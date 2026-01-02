const CACHE_NAME = 'fodmap-app-v3-0-0-persistlogin';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/main.js',
    './js/data.js',
    './js/drive.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
