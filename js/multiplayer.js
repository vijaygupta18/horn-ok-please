// multiplayer.js — draw the OTHER drivers on the open map.
//
// The presence layer hands us a roster of everyone else, each with a real world
// position (x, z) and heading — because the world is now free-roam 2D, not a
// rail. We turn that into:
//
//   • a coloured, named ghost lorry for each nearby player, placed at their true
//     spot on the plain (on or off the road), dead-reckoned between heartbeats;
//   • a top-down radar in the corner showing every driver around you and the
//     road, rotated so you always face up.

import * as THREE from 'three';
import { roadCenterX } from './world.js';

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

// shortest signed angle a→b
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

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
    this.ghosts = new Map();         // id -> { group, label, x, z, heading, kmh, tX, tZ, tHeading, tKmh, name, color }
    this.roster = [];
    this.me = { x: 0, z: 0, heading: 0, name: 'You', color: '#fbdb4a' };
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
        gh = { group, label, x: p.x, z: p.z, heading: p.heading || 0, kmh: p.kmh, name: p.name, color: p.color };
        this.ghosts.set(p.id, gh);
      }
      gh.tX = p.x; gh.tZ = p.z; gh.tHeading = p.heading || 0; gh.tKmh = p.kmh;
      if (p.name !== gh.name || p.color !== gh.color) {
        gh.name = p.name; gh.color = p.color;
        paintLabel(gh.label.userData.ctx, p.name, p.color);
        gh.label.userData.tex.needsUpdate = true;
      }
    }
    for (const [id, gh] of this.ghosts) {
      if (seen.has(id)) continue;
      this.root.remove(gh.group);
      gh.group.traverse((o) => { o.geometry?.dispose?.(); if (o.material?.dispose) o.material.dispose(); });
      gh.label.material.map.dispose();
      gh.label.material.dispose();
      this.ghosts.delete(id);
    }
  }

  /** Called every frame with the hero's true world pose. */
  update(dt, heroX, heroZ, heroHeading, heroName, heroColor, night = 0) {
    this.me = { x: heroX, z: heroZ, heading: heroHeading, name: heroName, color: heroColor };
    const cx0 = roadCenterX(heroZ);

    for (const gh of this.ghosts.values()) {
      if (gh.tX === undefined) { gh.tX = gh.x; gh.tZ = gh.z; gh.tHeading = gh.heading; gh.tKmh = gh.kmh; }
      // dead reckon along the reported heading, then correct toward the last fix
      const v = gh.tKmh / 3.6;
      gh.x += Math.sin(gh.heading) * v * dt;
      gh.z += Math.cos(gh.heading) * v * dt;
      gh.x += (gh.tX - gh.x) * Math.min(1, dt * 1.6);
      gh.z += (gh.tZ - gh.z) * Math.min(1, dt * 1.6);
      gh.heading += angleDiff(gh.heading, gh.tHeading) * Math.min(1, dt * 3);

      const localX = gh.x - cx0;
      const localZ = gh.z - heroZ;
      const visible = localZ > -70 && localZ < 460 && Math.abs(localX) < 700;
      gh.group.visible = visible;
      if (!visible) continue;

      gh.group.position.set(localX, 0, localZ);
      gh.group.rotation.y = gh.heading;
      const pulse = 0.3 + 0.2 * Math.sin(performance.now() / 400 + localZ);
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
    const RANGE = 520;                 // metres from centre to rim
    const scale = R / RANGE;
    const me = this.me, h = me.heading;
    x.clearRect(0, 0, W, H);

    // radar face
    const bg = x.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R);
    bg.addColorStop(0, 'rgba(14,40,44,.92)');
    bg.addColorStop(1, 'rgba(4,20,24,.95)');
    x.save();
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip();
    x.fillStyle = bg; x.fillRect(0, 0, W, H);

    // world→radar: rotate so my heading points up (screen -Y)
    const toRadar = (wx, wz) => {
      const rx = wx - me.x, rz = wz - me.z;
      const right = rx * Math.cos(h) - rz * Math.sin(h);
      const fwd = rx * Math.sin(h) + rz * Math.cos(h);
      return [cx + right * scale, cy - fwd * scale];
    };

    // the road as a ribbon on the radar
    x.strokeStyle = 'rgba(120,130,140,.55)'; x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath();
    for (let d = me.z - RANGE; d <= me.z + RANGE; d += 30) {
      const [px, py] = toRadar(roadCenterX(d), d);
      if (d === me.z - RANGE) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    // centre lane dashes
    x.strokeStyle = 'rgba(251,219,74,.5)'; x.lineWidth = 1.4; x.setLineDash([4, 6]);
    x.stroke(); x.setLineDash([]);
    x.restore();

    // rim + rings
    x.lineWidth = 2; x.strokeStyle = 'rgba(240,160,32,.8)';
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 1;
    for (const rr of [0.5]) { x.beginPath(); x.arc(cx, cy, R * rr, 0, 7); x.stroke(); }

    // other drivers (clamped to the rim so you know which way to go)
    for (const gh of this.ghosts.values()) {
      let [px, py] = toRadar(gh.x, gh.z);
      const dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy);
      let clamped = false;
      if (len > R - 4) { px = cx + dx / len * (R - 4); py = cy + dy / len * (R - 4); clamped = true; }
      dot(x, px, py, gh.color, clamped ? 3 : 4);
      if (!clamped) label(x, px, py + 11, gh.name, gh.color);
    }

    // me — an arrow pointing up at the centre
    x.save();
    x.translate(cx, cy);
    x.fillStyle = me.color;
    x.beginPath(); x.moveTo(0, -7); x.lineTo(5, 6); x.lineTo(0, 3); x.lineTo(-5, 6); x.closePath();
    x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 1.4; x.stroke();
    x.restore();
    label(x, cx, cy + 14, me.name, '#fbdb4a');

    // header
    x.fillStyle = 'rgba(253,246,227,.9)';
    x.textAlign = 'center'; x.font = '700 11px Rajdhani, sans-serif';
    x.fillText(`${this.ghosts.size + 1} on the map`, cx, 13);
  }
}

function dot(x, px, py, color, r) {
  x.beginPath(); x.arc(px, py, r, 0, 7);
  x.fillStyle = color; x.fill();
}
function label(x, px, py, name, color) {
  x.font = '700 10px Rajdhani, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'top';
  x.lineWidth = 3; x.strokeStyle = 'rgba(4,20,24,.85)';
  const t = name.slice(0, 12);
  x.strokeText(t, px, py);
  x.fillStyle = color; x.fillText(t, px, py);
}
