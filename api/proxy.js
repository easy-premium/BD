// api/proxy.js — Vercel Serverless Function (Express নয়!)
export default async function handler(req, res) {
  // CORS হেডার
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 🔐 শুধু env variable থেকে — কোনো fallback নেই
  const API_KEY  = process.env.EFLEXI_KEY;
  const API_PASS = process.env.EFLEXI_PASS;

  if (!API_KEY || !API_PASS) {
    return res.status(500).json({ 
      status: false, 
      message: 'Server credentials missing' 
    });
  }

  // 🔍 URL থেকে endpoint বের করুন
  // যেমন: /api/proxy?endpoint=balance  → endpoint = 'balance'
  const { endpoint, ...query } = req.query;

  const ALLOWED = ['balance', 'recharge', 'status', 'sms'];
  if (!endpoint || !ALLOWED.includes(endpoint)) {
    return res.status(400).json({ 
      status: false, 
      message: 'Invalid endpoint' 
    });
  }

  // 🌐 eflexi API তে কল
  const url = new URL(`https://eflexi.net/api/v2/${endpoint}`);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('api_pass', API_PASS);

  for (const k in query) {
    url.searchParams.set(k, query[k]);
  }

  try {
    const upstream = await fetch(url.toString(), { method: 'GET' });
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('Upstream error:', err);
    return res.status(502).json({
      status: false,
      message: 'Upstream API unreachable'
    });
  }
}
