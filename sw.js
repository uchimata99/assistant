// יעד שיתוף: מקבל טקסט ותמונות מאפליקציות אחרות (ווטסאפ, גלריה) ומעביר לאפליקציה
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const cache = await caches.open('assist-share');
      let n = 0;
      for (const f of form.getAll('files')) {
        if (f && f.size) { await cache.put('/shared-file-' + n, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } })); n++; }
      }
      const data = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: n };
      await cache.put('/shared', new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect('./index.html', 303);
    })());
  }
});
