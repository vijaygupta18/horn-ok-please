// world.js — endless highway.
//
// The truck never actually moves: it sits at z=0 and the world is rebuilt around
// a scalar `dist` (metres travelled). Road shape comes from pure functions of
// distance, so scenery, traffic and the road ribbon all agree without bookkeeping.

import * as THREE from 'three';
import * as ART from './art.js';
import { buildTruck, refreshRearPanel } from './truck.js';

const PAL = ART.PAL;

export const ROAD_W = 11;      // base asphalt width (two generous lanes + shoulders)
export const LANE = 2.6;       // centre of a lane, offset from road centre
const LANE_STEP = 3.4;         // extra tarmac width added per extra lane
const VIEW = 430;              // metres of road built ahead
const BEHIND = 45;
const SEGS = 190;

// ── the "small round universe" ──────────────────────────────────────────────
// The highway is a genuine LOOP: the road shape functions below are periodic
// with period UNIVERSE_LEN, so after driving that far you arrive back where you
// started, past the same scenery and the same billboards. That is what lets
// multiplayer drivers actually meet — two drivers at the same distance-modulo
// stand at the same spot on the ring. A special upload billboard stands every
// BILLBOARD_SPACING metres; its slot id (0…COUNT-1) is the shared key every
// client agrees on, so an upload lands on the same board for everybody.
export const BILLBOARD_SPACING = 220;                              // one every 220 m
export const BILLBOARD_COUNT = 30;                                 // 30 upload boards
export const UNIVERSE_LEN = BILLBOARD_SPACING * BILLBOARD_COUNT;   // 6.6 km loop
const LOOP_W = (Math.PI * 2) / UNIVERSE_LEN;                       // 1 lap = 2π

/** Stable, shared slot id for the billboard standing at distance `d`. */
export function billboardSlot(d) {
  const k = Math.round(d / BILLBOARD_SPACING);
  return ((k % BILLBOARD_COUNT) + BILLBOARD_COUNT) % BILLBOARD_COUNT;
}

// Signposted highway distance is compressed against real driving distance —
// otherwise Amritsar (440 km up NH-44) would never arrive in a play session.
export const HWY_SCALE = 20;   // signposted km per game km
export const HWY_START = 0;    // we join the highway at Delhi

/** Lateral position of the road centreline at a given distance. */
/**
 * Current time in India as a 0–1 position in our day cycle.
 * The HUD clock reads `timeOfDay * 24 + 6`, so invert that: a driver opening
 * this at 9pm IST should find themselves on a dark highway, not at noon.
 */
export function istTimeOfDay() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = +parts.find((p) => p.type === 'hour').value;
  const m = +parts.find((p) => p.type === 'minute').value;
  return (((h + m / 60 - 6) / 24) % 1 + 1) % 1;
}

/** Shortest-path interpolation around the 0–1 day circle. */
function lerpCyclic(a, b, t) {
  let d = b - a;
  if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
  return ((a + d * t) % 1 + 1) % 1;
}

export const TIME_MODES = [
  { id: 'ist',   label: 'INDIA TIME', hi: 'भारत समय' },
  { id: 'day',   label: 'DAY',        hi: 'दिन',      tod: 0.30 },
  { id: 'night', label: 'NIGHT',      hi: 'रात',      tod: 0.80 },
  { id: 'cycle', label: 'FAST CYCLE', hi: 'तेज़ चक्र' },
];

// These are PERIODIC in UNIVERSE_LEN (every term is an integer multiple of the
// loop frequency LOOP_W), so roadCenterX(d) === roadCenterX(d + UNIVERSE_LEN):
// the highway closes into a ring. Amplitudes are chosen to read like the old
// endless road, just now it repeats once per lap.
export function roadCenterX(d) {
  return Math.sin(d * LOOP_W + 1.3) * 48
       + Math.sin(d * LOOP_W * 3) * 22
       + Math.sin(d * LOOP_W * 7 + 0.7) * 6;
}

/** Road elevation. Flat now: the world is a free-roam open plain you can drive
 * off the road onto in any direction, and terrain-following on a 2D map isn't
 * worth the tilt jitter — so everything sits at y = 0. */
export function roadY(_d) {
  return 0;
}

/** Heading (radians) of the centreline, for orienting the truck and traffic. */
export function roadHeading(d) {
  return Math.atan2(roadCenterX(d + 2) - roadCenterX(d - 2), 4);
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });

// ── ribbon: a strip mesh rebuilt each frame from the road functions ─────────

