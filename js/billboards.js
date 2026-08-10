// billboards.js — the shared "upload your photo" billboards.
//
// The highway is a loop (see world.js). A billboard stands at every multiple of
// BILLBOARD_SPACING, so there are BILLBOARD_COUNT of them around the ring — a lot
// of them, at exact positions every client agrees on. Each maps to a shared slot
// (0…COUNT-1); whatever photo has been uploaded to that slot is painted on the
// board for everybody, credited to the uploader's truck name.
//
// This module owns the billboard meshes directly (a small reused pool that
// covers the visible stretch of road), the glowing road pad under each, the
// floating credit plate above each, and the upload menu. It talks to
// /api/billboards so uploads are shared with everyone, with a localStorage
// fallback so it still works offline / on a plain file server.

import * as THREE from 'three';
import {
  makeBillboard, billboardSlot, BILLBOARD_COUNT, BILLBOARD_SPACING,
  ROAD_W, roadCenterX, roadY, roadHeading,
} from './world.js';

const POLL_MS = 15000;
const LS_KEY = 'its_billboards_v1';
const BOARD_OFF = 4;            // metres the board stands beyond the tarmac edge
const PAD_INSET = 0.9;          // how far onto the tarmac the pad sits from the edge
const NEAR_REL = 11;            // metres along the road to count as "at" the board
const NEAR_LAT = 3.2;          // lateral metres to count as "pulled over to it"
const PARK_KMH = 12;           // must be crawling/stopped to upload
const AHEAD = 440;             // how far ahead to render boards
const BEHIND = 60;             // how far behind to keep them

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
    this.identity = identity || (() => 'Anonymous');   // () => my truck's name
    this.root = new THREE.Group();
    scene.add(this.root);

    this.placeholder = placeholderTexture();
    this.gallery = this._loadLocal();     // { slot: { src, by } }
    this.slotTex = {};                    // { slot: THREE.Texture }
    for (const [slot, e] of Object.entries(this.gallery)) if (e?.src) this._buildSlotTex(+slot, e.src);

    this.boards = [];                     // reused mesh pool covering the visible road
    this.nearby = null;                   // { slot } when parked at a board
    this.live = false;

    this._bindUI();
    this._poll();
    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  _makeEntry() {
    const group = makeBillboard();
    let face = null;
    group.traverse((o) => { if (o.userData.billboardFace) face = o; });
    const credit = makeCreditLabel();
    credit.position.set(0, 11.0, 0.3);
    group.add(credit);
    const pad = makePad();
    group.visible = false; pad.visible = false;
    this.root.add(group);
    this.root.add(pad);
    return { group, face, credit, pad, token: null, creditToken: null };
  }

  // ── per-frame ──────────────────────────────────────────────────────────────

  update(dt, dist, lane, kmh, night, t, roadW = ROAD_W) {
    const SP = BILLBOARD_SPACING;
    const iMin = Math.ceil((dist - BEHIND) / SP);
    const iMax = Math.floor((dist + AHEAD) / SP);
    const need = Math.max(0, iMax - iMin + 1);
    while (this.boards.length < need) this.boards.push(this._makeEntry());

    const cx0 = roadCenterX(dist), y0 = roadY(dist);
    let best = null;

    for (let k = 0; k < this.boards.length; k++) {
      const e = this.boards[k];
      if (k >= need) { e.group.visible = false; e.pad.visible = false; continue; }

      const i = iMin + k;
      const d = i * SP;
      const slot = ((i % BILLBOARD_COUNT) + BILLBOARD_COUNT) % BILLBOARD_COUNT;
      const side = (i % 2 === 0) ? 1 : -1;              // deterministic: same board, same side for all
      const h = roadHeading(d), rel = d - dist;

      const boardLat = side * (roadW / 2 + BOARD_OFF);
      e.group.visible = true;
      e.group.position.set(
        roadCenterX(d) - cx0 + Math.cos(h) * boardLat,
        roadY(d) - y0,
        rel + Math.sin(h) * -boardLat
      );
      e.group.rotation.y = Math.PI + h;                 // face oncoming traffic
      this._paintFace(e, slot);
      this._paintCredit(e, slot);
      for (const c of e.group.children) {
        if (c.userData.bulb) c.material.emissiveIntensity = 0.08 + night * 0.5;
      }

      // glowing pad on the tarmac edge in front of the board
      const padLat = side * (roadW / 2 - PAD_INSET);
      e.pad.visible = true;
      e.pad.position.set(
        roadCenterX(d) - cx0 + Math.cos(h) * padLat,
        roadY(d) - y0 + 0.02,
        rel + Math.sin(h) * -padLat
      );
      const parked = Math.abs(rel) < NEAR_REL && Math.abs(lane - padLat) < NEAR_LAT && kmh < PARK_KMH;
      const glow = parked ? 1 : 0.35 + 0.2 * Math.sin(t * 3 + i);
      e.pad.userData.disc.material.opacity = 0.16 + glow * 0.4 + night * 0.15;
      e.pad.userData.ring.material.opacity = 0.4 + glow * 0.5;
      e.pad.userData.beam.material.opacity = 0.05 + glow * 0.12 + night * 0.05;
      e.pad.scale.setScalar(parked ? 1.08 + 0.05 * Math.sin(t * 6) : 1);

      if (parked && (!best || Math.abs(rel) < Math.abs(best.rel))) best = { slot, rel };
    }

    this._setNearby(best ? { slot: best.slot } : null);
  }

  _paintFace(e, slot) {
    if (!e.face) return;
    const token = this.gallery[slot]?.src || 'ph';
    if (e.token === token) return;
    e.token = token;
    e.face.material.map = this.slotTex[slot] || this.placeholder;
    e.face.material.needsUpdate = true;
  }

  // Floating "📷 by <trucker>" plate above a board that has an uploaded photo.
  _paintCredit(e, slot) {
    const by = this.gallery[slot]?.by || '';
    const token = by || 'none';
    if (e.creditToken === token) return;
    e.creditToken = token;
    e.credit.visible = !!by;
    if (by) {
      paintCredit(e.credit.userData.ctx, by);
      e.credit.userData.tex.needsUpdate = true;
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
    // force the visible boards to re-check their textures next frame
    for (const b of this.boards) { b.token = null; b.creditToken = null; }
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
    for (const b of this.boards) { b.token = null; b.creditToken = null; }
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
      const W = 512, H = 252;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      this._pending = c.toDataURL('image/jpeg', 0.72);
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
