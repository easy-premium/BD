// ============================================================
// api/balance.js — Admin Balance Management (with global log)
// 🚨 কঠোর ডাবল অথেন্টিকেশন: PASSWORD_1 + PASSWORD_1_UID
// ✅ FIXED: fbUrl() এ /.json করা হয়েছে (root path DNS fix)
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

function maskSecret(s) {
  if (!s) return '—';
  const str = String(s);
  if (str.length <= 4) return '****';
  return str.substring(0, 2) + '***' + str.slice(-2);
}

/* ============================================================
   🔐 কঠোর Main Admin যাচাই
   ============================================================ */
function isMainAdmin(password, uid) {
  const storedPwd = process.env.PASSWORD_1;
  const storedUid = process.env.PASSWORD_1_UID;

  if (!storedPwd || !storedUid) {
    console.error('SECURITY: PASSWORD_1 or PASSWORD_1_UID missing in env');
    return false;
  }
  if (!password || !uid) return false;
  if (typeof password !== 'string' || typeof uid !== 'string') return false;

  const pwdMatch = String(storedPwd).trim() === password.trim();
  const uidMatch = String(storedUid).trim() === uid.trim();

  return pwdMatch && uidMatch;
}

/* ============================================================
   🔥 Firebase REST
   ============================================================
   ⭐ FIX: `${p}/.json` — আগে ছিল `${p}.json`
   root path (path='') এ আগে URL হত `.app.json` → DNS error
   এখন হবে `.app/.json` → সঠিক
   ============================================================ */
function fbUrl(path = '') {
  const secret = process.env.DATABASE_SECRETS;
  const p = path ? `/${path}` : '';
  return `${FIREBASE_URL}${p}/.json?auth=${encodeURIComponent(secret)}`;
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
  return { ok: true };
}

