// api/webhook.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const payload = req.body;
    console.log('📩 Webhook received:', payload.event);

    if (payload.event === 'ORDER_FINISHED') {
      const { trx, reference } = payload.data || {};
      console.log(`🔔 Order finished: trx=${trx}, reference=${reference}`);

      // রেফারেন্স পার্স করুন (JSON ফরম্যাট)
      let firebaseOrderId = null;
      let userId = null;
      try {
        const refData = JSON.parse(reference);
        firebaseOrderId = refData.firebaseOrderId;
        userId = refData.userId;
        console.log(`✅ Parsed: firebaseOrderId=${firebaseOrderId}, userId=${userId}`);
      } catch (e) {
        console.error('❌ Failed to parse reference JSON:', e.message);
        return res.status(200).json({ received: true, warning: 'Invalid reference' });
      }

      if (!firebaseOrderId) {
        console.warn('⚠️ firebaseOrderId missing');
        return res.status(200).json({ received: true, warning: 'No firebaseOrderId' });
      }

      // Firebase কনফিগারেশন
      const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
      const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

      if (!FIREBASE_DATABASE_URL || !FIREBASE_SECRET) {
        console.error('❌ Missing Firebase config');
        return res.status(500).json({ error: 'Firebase not configured' });
      }

      // Relograde থেকে অর্ডার ডিটেইলস এনে টোকেন/ভাউচার তথ্য সংগ্রহ
      const apiKey = process.env.RELOGRADE_API_KEY;
      let voucherData = null;
      if (apiKey && trx) {
        try {
          const orderRes = await fetch(`https://connect.relograde.com/api/1.02/order/${trx}`, {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (orderRes.ok) {
            const orderDetails = await orderRes.json();
            console.log('📦 Order details from Relograde received');

            // 🔥 ইম্প্রুভড টোকেন এক্সট্রাকশন লজিক
            let token = null;
            let voucherLink = null;
            let voucherCode = null;

            if (orderDetails.items && orderDetails.items.length > 0) {
              const firstItem = orderDetails.items[0];
              if (firstItem.orderLines && firstItem.orderLines.length > 0) {
                const firstLine = firstItem.orderLines[0];

                // 1. সরাসরি token ফিল্ড (আগের কাঠামো)
                token = firstLine.token || null;

                // 2. যদি token না পাওয়া যায়, তবে product স্ট্রিং-এর ভিতরে খুঁজুন (নতুন কাঠামো)
                if (!token && firstLine.product && typeof firstLine.product === 'string') {
                  try {
                    const productObj = JSON.parse(firstLine.product);
                    token = productObj.token || null;
                    console.log('✅ Token extracted from product string:', token);
                  } catch (parseError) {
                    console.log('⚠️ Could not parse product string');
                  }
                }

                // 3. voucherCode খোঁজা
                voucherCode = firstLine.voucherCode || null;

                // 4. যদি কিছু না পাওয়া যায়, তবে পুরো orderLines লুপ করে দেখি (ভবিষ্যতের জন্য)
                if (!token) {
                  for (const line of firstItem.orderLines) {
                    if (line.token) {
                      token = line.token;
                      break;
                    }
                    if (line.product && typeof line.product === 'string') {
                      try {
                        const productObj = JSON.parse(line.product);
                        if (productObj.token) {
                          token = productObj.token;
                          break;
                        }
                      } catch (e) {}
                    }
                  }
                }
              }
            }

            // voucherLink তৈরি (token থাকলে)
            if (token) {
              voucherLink = `https://reward.relograde.com/${token}`;
            }

            voucherData = {
              token: token,
              voucherLink: voucherLink,
              voucherCode: voucherCode,
            };
            console.log('✅ Extracted voucher data:', voucherData);
          } else {
            console.error('❌ Failed to fetch order details from Relograde');
          }
        } catch (err) {
          console.error('❌ Error fetching order details:', err.message);
        }
      }

      // আপডেট ডাটা প্রস্তুত (completed স্ট্যাটাস ও ভাউচার তথ্য একসাথে)
      const updates = {
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      if (voucherData) {
        updates.voucherData = voucherData;
      }

      // ========== 1. transactions আপডেট ==========
      const transactionDirectUrl = `${FIREBASE_DATABASE_URL}/transactions/${firebaseOrderId}.json?auth=${FIREBASE_SECRET}`;
      const directCheck = await fetch(transactionDirectUrl, { method: 'GET' });

      if (directCheck.ok) {
        const transactionData = await directCheck.json();
        if (transactionData && transactionData.orderId === firebaseOrderId) {
          await fetch(transactionDirectUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });
          console.log(`✅ Transaction ${firebaseOrderId} updated directly with voucher`);
        } else {
          await updateTransactionViaSearch(firebaseOrderId, updates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
        }
      } else {
        await updateTransactionViaSearch(firebaseOrderId, updates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
      }

      // ========== 2. userOrders আপডেট ==========
      if (userId) {
        const userUpdates = {
          status: 'completed'
        };
        if (voucherData) {
          userUpdates.voucherData = voucherData;
          userUpdates.voucherLink = voucherData.voucherLink;
        }

        const userOrderDirectUrl = `${FIREBASE_DATABASE_URL}/userOrders/${userId}/${firebaseOrderId}.json?auth=${FIREBASE_SECRET}`;
        const userCheck = await fetch(userOrderDirectUrl, { method: 'GET' });

        if (userCheck.ok) {
          const userData = await userCheck.json();
          if (userData) {
            await fetch(userOrderDirectUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(userUpdates),
            });
            console.log(`✅ User order updated for user ${userId} with voucher data`);
          } else {
            console.warn(`⚠️ User order not found at direct path, trying fallback...`);
            await updateUserOrderViaSearch(userId, firebaseOrderId, userUpdates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
          }
        } else {
          console.warn(`⚠️ Failed to access user order direct path, trying fallback...`);
          await updateUserOrderViaSearch(userId, firebaseOrderId, userUpdates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

// সার্চ করে ট্রানজেকশন আপডেট করার ফাংশন (পুরনো পদ্ধতি)
async function updateTransactionViaSearch(orderId, updates, dbUrl, secret) {
  const findUrl = `${dbUrl}/transactions.json?orderBy="orderId"&equalTo="${orderId}"&auth=${secret}`;
  const findRes = await fetch(findUrl);
  const findData = await findRes.json();

  if (findData && typeof findData === 'object') {
    const keys = Object.keys(findData);
    if (keys.length > 0) {
      const transactionKey = keys[0];
      const updateUrl = `${dbUrl}/transactions/${transactionKey}.json?auth=${secret}`;
      await fetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      console.log(`✅ Transaction ${orderId} updated via search (key: ${transactionKey}) with voucher`);
    } else {
      console.warn(`⚠️ No transaction found with orderId ${orderId}`);
    }
  } else {
    console.warn(`⚠️ Transaction search failed for orderId ${orderId}`);
  }
}


async function updateUserOrderViaSearch(userId, orderId, updates, dbUrl, secret) {
  const userOrdersUrl = `${dbUrl}/userOrders/${userId}.json?auth=${secret}`;
  const userOrdersRes = await fetch(userOrdersUrl);
  const userOrders = await userOrdersRes.json();

  if (userOrders && typeof userOrders === 'object') {
    for (const key in userOrders) {
      if (userOrders[key].orderId === orderId) {
        const updateUrl = `${dbUrl}/userOrders/${userId}/${key}.json?auth=${secret}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        console.log(`✅ User order updated for user ${userId} via search (key: ${key}) with voucher:`, updates.voucherData);
        return;
      }
    }
    console.warn(`⚠️ No matching user order found for userId ${userId} with orderId ${orderId}`);
  } else {
    console.warn(`⚠️ No userOrders found for userId ${userId}`);
  }
}
