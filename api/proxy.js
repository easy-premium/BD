// Node 18+ / Express
import express from 'express';
const app = express();

const API_KEY  = process.env.EFLEXI_KEY  || 'easy@pre';
const API_PASS = process.env.EFLEXI_PASS || '8497036d-e88f-43c3-8a60-40685ce92e9a';
const BASE     = 'https://eflexi.net/api/v2';

const ALLOWED = ['balance','recharge','status','sms'];

app.get('/api/recharge/:endpoint', async (req, res) => {
  const ep = req.params.endpoint;
  if (!ALLOWED.includes(ep)) return res.status(400).json({status:false,message:'Invalid endpoint'});

  const url = new URL(`${BASE}/${ep}`);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('api_pass', API_PASS);
  for (const k in req.query) url.searchParams.set(k, req.query[k]);

  try {
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({status:false, message:'Upstream error'});
  }
});

app.listen(3000, ()=>console.log('Proxy → http://localhost:3000'));
