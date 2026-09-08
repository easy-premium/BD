<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$query = isset($_GET['s']) ? trim($_GET['s']) : '';
if (empty($query)) {
    echo json_encode(['error' => 'সার্চ টার্ম দিন']);
    exit;
}

$url = 'https://etel.com.bd/?s=' . urlencode($query) . '&post_type=product';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
$html = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200 || empty($html)) {
    echo json_encode(['error' => 'ডেটা আনতে ব্যর্থ', 'code' => $httpCode]);
    exit;
}

$dom = new DOMDocument();
libxml_use_internal_errors(true);
$dom->loadHTML($html);
libxml_clear_errors();

$xpath = new DOMXPath($dom);
$cards = $xpath->query("//div[contains(@class, 'product-wrapper')]");

$products = [];
foreach ($cards as $card) {
    // নাম
    $nameNode = $xpath->query(".//h3[contains(@class, 'wd-entities-title')]/a", $card);
    $name = $nameNode->length > 0 ? trim($nameNode->item(0)->nodeValue) : '';

    // ছবি
    $imgNode = $xpath->query(".//img[contains(@class, 'woocommerce_thumbnail')]", $card);
    $image = '';
    if ($imgNode->length > 0) {
        $src = $imgNode->item(0)->getAttribute('src');
        if (strpos($src, 'lazy.svg') !== false) {
            $dataSrc = $imgNode->item(0)->getAttribute('data-src');
            $image = $dataSrc ?: $src;
        } else {
            $image = $src;
        }
        if ($image && strpos($image, 'http') !== 0) {
            $image = 'https://etel.com.bd' . $image;
        }
    }

    // দাম
    $priceNode = $xpath->query(".//span[contains(@class, 'price')]", $card);
    $price = '';
    if ($priceNode->length > 0) {
        $priceHtml = $priceNode->item(0)->nodeValue;
        preg_match_all('/\d{1,3}(?:,\d{3})*|\d+/', $priceHtml, $matches);
        if (!empty($matches[0])) {
            $numbers = array_map(function($n) { return (int)str_replace(',', '', $n); }, $matches[0]);
            if (count($numbers) >= 2) {
                $price = min($numbers) . ' ৳';
            } else {
                $price = $numbers[0] . ' ৳';
            }
        }
    }

    if ($name || $image || $price) {
        $products[] = [
            'name' => $name ?: 'প্রোডাক্ট',
            'image' => $image ?: 'https://via.placeholder.com/300x300?text=No+Image',
            'price' => $price ?: '০.০০ ৳'
        ];
    }
}

echo json_encode([
    'success' => true,
    'query' => $query,
    'count' => count($products),
    'products' => array_slice($products, 0, 30)
]);
