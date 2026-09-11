// ============================================================================
// Service Worker - 앱쉘 오프라인 캐시 (현장 Wi-Fi 음영지역 대응)
// 정적 리소스(HTML/CSS/JS/아이콘)는 캐시 우선, Supabase/외부 API는 캐시하지 않음
// ============================================================================
const CACHE_NAME = "dcl-shell-v32";
const SHELL_FILES = [
  "./index.html", "./inspect.html", "./dashboard.html", "./actions.html",
  "./parts.html", "./qr.html", "./types.html", "./inspectors.html", "./history.html",
  "./i18n-admin.html", "./inquiries.html", "./report.html",
  "./css/style.css",
  "./js/common.js", "./js/supabase-config.js", "./js/i18n.js",
  "./js/index.js", "./js/inspect.js", "./js/dashboard.js", "./js/actions.js",
  "./js/parts.js", "./js/qr.js", "./js/types.js", "./js/inspectors.js", "./js/history.js",
  "./js/i18n-admin.js", "./js/inquiries.js", "./js/report.js",
  "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// 네트워크 우선(Network-First) - 온라인이면 항상 최신 배포본을 즉시 사용하고,
// 오프라인일 때만 캐시된 이전 버전으로 대체 (배포 후 "새로고침해도 안 바뀜" 현상 방지)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // 쓰기 요청(Supabase RPC 등)은 그대로 통과
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부(Supabase/CDN)는 캐시하지 않고 네트워크로 통과

  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
