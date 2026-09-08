// שני תפקידים: יעד שיתוף מווטסאפ ומהגלריה, ומטמון שמאפשר לאפליקציה לעלות בלי רשת.
// בלי המטמון כרום לא מציע להתקין את האפליקציה למסך הבית — "עובד גם לא מקוון" הוא תנאי התקנה.
const CACHE = 'assist-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg',
                './icon-192.png', './icon-512.png', './apple-touch-icon.png', './404.html'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // כישלון של קובץ בודד לא יפיל את ההתקנה
    await Promise.all(ASSETS.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== 'assist-share').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // יעד שיתוף: מקבל טקסט ותמונות מאפליקציות אחרות ומעביר לאפליקציה
  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith((async () => {
      const form = await req.formData();
      const cache = await caches.open('assist-share');
      let n = 0;
      for (const f of form.getAll('files')) {
        if (f && f.size) { await cache.put('/shared-file-' + n, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } })); n++; }
      }
      const data = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: n };
      await cache.put('/shared', new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
      return Response.redirect('./index.html', 303);
    })());
    return;
  }

  // הקריאות לשרת אפס סקריפט הן ממקור אחר ולא נוגעים בהן בשום מצב
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // קודם רשת, ואם אין — מהמטמון. כך גרסה חדשה נוחתת מיד, ובלי רשת האפליקציה עדיין עולה.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const idx = await caches.match('./index.html');
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
