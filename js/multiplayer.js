// multiplayer.js — draw the OTHER drivers.
//
// The presence layer (js/presence.js) hands us a roster of everyone else on the
// highway. Here we turn that into two things you can actually see:
//
//   • a coloured, named ghost lorry for each nearby player, placed on the same
//     procedural road we're all driving — the world is a ring (UNIVERSE_LEN), so
//     someone "ahead" of you by half the loop comes round to meet you.
//   • a round radar in the corner where every driver is a dot on the little
//     round universe, with their name under it.
//
// Ghosts are deliberately simple box lorries (not the full hero truck): cheap to
// build, and their own colour makes them read instantly as "another player"
// rather than NPC traffic.

import * as THREE from 'three';
import { roadCenterX, roadY, roadHeading, ROAD_W, UNIVERSE_LEN } from './world.js';

// nearest-image wrap of a distance delta into (-L/2, L/2]
function wrapDelta(d) {
  const L = UNIVERSE_LEN;
  return ((d % L) + L * 1.5) % L - L / 2;
}

const NAME_FIRST = ['Pappu', 'Bittu', 'Guddu', 'Sonu', 'Raju', 'Kaka', 'Balli', 'Fauji',
  'Chotu', 'Lucky', 'Goldy', 'Deepa', 'Sardar', 'Munna', 'Tinku', 'Happy'];
const NAME_LAST = ['Transport', 'Goods', 'Lorry', 'Roadways', 'Carrier', 'Express',
  'ji', 'Bhai', 'Driver', 'Singh', 'da Puttar', 'Ustaad'];
const COLORS = ['#f0a020', '#d92121', '#1f9a4a', '#1e6fd9', '#ec4899', '#f5741a',
  '#13a892', '#6d28d9', '#fbdb4a', '#38bdf8'];

const rndItem = (a) => a[(Math.random() * a.length) | 0];
export const randomDriverName = () => `${rndItem(NAME_FIRST)} ${rndItem(NAME_LAST)}`;
export const randomDriverColor = () => rndItem(COLORS);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o });

// A compact painted-lorry silhouette in the player's colour.
function makeGhostTruck(color) {
  const g = new THREE.Group();
  const paint = mat(color, { roughness: 0.5, metalness: 0.1 });
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 5.4), paint);
  cargo.position.set(0, 2.5, -1.2);
  cargo.castShadow = true;
  g.add(cargo);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.4, 2.2), mat(color, { roughness: 0.45 }));
  cab.position.set(0, 1.7, 2.9);
  cab.castShadow = true;
  g.add(cab);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 0.1),
    mat('#16202b', { metalness: 0.5, roughness: 0.2 }));
  glass.position.set(0, 2.4, 4.0);
  g.add(glass);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.4), mat('#c8d2dc', { metalness: 0.9, roughness: 0.2 }));
  bumper.position.set(0, 0.7, 4.1);
  g.add(bumper);
  const wg = new THREE.CylinderGeometry(0.6, 0.6, 0.34, 14);
  for (const [x, z] of [[-1.05, 2.9], [1.05, 2.9], [-1.05, -0.6], [1.05, -0.6], [-1.05, -2.6], [1.05, -2.6]]) {
    const w = new THREE.Mesh(wg, mat('#141416', { roughness: 0.95 }));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.6, z);
    g.add(w);
  }
  // a soft colour ring on the ground so you can spot a teammate from afar
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.1, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

// Floating name plate that always faces the camera.
function makeNameLabel(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  paintLabel(x, name, color);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  spr.scale.set(4.2, 1.05, 1);
  spr.userData = { canvas: c, ctx: x, tex, name };
  return spr;
}

