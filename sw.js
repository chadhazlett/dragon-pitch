/* Dragon Pitch service worker — cache the whole app for offline play. */
const CACHE = "dragonpitch-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./happy-birthday.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./vendor/Tone.js",
  "./assets/theend.png",
  "./assets/dragons/ender.svg", "./assets/dragons/wither.svg", "./assets/dragons/god.svg",
  "./assets/dragons/titan.svg", "./assets/dragons/water.svg", "./assets/dragons/soulfire.svg",
  "./assets/dragons/glacier.svg", "./assets/dragons/gold.svg",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/piano/C2.mp3", "./assets/piano/Ds2.mp3", "./assets/piano/Fs2.mp3", "./assets/piano/A2.mp3",
  "./assets/piano/C3.mp3", "./assets/piano/Ds3.mp3", "./assets/piano/Fs3.mp3", "./assets/piano/A3.mp3",
  "./assets/piano/C4.mp3", "./assets/piano/Ds4.mp3", "./assets/piano/Fs4.mp3", "./assets/piano/A4.mp3",
  "./assets/piano/C5.mp3", "./assets/piano/Ds5.mp3", "./assets/piano/Fs5.mp3", "./assets/piano/A5.mp3",
  "./assets/piano/C6.mp3",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// network-first: always show the latest when online; fall back to cache when offline
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
