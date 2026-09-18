const assert = require('assert');
const { isSafeHttpUrl, resolveUrl, extractIconHref } = require('../article-enrichment');

// isSafeHttpUrl - basic SSRF guard
assert.strictEqual(isSafeHttpUrl('https://www.yna.co.kr/article/1'), true);
assert.strictEqual(isSafeHttpUrl('http://example.com'), true);
assert.strictEqual(isSafeHttpUrl('ftp://example.com'), false);
assert.strictEqual(isSafeHttpUrl('file:///etc/passwd'), false);
assert.strictEqual(isSafeHttpUrl('http://localhost/'), false);
assert.strictEqual(isSafeHttpUrl('http://sub.localhost/'), false);
assert.strictEqual(isSafeHttpUrl('http://127.0.0.1/'), false);
assert.strictEqual(isSafeHttpUrl('http://127.0.0.1:8080/x'), false);
assert.strictEqual(isSafeHttpUrl('http://10.0.0.5/'), false);
assert.strictEqual(isSafeHttpUrl('http://192.168.1.1/'), false);
assert.strictEqual(isSafeHttpUrl('http://172.16.0.1/'), false);
assert.strictEqual(isSafeHttpUrl('http://172.31.255.255/'), false);
assert.strictEqual(isSafeHttpUrl('http://172.32.0.1/'), true); // just outside the 172.16-31 private block
assert.strictEqual(isSafeHttpUrl('http://169.254.1.1/'), false);
assert.strictEqual(isSafeHttpUrl('http://0.0.0.0/'), false);
assert.strictEqual(isSafeHttpUrl('not a url'), false);

// resolveUrl - relative -> absolute against a base
assert.strictEqual(resolveUrl('/favicon.ico', 'https://news.example.com/a/b'), 'https://news.example.com/favicon.ico');
assert.strictEqual(resolveUrl('https://cdn.example.com/x.png', 'https://news.example.com/a/b'), 'https://cdn.example.com/x.png');
assert.strictEqual(resolveUrl('::not a url::', 'not-a-base-either'), null);

// extractIconHref - rel variants, either attribute order, priority order
assert.strictEqual(extractIconHref('<link rel="icon" href="/favicon.ico">'), '/favicon.ico');
assert.strictEqual(extractIconHref('<link href="/favicon2.ico" rel="shortcut icon">'), '/favicon2.ico');
assert.strictEqual(
  extractIconHref('<link rel="icon" href="/a.ico"><link rel="apple-touch-icon" href="/apple.png">'),
  '/apple.png' // apple-touch-icon takes priority per the checked order
);
assert.strictEqual(extractIconHref('<meta name="x" content="y">'), null);
assert.strictEqual(extractIconHref('<p>no link tag here</p>'), null);

console.log('enrichment.test.js: all assertions passed');
