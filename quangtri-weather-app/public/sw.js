// public/sw.js
//
// Service Worker — CHỈ lưu tạm (cache) phần giao diện tĩnh (JS/CSS/icon) để
// mở nhanh hơn ở lần sau, đặc biệt hữu ích khi sóng yếu. TUYỆT ĐỐI KHÔNG
// cache dữ liệu thời tiết/mưa/mực nước — luôn bắt buộc lấy mới từ mạng, vì
// đây là app cảnh báo thiên tai, hiển thị số liệu cũ giả làm mới lúc có lũ
// thật là rất nguy hiểm.

const CACHE_NAME = 'qt-weather-static-v1';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Các URL chứa 1 trong các chuỗi này -> KHÔNG BAO GIỜ cache, luôn lấy mới.
const NEVER_CACHE_PATTERNS = [
  '/.netlify/functions/', // rainfall, mucnuoc, forecast... (dữ liệu real-time)
  'api.open-meteo.com',
  'archive-api.open-meteo.com',
  '203.209.181.170', // API KTTV
  'vrain.vn', // cả mưa lẫn mực nước VRain
];

function isNeverCache(url) {
  return NEVER_CACHE_PATTERNS.some((p) => url.includes(p));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {}), // không chặn cài đặt nếu 1 vài file lỗi
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // bỏ qua POST (vd. đăng nhập VRain), không can thiệp

  if (isNeverCache(request.url)) {
    // Luôn ưu tiên lấy mới từ mạng cho dữ liệu real-time — không cache.
    event.respondWith(fetch(request));
    return;
  }

  // Tài nguyên tĩnh: ưu tiên MẠNG trước (để luôn có bản mới nhất khi có cập
  // nhật), chỉ dùng bản lưu tạm khi mất mạng/lỗi.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
