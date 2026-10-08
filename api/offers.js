// ============================================================
// api/offers.js — Officer Reports API
// 🚨 শুধুমাত্র PASSWORD_1 + PASSWORD_1_UID (Main Admin)
// ============================================================

const FIREBASE_URL = 'https://easy-recharge-bd-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_PASSWORDS = 20;

/* ============================================================
   📢 Telegram লগ
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

function formatBDTime(date = new Date()) {
  const bd = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(bd.getUTCDate())}/${pad(bd.getUTCMonth()+1)}/${bd.getUTCFullYear()} ${pad(bd.getUTCHours())}:${pad(bd.getUTCMinutes())}:${pad(bd.getUTCSeconds())}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtBDT(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

/* ============================================================
   🔐 Main Admin check — PASSWORD_1 + PASSWORD_1_UID দুটোই লাগবে
   ============================================================ */
function isMainAdmin(password, uid) {
  const storedPwd = process.env.PASSWORD_1;
  const storedUid = process.env.PASSWORD_1_UID;

  if (!storedPwd || !storedUid) {
    console.error('PASSWORD_1 or PASSWORD_1_UID missing in env');
    return false;
  }
  if (!password || !uid) return false;

  const pwdMatch = String(storedPwd).trim() === String(password).trim();
  const uidMatch = String(storedUid).trim() === String(uid).trim();

  return pwdMatch && uidMatch;
}

/* ============================================================
   🔥 Firebase REST
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
      case 'login':          return await handleLogin(res, body, query);
      case 'list-officers':  return await handleListOfficers(res, body, query);
      case 'officer-detail': return await handleOfficerDetail(res, body, query);
      case 'officer-stats':  return await handleOfficerStats(res, body, query);
      default:
        return res.status(400).json({ status: false, message: 'Invalid endpoint' });
    }
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ status: false, message: 'Server error: ' + err.message });
  }
}

/* ============================================================
   🔐 Login — PASSWORD_1 + PASSWORD_1_UID দুটোই লাগবে
   POST /api/offers?endpoint=login
       { password, uid }
   ============================================================ */
async function handleLogin(res, body, query) {
  const password = body.password || query.password;
  const uid      = body.uid      || query.uid;

  if (!isMainAdmin(password, uid)) {
    /* 🚨 Unauthorized চেষ্টা → Telegram লগ */
    const pwdMatched = process.env.PASSWORD_1 &&
                       String(process.env.PASSWORD_1).trim() === String(password || '').trim();
    const uidMatched = process.env.PASSWORD_1_UID &&
                       String(process.env.PASSWORD_1_UID).trim() === String(uid || '').trim();

    let reason = '';
    if (!pwdMatched && !uidMatched) reason = 'পাসওয়ার্ড এবং UID দুটোই ভুল';
    else if (!pwdMatched)           reason = 'পাসওয়ার্ড ভুল';
    else if (!uidMatched)           reason = 'UID ভুল';

    sendTelegramLog(
`🚨 <b>Offers Panel এ Unauthorized Access চেষ্টা</b>

🔑 পাসওয়ার্ড: <code>${escapeHtml(password || '—')}</code>
🆔 UID: <code>${escapeHtml(uid || '—')}</code>
❗ কারণ: ${escapeHtml(reason)}
🕐 সময়: ${formatBDTime()}
⚠️ সঠিক পাসওয়ার্ড + UID দুটোই লাগবে`
    );

    return res.status(200).json({
      status: false,
      message: 'ভুল পাসওয়ার্ড অথবা UID',
      reason
    });
  }

  sendTelegramLog(
`✅ <b>Offers Panel এ মেইন এডমিন লগইন</b>

👤 রোল: Main Admin (PASSWORD_1)
🔐 Auth: Password + UID ✅
🕐 সময়: ${formatBDTime()}`
  );

  return res.status(200).json({
    status: true,
    role: 'main-admin',
    message: 'স্বাগতম মেইন এডমিন'
  });
}

/* ============================================================
   👥 List Officers — সব অফিসারের সামারি
   POST /api/offers?endpoint=list-officers   { password, uid }
   ============================================================ */
async function handleListOfficers(res, body, query) {
  const password = body.password || query.password;
  const uid      = body.uid      || query.uid;

  if (!isMainAdmin(password, uid)) {
    return res.status(401).json({ status: false, message: 'শুধু মেইন এডমিন' });
  }

  const t = getTimeKeys();
  const officers = [];

  for (let i = 2; i <= MAX_PASSWORDS; i++) {
    const key = `PASSWORD_${i}`;
    const envPwd = process.env[key];
    if (!envPwd) continue;

    let data = null;
    try { data = await fbGet(key); }
    catch (e) { continue; }

    if (!data || typeof data !== 'object') continue;

    const total   = data['Total-Recharge'] || {};
    const histObj = data['mobail-Recharge'] || {};

    let todaySuccess = 0, todayFailed = 0;
    for (const [timeKey, entry] of Object.entries(histObj)) {
      if (!timeKey.startsWith(t.day)) continue;
      if (entry && entry.status === true) todaySuccess++;
      else todayFailed++;
    }

    officers.push({
      userKey: key,
      name: data.name || '—',
      email: data.email || '—',
      number: data.number || '—',
      taka: Number(data.taka || 0),
      totals: {
        year:  Number(total[t.year]  || 0),
        month: Number(total[t.month] || 0),
        day:   Number(total[t.day]   || 0)
      },
      todayTx: {
        total: todaySuccess + todayFailed,
        success: todaySuccess,
        failed: todayFailed
      }
    });
  }

  const summary = {
    totalOfficers: officers.length,
    totalBalance:  officers.reduce((s, o) => s + o.taka, 0),
    totalToday:    officers.reduce((s, o) => s + o.totals.day, 0),
    totalMonth:    officers.reduce((s, o) => s + o.totals.month, 0),
    totalYear:     officers.reduce((s, o) => s + o.totals.year, 0)
  };

  return res.status(200).json({
    status: true,
    date: t.day,
    summary,
    officers
  });
}

