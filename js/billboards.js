// billboards.js — the shared "upload your photo" billboards.
//
// world.js scatters special billboard props down the highway, each locked to a
// shared slot id (0 … BILLBOARD_COUNT-1) via billboardSlot(). This module:
//
//   • paints every billboard face with whatever image has been uploaded to its
//     slot (or a "park & upload" placeholder),
//   • draws a glowing pad on the road below each one,
//   • notices when the hero truck parks on a pad and offers the upload menu,
//   • talks to /api/billboards so uploads are shared with everyone (with a
//     localStorage fallback so it still works offline / on a plain file server).

import * as THREE from 'three';
import { roadCenterX, roadY, roadHeading, ROAD_W, billboardSlot, BILLBOARD_COUNT } from './world.js';

const POLL_MS = 15000;
const LS_KEY = 'its_billboards_v1';
const PAD_INSET = 0.9;          // how far onto the tarmac the pad sits from the edge
const NEAR_REL = 11;            // metres along the road to count as "at" the board
const NEAR_LAT = 3.2;           // lateral metres to count as "pulled over to it"
const PARK_KMH = 12;            // must be crawling/stopped to upload

const $ = (s) => document.querySelector(s);

// The default face: a hand-lettered "advertise here" placeholder.
function placeholderTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 252;
  const x = c.getContext('2d');
  x.fillStyle = '#0e9488'; x.fillRect(0, 0, 512, 252);
  x.strokeStyle = '#fbdb4a'; x.lineWidth = 10; x.strokeRect(10, 10, 492, 232);
  x.fillStyle = '#fdf6e3'; x.textAlign = 'center';
  x.font = '800 40px "Baloo 2", sans-serif';
  x.fillText('YOUR AD HERE', 256, 78);
  x.font = '700 30px "Noto Sans Devanagari", sans-serif';
  x.fillStyle = '#fbdb4a';
  x.fillText('अपनी फोटो लगाओ', 256, 128);
  x.fillStyle = '#fdf6e3';
  x.font = '700 24px Rajdhani, sans-serif';
  x.fillText('PARK ON THE PAD · PRESS U', 256, 176);
  x.font = '46px sans-serif';
  x.fillText('📷', 256, 224);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePad() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.0, 36),
    new THREE.MeshBasicMaterial({ color: '#2fe0c8', transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.1, 44),
    new THREE.MeshBasicMaterial({ color: '#8ffbe8', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  g.add(ring);
  // a faint upward beam so you can spot the pad from a distance
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.2, 7, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: '#2fe0c8', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 3.5;
  g.add(beam);
  g.userData = { disc, ring, beam };
  return g;
}

export class Billboards {
  constructor(scene, world, identity) {
    this.scene = scene;
    this.world = world;
    this.identity = identity || (() => 'Anonymous');   // () => my truck's name
    this.root = new THREE.Group();
    scene.add(this.root);

    this.placeholder = placeholderTexture();
    this.gallery = this._loadLocal();     // { slot: { src, by } }
    this.slotTex = {};                    // { slot: THREE.Texture }
    for (const [slot, e] of Object.entries(this.gallery)) if (e?.src) this._buildSlotTex(+slot, e.src);

    this.nearby = null;                   // { slot } when parked at a board
    this._pads = [];                      // reusable pad pool
    this.live = false;

    this._bindUI();
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  // ── per-frame ──────────────────────────────────────────────────────────────

  update(dt, dist, lane, kmh, night, t) {
    const boards = this.world.props.filter((p) => p.kind === 'billboard' && p.obj.visible);
    let best = null;

    // make sure we have enough pads
    while (this._pads.length < boards.length) {
      const pad = makePad();
      this.root.add(pad);
      this._pads.push(pad);
    }
    for (const pad of this._pads) pad.visible = false;

    const cx0 = roadCenterX(dist), y0 = roadY(dist);
    boards.forEach((rec, i) => {
      const slot = billboardSlot(rec.d);
      this._paintFace(rec, slot);
      this._paintCredit(rec, slot);

      // pad on the road edge in front of the board
      const padLat = rec.side * (ROAD_W / 2 - PAD_INSET);
      const h = roadHeading(rec.d);
      const rel = rec.d - dist;
      const pad = this._pads[i];
      pad.visible = true;
      pad.position.set(
        roadCenterX(rec.d) - cx0 + Math.cos(h) * padLat,
        roadY(rec.d) - y0 + 0.02,
        rel + Math.sin(h) * -padLat
      );

      const latDist = Math.abs(lane - padLat);
      const parked = Math.abs(rel) < NEAR_REL && latDist < NEAR_LAT && kmh < PARK_KMH;
      const glow = parked ? 1 : 0.35 + 0.2 * Math.sin(t * 3 + i);
      pad.userData.disc.material.opacity = 0.16 + glow * 0.4 + night * 0.15;
      pad.userData.ring.material.opacity = 0.4 + glow * 0.5;
      pad.userData.beam.material.opacity = 0.05 + glow * 0.12 + night * 0.05;
      pad.scale.setScalar(parked ? 1.08 + 0.05 * Math.sin(t * 6) : 1);

      if (parked && (!best || Math.abs(rel) < Math.abs(best.rel))) best = { slot, rel };
    });

    this._setNearby(best ? { slot: best.slot } : null);
  }

  _paintFace(rec, slot) {
    if (!rec._face) rec.obj.traverse((o) => { if (o.userData.billboardFace) rec._face = o; });
    const face = rec._face;
    if (!face) return;
    const token = this.gallery[slot]?.src || 'ph';
    if (rec._token === token) return;
    rec._token = token;
    face.material.map = this.slotTex[slot] || this.placeholder;
    face.material.needsUpdate = true;
  }

  // Floating "📷 by <trucker>" plate above a board that has an uploaded photo.
  _paintCredit(rec, slot) {
    const by = this.gallery[slot]?.by || '';
    if (!rec._credit) {
      const label = makeCreditLabel();
      label.position.set(0, 11.0, 0.3);   // above the board face
      rec.obj.add(label);
      rec._credit = label;
    }
    const token = by || 'none';
    if (rec._creditToken !== token) {
      rec._creditToken = token;
      rec._credit.visible = !!by;
      if (by) {
        paintCredit(rec._credit.userData.ctx, by);
        rec._credit.userData.tex.needsUpdate = true;
      }
    }
  }

  _setNearby(n) {
    const changed = (n && n.slot) !== (this.nearby && this.nearby.slot);
    this.nearby = n;
    if (!changed || !this.hintEl) return;
    if (n) {
      const by = this.gallery[n.slot]?.by;
      this.hintEl.innerHTML = by
        ? `🖼️ ${escapeHtml(by)}'s photo is here — <b>press U</b> to replace it`
        : '📷 Free billboard! <b>press U</b> to put your photo up for everyone';
      this.hintEl.classList.add('show');
    } else {
      this.hintEl.classList.remove('show');
    }
  }

  // ── shared gallery I/O ──────────────────────────────────────────────────────

  async _poll() {
    try {
      const r = await fetch('/api/billboards', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      if (data && data.images) { this.live = true; this._applyGallery(data.images); return; }
      throw new Error('no images');
    } catch {
      this.live = false;               // stay on whatever we have locally
    }
  }

  _applyGallery(map) {
    for (let slot = 0; slot < BILLBOARD_COUNT; slot++) {
      const e = map[slot];
      const cur = this.gallery[slot];
      if (e && e.image) {
        if (cur && cur.src === e.image && cur.by === e.by) continue;
        this.gallery[slot] = { src: e.image, by: e.by || 'Anonymous' };
        this._buildSlotTex(slot, e.image);
      } else if (cur) {
        delete this.gallery[slot];
        this._disposeSlot(slot);
      }
    }
    this._saveLocal();
  }

  _buildSlotTex(slot, src) {
    this._disposeSlot(slot);
    const tex = new THREE.TextureLoader().load(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.slotTex[slot] = tex;
  }

  _disposeSlot(slot) {
    this.slotTex[slot]?.dispose?.();
    delete this.slotTex[slot];
  }

  _loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') out[k] = { src: v, by: 'You' };   // legacy image-only
        else if (v && v.src) out[k] = { src: v.src, by: v.by || 'You' };
      }
      return out;
    } catch { return {}; }
  }

  _saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.gallery)); } catch { /* private mode */ }
  }

  async _upload(slot, dataURL) {
    const by = (this.identity() || 'Anonymous').toString().slice(0, 20) || 'Anonymous';
    // paint it locally right away — no waiting on the round trip
    this.gallery[slot] = { src: dataURL, by };
    this._buildSlotTex(slot, dataURL);
    this._saveLocal();
    try {
      await fetch('/api/billboards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot, image: dataURL, by }),
      });
    } catch { /* offline: it's saved locally, will still show for you */ }
  }

  // ── upload menu (DOM) ───────────────────────────────────────────────────────

  _bindUI() {
    this.hintEl = $('#bb-hint');
    this.modal = $('#bb-modal');
    this.fileInput = $('#bb-file');
    this.preview = $('#bb-preview');
    this._pending = null;
    if (!this.modal) return;

    this.fileInput?.addEventListener('change', (e) => this._onFile(e.target.files[0]));
    $('#bb-cancel')?.addEventListener('click', () => this.closeUpload());
    $('#bb-paste')?.addEventListener('click', () => this._commit());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.closeUpload(); });
  }

  /** Open the menu for whatever board we're parked at. No-op if not parked. */
  openUpload() {
    if (!this.nearby || !this.modal) return;
    this._uploadSlot = this.nearby.slot;
    this._pending = null;
    if (this.fileInput) this.fileInput.value = '';
    const btn = $('#bb-paste'); if (btn) btn.disabled = true;
    const pv = this.preview?.getContext('2d');
    if (pv) { pv.fillStyle = '#0b1f22'; pv.fillRect(0, 0, this.preview.width, this.preview.height); }
    const title = $('#bb-title');
    if (title) title.textContent = `Billboard #${this._uploadSlot + 1} — पूरी दुनिया देखेगी`;
    this.modal.classList.add('show');
    return true;
  }

  closeUpload() {
    this.modal?.classList.remove('show');
  }

  _onFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // downscale to the board's ~2:1 face with a centred cover crop
      const W = 512, H = 252;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      this._pending = c.toDataURL('image/jpeg', 0.72);
      // preview
      if (this.preview) {
        const p = this.preview.getContext('2d');
        p.drawImage(c, 0, 0, this.preview.width, this.preview.height);
      }
      const btn = $('#bb-paste'); if (btn) btn.disabled = false;
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  _commit() {
    if (this._pending == null || this._uploadSlot == null) return;
    this._upload(this._uploadSlot, this._pending);
    this._pending = null;
    this.closeUpload();
  }

  destroy() { clearInterval(this._pollTimer); }
}

// ── credit plate ("📷 by <trucker>") that floats above a filled billboard ─────
function makeCreditLabel() {
  const c = document.createElement('canvas');
  c.width = 340; c.height = 72;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  spr.scale.set(5.2, 1.1, 1);
  spr.visible = false;
  spr.userData = { canvas: c, ctx, tex };
  return spr;
}

function paintCredit(x, name) {
  x.clearRect(0, 0, 340, 72);
  x.fillStyle = 'rgba(10,28,26,.9)';
  bbRoundRect(x, 8, 10, 324, 46, 12); x.fill();
  x.lineWidth = 3; x.strokeStyle = '#fbdb4a'; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 26px "Baloo 2", Rajdhani, sans-serif';
  x.fillStyle = '#fdf6e3';
  x.fillText(`📷 by ${name.slice(0, 16)}`, 170, 34);
}

function bbRoundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
