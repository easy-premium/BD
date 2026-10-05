// ============================================================
// api/proxy.js — Vercel Serverless Function
// Easy Premium — Recharge with per-user isolation + status check
// ============================================================

const FIREBASE_URL = 'https://easy-recharge-bd-default-rtdb.asia-southeast1.firebasedatabase.app';
const EFLEXI_BASE  = 'https://eflexi.net/api/v2';
const MAX_PASSWORDS = 20;

/* ============================================================
   🔐 পাসওয়ার্ড যাচাই
   ============================================================ */
function findUserKey(password) {
  if (!password || typeof password !== 'string') return null;
  const pwd = password.trim();
  if (!pwd) return null;
  for (let i = 1; i <= MAX_PASSWORDS; i++) {
    const key = `PASSWORD_${i}`;
    const stored = process.env[key];
    if (stored && String(stored).trim() === pwd) return key;
  }
  return null;
}

/* ============================================================
   🔥 Firebase REST helpers
   ============================================================ */
function fbUrl(path = '') {
  const secret = process.env.DATABASE_SECRETS;
  const p = path ? `/${path}` : '';
  return `${FIREBASE_URL}${p}.json?auth=${encodeURIComponent(secret)}`;
}

async function fbGet(path) {
  const res = await fetch(fbUrl(path));
  if (!res.ok) throw new Error(`FB GET ${res.status}`);
  return await res.json();
}

async function fbPatchRoot(updates) {
  const res = await fetch(fbUrl(''), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) throw new Error(`FB PATCH ${res.status}: ${await res.text()}`);
  return await res.json();
}

/* ============================================================
   🕒 বাংলাদেশ সময়
   ============================================================ */
function getTimeKeys(date = new Date()) {
  const bd = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  const yyyy = bd.getUTCFullYear();
  const mm = String(bd.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(bd.getUTCDate()).padStart(2, '0');
  const hh = String(bd.getUTCHours()).padStart(2, '0');
  const mi = String(bd.getUTCMinutes()).padStart(2, '0');
  const ss = String(bd.getUTCSeconds()).padStart(2, '0');
  return {
    year:  String(yyyy),
    month: `${yyyy}-${mm}`,
    day:   `${yyyy}-${mm}-${dd}`,
    full:  `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`
  };
}

/* ============================================================
   🚀 MAIN HANDLER
   ============================================================ */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, ...query } = req.query;

  let body = {};
  if (req.body) {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch { body = {}; }
  }

  try {
    switch (endpoint) {
      case 'balance':
      case 'site-balance':   return await handleSiteBalance(res);
      case 'verify':         return await handleVerify(res, body, query);
      case 'user-recharge':  return await handleUserRecharge(res, body, query);
      case 'history':        return await handleHistory(res, body, query);
      case 'check-status':   return await handleCheckStatus(res, body, query);   // ⭐ নতুন
      // পুরনো eflexi proxy (compat)
      case 'recharge':
      case 'status':
      case 'sms':            return await handleEflexiProxy(res, endpoint, query);
      default:
        return res.status(400).json({ status: false, message: 'Invalid endpoint' });
    }
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ status: false, message: 'Server error: ' + err.message });
  }
}

/* ============================================================
   🌐 সাইট ব্যালেন্স (পাবলিক)
   ============================================================ */
async function handleSiteBalance(res) {
  const API_KEY  = process.env.EFLEXI_KEY;
  const API_PASS = process.env.EFLEXI_PASS;
  if (!API_KEY || !API_PASS) {
    return res.status(500).json({ status: false, message: 'Server credentials missing' });
  }
  const url = new URL(`${EFLEXI_BASE}/balance`);
  url.searchParams.set('api_key',  API_KEY);
  url.searchParams.set('api_pass', API_PASS);
  const upstream = await fetch(url.toString());
  const data = await upstream.json();
  return res.status(200).json(data);
}

/* ============================================================
   🔐 পাসওয়ার্ড যাচাই
   ============================================================ */
