// api/relograde-orders.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 🔐 Password verification
  const adminPassword = process.env.PASSWORD || process.env.ADMIN_PASSWORD;
  const providedPassword = req.query.password;

  if (!providedPassword) {
    return res.status(401).json({ success: false, error: 'Password is required to fetch orders' });
  }
  if (providedPassword !== adminPassword) {
    return res.status(403).json({ success: false, error: 'Invalid password' });
  }

  const apiKey = process.env.RELOGRADE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RELOGRADE_API_KEY not configured' });
  }

  try {
    const { trx } = req.query;

    // If a specific transaction ID is requested, fetch only that one (no filtering)
    if (trx) {
      const url = `https://connect.relograde.com/api/1.02/order?trx=${encodeURIComponent(trx)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Relograde API error response:', errorText);
        return res.status(response.status).json({ 
          error: `Relograde API responded with status ${response.status}`,
          details: errorText.substring(0, 200)
        });
      }

      const result = await response.json();
      let order = null;
      if (Array.isArray(result)) order = result[0];
      else if (result.data && Array.isArray(result.data)) order = result.data[0];
      else if (result.orders && Array.isArray(result.orders)) order = result.orders[0];
      else order = result;

      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const enrichedOrder = await enrichOrderWithFirebaseStatus(order);
      return res.status(200).json({ success: true, data: enrichedOrder });
    }

    // ---------- Fetch ALL orders from Relograde (pagination) ----------
    const limit = 100;
    let offset = 0;
    let allOrders = [];
    let hasMore = true;

    while (hasMore) {
      const url = `https://connect.relograde.com/api/1.02/order?limit=${limit}&offset=${offset}`;
      console.log(`Fetching orders: offset=${offset}, limit=${limit}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Relograde API error response:', errorText);
        return res.status(response.status).json({ 
          error: `Relograde API responded with status ${response.status}`,
          details: errorText.substring(0, 200)
        });
      }

      const result = await response.json();

      let pageOrders = [];
      if (Array.isArray(result)) pageOrders = result;
      else if (result.data && Array.isArray(result.data)) pageOrders = result.data;
      else if (result.orders && Array.isArray(result.orders)) pageOrders = result.orders;
      else pageOrders = [result];

      if (pageOrders.length === 0) {
        hasMore = false;
      } else {
        allOrders = allOrders.concat(pageOrders);
        offset += limit;
        if (pageOrders.length < limit) hasMore = false;
      }

      // Safety: prevent infinite loop
      if (offset > 10000) hasMore = false;
    }

    console.log(`Total orders fetched from Relograde: ${allOrders.length}`);

    let enrichedOrders = await Promise.all(allOrders.map(order => enrichOrderWithFirebaseStatus(order)));

    // Apply filtering: exclude finished, fail, and orders older than 24 hours
    enrichedOrders = enrichedOrders.filter(order => {
      if (order.orderStatus === 'finished') return false;
      if (order.orderStatus === 'fail') return false;

      const orderDateString = order.orderDate || order.createdAt || order.date;
      if (orderDateString) {
        const orderDate = new Date(orderDateString);
        const now = new Date();
        const hoursDiff = (now - orderDate) / (1000 * 60 * 60);
        if (hoursDiff > 24) return false;
      }
      return true;
    });

    console.log(`Orders after filtering: ${enrichedOrders.length}`);

    res.status(200).json({ success: true, count: enrichedOrders.length, data: enrichedOrders });

  } catch (error) {
    console.error('Error fetching orders:', error.message);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Checks Firebase CompletedOrders and FailOrders for the given order
 * and overrides orderStatus accordingly.
 * @param {Object} order - Relograde order object
 * @returns {Promise<Object>} Enriched order
 */
async function enrichOrderWithFirebaseStatus(order) {
  if (!order || !order.trx) return order;

  const firebaseUrl = process.env.FIREBASE_DATABASE_URL;
  const firebaseSecret = process.env.FIREBASE_SECRET;

  if (!firebaseUrl || !firebaseSecret) {
    console.warn('Firebase configuration missing, skipping status enrichment');
    return order;
  }

  try {
    // Check CompletedOrders
    const completedUrl = `${firebaseUrl}/CompletedOrders/${order.trx}.json?auth=${firebaseSecret}`;
    const completedRes = await fetch(completedUrl);
    if (completedRes.ok) {
      const completedData = await completedRes.json();
      if (completedData && completedData !== null) {
        order.orderStatus = 'finished';
        console.log(`✅ Order ${order.trx} found in CompletedOrders → status: finished`);
        return order;
      }
    }

    // Check FailOrders
    const failUrl = `${firebaseUrl}/FailOrders/${order.trx}.json?auth=${firebaseSecret}`;
    const failRes = await fetch(failUrl);
    if (failRes.ok) {
      const failData = await failRes.json();
      if (failData && failData !== null) {
        order.orderStatus = 'fail';
        console.log(`❌ Order ${order.trx} found in FailOrders → status: fail`);
        return order;
      }
    }

    return order;
  } catch (err) {
    console.error(`Error checking Firebase for order ${order.trx}:`, err.message);
    return order;
  }
}
