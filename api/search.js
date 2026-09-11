const cheerio = require('cheerio');

module.exports = async (req, res) => {
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

            // --- আপডেট করা ছবি খোঁজার লজিক ---
            let image = '';
            const $img = $(el).find('img').first(); // প্রথম img ট্যাগটি নিন
            
            if ($img.length) {
                // data-src আগে চেক করুন, না থাকলে src
                image = $img.attr('data-src') || $img.attr('src');
                
                // যদি lazy.svg পায়, তাহলে data-srcset থেকে আসল ছবি বের করুন
                if (image && image.includes('lazy.svg')) {
                    const srcset = $img.attr('data-srcset');
                    if (srcset) {
                        // srcset থেকে প্রথম URL টি নিন (যেমন: "url1.jpg 430w, url2.jpg 300w")
                        image = srcset.split(',')[0].trim().split(' ')[0];
                    } else {
                        image = ''; // কিছু না পেলে ফাঁকা রাখুন
                    }
                }
            }

            // Relative URL ঠিক করা
            if (image && !image.startsWith('http')) {
                image = `https://etel.com.bd${image.startsWith('/') ? '' : '/'}${image}`;
            }
            // --------------------------------

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
