// presence.js — live multiplayer: broadcast my truck's state, receive everyone
// else's. Two modes, chosen automatically:
//
//   LIVE  — /api/presence answers, so the roster is the real set of people on
//           the site right now, wherever they are (see api/presence.js). This is
//           what you get on Vercel.
//   LOCAL — no API (e.g. `python3 -m http.server`). Falls back to a cross-tab
//           roster on THIS machine via localStorage heartbeats, so opening a
//           second tab still gives you a second driver to meet.
//
// Either way `onRoster` fires with the list of OTHER drivers, and the displayed
// count never drops below FLOOR (the ambient "drivers on the highway" vibe).

const FLOOR = 13;
const KEY = 'its_roster_v1';
const HEARTBEAT_MS = 2500;
const STALE_MS = 9000;

export class Presence {
  /**
   * @param {object} o
   * @param {() => {name:string,color:string}} o.identity   who I am right now
   * @param {() => {dist:number,lane:number,kmh:number}} o.state   where I am
   * @param {(count:number, delta:number, live:boolean) => void} o.onUpdate
   * @param {(players:Array) => void} o.onRoster   the OTHER drivers
   */
  constructor(o) {
    this.identity = o.identity || (() => ({ name: 'Driver', color: '#f0a020' }));
    this.state = o.state || (() => ({ dist: 0, lane: 0, kmh: 0 }));
    this.onUpdate = o.onUpdate || (() => {});
    this.onRoster = o.onRoster || (() => {});
    this.onSpawn = o.onSpawn || (() => {});      // fired once: a WiFi-mate's distance
    this._spawned = false;

    this.id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.count = FLOOR;
    this.lastCount = FLOOR;
    this.live = false;

    this._beat();
    this._hb = setInterval(() => this._beat(), HEARTBEAT_MS);

    addEventListener('storage', (e) => { if (e.key === KEY) this._recountLocal(); });
    addEventListener('beforeunload', () => this._leave());
    addEventListener('pagehide', () => this._leave());   // the one that fires on mobile Safari

    if ('BroadcastChannel' in window) {
      this.bc = new BroadcastChannel('its_presence');
      this.bc.onmessage = () => this._recountLocal();
    }
  }

  _mine() {
    const idy = this.identity() || {};
    const st = this.state() || {};
    return {
      name: (idy.name || 'Driver').slice(0, 20),
      color: idy.color || '#f0a020',
      dist: +st.dist || 0,
      lane: +st.lane || 0,
      kmh: +st.kmh || 0,
    };
  }

  async _beat() {
    // Try the server first; fall back to the cross-tab roster if it's not there.
    const mine = this._mine();
    try {
      const r = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ id: this.id, ...mine }),
      });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      if (Array.isArray(data.players)) {
        this.live = true;
        const others = data.players.filter((p) => p.id !== this.id);
        this.onRoster(others);
        this._setCount(typeof data.count === 'number' ? data.count : others.length + 1);
        if (!this._spawned && typeof data.spawn === 'number') {
          this._spawned = true;
          this.onSpawn(data.spawn);
        }
        return;
      }
      throw new Error('no players');
    } catch {
      this.live = false;
      this._beatLocal(mine);
    }
  }

  // ── cross-tab local roster ────────────────────────────────────────────────

  _read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  }

  _write(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode */ }
  }

  _beatLocal(mine) {
    const now = Date.now();
    const map = this._read();
    map[this.id] = { ...mine, ts: now };
    for (const k of Object.keys(map)) if (now - (map[k].ts || 0) > STALE_MS) delete map[k];
    this._write(map);
    this.bc?.postMessage('beat');
    this._recountLocal(map);
  }

  _recountLocal(map) {
    if (this.live) return;                 // server took over between ticks
    const now = Date.now();
    map = map || this._read();
    const others = [];
    for (const [k, v] of Object.entries(map)) {
      if (k === this.id || now - (v.ts || 0) > STALE_MS) continue;
      others.push({ id: k, name: v.name, color: v.color, dist: v.dist, lane: v.lane, kmh: v.kmh });
    }
    this.onRoster(others);
    this._setCount(others.length + 1);
    // same machine counts as the same "network" — spawn near another local tab
    if (!this._spawned && others.length) {
      this._spawned = true;
      this.onSpawn(others[0].dist);
    }
  }

  _leave() {
    // tell the server I'm gone so my dot drops immediately
    try {
      const blob = new Blob([JSON.stringify({ id: this.id, leave: true })], { type: 'application/json' });
      navigator.sendBeacon?.('/api/presence', blob);
    } catch { /* nothing to do on unload */ }
    // and clear my local entry
    const map = this._read();
    delete map[this.id];
    this._write(map);
    this.bc?.postMessage('leave');
  }

  _setCount(real) {
    const next = Math.max(FLOOR, real);
    if (next !== this.count) {
      this.lastCount = this.count;
      this.count = next;
      this.onUpdate(this.count, next - this.lastCount, this.live);
    }
  }

  destroy() {
    clearInterval(this._hb);
    this._leave();
  }
}
