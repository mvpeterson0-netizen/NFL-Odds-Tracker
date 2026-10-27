// Stix service worker: shows phone alerts (web push). It does not cache pages or data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  // Safari requires every push to show a notification, so always show one.
  e.waitUntil(self.registration.showNotification(d.title || "Stix", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "./#/guide" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#/guide", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { await w.focus(); if ("navigate" in w) await w.navigate(url); return; } }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
