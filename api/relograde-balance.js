// api/relograde-balance.js
// Fetch Relograde account balance (USD)

const RELOGRADE_API_URL = 'https://connect.relograde.com/api/1.02';
const RELOGRADE_API_KEY = process.env.RELOGRADE_API_KEY;

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!RELOGRADE_API_KEY) {
        console.error('❌ RELOGRADE_API_KEY not configured');
        return res.status(500).json({ success: false, error: 'API key missing' });
    }

    try {
        const url = `${RELOGRADE_API_URL}/account`;
        const options = {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${RELOGRADE_API_KEY}`,
                'Accept': 'application/json'
            }
        };

        console.log(`📤 Fetching Relograde accounts from ${url}`);
        const response = await fetch(url, options);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `API error: ${response.status}`);
        }

        // result is an array of accounts: [{ currency, state, totalAmount }, ...]
        if (!Array.isArray(result)) {
            throw new Error('Unexpected response format from Relograde');
        }

        // Find USD account (case-insensitive)
        const usdAccount = result.find(acc => acc.currency?.toLowerCase() === 'usd');
        if (!usdAccount) {
            console.warn('⚠️ No USD account found in Relograde response');
            return res.status(200).json({ success: true, balance: 0 });
        }

        const balance = parseFloat(usdAccount.totalAmount) || 0;
        console.log(`✅ USD balance fetched: $${balance}`);

        return res.status(200).json({
            success: true,
            balance: balance
        });
    } catch (error) {
        console.error('❌ Balance fetch error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch balance'
        });
    }
}