/* ============================================================
   📜 Officer Detail — একজন অফিসারের সম্পূর্ণ হিস্ট্রি
   POST /api/offers?endpoint=officer-detail
       { password, uid, officerKey: 'PASSWORD_2' }
   ============================================================ */
async function handleOfficerDetail(res, body, query) {
  const password   = body.password   || query.password;
  const uid        = body.uid        || query.uid;
  const officerKey = String(body.officerKey || query.officerKey || '').trim().toUpperCase();

  if (!isMainAdmin(password, uid)) {
    return res.status(401).json({ status: false, message: 'শুধু মেইন এডমিন' });
  }

  if (!/^PASSWORD_([2-9]|1[0-9]|20)$/.test(officerKey)) {
    return res.status(400).json({
      status: false,
      message: 'সঠিক অফিসার key দিন (PASSWORD_2 - PASSWORD_20)'
    });
  }

  if (!process.env[officerKey]) {
    return res.status(404).json({ status: false, message: 'এই অফিসার নেই' });
  }

  let data;
  try { data = await fbGet(officerKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  if (!data || typeof data !== 'object') {
    return res.status(404).json({ status: false, message: 'এই অফিসারের কোনো ডেটা নেই' });
  }

  const histObj = data['mobail-Recharge'] || {};
  const entries = Object.entries(histObj)
    .map(([time, d]) => ({
      time,
      amount:   d.amount   || 0,
      number:   d.number   || '—',
      operator: d.operator || '—',
      status:   d.status === true,
      trxid:    d.trxid    || '—',
      refid:    d.refid    || '—',
      message:  d.rawMessage || (d.status ? 'সফল' : 'ব্যর্থ')
    }))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));

  const successCount = entries.filter(e => e.status).length;
  const failedCount  = entries.length - successCount;
  const successSum   = entries.filter(e => e.status).reduce((s, e) => s + Number(e.amount || 0), 0);

  sendTelegramLog(
`📊 <b>Main Admin Review — Officer Detail</b>

👤 অফিসার: <b>${escapeHtml(data.name || officerKey)}</b> (${escapeHtml(officerKey)})
📱 নম্বর: ${escapeHtml(data.number || '—')}
💵 বর্তমান ব্যালেন্স: ৳${fmtBDT(data.taka || 0)}
📈 মোট লেনদেন: ${entries.length} (✅ ${successCount} / ❌ ${failedCount})
💰 সফল রিচার্জ: ৳${fmtBDT(successSum)}
🕐 সময়: ${formatBDTime()}
ℹ️ মেইন এডমিন এই ডেটা দেখেছেন`
  );

  return res.status(200).json({
    status: true,
    officer: {
      userKey: officerKey,
      name:    data.name   || '—',
      email:   data.email  || '—',
      number:  data.number || '—',
      taka:    Number(data.taka || 0)
    },
    stats: {
      total: entries.length,
      success: successCount,
      failed: failedCount,
      successAmount: successSum
    },
    totalRecharge: data['Total-Recharge'] || {},
    history: entries
  });
}

/* ============================================================
   📊 Officer Stats — দিন / মাস / বছরের aggregate
   POST /api/offers?endpoint=officer-stats
       { password, uid, view: 'day' | 'month' | 'year' }
   ============================================================ */
async function handleOfficerStats(res, body, query) {
  const password = body.password || query.password;
  const uid      = body.uid      || query.uid;
  const view     = String(body.view || query.view || 'day').toLowerCase();

  if (!isMainAdmin(password, uid)) {
    return res.status(401).json({ status: false, message: 'শুধু মেইন এডমিন' });
  }

  if (!['day', 'month', 'year'].includes(view)) {
    return res.status(400).json({ status: false, message: 'view: day/month/year' });
  }

  const rows = [];

  for (let i = 2; i <= MAX_PASSWORDS; i++) {
    const key = `PASSWORD_${i}`;
    if (!process.env[key]) continue;

    let data = null;
    try { data = await fbGet(key); }
    catch (e) { continue; }

    if (!data || typeof data !== 'object') continue;

    const tr = data['Total-Recharge'] || {};
    const values = {};

    for (const [k, v] of Object.entries(tr)) {
      if (view === 'year'  && /^\d{4}$/.test(k))            values[k] = Number(v || 0);
      if (view === 'month' && /^\d{4}-\d{2}$/.test(k))       values[k] = Number(v || 0);
      if (view === 'day'   && /^\d{4}-\d{2}-\d{2}$/.test(k)) values[k] = Number(v || 0);
    }

    rows.push({
      userKey: key,
      name:    data.name   || '—',
      number:  data.number || '—',
      values,
      total: Object.values(values).reduce((s, n) => s + n, 0)
    });
  }

  return res.status(200).json({
    status: true,
    view,
    officers: rows
  });
}
