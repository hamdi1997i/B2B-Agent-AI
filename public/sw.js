'use strict';

/**
 * Service worker: on met en cache la coquille de l'app pour qu'elle s'ouvre
 * même sans réseau. Les appels /api/ passent toujours par le réseau —
 * l'agent a besoin de Claude et du serveur pour répondre.
 */

const CACHE = 'maawen-v1';
const SHELL = [
  '/',
  '/agent.html',
  '/agent.css',
  '/agent.js',
  '/manifest.webmanifest',
  '/icons/icon-48.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // toujours en direct

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/agent.html'))),
  );
});