async function handleVerify(res, body, query) {
  const password = body.password || query.password;
  const userKey  = findUserKey(password);

  if (!userKey) {
    return res.status(200).json({ status: false, matched: false, message: 'ভুল পাসওয়ার্ড' });
  }

  let userData;
  try {
    userData = await fbGet(userKey);
  } catch (e) {
    return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' });
  }
  if (!userData || typeof userData !== 'object') {
    return res.status(200).json({ status: false, matched: false, message: 'ইউজার ডেটা পাওয়া যায়নি' });
  }

  return res.status(200).json({
    status: true,
    matched: true,
    name:   userData.name   || '—',
    taka:   Number(userData.taka || 0),
    number: userData.number || '—',
    email:  userData.email  || '—',
    totalRecharge: userData['Total-Recharge'] || {}
  });
}

/* ============================================================
   💰 ইউজার রিচার্জ (atomic)
   ============================================================ */
async function handleUserRecharge(res, body, query) {
  const password = body.password || query.password;
  const number   = String(body.number   || query.number   || '').trim();
  const operator = String(body.operator || query.operator || '').trim().toUpperCase();
  const amount   = parseInt(body.amount  || query.amount, 10);

  if (!password)              return res.status(400).json({ status: false, message: 'পাসওয়ার্ড দিন' });
  if (!/^01[3-9]\d{8}$/.test(number))
                              return res.status(400).json({ status: false, message: 'সঠিক ১১ ডিজিটের নম্বর দিন' });
  if (!['GP','RB','BL','AT','TT','BT'].includes(operator))
                              return res.status(400).json({ status: false, message: 'অপারেটর সাপোর্টেড নয়' });
  if (!amount || amount < 10 || amount > 5000)
                              return res.status(400).json({ status: false, message: 'পরিমাণ ৳১০ থেকে ৳৫০০০' });

  const userKey = findUserKey(password);
  if (!userKey) return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });

  let userData;
  try { userData = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }
  if (!userData || typeof userData !== 'object')
    return res.status(200).json({ status: false, message: 'ইউজার ডেটা পাওয়া যায়নি' });

  const currentTaka = Number(userData.taka) || 0;
  if (currentTaka < amount) {
    return res.status(200).json({
      status: false,
      message: `পর্যাপ্ত ব্যালেন্স নেই। আপনার আছে ৳${currentTaka}`,
      taka: currentTaka
    });
  }

  /* --- eflexi এ রিচার্জ পাঠানো --- */
  const API_KEY  = process.env.EFLEXI_KEY;
  const API_PASS = process.env.EFLEXI_PASS;
  const refid = 'EP' + Date.now() + Math.random().toString(36).slice(2, 7).toUpperCase();

  const eflexiUrl = new URL(`${EFLEXI_BASE}/recharge`);
  eflexiUrl.searchParams.set('api_key',  API_KEY);
  eflexiUrl.searchParams.set('api_pass', API_PASS);
  eflexiUrl.searchParams.set('number',   number);
  eflexiUrl.searchParams.set('amount',   amount);
  eflexiUrl.searchParams.set('type',     'prepaid');
  eflexiUrl.searchParams.set('operator', operator);
  eflexiUrl.searchParams.set('refid',    refid);

  let eflexiData;
  try {
    const up = await fetch(eflexiUrl.toString());
    eflexiData = await up.json();
  } catch (err) {
    return res.status(502).json({ status: false, message: 'eflexi সার্ভার unreachable' });
  }

  const success = eflexiData && eflexiData.status === true;
  const trxid   = eflexiData?.trxid || refid;
  const timeKeys = getTimeKeys();

  const rechargeEntry = {
    amount:   amount,
    number:   number,
    operator: operator,
    refid:    refid,
    status:   success,
    trxid:    trxid,
    type:     'prepaid',
    time:     new Date().toISOString(),
    rawMessage: eflexiData?.message || ''
  };

  const updates = {};

  // ✅ শুধু সফল হলে taka কমবে ও Total-Recharge বাড়বে
  if (success) {
    const prevTotal = userData['Total-Recharge'] || {};
    updates[`${userKey}/taka`] = currentTaka - amount;

    updates[`${userKey}/Total-Recharge/${timeKeys.year}`]  =
      Number(prevTotal[timeKeys.year]  || 0) + amount;
    updates[`${userKey}/Total-Recharge/${timeKeys.month}`] =
      Number(prevTotal[timeKeys.month] || 0) + amount;
    updates[`${userKey}/Total-Recharge/${timeKeys.day}`]   =
      Number(prevTotal[timeKeys.day]   || 0) + amount;
  }

  // ✅ সব ক্ষেত্রেই রেকর্ড সেভ
  updates[`${userKey}/mobail-Recharge/${timeKeys.full}`] = rechargeEntry;

  try {
    await fbPatchRoot(updates);
  } catch (err) {
    console.error('Firebase update failed:', err);
    return res.status(500).json({
      status: false,
      message: 'রিচার্জ হয়েছে কিন্তু ডেটাবেসে সেভ ব্যর্থ। সাপোর্টে জানান।',
      trxid: trxid
    });
  }

  if (success) {
    return res.status(200).json({
      status: true,
      message: eflexiData.message || 'রিচার্জ সফল',
      trxid, amount, number, operator,
      newTaka: currentTaka - amount
    });
  } else {
    return res.status(200).json({
      status: false,
      message: eflexiData?.message || 'রিচার্জ ব্যর্থ',
      trxid
    });
  }
}