function paintLabel(x, name, color) {
  x.clearRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(8,14,22,.72)';
  roundRect(x, 6, 14, 244, 36, 10); x.fill();
  x.lineWidth = 2.5; x.strokeStyle = color; x.stroke();
  x.fillStyle = '#fdf6e3';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 24px Rajdhani, "Baloo 2", sans-serif';
  x.fillText(name.slice(0, 16), 128, 33);
  // little pointer under the plate
  x.fillStyle = 'rgba(8,14,22,.72)';
  x.beginPath(); x.moveTo(118, 50); x.lineTo(138, 50); x.lineTo(128, 60); x.closePath(); x.fill();
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

export class Multiplayer {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.ghosts = new Map();         // id -> { group, label, dist, lane, kmh, tDist, tLane, tKmh, name, color }
    this.roster = [];                // last roster from presence
    this.me = { dist: 0, lane: 0, name: 'You', color: '#fbdb4a' };
    this.mapCtx = null;
    this._mapTimer = 0;
  }

  attachMap(canvas) {
    if (canvas) this.mapCtx = canvas.getContext('2d');
  }

  setRoster(players) {
    this.roster = players || [];
    const seen = new Set();
    for (const p of this.roster) {
      seen.add(p.id);
      let gh = this.ghosts.get(p.id);
      if (!gh) {
        const group = makeGhostTruck(p.color);
        const label = makeNameLabel(p.name, p.color);
        label.position.y = 5.6;
        group.add(label);
        group.visible = false;
        this.root.add(group);
        gh = { group, label, dist: p.dist, lane: p.lane, kmh: p.kmh, name: p.name, color: p.color };
        this.ghosts.set(p.id, gh);
      }
      // fresh targets for dead-reckoning
      gh.tDist = p.dist; gh.tLane = p.lane; gh.tKmh = p.kmh;
      if (p.name !== gh.name || p.color !== gh.color) {
        gh.name = p.name; gh.color = p.color;
        paintLabel(gh.label.userData.ctx, p.name, p.color);
        gh.label.userData.tex.needsUpdate = true;
      }
    }
    // retire drivers who left
    for (const [id, gh] of this.ghosts) {
      if (seen.has(id)) continue;
      this.root.remove(gh.group);
      gh.group.traverse((o) => { o.geometry?.dispose?.(); if (o.material?.dispose) o.material.dispose(); });
      gh.label.material.map.dispose();
      gh.label.material.dispose();
      this.ghosts.delete(id);
    }
  }

  /** Called every frame with the hero's current world state. */
  update(dt, heroDist, heroLane, heroName, heroColor, night = 0) {
    this.me = { dist: heroDist, lane: heroLane, name: heroName, color: heroColor };

    for (const gh of this.ghosts.values()) {
      // dead reckon forward, then correct toward the last reported position
      if (gh.tDist === undefined) { gh.tDist = gh.dist; gh.tLane = gh.lane; gh.tKmh = gh.kmh; }
      gh.dist += (gh.tKmh / 3.6) * dt;
      gh.dist += wrapDelta(gh.tDist - gh.dist) * Math.min(1, dt * 1.6);
      gh.lane += (gh.tLane - gh.lane) * Math.min(1, dt * 3);

      const delta = wrapDelta(gh.dist - heroDist);
      const visible = delta > -70 && delta < 460;
      gh.group.visible = visible;
      if (!visible) continue;

      const h = roadHeading(gh.dist);
      gh.group.position.set(
        roadCenterX(gh.dist) - roadCenterX(heroDist) + Math.cos(h) * gh.lane,
        roadY(gh.dist) - roadY(heroDist),
        delta + Math.sin(h) * -gh.lane
      );
      gh.group.rotation.y = h;
      // colour ring pulses gently, brighter at night
      const pulse = 0.3 + 0.2 * Math.sin(performance.now() / 400 + delta);
      gh.group.userData.ring.material.opacity = pulse + night * 0.25;
    }

    this._mapTimer -= dt;
    if (this._mapTimer <= 0) { this._mapTimer = 1 / 12; this._drawMap(); }
  }

  _drawMap() {
    const x = this.mapCtx;
    if (!x) return;
    const W = x.canvas.width, H = x.canvas.height;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12;
    x.clearRect(0, 0, W, H);

    // the little round universe
    const bg = x.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R);
    bg.addColorStop(0, 'rgba(14,40,44,.92)');
    bg.addColorStop(1, 'rgba(4,20,24,.95)');
    x.fillStyle = bg;
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
    x.lineWidth = 2; x.strokeStyle = 'rgba(240,160,32,.8)';
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    // faint lane rings + crosshair
    x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 1;
    for (const rr of [0.4, 0.7]) { x.beginPath(); x.arc(cx, cy, R * rr, 0, 7); x.stroke(); }
    x.beginPath(); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke();

    const a0 = (this.me.dist / UNIVERSE_LEN) * Math.PI * 2;   // my heading angle
    const place = (dist, lane) => {
      const a = (dist / UNIVERSE_LEN) * Math.PI * 2 - a0 - Math.PI / 2;   // keep me at the top
      const rr = R * (0.62 + Math.max(-1, Math.min(1, lane / (ROAD_W / 2))) * 0.16);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    };

    // other drivers
    for (const gh of this.ghosts.values()) {
      const [px, py] = place(gh.dist, gh.lane);
      dot(x, px, py, gh.color, 4);
      label(x, px, py + 12, gh.name, gh.color);
    }
    // me, always at the top, highlighted
    const [mx, my] = place(this.me.dist, this.me.lane);
    x.beginPath(); x.arc(mx, my, 8, 0, 7);
    x.fillStyle = 'rgba(251,219,74,.25)'; x.fill();
    dot(x, mx, my, this.me.color, 5.5);
    x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
    label(x, mx, my - 13, this.me.name, '#fbdb4a', true);

    // header
    x.fillStyle = 'rgba(253,246,227,.9)';
    x.textAlign = 'center'; x.font = '700 11px Rajdhani, sans-serif';
    x.fillText(`${this.ghosts.size + 1} on the ring`, cx, 13);
  }
}

function dot(x, px, py, color, r) {
  x.beginPath(); x.arc(px, py, r, 0, 7);
  x.fillStyle = color; x.fill();
}
function label(x, px, py, name, color, above = false) {
  x.font = '700 10px Rajdhani, sans-serif';
  x.textAlign = 'center'; x.textBaseline = above ? 'bottom' : 'top';
  x.lineWidth = 3; x.strokeStyle = 'rgba(4,20,24,.85)';
  const t = name.slice(0, 12);
  x.strokeText(t, px, py);
  x.fillStyle = color; x.fillText(t, px, py);
}
