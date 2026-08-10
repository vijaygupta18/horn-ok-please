// api/presence.js — live multiplayer roster: who's on the highway, where, named.
//
// Each client POSTs a heartbeat with its id and current state (name, colour,
// distance travelled, lane, speed). The response is the full roster of everyone
// whose heartbeat is still fresh — so every driver can see every other driver's
// truck on the road and dot on the minimap. Anyone who goes quiet for TTL_MS
// drops out.
//
// Storage: a Redis hash via the Upstash/Vercel-KV REST API when the env vars are
// present (shared across serverless instances). Without them it falls back to a
// per-instance in-memory Map. No npm dependencies either way — deploys with no
// build step. If storage is missing entirely the client drops to a cross-tab
// local roster on its own, so the page never breaks.

const TTL_MS = 25000;          // a driver is "gone" after 25s of silence
const KEY = 'its:roster';
const MAX_PLAYERS = 60;

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// in-memory fallback (module scope survives between invocations on a warm instance)
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
    req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);

// Parse a stored value into a full record (incl. the private network id used to
// group drivers on the same WiFi), or null if stale/garbage.
function record(id, raw, now) {
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  if (now - (v.ts || 0) > TTL_MS) return null;
  return {
    id: str(id, 64),
    name: str(v.name, 20) || 'Driver',
    color: str(v.color, 12) || '#f0a020',
    dist: num(v.dist),
    lane: num(v.lane),
    kmh: num(v.kmh),
    net: str(v.net, 64),          // network group (hashed IP) — never returned
    ts: v.ts || 0,
  };
}

// A coarse network id from the caller's IP, so people behind the same router
// (same WiFi / NAT) share a group. Hashed so we never store a raw address.
function netId(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.socket?.remoteAddress || 'local';
  let h = 5381;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) + h + ip.charCodeAt(i)) | 0;
  return 'n' + (h >>> 0).toString(36);
}

// The public view of a driver — network id stripped out.
const publicOf = ({ id, name, color, dist, lane, kmh }) => ({ id, name, color, dist, lane, kmh });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? await readBody(req) : {};
  const url = new URL(req.url, 'http://x');
  const id = str(body.id || url.searchParams.get('id'), 64);
  const leaving = body.leave === true || url.searchParams.get('leave') === '1';
  const now = Date.now();
  const net = netId(req);

  const mine = id ? JSON.stringify({
    name: str(body.name, 20), color: str(body.color, 12),
    dist: num(body.dist), lane: num(body.lane), kmh: num(body.kmh), net, ts: now,
  }) : null;

  // Spawn a newcomer near a driver already on the same WiFi. It's the nearest
  // network-mate ahead of us on the loop (or just any mate) so we appear together.
  function spawnFor(records, myDist) {
    const mates = records.filter((r) => r.id !== id && r.net === net);
    if (!mates.length) return null;
    mates.sort((a, b) => b.ts - a.ts);         // most recently active mate
    return mates[0].dist;
  }

  try {
    if (KV_URL && KV_TOKEN) {
      if (id && leaving) await kvCmd(['hdel', KEY, id]);
      else if (id) await kvCmd(['hset', KEY, id], mine);

      const arr = (await kvCmd(['hgetall', KEY])) || [];
      const records = [];
      const stale = [];
      for (let i = 0; i < arr.length; i += 2) {
        const r = record(arr[i], arr[i + 1], now);
        if (r) records.push(r); else stale.push(arr[i]);
      }
      for (const s of stale) kvCmd(['hdel', KEY, s]).catch(() => {});
      const players = records.map(publicOf).slice(0, MAX_PLAYERS);
      return res.status(200).json({ count: records.length, players, spawn: spawnFor(records, num(body.dist)), source: 'kv' });
    }

    // in-memory fallback
    if (id && leaving) MEM.delete(id);
    else if (id) MEM.set(id, mine);
    const records = [];
    for (const [k, raw] of MEM) {
      const r = record(k, raw, now);
      if (r) records.push(r); else MEM.delete(k);
    }
    const players = records.map(publicOf).slice(0, MAX_PLAYERS);
    return res.status(200).json({ count: records.length, players, spawn: spawnFor(records, num(body.dist)), source: 'memory' });
  } catch (e) {
    // Never let a storage hiccup break the page — the client falls back on its own.
    return res.status(200).json({ count: null, players: [], error: String((e && e.message) || e) });
  }
};
