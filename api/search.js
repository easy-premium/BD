const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // CORS হেডার (যাতে যেকোনো ডোমেইন থেকে কল করা যায়)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const query = req.query.s;
    if (!query || query.trim() === '') {
        return res.status(400).json({ error: 'সার্চ টার্ম দিন' });
    }

    try {
        const response = await fetch(`https://etel.com.bd/?s=${encodeURIComponent(query.trim())}&post_type=product`);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const products = [];

        $('.product-wrapper').each((i, el) => {
            const name = $(el).find('.wd-entities-title a').text().trim();

            let image = $(el).find('img.woocommerce_thumbnail').attr('src');
            if (image && image.includes('lazy.svg')) {
                image = $(el).find('img.woocommerce_thumbnail').attr('data-src') || image;
            }
            if (image && !image.startsWith('http')) {
                image = `https://etel.com.bd${image.startsWith('/') ? '' : '/'}${image}`;
            }

            let price = '';
            const priceText = $(el).find('.price').text().trim();
            const prices = priceText.match(/\d{1,3}(?:,\d{3})*|\d+/g);
            if (prices && prices.length > 0) {
                price = prices[prices.length - 1] + ' ৳'; 
            }

            if (name || image || price) {
                products.push({
                    name: name || 'প্রোডাক্ট',
                    image: image || 'https://via.placeholder.com/300x300?text=No+Image',
                    price: price || '০.০০ ৳'
                });
            }
        });

        res.status(200).json({
            success: true,
            count: products.length,
            products: products.slice(0, 30)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'ডেটা আনতে ব্যর্থ', details: error.message });
    }
};
