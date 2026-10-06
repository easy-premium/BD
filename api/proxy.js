// ============================================================
// api/proxy.js — Vercel Serverless Function
// Easy Premium — Recharge with race-safe Firebase updates (FIXED)
// + Telegram Bot Logging
// ============================================================

const FIREBASE_URL = 'https://easy-recharge-bd-default-rtdb.asia-southeast1.firebasedatabase.app';
const EFLEXI_BASE  = 'https://eflexi.net/api/v2';
const MAX_PASSWORDS = 20;
const MAX_PATCH_RETRIES = 3;

/* ============================================================
   📢 টেলিগ্রাম লগ — সব ইভেন্ট এখান থেকে যায়
   ============================================================ */
async function sendTelegramLog(message) {
  const token  = process.env.TELEGRAM_BOT_TOKENa;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });
  } catch (e) {
    console.error('Telegram log failed:', e.message);
  } finally {
    clearTimeout(timeoutId);
  }
}

/* বাংলাদেশ সময় (লগে দেখানোর জন্য) */
function formatBDTime(date = new Date()) {
  const bd = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(bd.getUTCDate())}/${pad(bd.getUTCMonth() + 1)}/${bd.getUTCFullYear()} ${pad(bd.getUTCHours())}:${pad(bd.getUTCMinutes())}:${pad(bd.getUTCSeconds())}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtBDT(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

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
  const data = await res.json();
  const etag = res.headers.get('etag') || null;
  return { data, etag };
}

async function fbPatchUser(userKey, updates, etag = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag;

  const res = await fetch(fbUrl(userKey), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates)
  });

  if (res.status === 412) return { conflict: true };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FB PATCH ${res.status}: ${text}`);
  }
  return { ok: true, data: await res.json() };
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
   🔍 eflexi success detection
   ============================================================ */
function isEflexiRechargeSuccess(upstream) {
  if (!upstream) return false;
  const rs = String(upstream.recharge_status || upstream.rechargeStatus || '').toLowerCase().trim();
  const failWords = ['fail', 'error', 'cancel', 'reject', 'pending', 'process', 'refund'];
  if (failWords.some(w => rs.includes(w))) return false;
  const successWords = ['success', 'complete', 'completed', 'done', 'paid', 'approved'];
  if (successWords.some(w => rs.includes(w))) return true;
  if (!rs && (upstream.status === true || upstream.status === 'true')) return true;
  return false;
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
      case 'check-status':   return await handleCheckStatus(res, body, query);
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
   🌐 সাইট ব্যালেন্স
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
    /* 🚨 ভুল পাসওয়ার্ড চেষ্টা → টেলিগ্রামে সতর্কতা */
    sendTelegramLog(
`🚨 <b>ভুল পাসওয়ার্ড চেষ্টা</b>

🔑 পাসওয়ার্ড: <code>${escapeHtml(password || '—')}</code>
🕐 সময়: ${formatBDTime()}
📍 Endpoint: verify
⚠️ কেউ ভুল পাসওয়ার্ড দিয়ে ঢোকার চেষ্টা করছে`
    );
    return res.status(200).json({ status: false, matched: false, message: 'ভুল পাসওয়ার্ড' });
  }

  let got;
  try { got = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const userData = got.data;
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
   💰 ইউজার রিচার্জ — Race-safe + Telegram Log
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
  if (!userKey) {
    /* 🚨 ভুল পাসওয়ার্ডে রিচার্জ চেষ্টা */
    sendTelegramLog(
`🚨 <b>ভুল পাসওয়ার্ডে রিচার্জ চেষ্টা</b>