class Ribbon {
  constructor(width, material, vScale, yOff, uRepeat = 1) {
    this.width = width; this.vScale = vScale; this.yOff = yOff; this.uRepeat = uRepeat;
    const pos = new Float32Array(SEGS * 2 * 3);
    const uv = new Float32Array(SEGS * 2 * 2);
    const idx = [];
    for (let i = 0; i < SEGS - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }
  update(dist) {
    const p = this.geo.attributes.position.array;
    const uv = this.geo.attributes.uv.array;
    const y0 = roadY(dist);
    for (let i = 0; i < SEGS; i++) {
      const z = -BEHIND + (i / (SEGS - 1)) * (VIEW + BEHIND);
      const d = dist + z;
      const cx = roadCenterX(d) - roadCenterX(dist);
      const cy = roadY(d) - y0 + this.yOff;
      const h = roadHeading(d);
      // widen perpendicular to heading so the strip keeps constant width in curves
      const nx = Math.cos(h) * (this.width / 2);
      const nz = -Math.sin(h) * (this.width / 2);
      const o = i * 6, uo = i * 4;
      p[o] = cx - nx; p[o + 1] = cy; p[o + 2] = z - nz;
      p[o + 3] = cx + nx; p[o + 4] = cy; p[o + 5] = z + nz;
      uv[uo] = 0; uv[uo + 1] = d / this.vScale;
      uv[uo + 2] = this.uRepeat; uv[uo + 3] = d / this.vScale;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ── sky dome with a time-of-day gradient ───────────────────────────────────

const SKY_VERT = `
  varying vec3 vPos;
  void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `
  uniform vec3 top; uniform vec3 bottom; uniform float glowY; uniform vec3 glow;
  varying vec3 vPos;
  void main(){
    float h = normalize(vPos).y;
    vec3 c = mix(bottom, top, smoothstep(-0.08, 0.55, h));
    // horizon burn for sunrise/sunset
    c = mix(c, glow, glowY * pow(max(0.0, 1.0 - abs(h - 0.02) * 4.2), 2.5));
    gl_FragColor = vec4(c, 1.0);
  }`;

// Time-of-day keyframes. `t` runs 0→1 and wraps.
const PHASES = [
  { t: 0.00, top: '#26355f', bot: '#f2a468', fog: '#d8a074', glow: '#ff9d55', gy: 0.9, sun: 0.55, amb: 0.34, night: 0.75 },
  { t: 0.10, top: '#4ba2e6', bot: '#d6ecff', fog: '#cfe1ef', glow: '#ffd9a8', gy: 0.3, sun: 1.10, amb: 0.62, night: 0.10 },
  { t: 0.38, top: '#1c7fd6', bot: '#c4e6ff', fog: '#c9dcea', glow: '#ffffff', gy: 0.0, sun: 1.45, amb: 0.80, night: 0.00 },
  { t: 0.54, top: '#1f3a63', bot: '#ff8a3d', fog: '#dd8259', glow: '#ff6a2a', gy: 1.0, sun: 0.80, amb: 0.42, night: 0.35 },
  { t: 0.63, top: '#141f3c', bot: '#6d4467', fog: '#452f4c', glow: '#a4436a', gy: 0.5, sun: 0.22, amb: 0.22, night: 0.80 },
  // A moonlit plain is never truly black — keep enough ambient to read shapes.
  { t: 0.80, top: '#050818', bot: '#0e1830', fog: '#080e1e', glow: '#1a2a4a', gy: 0.1, sun: 0.10, amb: 0.24, night: 1.00 },
  { t: 0.94, top: '#101a3a', bot: '#3d3a63', fog: '#2a2b46', glow: '#8a5a7a', gy: 0.4, sun: 0.18, amb: 0.22, night: 0.90 },
];

const cA = new THREE.Color(), cB = new THREE.Color();
function lerpPhase(t) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < PHASES.length - 1 && PHASES[i + 1].t <= t) i++;
  const a = PHASES[i];
  const b = PHASES[(i + 1) % PHASES.length];
  const span = (b.t > a.t ? b.t : b.t + 1) - a.t;
  const k = span <= 0 ? 0 : (t - a.t) / span;
  const mix = (ka, kb) => cA.set(ka).lerp(cB.set(kb), k).clone();
  return {
    top: mix(a.top, b.top), bot: mix(a.bot, b.bot),
    fog: mix(a.fog, b.fog), glow: mix(a.glow, b.glow),
    gy: a.gy + (b.gy - a.gy) * k,
    sun: a.sun + (b.sun - a.sun) * k,
    amb: a.amb + (b.amb - a.amb) * k,
    night: a.night + (b.night - a.night) * k,
  };
}

// ── roadside props ─────────────────────────────────────────────────────────

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

/**
 * Roadside trees. A single blobby shape repeated down the highway reads as
 * obviously fake, so this builds the four species you actually pass on the
 * Grand Trunk Road: broad neem, columnar poplar (all over Punjab), spreading
 * banyan with aerial roots, and date palm.
 */
function makeTree() {
  const g = new THREE.Group();
  const species = pick(['neem', 'neem', 'poplar', 'banyan', 'palm']);
  const leafCol = pick(['#2f6b2a', '#3d7d33', '#275c24', '#4a8a38', '#356b30']);
  const leaf = mat(leafCol, { roughness: 1 });
  const bark = mat(pick(['#5b4530', '#6b5540', '#4a3826']), { roughness: 1 });

  if (species === 'poplar') {
    const h = rnd(7, 11);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 7), bark);
    t.position.y = h / 2; t.castShadow = true; g.add(t);
    for (let i = 0; i < 4; i++) {
      const r = rnd(0.7, 1.15) * (1 - i * 0.14);
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 7), leaf);
      b.position.set(rnd(-0.2, 0.2), h * 0.45 + i * h * 0.17, rnd(-0.2, 0.2));
      b.scale.y = 2.1;                       // tall and narrow
      b.castShadow = true; g.add(b);
    }
    return g;
  }

  if (species === 'palm') {
    const h = rnd(4.5, 8);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, h, 7), mat('#7a6448', { roughness: 1 }));
    t.position.y = h / 2; t.castShadow = true; g.add(t);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.5, 4), leaf);
      frond.position.set(Math.cos(a) * 0.95, h + 0.15, Math.sin(a) * 0.95);
      frond.rotation.set(Math.PI / 2.1, 0, -a + Math.PI / 2);
      frond.scale.set(1, 1, 0.28);
      frond.castShadow = true; g.add(frond);
    }
    return g;
  }

  if (species === 'banyan') {
    const h = rnd(4, 6);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, h, 9), bark);
    t.position.y = h / 2; t.castShadow = true; g.add(t);
    for (let i = 0; i < 7; i++) {         // wide, layered canopy
      const r = rnd(1.9, 3.2);
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), leaf);
      const a = (i / 7) * Math.PI * 2;
      b.position.set(Math.cos(a) * rnd(0.6, 2.4), h + rnd(-0.3, 1.1), Math.sin(a) * rnd(0.6, 2.4));
      b.scale.y = 0.62;
      b.castShadow = true; g.add(b);
    }
    for (let i = 0; i < 6; i++) {         // aerial roots — the banyan's signature
      const len = rnd(1.4, h * 0.9);
      const a = rnd(0, Math.PI * 2), rad = rnd(1.4, 2.8);
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, len, 5), bark);
      root.position.set(Math.cos(a) * rad, h - len / 2 + 0.4, Math.sin(a) * rad);
      g.add(root);
    }
    return g;
  }

  // neem: a trunk that forks, with an irregular crown
  const h = rnd(3.4, 6.4);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, h, 8), bark);
  trunk.position.y = h / 2; trunk.castShadow = true; g.add(trunk);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, h * 0.5, 6), bark);
    const a = rnd(0, Math.PI * 2);
    b.position.set(Math.cos(a) * 0.4, h * 0.85, Math.sin(a) * 0.4);
    b.rotation.z = Math.cos(a) * 0.5; b.rotation.x = Math.sin(a) * 0.5;
    g.add(b);
  }
  for (let i = 0; i < 5; i++) {
    const r = rnd(1.1, 2.1);
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), leaf);
    b.position.set(rnd(-1.3, 1.3), h + rnd(-0.3, 1.1), rnd(-1.3, 1.3));
    b.scale.y = 0.78;
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

function makePole() {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 8.5, 6), mat('#8a8578'));
  p.position.y = 4.25;
  g.add(p);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), mat('#6b6558'));
  arm.position.y = 8.0;
  g.add(arm);
  for (const sx of [-0.85, 0.85]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 6), mat('#d8d2c0'));
    ins.position.set(sx, 8.16, 0);
    g.add(ins);
  }
  return g;
}

function makeMilestone(km) {
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ color: '#f0ece0', roughness: 0.9 });
  idle(() => {
    if (face.map) face.map.dispose();
    face.map = ART.milestone(km);
    face.needsUpdate = true;
  });
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.44, 0.95, 0.22),
    [mat('#f0ece0'), mat('#f0ece0'), mat('#f0a020'), mat('#888'), face, mat('#f0ece0')]
  );
  m.position.y = 0.48;
  m.castShadow = true;
  g.add(m);
  return g;
}

function makeHoarding(pool) {
  const g = new THREE.Group();
  for (const sx of [-2.1, 2.1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 5, 6), mat('#6b6558'));
    p.position.set(sx, 2.5, 0);
    g.add(p);
  }
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(5.4, 2.7),
    new THREE.MeshStandardMaterial({
      map: pool ? pool[(Math.random() * pool.length) | 0] : ART.hoarding(),
      side: THREE.DoubleSide, roughness: 0.85,
    })
  );
  board.position.y = 5.2;
  board.castShadow = true;
  g.add(board);
  return g;
}

// ── special "upload" billboard ──────────────────────────────────────────────
// A big blank hoarding on two posts whose face is a swappable image. The face
// mesh is tagged so js/billboards.js can paint it with either a placeholder or
// whatever a player has uploaded to this board's shared slot. The glowing pad on
// the road below it is drawn separately (js/billboards.js), in world space.
export function makeBillboard() {
  const g = new THREE.Group();
  for (const sx of [-3.3, 3.3]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 7.4, 8),
      mat('#4b5158', { metalness: 0.45, roughness: 0.55 }));
    p.position.set(sx, 3.7, 0); p.castShadow = true;
    g.add(p);
  }
  // dark frame behind the image
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.0, 4.7, 0.28), mat('#23272e'));
  frame.position.y = 7.7; frame.castShadow = true;
  g.add(frame);
  // the swappable face — billboards.js owns its material.map
  const faceMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 4.2), faceMat);
  face.position.set(0, 7.7, 0.16);
  face.userData.billboardFace = true;
  g.add(face);
  // striplights along the top that warm up at dusk
  const lampGeo = new THREE.SphereGeometry(0.1, 7, 6);
  for (let i = 0; i < 6; i++) {
    const lamp = new THREE.Mesh(lampGeo,
      new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffdf90', emissiveIntensity: 0.2 }));
    lamp.position.set(-3.6 + i * 1.44, 10.15, 0.3);
    lamp.userData.bulb = true;
    g.add(lamp);
  }
  g.userData.isBillboard = true;
  return g;
}

// A dhaba: brick block, tin roof, painted sign, charpais out front, tandoor smoke.
function makeDhaba() {
  const g = new THREE.Group();
  const w = rnd(6, 9), d = rnd(4, 6), h = 3.1;
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(pick(['#d8c9a8', '#c9a882', '#e0d2b4'])));
  b.position.y = h / 2;
  b.castShadow = true; b.receiveShadow = true;
  g.add(b);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.16, d + 1.6), mat('#7a6a55', { metalness: 0.35, roughness: 0.6 }));
  roof.position.y = h + 0.08;
  g.add(roof);
  // painted signboard
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.9, 1.5),
    new THREE.MeshStandardMaterial({ map: ART.hoarding(), side: THREE.DoubleSide, roughness: 0.85 })
  );
  sign.position.set(0, h - 0.5, d / 2 + 0.05);
  g.add(sign);
  // charpais (rope cots) under the awning
  for (let i = 0; i < 3; i++) {
    const cot = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.95), mat('#8a6a3a'));
    frame.position.y = 0.5;
    cot.add(frame);
    const weave = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.06, 0.82), mat(pick(['#d84a3a', '#3a7ad8', '#d8b43a'])));
    weave.position.y = 0.56;
    cot.add(weave);
    for (const [lx, lz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), mat('#7a5a2a'));
      leg.position.set(lx, 0.25, lz);
      cot.add(leg);
    }
    cot.position.set(rnd(-w / 2, w / 2), 0, d / 2 + rnd(1.4, 3.2));
    cot.rotation.y = rnd(-0.4, 0.4);
    g.add(cot);
  }
  // string lights
  const bulbGeo = new THREE.SphereGeometry(0.09, 7, 6);
  for (let i = 0; i < 10; i++) {
    const c = [PAL.yellow, PAL.red, PAL.seaGreen][i % 3];
    const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25 }));
    bulb.position.set(-w / 2 + i * (w / 9), h + 0.3 + Math.sin(i) * 0.1, d / 2 + 0.6);
    bulb.userData.bulb = true;
    g.add(bulb);
  }
  g.userData.isDhaba = true;
  return g;
}

function makeTemple() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), mat('#f2ece0'));
  base.position.y = 1.1;
  base.castShadow = true;
  g.add(base);
  const shikhar = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 8), mat('#f07a20'));
  shikhar.position.y = 3.5;
  shikhar.castShadow = true;
  g.add(shikhar);
  const kalash = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat('#e8b020', { metalness: 0.8, roughness: 0.3 }));
  kalash.position.y = 4.95;
  g.add(kalash);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5), mat('#8a8578'));
  pole.position.set(1.9, 1.2, 0);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6),
    new THREE.MeshStandardMaterial({ color: '#f04a20', side: THREE.DoubleSide }));
  flag.position.set(2.45, 2.1, 0);
  flag.userData.flag = true;
  g.add(flag);
  return g;
}

// NHAI green direction board on two posts. Its artwork depends on how far
// along the highway we are, so it's painted asynchronously (see `idle`).
function makeDirectionSign(km) {
  const g = new THREE.Group();
  for (const sx of [-2.4, 2.4]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 6.4, 8), mat('#9aa6b2', { metalness: 0.5, roughness: 0.5 }));
    p.position.set(sx, 3.2, 0);
    g.add(p);
  }
  const m = new THREE.MeshStandardMaterial({ color: '#0b6b39', side: THREE.DoubleSide, roughness: 0.7 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.75), m);
  board.position.y = 6.2;
  board.castShadow = true;
  g.add(board);
  idle(() => {
    if (m.map) m.map.dispose();
    m.map = ART.destinationSign(km);
    m.needsUpdate = true;
  });
  return g;
}

// Small BRO safety board, low and close to the shoulder.
function makeSafetySign(pool) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 7), mat('#c8cdd4'));
  p.position.y = 1.45;
  g.add(p);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.3),
    new THREE.MeshStandardMaterial({
      map: pool ? pool[(Math.random() * pool.length) | 0] : ART.safetySign(),
      side: THREE.DoubleSide, roughness: 0.75,
    })
  );
  board.position.y = 2.6;
  board.castShadow = true;
  g.add(board);
  return g;
}

// Fuel station — research says one every 40–60 km on NH-44, so they matter.
function makePetrolPump() {
  const brand = pick([
    { name: 'INDIAN OIL', a: '#f5741a', b: '#1f9a4a' },
    { name: 'HP',         a: '#1e4fd8', b: '#d92121' },
    { name: 'BPCL',       a: '#f0c020', b: '#1e6fd9' },
  ]);
  const g = new THREE.Group();
  // canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(13, 0.6, 8), mat('#f2f2f0'));
  canopy.position.y = 5.4;
  canopy.castShadow = true;
  g.add(canopy);
  const band = new THREE.Mesh(new THREE.BoxGeometry(13.1, 0.75, 8.1), mat(brand.a));
  band.position.y = 4.9;
  g.add(band);
  for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.7, 0.5), mat('#e8e8e4'));
    col.position.set(px, 2.35, pz);
    g.add(col);
  }
  // dispensers
  for (const px of [-2.4, 2.4]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.7), mat(brand.b));
    d.position.set(px, 0.95, 0);
    d.castShadow = true;
    g.add(d);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 0.75), mat('#22262b'));
    top.position.set(px, 2.05, 0);
    g.add(top);
  }
  // brand pylon
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 8, 8), mat('#c8cdd4'));
  pole.position.set(-7.6, 4, 0);
  g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 0.3),
    [mat(brand.a), mat(brand.a), mat(brand.a), mat(brand.a), mat(brand.b), mat(brand.b)]);
  sign.position.set(-7.6, 8.2, 0);
  sign.castShadow = true;
  g.add(sign);
  return g;
}

// Toll plaza — booths and a gantry spanning the carriageway.
function makeTollPlaza() {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 7, 0.8, 1.5), mat('#f0c020'));
  beam.position.y = 6.2;
  beam.castShadow = true;
  g.add(beam);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 8, 0.35, 5.5), mat('#e8e8e4'));
  roof.position.y = 6.8;
  g.add(roof);
  for (const sx of [-(ROAD_W / 2 + 3), ROAD_W / 2 + 3]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.2, 0.7), mat('#d8d8d4'));
    col.position.set(sx, 3.1, 0);
    g.add(col);
  }
  // booths straddling the lane divider
  for (const sx of [-1.6, 1.6]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.8, 3.2), mat('#f2ece0'));
    b.position.set(sx, 1.4, 0);
    b.castShadow = true;
    g.add(b);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.1, 1.6), mat('#16202b', { metalness: 0.5, roughness: 0.2 }));
    win.position.set(sx, 2.0, 0);
    g.add(win);
    // FASTag boom barrier, raised
    const boom = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.14), mat('#d92121'));
    boom.position.set(sx + 1.9, 2.9, 1.7);
    boom.rotation.z = -0.9;
    g.add(boom);
  }
  return g;
}

// Mud-and-thatch village house, the kind clustered just off the highway.
/**
 * Village housing. Three kinds you pass on the highway: a thatched mud hut, a
 * flat-roofed brick house with a parapet and water tank, and a painted
 * two-storey pukka house — the one somebody's Gulf remittance built.
 */
function makeHut() {
  const g = new THREE.Group();
  const kind = pick(['mud', 'brick', 'brick', 'pukka']);

  if (kind === 'mud') {
    const w = rnd(3, 4.6), d = rnd(3, 4.2), h = rnd(2.2, 2.8);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(pick(['#c9a882', '#b89060', '#d8c9a8']), { roughness: 1 }));
    walls.position.y = h / 2;
    walls.castShadow = true; walls.receiveShadow = true;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.86, 1.6, 4), mat('#8a7040', { roughness: 1 }));
    roof.position.y = h + 0.78;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.5), mat('#5b4530'));
    door.position.set(0, 0.75, d / 2 + 0.02);
    g.add(door);
    return g;
  }

  const storeys = kind === 'pukka' ? 2 : 1;
  const w = rnd(4, 6.5), d = rnd(4, 5.5), sh = 2.9;
  const wallCol = kind === 'pukka'
    ? pick(['#e8d7b8', '#cfe0e8', '#e8c9c0', '#d8e0c8'])   // painted
    : pick(['#b06a4a', '#a85f42', '#c08060']);            // bare brick
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, sh * storeys, d), mat(wallCol, { roughness: 0.95 }));
  walls.position.y = sh * storeys / 2;
  walls.castShadow = true; walls.receiveShadow = true;
  g.add(walls);

  // parapet wall round the flat roof
  const par = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.42, d + 0.16), mat(wallCol, { roughness: 0.95 }));
  par.position.y = sh * storeys + 0.2;
  g.add(par);

  // windows + door
  const glass = mat('#22303c', { metalness: 0.4, roughness: 0.25 });
  for (let s = 0; s < storeys; s++) {
    for (const sx of [-0.28, 0.28]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), glass);
      win.position.set(sx * w, sh * s + 1.7, d / 2 + 0.02);
      g.add(win);
    }
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9), mat('#4a3826'));
  door.position.set(0, 0.95, d / 2 + 0.02);
  g.add(door);

  // black plastic water tank on the roof — on practically every Indian house
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.75, 12), mat('#1e1e22', { roughness: 0.9 }));
  tank.position.set(w * 0.25, sh * storeys + 0.78, -d * 0.2);
  tank.castShadow = true;
  g.add(tank);

  // stair block up to the roof
  const stair = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.3), mat(wallCol, { roughness: 0.95 }));
  stair.position.set(-w * 0.28, sh * storeys + 0.55, -d * 0.28);
  g.add(stair);
  return g;
}

// Overhead village water tank on legs.
function makeWaterTank() {
  const g = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.8, 14), mat('#2a6ad8'));
  tank.position.y = 6.5;
  tank.castShadow = true;
  g.add(tank);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 14), mat('#1e4fa8'));
  cap.position.y = 7.7;
  g.add(cap);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5.8, 6), mat('#8a8578'));
    leg.position.set(lx, 2.9, lz);
    g.add(leg);
  }
  return g;
}

// Tractor + trolley — the second most common thing on an Indian highway.
function makeTractor() {
  const g = new THREE.Group();
  const c = pick(['#1f6fd9', '#d92121', '#1f9a4a', '#f0a020']);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 2.6), mat(c));
  body.position.y = 1.1;
  body.castShadow = true;
  g.add(body);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.2), mat(c));
  hood.position.set(0, 1.5, 0.9);
  g.add(hood);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), mat('#22262b'));
  seat.position.set(0, 1.85, -0.6);
  g.add(seat);
  // big rear wheels, small fronts
  for (const sx of [-0.86, 0.86]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.38, 16), mat('#1a1a1c'));
    r.rotation.z = Math.PI / 2; r.position.set(sx, 0.85, -0.85);
    g.add(r);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 12), mat('#1a1a1c'));
    f.rotation.z = Math.PI / 2; f.position.set(sx * 0.75, 0.42, 1.25);
    g.add(f);
  }
  // trolley heaped with sugarcane
  const tr = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.9, 3.4), mat('#c23a2a'));
  tr.position.set(0, 1.1, -3.2);
  tr.castShadow = true;
  g.add(tr);
  const load = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 3.2), mat('#9aa832', { roughness: 1 }));
  load.position.set(0, 2.0, -3.2);
  g.add(load);
  return g;
}

// Roadside shrine — a small painted niche with a flag.
function makeShrine() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.0), mat('#f2ece0'));
  b.position.y = 0.7;
  b.castShadow = true;
  g.add(b);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, 7, 0, Math.PI / 2), mat('#f07a20'));
  dome.position.y = 1.4;
  g.add(dome);
  const niche = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), mat('#d92121'));
  niche.position.set(0, 0.75, 0.51);
  g.add(niche);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 5), mat('#8a8578'));
  pole.position.set(0.9, 1, 0);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4),
    new THREE.MeshStandardMaterial({ color: '#f04a20', side: THREE.DoubleSide }));
  flag.position.set(1.28, 1.75, 0);
  flag.userData.flag = true;
  g.add(flag);
  return g;
}

// Props whose artwork must be READ by the driver. Their lettered face is built
// on +Z, but the driver travels toward +Z — so left at rotation 0 they present
// their back and every word comes out mirrored. These must be turned to face
// oncoming traffic no matter which side of the road they stand on.
const LETTERED = new Set(['hoarding', 'sign', 'safety', 'milestone', 'dhaba']);

/**
 * Run expensive canvas work off the render frame.
 * Painting a distance board is ~170 ms — enough to drop ten frames if it lands
 * inside one. The prop respawns 430 m ahead, so nobody can read it for several
 * seconds anyway; updating its texture a beat late is invisible.
 */
const idle = (fn) => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(fn, { timeout: 1200 })
  : setTimeout(fn, 0));

function facingFor(kind, side) {
  if (!LETTERED.has(kind)) return rnd(-0.4, 0.4) + (side < 0 ? Math.PI : 0);
  // face back down the road, angled slightly in toward the carriageway
  return Math.PI + rnd(-0.1, 0.1) - side * 0.2;
}

function makeFieldPatch() {
  const g = new THREE.Group();
  const c = pick(['#d8c23a', '#c9b52e', '#8aa832', '#6f9a2c']); // mustard / wheat
  const p = new THREE.Mesh(new THREE.PlaneGeometry(rnd(22, 44), rnd(18, 34)), mat(c));
  p.rotation.x = -Math.PI / 2;
  p.position.y = 0.03;
  p.receiveShadow = true;
  g.add(p);
  return g;
}

export function makeCow() {
  const g = new THREE.Group();
  // Indian cattle are zebu: shoulder hump, big hanging dewlap, floppy ears,
  // upswept horns (often painted), and a tufted tail. Those five things are
  // what make it read as a cow on an Indian highway rather than a generic box.
  const coat = pick(['#e8ddcc', '#c9a882', '#8a7460', '#f0e8dc', '#5b4a3c']);
  const hide = mat(coat, { roughness: 0.95 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.0, 4, 12), hide);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.02;
  body.castShadow = true;
  g.add(body);

  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), hide);
  hump.position.set(0, 1.42, 0.42);
  hump.scale.set(0.85, 0.78, 1.05);
  g.add(hump);

  // dewlap — the loose fold of skin under the neck
  const dewlap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.5), hide);
  dewlap.position.set(0, 0.92, 0.95);
  g.add(dewlap);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.42, 10), hide);
  neck.position.set(0, 1.22, 0.92);
  neck.rotation.x = 0.85;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.56), hide);
  head.position.set(0, 1.24, 1.32);
  head.castShadow = true;
  g.add(head);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.16), mat('#5a4a44'));
  muzzle.position.set(0, 1.17, 1.62);
  g.add(muzzle);
  for (const sx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat('#191410'));
    eye.position.set(sx, 1.33, 1.55);
    g.add(eye);
    // floppy ears, set low and wide
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.1), hide);
    ear.position.set(sx * 1.9, 1.34, 1.2);
    ear.rotation.z = sx > 0 ? -0.45 : 0.45;
    g.add(ear);
  }
  // upswept horns, often painted in bright colours
  const hornCol = Math.random() < 0.35 ? pick(['#d92121', '#f0a020', '#1e6fd9']) : '#e0d8c0';
  for (const sx of [-0.13, 0.13]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 7), mat(hornCol));
    horn.position.set(sx, 1.5, 1.24);
    horn.rotation.z = sx * 2.6;
    horn.rotation.x = -0.35;
    g.add(horn);
  }

  // legs with darker hooves
  for (const [lx, lz] of [[-0.26, -0.52], [0.26, -0.52], [-0.26, 0.62], [0.26, 0.62]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.72, 7), hide);
    leg.position.set(lx, 0.36, lz);
    g.add(leg);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.1, 7), mat('#2e2721'));
    hoof.position.set(lx, 0.05, lz);
    g.add(hoof);
  }

  // tail with a tuft
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.7, 6), hide);
  tail.position.set(0, 1.0, -0.78);
  tail.rotation.x = 0.32;
  g.add(tail);
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), mat('#3a2f26'));
  tuft.position.set(0, 0.66, -0.9);
  g.add(tuft);
  return g;
}

// ── traffic vehicles ───────────────────────────────────────────────────────

function makeBus() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.7, 9), mat(pick(['#d84a2a', '#2a6ad8', '#1f9a4a'])));
  body.position.y = 1.9;
  body.castShadow = true;
  g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.5, 9.02), mat(PAL.yellow));
  stripe.position.y = 2.5;
  g.add(stripe);
  const glass = new THREE.MeshStandardMaterial({ color: '#16202b', roughness: 0.25, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    for (const sx of [-1.27, 1.27]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.85), glass);
      w.position.set(sx, 2.65, -3.6 + i * 1.35);
      w.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(w);
    }
  }
  const wg = new THREE.CylinderGeometry(0.52, 0.52, 0.3, 14);
  for (const [x, z] of [[-1.1, 3], [1.1, 3], [-1.1, -2.8], [1.1, -2.8]]) {
    const w = new THREE.Mesh(wg, mat('#1a1a1c'));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.52, z);
    g.add(w);
  }
  return g;
}

function makeAuto() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.15, 2.4), mat('#1f9a4a'));
  body.position.y = 0.85;
  body.castShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.5, 2.0), mat(PAL.yellow));
  roof.position.y = 1.6;
  g.add(roof);
  const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 12);
  const front = new THREE.Mesh(wg, mat('#1a1a1c'));
  front.rotation.z = Math.PI / 2; front.position.set(0, 0.3, 1.05);
  g.add(front);
  for (const sx of [-0.6, 0.6]) {
    const w = new THREE.Mesh(wg, mat('#1a1a1c'));
    w.rotation.z = Math.PI / 2; w.position.set(sx, 0.3, -0.9);
    g.add(w);
  }
  return g;
}

// Cars come in the shapes you actually meet on a national highway: hatchbacks,
// sedans and the SUVs that overtake everybody.
const CAR_TYPES = [
  { name: 'hatchback', L: 3.7, W: 1.7, bodyH: 0.80, cabH: 0.72, cabL: 1.9, cabZ: -0.30, ride: 0.31 },
  { name: 'sedan',     L: 4.5, W: 1.8, bodyH: 0.82, cabH: 0.66, cabL: 2.1, cabZ: -0.25, ride: 0.33 },
  { name: 'suv',       L: 4.7, W: 1.95, bodyH: 1.05, cabH: 0.88, cabL: 2.6, cabZ: -0.15, ride: 0.40 },
  { name: 'taxi',      L: 4.2, W: 1.78, bodyH: 0.84, cabH: 0.72, cabL: 2.1, cabZ: -0.22, ride: 0.33, taxi: true },
];

function makeCar() {
  const t = pick(CAR_TYPES);
  const g = new THREE.Group();
  const c = t.taxi ? '#f0d020'
    : pick(['#d8d8d8', '#2a2a30', '#b83030', '#3a6ad8', '#e0e0e8', '#8a9098', '#1f6f4a']);
  const paint = mat(c, { metalness: 0.45, roughness: 0.35 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(t.W, t.bodyH, t.L), paint);
  body.position.y = t.ride + t.bodyH / 2;
  body.castShadow = true;
  g.add(body);

  const glass = mat('#16202b', { metalness: 0.55, roughness: 0.15 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(t.W * 0.92, t.cabH, t.cabL), glass);
  cabin.position.set(0, t.ride + t.bodyH + t.cabH / 2 - 0.04, t.cabZ);
  g.add(cabin);
  // roof in body colour so it isn't a floating glass box
  const roof = new THREE.Mesh(new THREE.BoxGeometry(t.W * 0.86, 0.08, t.cabL * 0.86), paint);
  roof.position.set(0, t.ride + t.bodyH + t.cabH - 0.04, t.cabZ);
  g.add(roof);

  if (t.taxi) {   // roof sign
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.2), mat('#f2f2f0'));
    sign.position.set(0, t.ride + t.bodyH + t.cabH + 0.06, t.cabZ);
    g.add(sign);
  }

  // lamps
  // Kept deliberately dim: these are small emissive quads and, once bloom is
  // on at night, bright ones smear into white blobs that hide the road.
  const head = new THREE.MeshStandardMaterial({ color: '#d8d2b8', emissive: '#ffeeb0', emissiveIntensity: 0.045 });
  const tail = new THREE.MeshStandardMaterial({ color: '#5c0a0a', emissive: '#ff2a1a', emissiveIntensity: 0.07 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), head);
    hl.position.set(sx * t.W * 0.32, t.ride + t.bodyH * 0.75, t.L / 2);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), tail);
    tl.position.set(sx * t.W * 0.34, t.ride + t.bodyH * 0.78, -t.L / 2);
    g.add(tl);
  }

  const wg = new THREE.CylinderGeometry(t.ride, t.ride, 0.22, 14);
  const hub = new THREE.CylinderGeometry(t.ride * 0.55, t.ride * 0.55, 0.24, 10);
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wg, mat('#141416', { roughness: 0.95 }));
    w.rotation.z = Math.PI / 2;
    w.position.set(x * t.W * 0.47, t.ride, z * t.L * 0.32);
    g.add(w);
    const h = new THREE.Mesh(hub, mat('#b8c0c8', { metalness: 0.9, roughness: 0.25 }));
    h.rotation.z = Math.PI / 2;
    h.position.copy(w.position);
    g.add(h);
  }
  return g;
}

// Tata-Ace-style mini truck — "बड़ा होकर ट्रक बनूँगा".
function makeMiniTruck() {
  const g = new THREE.Group();
  const c = pick(['#d92121', '#1f6fd9', '#f0a020', '#f2f2f0']);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.35, 1.3), mat(c));
  cab.position.set(0, 1.15, 1.35);
  cab.castShadow = true;
  g.add(cab);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.5, 0.06), mat('#16202b', { metalness: 0.5, roughness: 0.2 }));
  glass.position.set(0, 1.5, 2.0);
  g.add(glass);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 2.4), mat(c));
  bed.position.set(0, 1.0, -0.5);
  bed.castShadow = true;
  g.add(bed);
  // painted tailboard — the joke writes itself
  const tail = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.62),
    new THREE.MeshStandardMaterial({ map: ART.rearPanel(ART.randomTruckIdentity()), side: THREE.DoubleSide, roughness: 0.7 })
  );
  tail.position.set(0, 1.0, -1.72);
  tail.rotation.y = Math.PI;
  g.add(tail);
  const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12);
  for (const [x, z] of [[-0.72, 1.5], [0.72, 1.5], [-0.72, -1.1], [0.72, -1.1]]) {
    const w = new THREE.Mesh(wg, mat('#161618'));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    g.add(w);
  }
  return g;
}

// ── the world ──────────────────────────────────────────────────────────────

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.dist = 0;
    // Start wherever India actually is right now.
    this.timeMode = 'ist';
    this.timeOfDay = istTimeOfDay();
    this.night = 0;

    // sky dome
    this.skyUniforms = {
      top: { value: new THREE.Color('#4ba2e6') },
      bottom: { value: new THREE.Color('#d6ecff') },
      glow: { value: new THREE.Color('#ffd9a8') },
      glowY: { value: 0.3 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        side: THREE.BackSide, depthWrite: false, fog: false,
      })
    );
    scene.add(this.sky);

    // ── stars ────────────────────────────────────────────────────────────
    // A flat white point cloud looks like static. Real night sky over the
    // Punjab plains has a dense Milky Way band, stars of varying brightness
    // and colour, and a slow twinkle — so build all three in.
    const sc = 700, n = 2600;
    const sp = new Float32Array(n * 3);
    const scol = new Float32Array(n * 3);
    const ssz = new Float32Array(n);
    const bandTilt = 0.5;
    for (let i = 0; i < n; i++) {
      let th, ph;
      if (i % 5 < 2) {
        // Milky Way: cluster tightly around a great circle
        const along = Math.random() * Math.PI * 2;
        const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.28;
        const x = Math.cos(along), y = Math.sin(along) * Math.sin(bandTilt) + spread,
              z = Math.sin(along) * Math.cos(bandTilt);
        const L = Math.hypot(x, y, z);
        th = Math.atan2(z / L, x / L);
        ph = Math.acos(Math.min(0.97, Math.max(0.02, y / L)));
      } else {
        th = Math.random() * Math.PI * 2;
        ph = Math.acos(Math.random() * 0.94 + 0.03);
      }
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * sc;
      sp[i * 3 + 1] = Math.abs(Math.cos(ph)) * sc;
      sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sc;

      // most stars white-ish, a few warm and a few blue
      const roll = Math.random();
      const tint = roll < 0.10 ? [1, 0.78, 0.62] : roll < 0.20 ? [0.72, 0.82, 1] : [1, 0.98, 0.94];
      const bright = 0.35 + Math.pow(Math.random(), 2.2) * 0.65;
      scol[i * 3] = tint[0] * bright;
      scol[i * 3 + 1] = tint[1] * bright;
      scol[i * 3 + 2] = tint[2] * bright;
      ssz[i] = 1 + Math.pow(Math.random(), 3) * 3.4;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(scol, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(ssz, 1));

    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, fog: false,
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor; varying float vTw;
        uniform float uTime;
        void main(){
          vColor = color;
          // each star twinkles on its own phase, derived from its position
          float seed = dot(position, vec3(0.013, 0.021, 0.017));
          vTw = 0.75 + 0.25 * sin(uTime * 2.2 + seed * 40.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * vTw;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vTw;
        uniform float uOpacity;
        void main(){
          // round, soft-edged point instead of a hard square
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.06, r);
          gl_FragColor = vec4(vColor * vTw, a * uOpacity);
        }`,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // sun / moon disc
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(22, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false })
    );
    scene.add(this.sunDisc);

    // lights
    this.hemi = new THREE.HemisphereLight('#cfe4ff', '#8a6a44', 0.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d0', 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // The light is kept a fixed short distance from the truck (see update) so the
    // ortho frustum below actually encloses the scene. Park it far away and every
    // surface falls beyond `far`, which reads as "fully shadowed" — the whole
    // world goes black.
    const cam = this.sun.shadow.camera;
    cam.left = -75; cam.right = 75; cam.top = 75; cam.bottom = -75;
    cam.near = 1; cam.far = 340;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this._sunDir = new THREE.Vector3();

    // ribbons
    const roadTex = ART.roadTexture();
    roadTex.wrapS = THREE.ClampToEdgeWrapping;
    roadTex.wrapT = THREE.RepeatWrapping;
    this.road = new Ribbon(ROAD_W, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.94 }), 14, 0.02);
    scene.add(this.road.mesh);
    // The carriageway widens as more drivers join — see setDriverCount().
    this.roadW = ROAD_W;
    this.targetRoadW = ROAD_W;
    this.laneCount = 2;

