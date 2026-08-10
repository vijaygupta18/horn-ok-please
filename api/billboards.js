// api/billboards.js — the shared roadside gallery.
//
// A finite ring of billboard "slots" (0 … COUNT-1). Anyone who parks at a
// billboard can POST a small resized image; it lands on that slot for everyone.
// GET returns the whole gallery so every client can paint the boards.
//
// Storage mirrors api/presence.js: a Redis hash on Upstash/Vercel-KV when the
// env vars are present, otherwise a per-instance in-memory Map. Images are
// already downscaled client-side to a compact JPEG data URL; we still cap the
// size here so nobody can wedge a megabyte into a slot. No npm deps, no build.

const KEY = 'its:billboards';
const SLOTS = 12;                 // must match BILLBOARD_COUNT in js/world.js
const MAX_IMG = 120000;           // ~120 KB data URL ceiling per slot

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const MEM = new Map();

async function kvCmd(path, body) {
  const res = await fetch(`${KV_URL}/${path.map(encodeURIComponent).join('/')}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'text/plain' } : {}),
    },
    body,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return (await res.json()).result;
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > MAX_IMG + 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const validSlot = (s) => Number.isInteger(+s) && +s >= 0 && +s < SLOTS;
const validImg = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length <= MAX_IMG;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

// A slot stores the image plus who put it there, so the billboard can credit them.
function unpack(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && typeof v === 'object' && validImg(v.image)) {
      return { image: v.image, by: str(v.by, 20) || 'Anonymous' };
    }
  } catch { /* legacy plain-string value (image only) */ }
  if (validImg(raw)) return { image: raw, by: 'Anonymous' };
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const slot = +body.slot;
      if (!validSlot(slot) || !validImg(body.image)) {
        return res.status(400).json({ ok: false, error: 'bad slot or image' });
      }
      const value = JSON.stringify({ image: body.image, by: str(body.by, 20) || 'Anonymous', ts: Date.now() });
      if (KV_URL && KV_TOKEN) await kvCmd(['hset', KEY, String(slot)], value);
      else MEM.set(String(slot), value);
      return res.status(200).json({ ok: true, slot });
    }

    // GET → whole gallery: { slot: { image, by } }
    const images = {};
    const collect = (k, raw) => { if (validSlot(k)) { const u = unpack(raw); if (u) images[k] = u; } };
    if (KV_URL && KV_TOKEN) {
      const arr = (await kvCmd(['hgetall', KEY])) || [];
      for (let i = 0; i < arr.length; i += 2) collect(arr[i], arr[i + 1]);
    } else {
      for (const [k, v] of MEM) collect(k, v);
    }
    return res.status(200).json({ images, source: KV_URL ? 'kv' : 'memory' });
  } catch (e) {
    return res.status(200).json({ images: {}, error: String((e && e.message) || e) });
  }
};