🔑 পাসওয়ার্ড: <code>${escapeHtml(password)}</code>
📱 নম্বর: <code>${escapeHtml(number)}</code>
📶 অপারেটর: ${escapeHtml(operator)}
💰 পরিমাণ: ৳${amount}
🕐 সময়: ${formatBDTime()}
⚠️ কেউ ভুল পাসওয়ার্ড দিয়ে রিচার্জের চেষ্টা করেছে`
    );
    return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });
  }

  /* --- ইউজার পড়া + taka চেক --- */
  let initial;
  try { initial = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const userData = initial.data;
  if (!userData || typeof userData !== 'object')
    return res.status(200).json({ status: false, message: 'ইউজার ডেটা পাওয়া যায়নি' });

  const userName   = userData.name || userKey;
  const currentTaka = Number(userData.taka) || 0;

  if (currentTaka < amount) {
    sendTelegramLog(
`⚠️ <b>পর্যাপ্ত ব্যালেন্স নেই</b>

👤 ইউজার: ${escapeHtml(userName)} (${escapeHtml(userKey)})
📱 নম্বর: <code>${escapeHtml(number)}</code>
📶 অপারেটর: ${escapeHtml(operator)}
💰 অনুরোধ: ৳${amount}
💵 আছে: ৳${fmtBDT(currentTaka)}
🕐 সময়: ${formatBDTime()}`
    );
    return res.status(200).json({
      status: false,
      message: `পর্যাপ্ত ব্যালেন্স নেই। আপনার আছে ৳${currentTaka}`,
      taka: currentTaka,
      saved: false
    });
  }

  /* --- eflexi এ রিচার্জ --- */
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

  let eflexiData  = null;
  let eflexiError = null;

  try {
    const up = await fetch(eflexiUrl.toString());
    eflexiData = await up.json().catch(() => null);
    if (!eflexiData) eflexiError = 'eflexi ফাঁকা রেসপন্স দিয়েছে';
  } catch (err) {
    eflexiError = 'eflexi সার্ভার unreachable: ' + err.message;
  }

  const success = !eflexiError && eflexiData && eflexiData.status === true;
  const trxid   = (eflexiData && eflexiData.trxid) || refid;
  const errMsg  = eflexiError || (eflexiData && eflexiData.message) || 'রিচার্জ ব্যর্থ';
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
    rawMessage: errMsg
  };

  /* --- Firebase এ atomic PATCH --- */
  let saved = false;
  let lastError = null;
  let finalNewTaka = currentTaka;
  let finalTotalYear = 0, finalTotalMonth = 0, finalTotalDay = 0;

  for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
    let fresh;
    try { fresh = await fbGet(userKey); }
    catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 80));
      continue;
    }

    const freshData = fresh.data || {};
    const freshTaka = Number(freshData.taka) || 0;
    const prevTotal = freshData['Total-Recharge'] || {};

    const updates = {
      [`mobail-Recharge/${timeKeys.full}`]: rechargeEntry
    };

    if (success) {
      const newTaka = Math.max(0, freshTaka - amount);
      finalNewTaka = newTaka;

      finalTotalYear  = Number(prevTotal[timeKeys.year]  || 0) + amount;
      finalTotalMonth = Number(prevTotal[timeKeys.month] || 0) + amount;
      finalTotalDay   = Number(prevTotal[timeKeys.day]   || 0) + amount;

      updates[`taka`] = newTaka;
      updates[`Total-Recharge/${timeKeys.year}`]  = finalTotalYear;
      updates[`Total-Recharge/${timeKeys.month}`] = finalTotalMonth;
      updates[`Total-Recharge/${timeKeys.day}`]   = finalTotalDay;
    } else {
      finalNewTaka = freshTaka;
    }

    try {
      const result = await fbPatchUser(userKey, updates, fresh.etag);
      if (result.conflict) {
        await new Promise(r => setTimeout(r, 80));
        continue;
      }
      saved = true;
      break;
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 80));
    }
  }

  /* ============================================================
     📢 Telegram লগ — সফল বা ব্যর্থ
     ============================================================ */

  if (!saved) {
    /* Firebase save fail — এটাও লগ করি */
    sendTelegramLog(
`🔥 <b>সিস্টেম ইরর — ডেটাবেস সেভ ব্যর্থ</b>