    // Infinite ground: one big plane that follows the truck, its texture locked
    // to world coordinates so it reads as an endless plain you can roam in any
    // direction — not just a strip beside the road.
    const grd = ART.groundTexture();
    grd.wrapS = grd.wrapT = THREE.RepeatWrapping;
    this.groundTile = 60;                                   // texture repeats every 60 m
    this.groundSize = 3200;
    const gRepeat = this.groundSize / this.groundTile;
    grd.repeat.set(gRepeat, gRepeat);
    this.groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.groundSize, this.groundSize, 1, 1),
      new THREE.MeshStandardMaterial({ map: grd, roughness: 1 })
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.06;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.frustumCulled = false;
    scene.add(this.groundPlane);

    // Board artwork is baked ONCE into pools. Repainting a 1024×512 canvas the
    // moment a hoarding recycles cost over a second of frame time; swapping a
    // pooled texture costs nothing and still gives every board a fresh joke.
    this.texPool = {
      hoarding: Array.from({ length: 7 }, () => ART.hoarding()),
      safety: Array.from({ length: 7 }, () => ART.safetySign()),
    };
    this._rebuildBudget = 0;

    // prop pool
    this.props = [];
    this.propRoot = new THREE.Group();
    scene.add(this.propRoot);
    this._seedProps();

    // traffic pool
    this.traffic = [];
    this.trafficRoot = new THREE.Group();
    scene.add(this.trafficRoot);
    this._seedTraffic();

    this.dhabaAhead = null;

    // ── environment map ──────────────────────────────────────────────────
    // Chrome bumpers, hubcaps and the exhaust stack are only convincing if
    // they reflect something. Paint a cheap equirectangular sky+ground and
    // run it through PMREM; refresh it occasionally as the day turns.
    this._pmrem = new THREE.PMREMGenerator(renderer);
    this._pmrem.compileEquirectangularShader();
    this._envCanvas = document.createElement('canvas');
    this._envCanvas.width = 256; this._envCanvas.height = 128;
    this._envTimer = 0;
    this._envRT = null;
    this._updateEnv(lerpPhase(this.timeOfDay));
  }

  _updateEnv(ph) {
    const c = this._envCanvas;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0.00, `#${ph.top.getHexString()}`);
    g.addColorStop(0.42, `#${ph.bot.getHexString()}`);
    g.addColorStop(0.50, `#${ph.glow.getHexString()}`);
    g.addColorStop(0.52, '#8a6a44');            // horizon → dusty ground
    g.addColorStop(1.00, '#5a4630');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    // a bright blob where the sun is, so highlights have somewhere to come from
    const sunX = ((this.timeOfDay + 0.25) % 1) * c.width;
    const rg = x.createRadialGradient(sunX, c.height * 0.3, 2, sunX, c.height * 0.3, 46);
    rg.addColorStop(0, `rgba(255,250,230,${0.25 + ph.sun * 0.5})`);
    rg.addColorStop(1, 'rgba(255,250,230,0)');
    x.fillStyle = rg;
    x.fillRect(0, 0, c.width, c.height);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rt = this._pmrem.fromEquirectangular(tex);
    tex.dispose();
    this._envRT?.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
  }

  _spawnProp(kind, d, side) {
    let obj, off, centered = false;
    switch (kind) {
      case 'tree':      obj = makeTree();       off = rnd(9, 34); break;
      case 'pole':      obj = makePole();       off = 8.6; break;
      case 'milestone': obj = makeMilestone(Math.round(HWY_START + d / 1000 * HWY_SCALE)); off = 6.8; break;
      case 'hoarding':  obj = makeHoarding(this.texPool?.hoarding); off = rnd(11, 16); break;
      case 'dhaba':     obj = makeDhaba();      off = rnd(16, 22); break;
      case 'temple':    obj = makeTemple();     off = rnd(14, 24); break;
      case 'field':     obj = makeFieldPatch(); off = rnd(40, 90); break;
      case 'sign':      obj = makeDirectionSign(HWY_START + d / 1000 * HWY_SCALE); off = rnd(8, 11); break;
      case 'safety':    obj = makeSafetySign(this.texPool?.safety); off = rnd(7, 9); break;
      case 'pump':      obj = makePetrolPump(); off = rnd(17, 22); break;
      case 'toll':      obj = makeTollPlaza();  off = 0; centered = true; break;
      case 'hut':       obj = makeHut();        off = rnd(20, 46); break;
      case 'tank':      obj = makeWaterTank();  off = rnd(28, 52); break;
      case 'tractor':   obj = makeTractor();    off = rnd(13, 24); break;
      case 'shrine':    obj = makeShrine();     off = rnd(7, 10); break;
      default:          obj = makeTree();       off = rnd(9, 30);
    }
    // `rot` is the prop's own facing; the road's heading is added each frame so
    // hoardings and dhabas keep squaring up to the tarmac through curves.
    const rec = { obj, d, side, off, kind, centered, rot: facingFor(kind, side) };
    if (centered) rec.rot = 0;
    this.propRoot.add(obj);
    this.props.push(rec);
    return rec;
  }

  _seedProps() {
    const flip = () => (Math.random() < 0.5 ? -1 : 1);
    // dense natural filler
    for (let d = -40; d < VIEW; d += rnd(8, 19)) {
      this._spawnProp(Math.random() < 0.72 ? 'tree' : 'field', d, flip());
    }
    for (let d = 0; d < VIEW; d += 45) this._spawnProp('pole', d, 1);
    for (let d = 0; d < VIEW; d += 100) this._spawnProp('milestone', d, -1);
    for (let d = 55; d < VIEW; d += 130) this._spawnProp('hoarding', d, flip());
    for (let d = 95; d < VIEW; d += 145) this._spawnProp('safety', d, flip());
    for (let d = 150; d < VIEW; d += 300) this._spawnProp('sign', d, 1);
    for (let d = 120; d < VIEW; d += 300) this._spawnProp('dhaba', d, flip());
    for (let d = 260; d < VIEW; d += 380) this._spawnProp('pump', d, flip());
    for (let d = 250; d < VIEW; d += 400) this._spawnProp('temple', d, flip());
    for (let d = 80; d < VIEW; d += 190) this._spawnProp('shrine', d, flip());
    for (let d = 180; d < VIEW; d += 260) this._spawnProp('tractor', d, flip());
    // NB: the upload billboards are NOT props — they're a dedicated grid on the
    // loop, owned by js/billboards.js, so there can be a lot of them at exact
    // shared positions. See Billboards.
    // village clusters
    for (let d = 200; d < VIEW; d += 340) {
      const s = flip();
      for (let i = 0; i < 4; i++) this._spawnProp('hut', d + i * rnd(6, 14), s);
      this._spawnProp('tank', d + 20, s);
    }
    this._spawnProp('toll', 380, 1);
  }

  // Only these are ever rebuilt from scratch, and only when their artwork
  // genuinely depends on distance travelled. Everything else is re-skinned or
  // simply moved — geometry churn mid-drive is what causes frame spikes.
  static REBUILD = new Set(['milestone', 'sign']);

  /** Swap a board's texture for another from the pool. Free. */
  _reskin(rec) {
    const pool = this.texPool[rec.kind];
    if (!pool) return;
    const tex = pool[(Math.random() * pool.length) | 0];
    rec.obj.traverse((o) => {
      if (o.isMesh && o.material && o.material.map && !Array.isArray(o.material)) {
        o.material.map = tex;      // no needsUpdate: defines unchanged
      }
    });
  }

  /** Push the board pools to the GPU up front (see warmTruckTextures). */
  warmTextures() {
    let n = 0;
    for (const pool of Object.values(this.texPool)) {
      for (const t of pool) { this.renderer.initTexture(t); n++; }
    }
    return n;
  }

  _recycleProp(rec) {
    let kind = rec.kind;
    if (kind === 'tree' || kind === 'field') kind = Math.random() < 0.72 ? 'tree' : 'field';

    // Jump forward in whole view-lengths so a long stall can't leave it behind.
    const span = VIEW + BEHIND;
    while (rec.d - this.dist < -BEHIND) rec.d += span;
    if (!rec.centered) rec.side = Math.random() < 0.5 ? -1 : 1;

    const mustRebuild = kind !== rec.kind || World.REBUILD.has(kind);
    // At most one rebuild per frame; the rest just move and try again later.
    if (mustRebuild && this._rebuildBudget > 0) {
      this._rebuildBudget--;
      this.propRoot.remove(rec.obj);
      disposeTree(rec.obj);
      const fresh = this._spawnProp(kind, rec.d, rec.side);
      this.props.pop();                       // _spawnProp appended it; we reuse `rec` instead
      rec.obj = fresh.obj;
      rec.off = fresh.off;
      rec.kind = kind;
      rec.centered = fresh.centered;
    } else {
      this._reskin(rec);                      // fresh joke, zero cost
    }
    rec.rot = rec.centered ? 0 : facingFor(rec.kind, rec.side);
  }

  _seedTraffic() {
    // Weighted toward trucks — this is a lorry highway, and each one carries
    // its own painted slogan for you to read.
    const kinds = ['truck', 'truck', 'truck', 'bus', 'car', 'truck', 'auto',
                   'car', 'truck', 'tractor', 'car', 'bus', 'mini', 'car'];
    let variant = 0;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      let obj;
      if (k === 'truck') obj = buildTruck({ variant: variant++ });
      else if (k === 'bus') obj = makeBus();
      else if (k === 'auto') obj = makeAuto();
      else if (k === 'tractor') obj = makeTractor();
      else if (k === 'mini') obj = makeMiniTruck();
      else obj = makeCar();

      const oncoming = Math.random() < 0.45;
      // Same-direction traffic must actually move at highway speeds
      // (43–79 km/h). Anything slower turns the drive into a queue.
      const rec = {
        obj, kind: k, oncoming,
        lane: oncoming ? -LANE : LANE,
        laneHome: oncoming ? -LANE : LANE,
        d: rnd(-BEHIND, VIEW),
        speed: oncoming ? -rnd(14, 23) : rnd(12, 22),
      };
      if (oncoming) obj.rotation.y = Math.PI;
      this.trafficRoot.add(obj);
      this.traffic.push(rec);
    }
  }

  // +1 lane for every 2 drivers online, so more people fit on the road. Base is
  // 2 lanes; the ribbon eases out to the new width over a second or so.
  setDriverCount(n) {
    const lanes = Math.min(5, 2 + Math.floor(Math.max(0, n) / 2));   // capped at 5 lanes
    this.laneCount = lanes;
    this.targetRoadW = ROAD_W + (lanes - 2) * LANE_STEP;
  }

  /** Nearest dhaba ahead, in metres (or null). Used for the refuel prompt. */
  nextDhaba() {
    let best = null;
    for (const p of this.props) {
      if (p.kind !== 'dhaba') continue;
      const rel = p.d - this.dist;
      if (rel > 4 && (best === null || rel < best)) best = rel;
    }
    return best;
  }

  update(dt, dist, speed, t, playerLane = null) {
    this.dist = dist;
    switch (this.timeMode) {
      case 'ist':                                        // track real Indian time
        this.timeOfDay = lerpCyclic(this.timeOfDay, istTimeOfDay(), Math.min(1, dt * 2));
        break;
      case 'day':
      case 'night': {
        const target = TIME_MODES.find((m) => m.id === this.timeMode).tod;
        this.timeOfDay = lerpCyclic(this.timeOfDay, target, Math.min(1, dt * 0.9));
        break;
      }
      case 'fixed': break;                                 // pinned (?tod= in the URL)
      default:
        this.timeOfDay = (this.timeOfDay + dt / 210) % 1;  // ~3.5 min per full day
    }
    const ph = lerpPhase(this.timeOfDay);
    this.night = ph.night;

    // sky + fog + lights
    this.skyUniforms.top.value.copy(ph.top);
    this.skyUniforms.bottom.value.copy(ph.bot);
    this.skyUniforms.glow.value.copy(ph.glow);
    this.skyUniforms.glowY.value = ph.gy;
    this.scene.fog.color.copy(ph.fog);
    this.scene.background = ph.fog;
    this.starMat.uniforms.uOpacity.value = Math.max(0, ph.night - 0.32) / 0.68;
    this.starMat.uniforms.uTime.value = t;

    const sunAng = this.timeOfDay * Math.PI * 2 - Math.PI / 2;
    const sx = Math.cos(sunAng) * 300, sy = Math.sin(sunAng) * 260, sz = -180;
    // Aim shadows at the road just ahead of the truck, and hold the light close
    // enough that everything worth shadowing sits inside the ortho frustum.
    const focus = 55;
    this._sunDir.set(Math.cos(sunAng), Math.max(0.35, Math.sin(sunAng)), -0.55).normalize();
    this.sun.target.position.set(0, 0, focus);
    this.sun.position.copy(this._sunDir).multiplyScalar(130).add(this.sun.target.position);
    this.sun.intensity = ph.sun;
    this.sun.color.copy(ph.glow).lerp(new THREE.Color('#fff0d0'), 0.5);
    this.hemi.intensity = ph.amb;
    this.hemi.color.copy(ph.top);
    this.hemi.groundColor.set('#8a6a44');

    // sun by day becomes the moon at night
    const moon = ph.night > 0.6;
    this.sunDisc.position.set(moon ? -sx : sx, Math.abs(sy) * 0.75 + 40, sz);
    this.sunDisc.material.color.set(moon ? '#e8ecf5' : '#fff3c4');
    this.sunDisc.scale.setScalar(moon ? 0.55 : 1);

    this.sky.position.set(0, 0, 0);
    this.stars.position.set(0, 0, 0);

    // refresh reflections a few times a minute as the light changes
    this._envTimer -= dt;
    if (this._envTimer <= 0) { this._envTimer = 3.5; this._updateEnv(ph); }

    // ribbons
    // ease the carriageway toward the target width (lanes scale with players)
    this.roadW += (this.targetRoadW - this.roadW) * Math.min(1, dt * 1.5);
    this.road.width = this.roadW;
    this.road.update(dist);

    // Follow the truck with the infinite ground plane and lock its texture to
    // world coordinates. In the render frame the truck sits at local X =
    // playerLane, Z = 0, and world X = roadCenterX(dist) + playerLane.
    const worldX = roadCenterX(dist) + (playerLane || 0);
    this.groundPlane.position.set(playerLane || 0, -0.06, 0);
    const T = this.groundTile, half = (this.groundSize / T) / 2;
    const gtex = this.groundPlane.material.map;
    gtex.offset.set(worldX / T - half, -dist / T - half);

    // props
    this._rebuildBudget = 1;          // amortise expensive rebuilds across frames
    const y0 = roadY(dist);
    const cx0 = roadCenterX(dist);
    for (const p of this.props) {
      if (p.d - dist < -BEHIND) this._recycleProp(p);
      const z = p.d - dist;
      const h = roadHeading(p.d);
      const lateral = p.centered ? 0 : p.side * (ROAD_W / 2 + p.off);
      p.obj.position.set(
        roadCenterX(p.d) - cx0 + Math.cos(h) * lateral,
        roadY(p.d) - y0,
        z + Math.sin(h) * -lateral
      );
      p.obj.rotation.y = p.rot + h;
      p.obj.visible = z > -BEHIND && z < VIEW;
      // dhaba string lights + temple flag come alive at dusk
      if (p.kind === 'dhaba') {
        for (const c of p.obj.children) {
          if (c.userData.bulb) c.material.emissiveIntensity = 0.08 + this.night * 0.45;
        }
      } else if (p.kind === 'temple' || p.kind === 'shrine') {
        for (const c of p.obj.children) {
          if (c.userData.flag) c.rotation.y = Math.sin(t * 3 + p.d) * 0.35;
        }
      }
    }

    // traffic
    for (const v of this.traffic) {
      // `v.d` is a WORLD distance along the highway, exactly like `dist` — the
      // same frame the position and heading lookups below use. Advancing it by
      // the RELATIVE speed instead (as this once did) made every vehicle drift
      // away at the player's speed until the road was empty.
      v.d += v.speed * dt;
      const relD = v.d - dist;
      if (relD < -BEHIND - 30 || relD > VIEW + 60) {
        v.oncoming = Math.random() < 0.45;
        v.lane = (v.oncoming ? -1 : 1) * (LANE + rnd(-0.5, 0.5));
        v.laneHome = v.lane;
        v.obj.rotation.y = v.oncoming ? Math.PI : 0;
        v.speed = v.oncoming ? -rnd(14, 24) : rnd(12, 22);
        // enter from whichever end it can actually approach from
        v.d = dist + ((v.speed - speed) > 0 ? -BEHIND - 10 : VIEW + 40);
        // give it a fresh slogan, avoiding any already on screen
        if (v.kind === 'truck') {
          const inUse = new Set();
          for (const o of this.traffic) {
            if (o === v || o.kind !== 'truck') continue;
            const map = o.obj.userData.body?.material?.[5]?.map;
            if (map) inUse.add(map);
          }
          refreshRearPanel(v.obj, inUse);
        }
      }
      // ── keep clear of the player ────────────────────────────────────────
      // Nothing should ever drive through the hero truck. Same-direction
      // traffic that closes on us slides aside and eases off until it's past.
      if (playerLane !== null) {
        const rel = v.d - dist;
        const near = Math.abs(rel) < 26;
        const sameSide = Math.abs(v.lane - playerLane) < 2.6;
        if (near && sameSide) {
          const away = v.lane > playerLane ? 1 : -1;
          const want = playerLane + away * 3.1;
          v.lane += (want - v.lane) * Math.min(1, dt * 3.2);
          // and don't let it grind through us from behind
          if (!v.oncoming && rel < 0 && rel > -18) v.d = dist - 18;
        } else if (v.laneHome !== undefined) {
          v.lane += (v.laneHome - v.lane) * Math.min(1, dt * 0.9);
        }
      }

      const h = roadHeading(v.d);
      v.obj.position.set(
        roadCenterX(v.d) - cx0 + Math.cos(h) * v.lane,
        roadY(v.d) - y0,
        v.d - dist + Math.sin(h) * -v.lane
      );
      v.obj.rotation.y = (v.oncoming ? Math.PI : 0) + h;
      v.obj.visible = v.d - dist > -BEHIND && v.d - dist < VIEW;
    }
  }
}

function disposeTree(obj) {
  const kill = (m) => { m?.map?.dispose?.(); m?.dispose?.(); };
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach(kill);
    else kill(o.material);
  });
}
