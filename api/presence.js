// api/presence.js — real "drivers on the highway" count.
//
// Each client POSTs a heartbeat every few seconds with a random id; anyone whose
// heartbeat has gone stale drops out. The count returned is therefore the actual
// number of people on the site right now.
//
// Storage: a Redis sorted set via the Upstash/Vercel-KV REST API when the env
// vars are present (works across serverless instances and cold starts). Without
// them it falls back to a per-instance in-memory Map — still a real count of
// real visitors, just not shared between instances. No npm dependencies either
// way, so this deploys with no build step.

const TTL_MS = 25000;          // a driver is "gone" after 25s of silence
const KEY = 'its:presence';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// in-memory fallback (module scope survives between invocations on a warm instance)
const MEM = new Map();

async function kv(...path) {
  const res = await fetch(`${KV_URL}/${path.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return (await res.json()).result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, 'http://x');
  const id = String(url.searchParams.get('id') || '').slice(0, 64);
  const leaving = url.searchParams.get('leave') === '1';
  const now = Date.now();

  try {
    if (KV_URL && KV_TOKEN) {
      if (id && leaving) await kv('zrem', KEY, id);
      else if (id) await kv('zadd', KEY, String(now), id);
      await kv('zremrangebyscore', KEY, '0', String(now - TTL_MS));
      const count = Number(await kv('zcard', KEY)) || 0;
      return res.status(200).json({ count, source: 'kv' });
    }

    if (id && leaving) MEM.delete(id);
    else if (id) MEM.set(id, now);
    for (const [k, t] of MEM) if (now - t > TTL_MS) MEM.delete(k);
    return res.status(200).json({ count: MEM.size, source: 'memory' });
  } catch (e) {
    // Never let a storage hiccup break the page — the client falls back on its own.
    return res.status(200).json({ count: null, error: String(e && e.message || e) });
  }
};
