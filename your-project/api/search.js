// api/search.js
export default async function handler(req, res) {
  // শুধু GET রিকোয়েস্ট নেব
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { s } = req.query; // সার্চ টার্ম
  if (!s || s.trim() === '') {
    return res.status(400).json({ error: 'সার্চ টার্ম দিন' });
  }

  const targetUrl = `https://etel.com.bd/?s=${encodeURIComponent(s.trim())}&post_type=product`;

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();

    // HTML পার্স করার জন্য cheerio ব্যবহার করছি (Vercel-এ ইনস্টল করতে হবে)
    // যদি cheerio ইনস্টল না থাকে, তাহলে npm install cheerio
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    const products = [];

    // Etel-এর প্রোডাক্ট কার্ড সিলেক্টর (product-wrapper)
    $('.product-wrapper').each((i, el) => {
      const $el = $(el);

      // ছবি
      let image = '';
      const img = $el.find('img.woocommerce_thumbnail');
      if (img.length) {
        let src = img.attr('src');
        // লেজি লোডিং চেক
        if (src && src.includes('lazy.svg')) {
          src = img.attr('data-src') || src;
        }
        image = src && !src.startsWith('http') ? `https://etel.com.bd${src.startsWith('/') ? '' : '/'}${src}` : src;
      }

      // নাম
      const nameEl = $el.find('.wd-entities-title a, .product-title a, h3 a');
      const name = nameEl.length ? nameEl.text().trim() : '';

      // দাম
      let price = '';
      const priceEl = $el.find('.price');
      if (priceEl.length) {
        const txt = priceEl.text().trim();
        const nums = txt.match(/\d{1,3}(?:,\d{3})*|\d+/g);
        if (nums && nums.length >= 2) {
          const sale = parseInt(nums[1].replace(/,/g, ''));
          price = `${sale} ৳`;
        } else if (nums && nums.length === 1) {
          price = `${parseInt(nums[0].replace(/,/g, ''))} ৳`;
        } else {
          price = txt.replace(/[^\d.]/g, '') + ' ৳';
        }
      }

      if (name || image || price) {
        products.push({
          name: name || 'প্রোডাক্ট',
          image: image || 'https://via.placeholder.com/300x300?text=No+Image',
          price: price || '০.০০ ৳'
        });
      }
    });

    // প্রথম ৩০টি প্রোডাক্ট পাঠানো
    res.status(200).json({
      success: true,
      query: s,
      count: products.length,
      products: products.slice(0, 30)
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'ডেটা আনতে ব্যর্থ', details: error.message });
  }
}
