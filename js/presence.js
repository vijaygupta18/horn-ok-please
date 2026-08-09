// presence.js — "drivers on the highway" counter.
//
// Two modes, chosen automatically:
//
//   LIVE  — /api/presence answers, so the number is the real count of people on
//           the site right now (see api/presence.js). This is what you get on
//           Vercel.
//   LOCAL — no API (e.g. `python3 -m http.server`). Falls back to counting the
//           browser tabs open on THIS machine via localStorage heartbeats, plus
//           a gentle ambient drift so the number isn't frozen.
//
// Either way the displayed number never drops below FLOOR.

const FLOOR = 13;
const KEY = 'its_presence_v1';
const HEARTBEAT_MS = 3000;
const LIVE_POLL_MS = 8000;
const STALE_MS = 10000;

export class Presence {
  constructor(onUpdate) {
    this.onUpdate = onUpdate || (() => {});
    this.id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.sim = 0;
    this.count = FLOOR;
    this.lastCount = FLOOR;
    this.live = false;          // flips true once the API answers
    this.liveCount = 0;

    this._beat();
    this._tickSim();
    this._pollLive();

    this._hb = setInterval(() => this._beat(), HEARTBEAT_MS);
    this._sim = setInterval(() => this._tickSim(), 1000);
    this._lp = setInterval(() => this._pollLive(), LIVE_POLL_MS);

    addEventListener('storage', (e) => { if (e.key === KEY) this._recount(); });
    addEventListener('beforeunload', () => this._leave());
    // `pagehide` is the one that actually fires on mobile Safari
    addEventListener('pagehide', () => this._leave());

    if ('BroadcastChannel' in window) {
      this.bc = new BroadcastChannel('its_presence');
      this.bc.onmessage = () => this._recount();
    }
  }

  // ── live server count ─────────────────────────────────────────────────────

  async _pollLive() {
    try {
      const r = await fetch(`/api/presence?id=${encodeURIComponent(this.id)}`, {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      if (typeof data.count === 'number') {
        this.live = true;
        this.liveCount = data.count;
        this.source = data.source;
        this._recount();
      }
    } catch {
      this.live = false;        // stay on the local estimate
    }
  }

  // ── local (per-machine) fallback ──────────────────────────────────────────

  _read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  }

  _write(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode */ }
  }

  _beat() {
    const now = Date.now();
    const map = this._read();
    map[this.id] = now;
    for (const k of Object.keys(map)) if (now - map[k] > STALE_MS) delete map[k];
    this._write(map);
    this.bc?.postMessage('beat');
    this._recount(map);
  }

  _leave() {
    const map = this._read();
    delete map[this.id];
    this._write(map);
    this.bc?.postMessage('leave');
    // best-effort "I'm gone" so the server count drops immediately
    try {
      navigator.sendBeacon?.(`/api/presence?id=${encodeURIComponent(this.id)}&leave=1`);
    } catch { /* nothing to do on unload */ }
  }

  _tabs(map) {
    const now = Date.now();
    map = map || this._read();
    return Object.values(map).filter((ts) => now - ts <= STALE_MS).length || 1;
  }

  // Ambient drift, used only when there's no live count to show.
  _tickSim() {
    if (this.live) return;
    if (Math.random() < 0.13) {
      this.sim += Math.random() < 0.55 ? 1 : -1;
      this.sim = Math.max(0, Math.min(37, this.sim));
    }
    this._recount();
  }

  _recount(map) {
    const next = this.live
      ? Math.max(FLOOR, this.liveCount)
      // FLOOR - 1 + tabs → a lone visitor sees exactly 13, each join adds one
      : Math.max(FLOOR, FLOOR - 1 + this._tabs(map) + this.sim);

    if (next !== this.count) {
      this.lastCount = this.count;
      this.count = next;
      this.onUpdate(this.count, next - this.lastCount, this.live);
    }
  }

  destroy() {
    clearInterval(this._hb);
    clearInterval(this._sim);
    clearInterval(this._lp);
    this._leave();
  }
}