👤 ইউজার: ${escapeHtml(userName)} (${escapeHtml(userKey)})
📱 নম্বর: <code>${escapeHtml(number)}</code>
💰 পরিমাণ: ৳${amount}
📊 eflexi: ${success ? '✅ সফল' : '❌ ব্যর্থ'}
🔖 Ref: <code>${refid}</code>
🕐 সময়: ${formatBDTime()}
⚠️ ${success ? 'টাকা কেটে গেছে কিন্তু হিসাব সেভ হয়নি' : 'লগ সেভ হয়নি'}
🚨 সাথে সাথে Firebase চেক করুন!`
    );

    console.error('Firebase update failed after retries:', lastError);
    return res.status(500).json({
      status: success,
      message: success
        ? `রিচার্জ সফল হয়েছে কিন্তু হিসাব সেভ ব্যর্থ। refid: ${refid} — সাপোর্টে জানান।`
        : `রিচার্জ ব্যর্থ এবং লগ সেভ হয়নি: ${errMsg}`,
      trxid: trxid,
      refid: refid,
      saved: false
    });
  }

  /* ✅ সব সেভ হয়ে গেছে — এখন সুন্দর লগ */

  if (success) {
    sendTelegramLog(
`✅ <b>রিচার্জ সফল</b>

👤 ইউজার: <b>${escapeHtml(userName)}</b> (${escapeHtml(userKey)})
📱 নম্বর: <code>${escapeHtml(number)}</code>
📶 অপারেটর: ${escapeHtml(operator)}
💰 পরিমাণ: <b>৳${amount}</b>
🎫 TRX ID: <code>${escapeHtml(trxid)}</code>
🔖 Ref ID: <code>${escapeHtml(refid)}</code>

💵 আগের ব্যালেন্স: ৳${fmtBDT(currentTaka)}
💵 নতুন ব্যালেন্স: ৳${fmtBDT(finalNewTaka)}

📊 <b>মোট রিচার্জ (${escapeHtml(userName)})</b>
  • এই বছর (${timeKeys.year}): ৳${fmtBDT(finalTotalYear)}
  • এই মাস (${timeKeys.month}): ৳${fmtBDT(finalTotalMonth)}
  • আজ (${timeKeys.day}): ৳${fmtBDT(finalTotalDay)}

🕐 সময়: ${formatBDTime()}`
    );
  } else {
    sendTelegramLog(
`❌ <b>রিচার্জ ব্যর্থ</b>

