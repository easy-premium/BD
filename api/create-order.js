// api/create-order.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ========== 1. ORDER CREATION (original logic) ==========
  const apiKey = process.env.RELOGRADE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RELOGRADE_API_KEY not configured' });

  const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
  const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
  const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
  const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

  const { productSlug, amount, paymentCurrency, reference, faceValue, firebaseOrderId, serviceCharge } = req.body;

  if (!productSlug || !amount || !paymentCurrency) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const amountInt = parseInt(amount);
  if (isNaN(amountInt) || amountInt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer' });
  }

  try {
    // Parse reference to get phone, txid, userId, email, admin
    let paymentMethod = 'UNKNOWN';
    let phone = '', txid = '', userId = '', email = '', admin = '';

    if (reference) {
      try {
        const parsedRef = JSON.parse(reference);
        paymentMethod = parsedRef.method || 'UNKNOWN';
        phone = parsedRef.phone || '';
        txid = parsedRef.txid || '';
        userId = parsedRef.userId || '';
        email = parsedRef.email || '';
        admin = parsedRef.admin || '';
      } catch (e) {
        console.error('Failed to parse reference JSON, falling back to pipe parsing:', e);
        const referenceParts = reference.split('|');
        paymentMethod = referenceParts[0] || 'UNKNOWN';
        referenceParts.forEach(part => {
          if (part.startsWith('Phone:')) phone = part.replace('Phone:', '');
          if (part.startsWith('TXID:')) txid = part.replace('TXID:', '');
          if (part.startsWith('UserID:')) userId = part.replace('UserID:', '');
          if (part.startsWith('Email:')) email = part.replace('Email:', '');
          if (part.startsWith('Admin:')) admin = part.replace('Admin:', '');
        });
      }
    }

    const finalOrderId = firebaseOrderId || 'REL' + Math.random().toString(36).substring(2, 15).toUpperCase();
    const dummyTimestamp = "2024-01-01T00:00:00.000Z";
    const dummyFormattedDate = "১ জানুয়ারি ২০২৪";

    const serviceChargeInt = serviceCharge ? parseInt(serviceCharge) : 0;
    const totalAmount = amountInt + serviceChargeInt;

    const formattedPrice = `${amountInt} ${paymentCurrency}`;
    const formattedTotalPrice = `${totalAmount} ${paymentCurrency}`;
    const platformName = productSlug.includes('variable') ? 'Rewarble Visa Variable USD' : productSlug;

    const items = [{ productSlug, amount: 1 }];
    if (faceValue !== undefined && faceValue !== null) {
      const faceValueNum = parseFloat(faceValue);
      if (!isNaN(faceValueNum) && faceValueNum > 0) {
        items[0].faceValue = faceValueNum;
      }
    }

    const relogradeReference = JSON.stringify({
      firebaseOrderId: finalOrderId,
      paymentMethod,
      phone,
      txid,
      userId,
      email,
      admin
    });

    const requestBody = {
      items,
      paymentCurrency: paymentCurrency.toLowerCase(),
      reference: relogradeReference
    };

    const response = await fetch('https://connect.relograde.com/api/1.02/order', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Relograde API responded with status ${response.status}: ${errorText}`);
    }

    const relogradeData = await response.json();

    // ✅ FIX: Get transaction ID from the correct location (data.trx)
    let relogradeTrx = null;
    if (relogradeData.data && relogradeData.data.trx) {
      relogradeTrx = relogradeData.data.trx;
    } else if (relogradeData.trx) {
      relogradeTrx = relogradeData.trx; // fallback for older structure
    }
    console.log(`✅ Relograde transaction ID: ${relogradeTrx}`);

    // ========== 2. FIREBASE WRITE (NEW) ==========
    const dbUrl = process.env.FIREBASE_DATABASE_URL;
    const secret = process.env.FIREBASE_SECRET;

    // Determine order status: if user provided phone+txid, it's "waiting", else "pending"
    const orderStatus = (phone && txid) ? 'waiting' : 'pending';

    if (dbUrl && secret) {
      try {
        // Prepare order data (admin যোগ করা হয়েছে)
        const firebaseOrder = {
          orderId: finalOrderId,
          userId: userId || 'guest',
          userEmail: email || '',
          platformId: productSlug,
          platform: platformName,
          amount: amountInt,
          price: amountInt.toString(),
          serviceCharge: serviceChargeInt,
          totalAmount: totalAmount,
          status: orderStatus,
          phone: phone || null,
          txid: txid || null,
          paymentMethod: paymentMethod,
          orderDate: new Date().toISOString(),
          timestamp: Date.now(),
          relogradeTrx: relogradeTrx,
          admin: admin || null          // 👈 নতুন যোগকৃত ফিল্ড
        };

        // Write to transactions node (key = orderId)
        const transactionUrl = `${dbUrl}/transactions/${finalOrderId}.json?auth=${secret}`;
        await fetch(transactionUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(firebaseOrder)
        });

        // Write to userOrders node if userId exists
        if (userId && userId !== 'guest') {
          const userOrderUrl = `${dbUrl}/userOrders/${userId}/${finalOrderId}.json?auth=${secret}`;
          await fetch(userOrderUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firebaseOrder)
          });
        }

        console.log(`✅ Order written to Firebase with status: ${orderStatus}`);
      } catch (firebaseError) {
        console.error('⚠️ Failed to write to Firebase:', firebaseError.message);
        // Continue – order creation still successful
      }
    } else {
      console.warn('⚠️ Firebase config missing, skipping DB write');
    }

    // ========== 3. EMAIL SENDING (original) ==========
    const orderLinkData = {
      OrderId: relogradeTrx || finalOrderId,
      PaymentMethods: paymentMethod,
      PaymentNumber: phone || 'N/A',
      PaymentTrxID: txid || 'N/A',
      Time: dummyTimestamp,
      email,
      platformId: productSlug,
      uid: userId || 'guest',
      amount: amountInt,
      currency: 'BDT',
      faceValue: faceValue || null,
      status: orderStatus,
      serviceCharge: serviceChargeInt,
      totalAmount: totalAmount
    };
    const jsonString = JSON.stringify(orderLinkData);
    const base64Data = Buffer.from(jsonString).toString('base64');
    const orderLink = `https://www.easy-premium.com/Checking?data=${encodeURIComponent(base64Data)}`;

    async function sendEmailWithLink() {
      if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) {
        console.log('❌ EmailJS credentials missing');
        return false;
      }
      if (!email) {
        console.log('❌ No email provided');
        return false;
      }
      try {
        const emailjsUrl = 'https://api.emailjs.com/api/v1.0/email/send';
        const templateParams = {
          to_email: email,
          to_name: userId || 'Valued Customer',
          order_id: relogradeTrx || finalOrderId,
          platform: platformName,
          order_date: dummyFormattedDate,
          payment_link: orderLink,
          payment_method: paymentMethod,
          payment_number: phone || 'N/A',
          transaction_id: txid || 'N/A',
          user_id: userId || 'guest',
          status: orderStatus,
          amount: formattedPrice,
          total_amount: formattedTotalPrice,
          face_value: faceValue ? `$${faceValue}` : 'N/A',
          from_name: 'Easy Premium',
          reply_to: 'support@easy-premium.com'
        };
        console.log('📧 Sending email with params:', templateParams);
        const emailResponse = await fetch(emailjsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            template_params: templateParams,
            accessToken: EMAILJS_PRIVATE_KEY
          })
        });
        const responseText = await emailResponse.text();
        console.log('📨 EmailJS response:', responseText);
        if (!emailResponse.ok) {
          console.error('❌ EmailJS error:', responseText);
          return false;
        }
        return true;
      } catch (emailError) {
        console.error('❌ Email error:', emailError);
        return false;
      }
    }

    let emailSent = false;
    if (email) {
      emailSent = await sendEmailWithLink();
    }

    return res.status(200).json({
      success: true,
      trx: finalOrderId,
      link: orderLink,
      emailSent,
      relogradeResponse: relogradeData,
      orderData: {
        orderId: finalOrderId,
        paymentMethod,
        paymentNumber: phone,
        transactionId: txid,
        time: dummyTimestamp,
        email,
        platformId: productSlug,
        faceValue: faceValue || null,
        serviceCharge: serviceChargeInt,
        totalAmount: totalAmount,
        status: orderStatus,
        admin: admin || null            // 👈 নতুন যোগকৃত ফিল্ড
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    return res.status(500).json({
      error: 'Failed to create order',
      details: error.message
    });
  }
}
