// api/order_completed.js
// Admin Order Management API - Complete, Fail & Delete Orders with Relograde Confirm

const RELOGRADE_API_URL = 'https://connect.relograde.com/api/1.02';
const RELOGRADE_API_KEY = process.env.RELOGRADE_API_KEY;
const ADMIN_PASSWORD = process.env.PASSWORD || process.env.ADMIN_PASSWORD; // Password for completing/failing orders

// Helper function for Relograde API calls
async function callRelogradeAPI(endpoint, method, data = null) {
  const url = `${RELOGRADE_API_URL}/${endpoint}`;
  const options = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RELOGRADE_API_KEY}`,
      'Accept': 'application/json'
    }
  };
  
  if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(data);
  }
  
  console.log(`📤 Relograde API Call: ${method} ${url}`);
  
  try {
    const response = await fetch(url, options);
    const result = await response.json();
    
    console.log(`📥 Response Status: ${response.status}`);
    console.log(`📥 Response Data:`, JSON.stringify(result, null, 2));
    
    if (!response.ok) {
      throw new Error(result.message || `API error: ${response.status}`);
    }
    
    return { success: true, data: result };
  } catch (error) {
    console.error('❌ Relograde API error:', error);
    return { success: false, error: error.message };
  }
}

// 🔥 Confirm Order Function
async function confirmRelogradeOrder(trxId) {
  console.log(`🔔 Confirming Relograde order: ${trxId}`);
  
  const confirmResult = await callRelogradeAPI(`order/confirm/${trxId}`, 'PATCH');
  
  if (!confirmResult.success) {
    console.error('❌ Relograde confirm failed:', confirmResult.error);
    return { success: false, error: confirmResult.error };
  }
  
  const orderData = confirmResult.data;
  console.log(`✅ Relograde order confirmed! Status: ${orderData.orderStatus}`);
  
  // Extract voucher codes if order is finished
  let voucherCodes = [];
  let voucherLinks = [];
  
  if (orderData.orderStatus === 'finished' && orderData.items) {
    for (const item of orderData.items) {
      if (item.orderLines && item.orderLines.length > 0) {
        for (const line of item.orderLines) {
          if (line.voucherCode) {
            voucherCodes.push(line.voucherCode);
            voucherLinks.push(`https://reward.relograde.com/${line.voucherCode}`);
            console.log(`🎫 Voucher found: ${line.voucherCode}`);
          }
        }
      }
    }
  }
  
  return { 
    success: true, 
    data: orderData,
    isFinished: orderData.orderStatus === 'finished',
    voucherCodes: voucherCodes,
    voucherLinks: voucherLinks
  };
}

// Helper to parse reference JSON and extract order details
function parseOrderReference(orderData) {
  if (!orderData || !orderData.reference) return null;
  try {
    const ref = JSON.parse(orderData.reference);
    return {
      firebaseOrderId: ref.firebaseOrderId,
      userId: ref.userId
    };
  } catch (e) {
    console.error('Failed to parse reference:', e);
    return null;
  }
}