/* ============================================================
   📜 ইউজার হিস্ট্রি — শুধু নিজের
   ============================================================ */
async function handleHistory(res, body, query) {
  const password = body.password || query.password;
  const userKey  = findUserKey(password);

  if (!userKey) return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });

  let userData;
  try { userData = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }
  if (!userData) return res.status(200).json({ status: false, message: 'ইউজার ডেটা পাওয়া যায়নি' });

  const historyObj = userData['mobail-Recharge'] || {};
  const entries = Object.entries(historyObj)
    .map(([time, data]) => ({
      time,
      amount:   data.amount   || 0,
      number:   data.number   || '—',
      operator: data.operator || '—',
      status:   data.status === true,
      trxid:    data.trxid    || '—',
      refid:    data.refid    || '—',
      message:  data.rawMessage || (data.status ? 'সফল' : 'ব্যর্থ')
    }))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))   // newest first
    .slice(0, 100);

  const successCount = entries.filter(e => e.status).length;
  const failCount    = entries.length - successCount;
  const successSum   = entries.filter(e => e.status).reduce((s, e) => s + Number(e.amount || 0), 0);

  return res.status(200).json({
    status: true,
    name: userData.name || '—',
    taka: Number(userData.taka || 0),
    totalRecharge: userData['Total-Recharge'] || {},
    stats: {
      total: entries.length,
      success: successCount,
      failed: failCount,
      successAmount: successSum
    },
    history: entries
  });
}

/* ============================================================
   🔍 refid দিয়ে eflexi স্ট্যাটাস চেক — শুধু নিজের লেনদেন
   POST body: { password, refid }
   ============================================================ */
