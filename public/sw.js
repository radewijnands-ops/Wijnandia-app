/* Wijnandia web-app: zorgt dat de app snel opent en ook zonder internet start.
   Verhoog VERSIE na elke wijziging aan de app, dan krijgt iedereen de nieuwe versie. */
const VERSIE = "wijnandia-v14";
const BESTANDEN = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "logo.png", "quiz/vragen.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSIE).then(c =>
    Promise.all(BESTANDEN.map(b => c.add(b).catch(() => {})))
  ));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSIE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

/* Eigen bestanden: eerst internet (altijd actueel), anders uit de cache.
   Uitslagen van HollandseVelden worden nooit gecachet, die blijven live. */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const kopie = r.clone(); caches.open(VERSIE).then(c => c.put(e.request, kopie)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});

/* Pushmeldingen (nieuwe uitslagen) tonen */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titel: "Wijnandia", tekst: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titel || "R.K.V.V. Wijnandia", {
    body: d.tekst || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag,
    data: { url: d.url || "./" }
  }));
});

/* Tikken op de melding opent (of activeert) de app */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const doel = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(lijst => {
    for (const c of lijst) { if ("focus" in c) { c.navigate(doel).catch(() => {}); return c.focus(); } }
    return clients.openWindow(doel);
  }));
});