👤 ইউজার: <b>${escapeHtml(userName)}</b> (${escapeHtml(userKey)})
📱 নম্বর: <code>${escapeHtml(number)}</code>
📶 অপারেটর: ${escapeHtml(operator)}
💰 পরিমাণ: ৳${amount}
🎫 TRX ID: <code>${escapeHtml(trxid)}</code>
🔖 Ref ID: <code>${escapeHtml(refid)}</code>
📝 কারণ: ${escapeHtml(errMsg)}
💵 ব্যালেন্স অপরিবর্তিত: ৳${fmtBDT(currentTaka)}
🕐 সময়: ${formatBDTime()}`
    );
  }

  /* --- রেসপন্স --- */
  if (success) {
    return res.status(200).json({
      status: true,
      message: (eflexiData && eflexiData.message) || 'রিচার্জ সফল',
      trxid, refid, amount, number, operator,
      newTaka: finalNewTaka,
      saved: true
    });
  } else {
    return res.status(200).json({
      status: false,
      message: errMsg,
      trxid, refid,
      saved: true
    });
  }
}

/* ============================================================
   📜 ইউজার হিস্ট্রি
   ============================================================ */
async function handleHistory(res, body, query) {
  const password = body.password || query.password;
  const userKey  = findUserKey(password);

  if (!userKey) return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });

  let got;
  try { got = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const userData = got.data;
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
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
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
   🔍 refid দিয়ে স্ট্যাটাস চেক — Auto-sync + Telegram log
   ============================================================ */
async function handleCheckStatus(res, body, query) {
  const password = body.password || query.password;
  const refid    = String(body.refid || query.refid || '').trim();

  if (!password) return res.status(400).json({ status: false, message: 'পাসওয়ার্ড দিন' });
  if (!refid)    return res.status(400).json({ status: false, message: 'refid দিন' });

  const userKey = findUserKey(password);
  if (!userKey) return res.status(200).json({ status: false, message: 'ভুল পাসওয়ার্ড' });

  let got;
  try { got = await fbGet(userKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const userData = got.data || {};
  const historyObj = userData['mobail-Recharge'] || {};
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

  const wasSuccess = matchedEntry.status === true;
  const nowSuccess = isEflexiRechargeSuccess(upstreamData);
  const statusChangedToSuccess = !wasSuccess && nowSuccess;

  if (statusChangedToSuccess) {
    const timeKeys = getTimeKeys(new Date(matchedEntry.time || Date.now()));
    const amt = Number(matchedEntry.amount || 0);
    let finalNewTaka = 0;

    for (let attempt = 0; attempt < MAX_PATCH_RETRIES; attempt++) {
      let fresh;
      try { fresh = await fbGet(userKey); }
      catch (e) {
        await new Promise(r => setTimeout(r, 80));
        continue;
      }

      const freshData = fresh.data || {};
      const freshTaka = Number(freshData.taka) || 0;
      const prevTotal = freshData['Total-Recharge'] || {};

      finalNewTaka = Math.max(0, freshTaka - amt);

      const updates = {
        [`taka`]: finalNewTaka,
        [`Total-Recharge/${timeKeys.year}`]:  Number(prevTotal[timeKeys.year]  || 0) + amt,
        [`Total-Recharge/${timeKeys.month}`]: Number(prevTotal[timeKeys.month] || 0) + amt,
        [`Total-Recharge/${timeKeys.day}`]:   Number(prevTotal[timeKeys.day]   || 0) + amt,
        [`mobail-Recharge/${matchedTime}/status`]: true,
        [`mobail-Recharge/${matchedTime}/rawMessage`]:
          upstreamData?.message || 'স্ট্যাটাস চেক থেকে সফল হয়েছে'
      };

      try {
        const result = await fbPatchUser(userKey, updates, fresh.etag);
        if (result.conflict) {
          await new Promise(r => setTimeout(r, 80));
          continue;
        }
        break;
      } catch (e) {
        console.error('Status sync failed:', e);
        await new Promise(r => setTimeout(r, 80));
      }
    }

    /* 📢 Auto-sync লগ */
    sendTelegramLog(
`🔄 <b>অটো সিঙ্ক — ব্যর্থ লেনদেন সফল হয়েছে</b>

👤 ইউজার: <b>${escapeHtml(userData.name || userKey)}</b> (${escapeHtml(userKey)})
📱 নম্বর: <code>${escapeHtml(matchedEntry.number || '—')}</code>
📶 অপারেটর: ${escapeHtml(matchedEntry.operator || '—')}
💰 পরিমাণ: ৳${amt}
🎫 TRX ID: <code>${escapeHtml(upstreamData?.recharge_trxid || '—')}</code>
🔖 Ref ID: <code>${escapeHtml(refid)}</code>
💵 নতুন ব্যালেন্স: ৳${fmtBDT(finalNewTaka)}
📝 eflexi: ${escapeHtml(upstreamData?.recharge_status || upstreamData?.message || '—')}
🕐 সময়: ${formatBDTime()}
ℹ️ অটো-চেক থেকে হিসাব আপডেট হয়েছে`
    );
  }

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
    upstream: upstreamData,
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