// Helper to update multiple Firebase paths
async function updateFirebasePaths(paths, firebaseUrl, secret) {
  const updates = {};
  for (const [path, value] of Object.entries(paths)) {
    updates[path] = value;
  }
  const url = `${firebaseUrl}.json?auth=${secret}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Firebase patch failed: ${error}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }
  
  try {
    const { trxId, action, adminEmail, orderData, password } = req.body;
    
    console.log('📝 API Called:', { trxId, action, adminEmail });
    
    if (!trxId) {
      return res.status(400).json({ 
        success: false, 
        error: 'trxId is required' 
      });
    }
    
    if (!action || !['complete', 'fail', 'delete'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        error: 'action must be complete, fail or delete' 
      });
    }
    
    // 🔐 Password verification for complete and fail actions
    if (action === 'complete' || action === 'fail') {
      if (!password) {
        return res.status(401).json({
          success: false,
          error: `Password is required to ${action} an order`
        });
      }
      
      if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({
          success: false,
          error: 'Invalid password'
        });
      }
    }
    
    // Firebase config
    const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
    const FIREBASE_SECRET = process.env.FIREBASE_SECRET;
    
    if (!FIREBASE_DATABASE_URL || !FIREBASE_SECRET) {
      console.error('❌ Firebase config missing');
      return res.status(500).json({ 
        success: false, 
        error: 'Firebase configuration missing' 
      });
    }
    
    const timestamp = new Date().toISOString();
    const timestampMs = Date.now();
    
    // Parse order reference to get user ID and order ID
    const parsedRef = parseOrderReference(orderData);
    const firebaseOrderId = parsedRef?.firebaseOrderId;
    const userId = parsedRef?.userId;
    
    if (action === 'complete') {
      // ========== STEP 1: 🔥 CONFIRM ORDER IN RELOGRADE ==========
      console.log(`\n🔄 STEP 1: Confirming order ${trxId} in Relograde...`);
      
      let relogradeResult = null;
      let voucherCodes = [];
      let voucherLinks = [];
      let relogradeStatus = null;
      
      if (RELOGRADE_API_KEY) {
        relogradeResult = await confirmRelogradeOrder(trxId);
        if (relogradeResult.success) {
          relogradeStatus = relogradeResult.data.orderStatus;
          voucherCodes = relogradeResult.voucherCodes;
          voucherLinks = relogradeResult.voucherLinks;
          console.log(`✅ Relograde order confirmed. Status: ${relogradeStatus}`);
        } else {
          console.warn(`⚠️ Relograde confirm failed: ${relogradeResult.error}`);
        }
      } else {
        console.warn('⚠️ RELOGRADE_API_KEY not configured');
      }
      
      // ========== STEP 2: Prepare Firebase updates ==========
      const updates = {};
      
      // CompletedOrders entry
      updates[`completedOrders/${trxId}`] = {
        trxId: trxId,
        status: 'completed',
        completedBy: adminEmail,
        completedAt: timestampMs,
        completedAtISO: timestamp,
        orderData: orderData || null,
        relogradeConfirmStatus: relogradeStatus,
        relogradeConfirmSuccess: relogradeResult?.success || false,
        voucherCodes: voucherCodes,
        voucherLinks: voucherLinks
      };
      
      // Update transaction under trxId (Relograde key)
      updates[`transactions/${trxId}`] = {
        status: 'completed',
        completedAt: timestamp,
        relogradeConfirmStatus: relogradeStatus,
        voucherCodes: voucherCodes,
        voucherLinks: voucherLinks
      };
      
      // If we have firebaseOrderId and userId, update those nodes too
      if (firebaseOrderId && userId) {
        // Update user's order record
        updates[`userOrders/${userId}/${firebaseOrderId}/status`] = 'completed';
        updates[`userOrders/${userId}/${firebaseOrderId}/completedAt`] = timestamp;
        if (voucherLinks.length > 0) {
          updates[`userOrders/${userId}/${firebaseOrderId}/voucherData`] = {
            voucherLinks: voucherLinks,
            voucherCodes: voucherCodes
          };
        }
        // Update transaction under firebaseOrderId
        updates[`transactions/${firebaseOrderId}/status`] = 'completed';
        updates[`transactions/${firebaseOrderId}/completedAt`] = timestamp;
        if (voucherLinks.length > 0) {
          updates[`transactions/${firebaseOrderId}/voucherData`] = {
            voucherLinks: voucherLinks,
            voucherCodes: voucherCodes
          };
        }
      }
      
      // Also update the top-level userOrders/${trxId} for consistency
      updates[`userOrders/${trxId}`] = {
        status: 'completed',
        orderStatus: 'completed'
      };
      
      // Apply all updates
      await updateFirebasePaths(updates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
      
      console.log(`✅ Order ${trxId} completed by ${adminEmail}`);
      
      return res.status(200).json({
        success: true,
        message: 'Order completed successfully',
        data: { 
          trxId, 
          status: 'completed',
          relogradeConfirmed: relogradeResult?.success || false,
          relogradeStatus: relogradeStatus,
          voucherCodes: voucherCodes,
          voucherLinks: voucherLinks
        }
      });
      
    } else if (action === 'fail') {
      // ========== FAIL ORDER ==========
      console.log(`\n❌ Failing order ${trxId}...`);
      
      const updates = {};
      
      // Save to FailOrders
      updates[`FailOrders/${trxId}`] = {
        trxId: trxId,
        status: 'failed',
        failedBy: adminEmail,
        failedAt: timestampMs,
        failedAtISO: timestamp,
        orderData: orderData || null
      };
      
      // Update transaction under trxId
      updates[`transactions/${trxId}`] = {
        status: 'fail',
        orderStatus: 'fail',
        failedAt: timestamp
      };
      
      // Update top-level userOrders entry for this trxId
      updates[`userOrders/${trxId}`] = {
        status: 'fail',
        orderStatus: 'fail'
      };
      
      // If we have firebaseOrderId and userId, update those nodes too
      if (firebaseOrderId && userId) {
        // Update user's order record
        updates[`userOrders/${userId}/${firebaseOrderId}/status`] = 'fail';
        updates[`userOrders/${userId}/${firebaseOrderId}/orderStatus`] = 'fail';
        updates[`userOrders/${userId}/${firebaseOrderId}/failedAt`] = timestamp;
        // Update transaction under firebaseOrderId
        updates[`transactions/${firebaseOrderId}/status`] = 'fail';
        updates[`transactions/${firebaseOrderId}/orderStatus`] = 'fail';
        updates[`transactions/${firebaseOrderId}/failedAt`] = timestamp;
      }
      
      // Apply all updates
      await updateFirebasePaths(updates, FIREBASE_DATABASE_URL, FIREBASE_SECRET);
      
      console.log(`✅ Order ${trxId} marked as failed by ${adminEmail}`);
      
      return res.status(200).json({
        success: true,
        message: 'Order marked as failed',
        data: { trxId, status: 'fail' }
      });
      
    } else if (action === 'delete') {
      // Delete order - backup and remove
      const backupData = {
        trxId: trxId,
        deletedBy: adminEmail,
        deletedAt: timestampMs,
        deletedAtISO: timestamp,
        originalData: orderData || null
      };
      
      const backupUrl = `${FIREBASE_DATABASE_URL}/deletedOrders/${trxId}.json?auth=${FIREBASE_SECRET}`;
      await fetch(backupUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupData)
      });
      
      const deleteUrl = `${FIREBASE_DATABASE_URL}/completedOrders/${trxId}.json?auth=${FIREBASE_SECRET}`;
      await fetch(deleteUrl, { method: 'DELETE' });
      
      console.log(`✅ Order ${trxId} deleted by ${adminEmail}`);
      
      return res.status(200).json({
        success: true,
        message: 'Order deleted successfully',
        data: { trxId, deleted: true }
      });
    }
    
  } catch (error) {
    console.error('❌ API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