/* ⭐ রুটে PATCH (গ্লোবাল লগ সেভ) */
async function fbPatchRoot(updates) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(fbUrl(''), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FB PATCH ROOT ${res.status}: ${text}`);
  }
  return { ok: true };
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
      case 'adjust':       return await handleAdjust(res, body, query);
      case 'log':          return await handleGetLog(res, body, query);
      case 'all-logs':     return await handleGetAllLogs(res, body, query);
      case 'global-log':   return await handleGlobalLog(res, body, query);
      default:
        return res.status(400).json({ status: false, message: 'Invalid endpoint' });
    }
  } catch (err) {
    console.error('❌ Handler error:', err);
    return res.status(500).json({ status: false, message: 'Server error: ' + err.message });
  }
}

/* ============================================================
   🛡️ Auth Check Helper
   ============================================================ */
async function enforceMainAdmin(res, body, query, endpointName) {
  const password = body.password || query.password;
  const uid      = body.uid      || query.uid;

  if (!isMainAdmin(password, uid)) {
    let reason = '';
    const hasPwd = !!password;
    const hasUid = !!uid;
    const envPwd = process.env.PASSWORD_1;
    const envUid = process.env.PASSWORD_1_UID;

    if (!hasPwd && !hasUid) {
      reason = 'পাসওয়ার্ড এবং UID দুটোই দেওয়া হয়নি';
    } else if (!hasPwd) {
      reason = 'পাসওয়ার্ড দেওয়া হয়নি';
    } else if (!hasUid) {
      reason = 'UID দেওয়া হয়নি';
    } else if (!envPwd || !envUid) {
      reason = 'Server env variables missing';
    } else {
      const pwdOk = String(envPwd).trim() === String(password).trim();
      const uidOk = String(envUid).trim() === String(uid).trim();
      if (!pwdOk && !uidOk) reason = 'পাসওয়ার্ড এবং UID দুটোই ভুল';
      else if (!pwdOk) reason = 'পাসওয়ার্ড ভুল';
      else if (!uidOk) reason = 'UID ভুল';
      else reason = 'অজানা ত্রুটি';
    }

    sendTelegramLog(
`🚨 <b>Balance API — Unauthorized Access চেষ্টা</b>

📌 Endpoint: <code>${escapeHtml(endpointName)}</code>
🔑 পাসওয়ার্ড: <code>${escapeHtml(maskSecret(password))}</code>
🆔 UID: <code>${escapeHtml(maskSecret(uid))}</code>
❗ কারণ: ${escapeHtml(reason)}
🕐 সময়: ${formatBDTime()}
⚠️ PASSWORD_1 + PASSWORD_1_UID দুটোই সঠিক থাকতে হবে`
    );

    res.status(401).json({
      status: false,
      message: 'Unauthorized — শুধু মেইন এডমিন অ্যাক্সেস পাবেন',
      reason: reason,
      required: ['PASSWORD_1', 'PASSWORD_1_UID']
    });
    return false;
  }

  return true;
}

/* ============================================================
   💰 Balance Adjust
   ============================================================ */
async function handleAdjust(res, body, query) {
  const authorized = await enforceMainAdmin(res, body, query, 'adjust');
  if (!authorized) return;

  const password   = body.password   || query.password;
  const uid        = body.uid        || query.uid;
  const officerKey = String(body.officerKey || query.officerKey || '').trim().toUpperCase();
  const action     = String(body.action || query.action || '').trim().toLowerCase();
  const amountRaw  = body.amount  || query.amount;
  const amount     = parseInt(amountRaw, 10);
  const note       = String(body.note || query.note || '').trim().slice(0, 200);

  if (!/^PASSWORD_([1-9]|1[0-9]|20)$/.test(officerKey)) {
    return res.status(400).json({
      status: false,
      message: 'সঠিক key দিন (PASSWORD_1 - PASSWORD_20)'
    });
  }

  if (!['add', 'subtract'].includes(action)) {
    return res.status(400).json({
      status: false,
      message: 'action: "add" অথবা "subtract" হতে হবে'
    });
  }

  if (!amount || amount < 1 || amount > 1000000) {
    return res.status(400).json({
      status: false,
      message: 'পরিমাণ ৳১ থেকে ৳১০,০০,০০০ এর মধ্যে হতে হবে'
    });
  }

  if (!process.env[officerKey]) {
    return res.status(404).json({ status: false, message: 'এই অফিসার নেই' });
  }

  /* Admin এর নাম পড়া */
  let adminName = 'Main Admin';
  try {
    const adminData = await fbGet('PASSWORD_1');
    if (adminData && adminData.data && adminData.data.name) {
      adminName = adminData.data.name;
    }
  } catch (e) { /* silent */ }

  const MAX_RETRIES = 3;
  let saved = false;
  let newTaka = 0;
  let oldTaka = 0;
  let officerData = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let fresh;
    try { fresh = await fbGet(officerKey); }
    catch (e) {
      await new Promise(r => setTimeout(r, 80));
      continue;
    }

    const data = fresh.data || {};
    if (!data || typeof data !== 'object') {
      return res.status(404).json({ status: false, message: 'অফিসার ডেটা পাওয়া যায়নি' });
    }

    officerData = data;
    oldTaka = Number(data.taka) || 0;

    let change;
    if (action === 'add') {
      change = amount;
      newTaka = oldTaka + amount;
    } else {
      if (oldTaka < amount) {
        return res.status(400).json({
          status: false,
          message: `পর্যাপ্ত ব্যালেন্স নেই। অফিসারের আছে ৳${oldTaka}`,
          taka: oldTaka
        });
      }
      change = -amount;
      newTaka = oldTaka - amount;
    }

    const timeKeys = getTimeKeys();
    const officerName = data.name || officerKey;
    const officerNumber = data.number || '—';

    const officerEntry = {
      action:      action,
      amount:      amount,
      change:      change,
      oldTaka:     oldTaka,
      newTaka:     newTaka,
      note:        note || '—',
      byPassword:  maskSecret(password),
      byUid:       maskSecret(uid),
      byRole:      'Main Admin',
      byName:      adminName,
      time:        new Date().toISOString(),
      timestamp:   timeKeys.full
    };

    const updates = {
      [`taka`]: newTaka,
      [`balance-history/${timeKeys.full}`]: officerEntry
    };

    try {
      const result = await fbPatchUser(officerKey, updates, fresh.etag);
      if (result.conflict) {
        await new Promise(r => setTimeout(r, 80));
        continue;
      }

      /* ⭐⭐ গ্লোবাল লগ — admin-actions-log/ */
      try {
        const globalEntry = {
          adminKey:      'PASSWORD_1',
          adminName:     adminName,
          adminPassword: maskSecret(password),
          adminUid:      maskSecret(uid),
          officerKey:    officerKey,
          officerName:   officerName,
          officerNumber: officerNumber,
          action:        action,
          amount:        amount,
          change:        change,
          oldTaka:       oldTaka,
          newTaka:       newTaka,
          note:          note || '—',
          time:          new Date().toISOString(),
          timestamp:     timeKeys.full
        };

        await fbPatchRoot({
          [`admin-actions-log/${timeKeys.full}_${officerKey}`]: globalEntry
        });
      } catch (gErr) {
        console.error('Global log save failed:', gErr);
      }

      saved = true;
      break;
    } catch (e) {
      console.error('Balance PATCH failed:', e);
      await new Promise(r => setTimeout(r, 80));
    }
  }

  if (!saved) {
    sendTelegramLog(
`🔥 <b>Balance Adjust সেভ ব্যর্থ</b>

👤 Officer: ${escapeHtml(officerKey)}
🎬 Action: ${escapeHtml(action)}
💰 Amount: ৳${fmtBDT(amount)}
🕐 সময়: ${formatBDTime()}`
    );
    return res.status(500).json({
      status: false,
      message: 'ডেটাবেসে সেভ ব্যর্থ। আবার চেষ্টা করুন।'
    });
  }

  const officerName = officerData?.name || officerKey;
  const officerNum  = officerData?.number || '—';
  const actionIcon  = action === 'add' ? '➕' : '➖';
  const actionText  = action === 'add' ? 'ব্যালেন্স এড' : 'ব্যালেন্স মাইনাস';
  const selfNote    = officerKey === 'PASSWORD_1' ? ' 👑 <b>(নিজের একাউন্ট)</b>' : '';

  sendTelegramLog(
`${actionIcon} <b>${actionText}</b>${selfNote}

👤 অফিসার: <b>${escapeHtml(officerName)}</b> (${escapeHtml(officerKey)})
📱 নম্বর: <code>${escapeHtml(officerNum)}</code>
💰 ${action === 'add' ? 'যোগ' : 'কর্তন'}: <b>৳${fmtBDT(amount)}</b>

💵 আগের ব্যালেন্স: ৳${fmtBDT(oldTaka)}
💵 নতুন ব্যালেন্স: <b>৳${fmtBDT(newTaka)}</b>

📝 নোট: ${escapeHtml(note || '—')}
👮 কর্তৃক: <b>${escapeHtml(adminName)}</b>
🕐 সময়: ${formatBDTime()}
✅ Main Admin কর্তৃক সম্পন্ন`
  );

  return res.status(200).json({
    status: true,
    message: `${actionText} সফল হয়েছে`,
    officer: {
      userKey: officerKey,
      name:    officerName,
      number:  officerNum
    },
    action:     action,
    amount:     amount,
    oldTaka:    oldTaka,
    newTaka:    newTaka,
    note:       note || '—',
    time:       new Date().toISOString()
  });
}

/* ============================================================
   📜 Single Officer Balance Log
   ============================================================ */
async function handleGetLog(res, body, query) {
  const authorized = await enforceMainAdmin(res, body, query, 'log');
  if (!authorized) return;

  const officerKey = String(body.officerKey || query.officerKey || '').trim().toUpperCase();
  const limit      = Math.min(parseInt(body.limit || query.limit || 200, 10), 500);

  if (!/^PASSWORD_([1-9]|1[0-9]|20)$/.test(officerKey)) {
    return res.status(400).json({
      status: false,
      message: 'সঠিক key দিন'
    });
  }

  let got;
  try { got = await fbGet(officerKey); }
  catch (e) { return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' }); }

  const data = got.data || {};
  const histObj = data['balance-history'] || {};

  const entries = Object.entries(histObj)
    .map(([time, d]) => ({
      timestamp: time,
      action:    d.action || '—',
      amount:    Number(d.amount || 0),
      change:    Number(d.change || 0),
      oldTaka:   Number(d.oldTaka || 0),
      newTaka:   Number(d.newTaka || 0),
      note:      d.note || '—',
      byPassword: d.byPassword || '—',
      byUid:     d.byUid || '—',
      byRole:    d.byRole || '—',
      byName:    d.byName || '—',
      time:      d.time || time
    }))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);

  const totalAdded = entries.filter(e => e.action === 'add').reduce((s, e) => s + e.amount, 0);
  const totalSubtracted = entries.filter(e => e.action === 'subtract').reduce((s, e) => s + e.amount, 0);

  return res.status(200).json({
    status: true,
    officer: {
      userKey: officerKey,
      name:    data.name   || '—',
      number:  data.number || '—',
      email:   data.email  || '—',
      taka:    Number(data.taka || 0)
    },
    stats: {
      totalEntries: entries.length,
      totalAdded: totalAdded,
      totalSubtracted: totalSubtracted
    },
    history: entries
  });
}

/* ============================================================
   📊 All Officers Balance Log (Combined)
   ============================================================ */
async function handleGetAllLogs(res, body, query) {
  const authorized = await enforceMainAdmin(res, body, query, 'all-logs');
  if (!authorized) return;

  const limit = Math.min(parseInt(body.limit || query.limit || 100, 10), 500);
  const allEntries = [];

  for (let i = 1; i <= MAX_PASSWORDS; i++) {
    const key = `PASSWORD_${i}`;
    if (!process.env[key]) continue;

    let got;
    try { got = await fbGet(key); }
    catch (e) { continue; }

    const data = got.data || {};
    const histObj = data['balance-history'] || {};
    const officerName = data.name || key;
    const officerNumber = data.number || '—';

    for (const [timestamp, d] of Object.entries(histObj)) {
      allEntries.push({
        officerKey: key,
        officerName: officerName,
        officerNumber: officerNumber,
        timestamp: timestamp,
        action:    d.action || '—',
        amount:    Number(d.amount || 0),
        change:    Number(d.change || 0),
        oldTaka:   Number(d.oldTaka || 0),
        newTaka:   Number(d.newTaka || 0),
        note:      d.note || '—',
        byPassword: d.byPassword || '—',
        byUid:     d.byUid || '—',
        byRole:    d.byRole || '—',
        byName:    d.byName || '—',
        time:      d.time || timestamp
      });
    }
  }

  allEntries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const sliced = allEntries.slice(0, limit);

  const totalAdded = sliced.filter(e => e.action === 'add').reduce((s, e) => s + e.amount, 0);
  const totalSubtracted = sliced.filter(e => e.action === 'subtract').reduce((s, e) => s + e.amount, 0);

  return res.status(200).json({
    status: true,
    stats: {
      totalEntries: sliced.length,
      totalAdded: totalAdded,
      totalSubtracted: totalSubtracted
    },
    history: sliced
  });
}

/* ============================================================
   ⭐ Global Admin Actions Log
   POST /api/balance?endpoint=global-log
       { password, uid, limit?: 300, officerKey?: 'PASSWORD_2', action?: 'add' }
   ============================================================ */
async function handleGlobalLog(res, body, query) {
  const authorized = await enforceMainAdmin(res, body, query, 'global-log');
  if (!authorized) return;

  const limit     = Math.min(parseInt(body.limit || query.limit || 300, 10), 1000);
  const filterKey = String(body.officerKey || query.officerKey || '').trim().toUpperCase();
  const filterAct = String(body.action || query.action || '').trim().toLowerCase();

  let got;
  try { got = await fbGet('admin-actions-log'); }
  catch (e) {
    return res.status(500).json({ status: false, message: 'Firebase সংযোগ ব্যর্থ' });
  }

  const logObj = got.data || {};

  /* ফাঁকা হলে খালি রেসপন্স */
  if (!logObj || typeof logObj !== 'object') {
    return res.status(200).json({
      status: true,
      filter: { officerKey: filterKey || null, action: filterAct || null },
      stats: { totalEntries: 0, totalAdded: 0, totalSubtracted: 0 },
      history: []
    });
  }

  let entries = Object.entries(logObj)
    .map(([key, d]) => {
      if (!d || typeof d !== 'object') return null;
      return {
        logKey:        key,
        adminKey:      d.adminKey || 'PASSWORD_1',
        adminName:     d.adminName || 'Main Admin',
        adminPassword: d.adminPassword || '—',
        adminUid:      d.adminUid || '—',
        officerKey:    d.officerKey || '—',
        officerName:   d.officerName || '—',
        officerNumber: d.officerNumber || '—',
        action:        d.action || '—',
        amount:        Number(d.amount || 0),
        change:        Number(d.change || 0),
        oldTaka:       Number(d.oldTaka || 0),
        newTaka:       Number(d.newTaka || 0),
        note:          d.note || '—',
        time:          d.time || '',
        timestamp:     d.timestamp || key
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  if (filterKey) entries = entries.filter(e => e.officerKey === filterKey);
  if (filterAct && ['add', 'subtract'].includes(filterAct)) {
    entries = entries.filter(e => e.action === filterAct);
  }

  const sliced = entries.slice(0, limit);

  const totalAdded = entries.filter(e => e.action === 'add').reduce((s, e) => s + e.amount, 0);
  const totalSubtracted = entries.filter(e => e.action === 'subtract').reduce((s, e) => s + e.amount, 0);

  return res.status(200).json({
    status: true,
    filter: {
      officerKey: filterKey || null,
      action:     filterAct || null
    },
    stats: {
      totalEntries: entries.length,
      totalAdded: totalAdded,
      totalSubtracted: totalSubtracted
    },
    history: sliced
  });
}