async function handleCheckStatus(res, body, query) {
  const password = body.password || query.password;
  const refid    = String(body.refid || query.refid || '').trim();

  if (!password) return res.status(400).json({ status: false, message: 'পাসওয়ার্ড দিন' });
  if (!refid)    return res.status(400).json({ status: false, message: 'refid দিন' });

  const userKey = findUserKey(password);
  if (!userKey) return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });

  /* --- ইউজারের ডেটা থেকে refid খুঁজে বের করা (ownership check) --- */
  let userData;
  try { userData = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const historyObj = userData?.['mobail-Recharge'] || {};
  let matchedTime = null;
  let matchedEntry = null;

  for (const [time, entry] of Object.entries(historyObj)) {
    if (entry && entry.refid === refid) {
      matchedTime = time;
      matchedEntry = entry;
      break;
    }
  }

  if (!matchedEntry) {
    return res.status(403).json({
      status: false,
      message: 'এই refid আপনার নয় অথবা লেনদেন পাওয়া যায়নি'
    });
  }

  /* --- eflexi স্ট্যাটাস API --- */
  const API_KEY  = process.env.EFLEXI_KEY;
  const API_PASS = process.env.EFLEXI_PASS;

  const url = new URL(`${EFLEXI_BASE}/status`);
  url.searchParams.set('api_key',  API_KEY);
  url.searchParams.set('api_pass', API_PASS);
  url.searchParams.set('refid',    refid);

  let upstreamData;
  try {
    const up = await fetch(url.toString());
    upstreamData = await up.json();
  } catch (err) {
    return res.status(502).json({ status: false, message: 'eflexi সার্ভার unreachable' });
  }

  /* --- যদি স্ট্যাটাস পরিবর্তন হয়ে success হয় → Firebase আপডেট --- */
  const wasSuccess = matchedEntry.status === true;
  const nowSuccess = upstreamData?.status === true &&
                     String(upstreamData?.recharge_status || '').toLowerCase().includes('success');

  // ⚠️ eflexi স্ট্যাটাস API থেকে exact "success" keyword কী হবে সেটা না জেনে
  //    আমরা শুধু "আগে fail ছিল, এখন status true" হলে success ধরে নিচ্ছি
  const statusChangedToSuccess = !wasSuccess && upstreamData?.status === true && nowSuccess;

  if (statusChangedToSuccess) {
    const timeKeys = getTimeKeys(new Date(matchedEntry.time || Date.now()));
    const prevTotal = userData['Total-Recharge'] || {};
    const amt = Number(matchedEntry.amount || 0);
    const currentTaka = Number(userData.taka || 0);

    const updates = {
      [`${userKey}/taka`]: currentTaka - amt,
      [`${userKey}/Total-Recharge/${timeKeys.year}`]:  Number(prevTotal[timeKeys.year]  || 0) + amt,
      [`${userKey}/Total-Recharge/${timeKeys.month}`]: Number(prevTotal[timeKeys.month] || 0) + amt,
      [`${userKey}/Total-Recharge/${timeKeys.day}`]:   Number(prevTotal[timeKeys.day]   || 0) + amt,
      [`${userKey}/mobail-Recharge/${matchedTime}/status`]: true,
      [`${userKey}/mobail-Recharge/${matchedTime}/rawMessage`]:
        upstreamData?.message || 'স্ট্যাটাস চেক থেকে সফল হয়েছে'
    };

    try {
      await fbPatchRoot(updates);
    } catch (err) {
      console.error('Status sync failed:', err);
      // তবুও eflexi থেকে পাওয়া ডেটা ফেরত দেব
    }
  }

  /* --- রেসপন্স --- */
  return res.status(200).json({
    status: true,
    local: {
      refid:    refid,
      amount:   matchedEntry.amount,
      number:   matchedEntry.number,
      operator: matchedEntry.operator,
      savedStatus: matchedEntry.status === true,
      time:     matchedTime
    },
    upstream: upstreamData,     // eflexi থেকে কাঁচা ডেটা
    synced: statusChangedToSuccess
  });
}

/* ============================================================
   🔁 Legacy eflexi proxy
   ============================================================ */
async function handleEflexiProxy(res, endpoint, query) {
  const API_KEY  = process.env.EFLEXI_KEY;
  const API_PASS = process.env.EFLEXI_PASS;
  if (!API_KEY || !API_PASS) {
    return res.status(500).json({ status: false, message: 'Server credentials missing' });
  }
  const url = new URL(`${EFLEXI_BASE}/${endpoint}`);
  url.searchParams.set('api_key',  API_KEY);
  url.searchParams.set('api_pass', API_PASS);
  for (const k in query) url.searchParams.set(k, query[k]);

  try {
    const upstream = await fetch(url.toString());
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ status: false, message: 'Upstream API unreachable' });
  }
}
