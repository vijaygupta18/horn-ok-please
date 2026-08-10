// main.js — game loop, driving model, autopilot, camera rigs, events, HUD.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTruck, updateTruck, setBrakeLights, warmTruckTextures } from './truck.js';
import { World, ROAD_W, LANE, roadCenterX, roadY, roadHeading, makeCow, TIME_MODES } from './world.js';
import { Radio, Sfx } from './audio.js';
import { Presence } from './presence.js';
import { Multiplayer, randomDriverName, randomDriverColor } from './multiplayer.js';
import { Billboards } from './billboards.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const KMH = 3.6;

// ── renderer / scene ───────────────────────────────────────────────────────

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// Fog must close out before the ground ribbon's far edge (430m) or you see a
// hard horizon seam where the terrain simply stops.
scene.fog = new THREE.Fog('#c9dcea', 70, 345);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.3, 1400);
camera.position.set(0, 6, -14);

// ── post-processing ────────────────────────────────────────────────────────
// Bloom is what sells night: marker lights, dhaba bulbs, headlamps and the
// diya on the dashboard all glow instead of just being bright pixels.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Higher threshold => only genuinely bright things (headlamps, dhaba bulbs)
// bloom, instead of every small emissive quad turning into a white smear.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Adaptive quality: if we can't hold a smooth frame, drop bloom first, then
// resolution — driving smoothly matters more than glow.
const QUALITY = { bloom: true, scale: 1, samples: [], checked: 0 };

const world = new World(scene, renderer);
const truck = buildTruck({ hero: true });
scene.add(truck);

// Headlight beams (night only). three.js r155+ uses physical light units, so
// spotlight intensity is candela and falls off by `decay` — the old
// small-integer intensities render as effectively no light at all.
const beams = [-0.86, 0.86].map((x) => {
  const sl = new THREE.SpotLight('#ffeec8', 0, 130, 0.46, 0.6, 1.15);
  sl.position.set(x, 1.5, 4.6);
  sl.target.position.set(x * 1.9, -1.2, 52);
  truck.add(sl);
  truck.add(sl.target);
  return sl;
});
// A wide, dim spill so the verges aren't pitch black beside the beam.
const spill = new THREE.SpotLight('#dfe4f0', 0, 60, 0.95, 0.95, 1.2);
spill.position.set(0, 2.4, 4.4);
spill.target.position.set(0, -1, 26);
truck.add(spill);
truck.add(spill.target);
// Bright enough to light the road, dim enough that a car caught in the beam
// stays a car instead of a white blob.
const HEADLIGHT_CD = 190;

// ── live rear-view mirror ──────────────────────────────────────────────────
// A grey rectangle isn't a mirror. This renders the road behind the truck into
// a small off-screen target and maps it onto the cab mirror, so at night you
// genuinely see headlights coming up on you. Cheap: 256×88, and only in CABIN.
const mirrorRT = new THREE.WebGLRenderTarget(256, 88, { depthBuffer: true });
const mirrorCam = new THREE.PerspectiveCamera(48, 256 / 88, 0.5, 320);
const mirrorMat = new THREE.MeshBasicMaterial({ map: mirrorRT.texture });
{
  const m = truck.userData.interior?.userData?.mirror;
  if (m) m.material = mirrorMat;
}

const MIRROR_EYE = new THREE.Vector3(1.62, 2.55, 3.0);   // just outside the cab
// Aimed at the horizon rather than the tarmac: pointed down it fills with
// dark asphalt and reads as a black rectangle.
const MIRROR_AIM = new THREE.Vector3(1.25, 2.30, -55);
const mirrorAimV = new THREE.Vector3();

let mirrorFrames = 0;
function renderMirror() {
  const m = truck.userData.interior?.userData?.mirror;
  if (!m) return;
  mirrorFrames++;
  // The camera must sit OUTSIDE the cab. Placed at the mirror itself it stares
  // straight into the rear cab wall and the glass renders solid black — a lorry
  // has no rear window, so this is a wing-mirror view by necessity and by fact.
  truck.localToWorld(mirrorCam.position.copy(MIRROR_EYE));
  truck.localToWorld(mirrorAimV.copy(MIRROR_AIM));
  mirrorCam.lookAt(mirrorAimV);
  m.visible = false;                              // never film itself
  const prevBg = scene.background;
  renderer.setRenderTarget(mirrorRT);
  renderer.clear();
  renderer.render(scene, mirrorCam);
  renderer.setRenderTarget(null);
  scene.background = prevBg;
  m.visible = true;
}

// ── exhaust smoke ──────────────────────────────────────────────────────────

const smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(190,190,190,.9)');
  g.addColorStop(0.5, 'rgba(150,150,150,.35)');
  g.addColorStop(1, 'rgba(120,120,120,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const smoke = [];
for (let i = 0; i < 34; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
  s.userData.life = 0;
  scene.add(s);
  smoke.push(s);
}
let smokeCursor = 0, smokeTimer = 0;

function emitSmoke(pos, puff) {
  const s = smoke[smokeCursor++ % smoke.length];
  s.position.copy(pos);
  s.userData.life = 1;
  s.userData.vy = 1.4 + Math.random() * 1.2;
  s.userData.vx = (Math.random() - 0.5) * 0.7;
  s.userData.grow = 1.6 + Math.random();
  s.userData.puff = puff;      // dark diesel puff on hard throttle
  s.scale.setScalar(0.5);
}

// ── cow (the road hazard everyone in India knows) ──────────────────────────

const cow = makeCow();
cow.visible = false;
scene.add(cow);
const cowState = { active: false, d: 0, lane: 0, hitCooldown: 0 };

// ── driving state ──────────────────────────────────────────────────────────

const S = {
  dist: 0,
  speed: 0,            // m/s
  lane: LANE,          // lateral offset from road centre
  steer: 0,            // smoothed steering, -1..1
  throttle: 0,
  braking: false,
  fuel: 100,
  auto: false,
  handbrake: false,
  reversing: false,      // in reverse gear (manual only)
  reverseHold: 0,        // how long the brake has been held at a standstill
  revBeep: 0,
  cam: 0,
  shake: 0,
  t: 0,
  started: false,
  hornCooldown: 0,
  offroad: 0,
};
const MAX_SPEED = 29;      // ~104 km/h
const REVERSE_MAX = 6;     // ~21 km/h — nobody reverses a loaded lorry faster
// The drivable half-width. It grows as the road widens with more drivers
// online (world.roadW), so it's recomputed each frame — see the loop.
let LANE_LIMIT = ROAD_W / 2 - 1.35;

const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;       // don't hijack the volume slider
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (keys[k]) return;                            // ignore OS key-repeat
  keys[k] = true;
  // any drive input cuts the dhaba break short
  if (BREAK.phase === 'resting' && ['w', 's', 'a', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    endBreak(true);
  }
  // 0–9 jump to that percentage of the track, like YouTube
  if (k >= '0' && k <= '9') {
    const { dur } = radio.time();
    if (dur > 0) { radio.seek(dur * (+k / 10)); toast(`${+k * 10}% पर`, `Jumped to ${+k * 10}%`, true); }
  }
  if (k === 'h') doHorn(false);
  if (k === 'u') billboards.openUpload();
  if (k === 'escape') billboards.closeUpload();
  if (k === 'p') toggleAuto();
  if (k === 'x') toggleHandbrake();
  if (k === 't') cycleTimeMode();
  if (k === 'g') cycleHorn();
  if (k === 'n') { radio.next(); toast('अगला गाना', 'NEXT TRACK', true); }
  if (k === 'b') radio.prev();
  if (k === 'j') { radio.skip(-10); toast('१० सेकंड पीछे', '−10s', true); }
  if (k === 'l') { radio.skip(10); toast('१० सेकंड आगे', '+10s', true); }
  if (k === 'k') radio.toggle();
  if (k === 'c') { S.cam = (S.cam + 1) % CAMS.length; syncOrbitToCam();
    toast('कैमरा', CAMS[S.cam].name + (CAMS[S.cam].orbit ? ' — drag to look around' : ''), true); }
  if (k === 'm') toggleMute();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

// touch
const touch = { left: 0, right: 0, gas: 0, brake: 0 };
function bindTouch(id, prop) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touch[prop] = 1; };
  const off = (e) => { e.preventDefault(); touch[prop] = 0; };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  addEventListener('mouseup', off);
}
bindTouch('#tc-left', 'left');
bindTouch('#tc-right', 'right');
bindTouch('#tc-gas', 'gas');
bindTouch('#tc-brake', 'brake');
$('#tc-horn').addEventListener('touchstart', (e) => { e.preventDefault(); doHorn(); }, { passive: false });
$('#tc-horn').addEventListener('click', doHorn);

// tap the "park to upload" hint (mobile / mouse) to open the billboard menu
$('#bb-hint')?.addEventListener('click', () => billboards.openUpload());

// ── audio + presence ───────────────────────────────────────────────────────

const sfx = new Sfx();
const radio = new Radio(renderNowPlaying);
let muted = false;

let hornLabelT = 0;

// ── driver identity (name + colour, shown to everyone) ──────────────────────
const DRIVER_KEY = 'its_driver_v1';
const driver = (() => {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(DRIVER_KEY) || '{}'); } catch { /* private mode */ }
  if (!d.color) d.color = randomDriverColor();
  if (!d.name) d.name = randomDriverName();
  return d;
})();
function saveDriver() {
  try { localStorage.setItem(DRIVER_KEY, JSON.stringify(driver)); } catch { /* private mode */ }
}

// ── multiplayer (other drivers on the road + the round-universe minimap) ────
const multiplayer = new Multiplayer(scene);
multiplayer.attachMap($('#minimap-c'));

// ── shared upload billboards (credited to your truck's name) ────────────────
const billboards = new Billboards(scene, world, () => driver.name);

const presence = new Presence({
  identity: () => ({ name: driver.name, color: driver.color }),
  state: () => ({ dist: S.dist, lane: S.lane, kmh: Math.abs(S.speed) * KMH }),
  onRoster: (players) => {
    multiplayer.setRoster(players);
    // +1 lane for every 2 drivers (you + everyone else), so more people fit.
    world.setDriverCount(players.length + 1);
  },
  onSpawn: (dist) => {
    // A driver on your WiFi is already out there — drop in just behind them so
    // you meet on the road straight away. Only ever fires once.
    if (!(dist > 0)) return;
    S.dist = Math.max(0, dist - 25);
    toast('अपने नेटवर्क वाले के पास', 'Spawned near a driver on your WiFi', true);
  },
  onUpdate: (count, delta, live) => {
    const el = $('#t-live');
    el.textContent = count;
    const panel = el.closest('.live');
    if (panel) {
      panel.title = live
        ? 'Live: the real number of drivers on the highway right now.'
        : 'No server: counting drivers across tabs on this device, over a baseline of 13.';
      panel.classList.toggle('is-live', !!live);
    }
    if (delta > 0) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  },
});

// prefill the start-card name field; the dice picks a fresh name + truck colour
{
  const nameInput = $('#driver-name');
  if (nameInput) nameInput.value = driver.name;
  $('#btn-dice')?.addEventListener('click', () => {
    driver.name = randomDriverName();
    driver.color = randomDriverColor();
    if (nameInput) nameInput.value = driver.name;
  });
}

function doHorn(long = false) {
  if (S.hornCooldown > 0) return;
  // A different horn every single press, played all the way through. The
  // cooldown is the tune's own length, so holding H waits for it to finish
  // rather than stuttering over itself.
  const h = sfx.randomHorn(long);
  const dur = (h && h.duration) || 1.6;
  // Short debounce only — a deliberate new press should be able to cut the
  // current tune off and start a different one straight away.
  S.hornCooldown = 0.15;
  if (h) {
    UI.horn.textContent = `📯 ${h.hi}`;
    UI.horn.classList.add('lit');
    clearTimeout(hornLabelT);
    hornLabelT = setTimeout(() => UI.horn.classList.remove('lit'), dur * 1000);
  }
  radio.duck(dur * 1000 + 300);
  // scatter the cow if it's close enough to hear you
  if (cowState.active && cowState.d - S.dist < 60) {
    cowState.active = false;
    cow.visible = false;
    toast('गाय भाग गई!', 'Cow moved — shukriya, horn!', true);
  }
}

function toggleAuto() {
  S.auto = !S.auto;
  const btn = $('#btn-auto');
  btn.classList.toggle('on', S.auto);
  $('#t-mode').textContent = S.auto ? 'AUTOPILOT' : 'MANUAL';
  toast(S.auto ? 'ऑटोपायलट चालू' : 'अब तुम चला रहे हो',
        S.auto ? 'Autopilot engaged — relax' : 'Manual control', true);
}

// G = play another random horn and name it
function cycleHorn() {
  const h = sfx.randomHorn(true);
  if (h) toast(h.hi, h.en, true);
  else toast('हॉर्न', 'Horn', true);
  radio.duck(2200);
}

function toggleHandbrake() {
  S.handbrake = !S.handbrake;
  const btn = $('#btn-stop');
  btn.classList.toggle('on', S.handbrake);
  $('#t-stop').textContent = S.handbrake ? 'BRAKE ON' : 'HANDBRAKE';
  if (S.handbrake) {
    sfx.airBrake();
    toast('हैंडब्रेक खींच दिया', 'Handbrake on — truck stopping', false);
  } else {
    toast('हैंडब्रेक छोड़ा', 'Handbrake released — chalo', true);
  }
}

// India time → Day → Night → Fast cycle
function cycleTimeMode() {
  const i = TIME_MODES.findIndex((m) => m.id === world.timeMode);
  const next = TIME_MODES[(i + 1) % TIME_MODES.length];
  world.timeMode = next.id;
  $('#t-timemode').textContent = next.label;
  $('#t-timeicon').textContent = { ist: '🕐', day: '☀️', night: '🌙', cycle: '🔄' }[next.id];
  $('#btn-time').classList.toggle('on', next.id !== 'ist');
  toast(next.hi, next.id === 'ist' ? 'Following real time in India' : next.label, true);
}

function toggleMute() {
  muted = !muted;
  sfx.setMuted(muted);
  radio.setVolume(muted ? 0 : +$('#vol').value);
  $('#btn-mute').textContent = muted ? '🔇' : '🔊';
}

// ── toasts ─────────────────────────────────────────────────────────────────

function toast(hi, en, good = false) {
  const box = $('#toast');
  const d = document.createElement('div');
  d.className = 'toast-item' + (good ? ' good' : '');
  d.innerHTML = `${en}<span class="hi">${hi}</span>`;
  box.appendChild(d);
  setTimeout(() => d.remove(), 3100);
}

// ── cameras ────────────────────────────────────────────────────────────────

const CAMS = [
  // Raised and pulled back, aimed lower and further down the road, so the default
  // view shows much more of the highway ahead — easier to drive, and to spot the
  // upload billboards and other drivers coming up.
  { name: 'CHASE',     pos: new THREE.Vector3(0, 6.4, -14.5),  look: new THREE.Vector3(0, 1.5, 40), fov: 62 },
  // Driver sits on the RIGHT — India drives on the left.
  // Eye point sits back from the wheel and above it, like an actual driver's.
  // Eye sits mid-glass (the window spans y≈2.17–2.79), not level with its top,
  // or the hanging fringe ends up across the middle of the road view.
  { name: 'CABIN',     pos: new THREE.Vector3(0.5, 2.52, 3.52), look: new THREE.Vector3(0.34, 2.30, 34), fov: 70, inside: true },
  // Bonnet cam sits ON the front edge looking down the road, not floating ahead
  // of the truck where the nose can clip through it.
  { name: 'BONNET',    pos: new THREE.Vector3(0, 3.02, 4.34),  look: new THREE.Vector3(0, 2.15, 40), fov: 68 },
  // Both of these are mouse-orbitable; each keeps its own framing.
  { name: 'CINEMATIC', pos: new THREE.Vector3(-9.5, 2.3, -6),  look: new THREE.Vector3(0, 2.2, 8),  fov: 46,
    orbit: true, orbitRadius: 13, orbitPitch: 0.20, orbitYaw: -1.15, aimY: 2.2 },
  { name: 'TOP',       pos: new THREE.Vector3(0, 15, -19),     look: new THREE.Vector3(0, 0, 22),  fov: 52,
    orbit: true, orbitRadius: 26, orbitPitch: 0.72, orbitYaw: 0, aimY: 2 },
];
const camPos = new THREE.Vector3(0, 6, -14);
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();

// ── mouse orbit (TOP view) ────────────────────────────────────────────────
// Drag to swing the camera around the truck, wheel to pull in and out.

const orbit = { yaw: 0, pitch: 0.72, zoom: 1, dragging: false, px: 0, py: 0, forCam: -1 };
const orbitCam = () => CAMS[S.cam].orbit;

/** Load this camera's own orbit framing the first time we switch to it. */
function syncOrbitToCam() {
  const c = CAMS[S.cam];
  if (!c.orbit || orbit.forCam === S.cam) return;
  orbit.forCam = S.cam;
  orbit.yaw = c.orbitYaw ?? 0;
  orbit.pitch = c.orbitPitch ?? 0.6;
  orbit.zoom = 1;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!orbitCam()) return;
  orbit.dragging = true;
  orbit.px = e.clientX; orbit.py = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (orbitCam()) canvas.style.cursor = orbit.dragging ? 'grabbing' : 'grab';
  else canvas.style.cursor = '';
  if (!orbit.dragging) return;
  orbit.yaw -= (e.clientX - orbit.px) * 0.006;
  orbit.pitch = clamp(orbit.pitch + (e.clientY - orbit.py) * 0.005, 0.12, 1.45);
  orbit.px = e.clientX; orbit.py = e.clientY;
});
addEventListener('pointerup', () => { orbit.dragging = false; });
canvas.addEventListener('wheel', (e) => {
  if (!orbitCam()) return;
  e.preventDefault();
  orbit.zoom = clamp(orbit.zoom * (e.deltaY > 0 ? 1.09 : 0.92), 0.42, 2.6);
}, { passive: false });

// ── speedometer ────────────────────────────────────────────────────────────

// Cached HUD nodes — querySelector in the render loop is pure waste.
const UI = {
  km: $('#t-km'), fuel: $('#t-fuel'), clock: $('#t-clock'), dhaba: $('#t-dhaba'),
  cur: $('#t-cur'), dur: $('#t-dur'), fill: $('#seek-fill'), knob: $('#seek-knob'),
  song: $('#t-song'), track: $('#t-track'), eq: $('#t-eq'), play: $('#btn-play'),
  live: $('#t-live'), breakBox: $('#break'), horn: $('#t-horn'),
  mspeed: $('#t-mspeed'), mmood: $('#t-mmood'),
};
let hudClock = 0, lastKm = '', lastClock = '', lastDhaba = '', lastKmh = -1;

const sc = $('#speedo-c').getContext('2d');
const DEVA = '"Noto Sans Devanagari","Kohinoor Devanagari",sans-serif';

// The dial is marked in moods, not just numbers — the way a decorated lorry
// would be if the painter got hold of the instrument cluster.
const MOODS = [
  { upto: 4,   hi: 'खड़ी है',        en: 'PARKED',      c: '#9aa6b2' },
  { upto: 25,  hi: 'चींटी की चाल',   en: 'ANT SPEED',   c: '#8ef0bd' },
  { upto: 48,  hi: 'आराम से',        en: 'ARAAM SE',    c: '#8ef0bd' },
  { upto: 72,  hi: 'मस्त चल रही',    en: 'MAST',        c: '#fbdb4a' },
  { upto: 92,  hi: 'बाप रे बाप!',    en: 'BAAP RE!',    c: '#f5741a' },
  { upto: 999, hi: 'राम भरोसे!',     en: 'RAM BHAROSE', c: '#ff4a3a' },
];
const moodFor = (k) => MOODS.find((m) => k <= m.upto);

function drawSpeedo(kmh, gear) {
  const W = 260, R = 104, cx = 130, cy = 124;
  sc.clearRect(0, 0, W, W);
  sc.textAlign = 'center'; sc.textBaseline = 'middle';

  // chrome bezel
  const bez = sc.createLinearGradient(0, 14, 0, 240);
  bez.addColorStop(0, '#f4f7fa'); bez.addColorStop(.42, '#96a2ae');
  bez.addColorStop(.55, '#e8eef4'); bez.addColorStop(1, '#78838f');
  sc.fillStyle = bez;
  sc.beginPath(); sc.arc(cx, cy, R + 20, 0, 7); sc.fill();

  // scalloped saffron ring — the fringe painted round every lorry dial
  sc.fillStyle = '#f0a020';
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    sc.beginPath();
    sc.arc(cx + Math.cos(a) * (R + 9), cy + Math.sin(a) * (R + 9), 5.4, 0, 7);
    sc.fill();
  }
  sc.strokeStyle = '#8f1414'; sc.lineWidth = 3;
  sc.beginPath(); sc.arc(cx, cy, R + 4, 0, 7); sc.stroke();

  // dial face
  const face = sc.createRadialGradient(cx, cy - 34, 8, cx, cy, R);
  face.addColorStop(0, '#12857a'); face.addColorStop(1, '#04302b');
  sc.fillStyle = face;
  sc.beginPath(); sc.arc(cx, cy, R, 0, 7); sc.fill();

  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, MAXK = 120;
  const ang = (k) => A0 + (A1 - A0) * (k / MAXK);

  // mood arcs around the rim
  for (const m of MOODS) {
    const from = MOODS[MOODS.indexOf(m) - 1]?.upto ?? 0;
    if (from >= MAXK) break;
    sc.strokeStyle = m.c; sc.lineWidth = 7; sc.globalAlpha = 0.85;
    sc.beginPath();
    sc.arc(cx, cy, R - 10, ang(from), ang(Math.min(MAXK, m.upto)));
    sc.stroke();
  }
  sc.globalAlpha = 1;

  // ticks + numbers
  for (let k = 0; k <= MAXK; k += 10) {
    const a = ang(k), major = k % 20 === 0;
    sc.strokeStyle = k >= 92 ? '#ffb0a0' : '#fdf6e3';
    sc.lineWidth = major ? 3.2 : 1.6;
    sc.beginPath();
    sc.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
    sc.lineTo(cx + Math.cos(a) * (R - (major ? 31 : 26)), cy + Math.sin(a) * (R - (major ? 31 : 26)));
    sc.stroke();
    if (major) {
      sc.fillStyle = '#fbdb4a';
      sc.font = '700 16px Rajdhani, sans-serif';
      sc.fillText(k, cx + Math.cos(a) * (R - 46), cy + Math.sin(a) * (R - 46));
    }
  }

  // ॐ at the top of the dial, like a painted blessing
  sc.fillStyle = 'rgba(251,219,74,.5)';
  sc.font = `700 20px ${DEVA}`;
  sc.fillText('ॐ', cx, cy - 60);

  // gear, drawn inside the dial so it can't collide with the bottom banner
  sc.fillStyle = 'rgba(0,0,0,.4)';
  sc.beginPath(); sc.roundRect(cx - 22, cy - 46, 44, 26, 7); sc.fill();
  sc.strokeStyle = 'rgba(251,219,74,.45)'; sc.lineWidth = 1.5; sc.stroke();
  sc.fillStyle = '#fbdb4a';
  sc.font = '800 17px Rajdhani, sans-serif';
  sc.fillText(gear, cx, cy - 32);

  // readout
  const m = moodFor(kmh);
  sc.fillStyle = '#fdf6e3';
  sc.font = '800 34px Rajdhani, sans-serif';
  sc.fillText(Math.round(kmh), cx, cy + 16);
  sc.fillStyle = '#fbdb4a';
  sc.font = '700 11px Rajdhani, sans-serif';
  sc.fillText('km/h', cx, cy + 40);

  // the mood label — the joke that makes it a lorry dial
  sc.fillStyle = m.c;
  sc.font = `800 15px ${DEVA}`;
  sc.fillText(m.hi, cx, cy + 62);

  // needle
  const a = ang(clamp(kmh, 0, MAXK));
  sc.save();
  sc.translate(cx, cy); sc.rotate(a);
  sc.fillStyle = '#d92121';
  sc.beginPath();
  sc.moveTo(-8, -5.5); sc.lineTo(-8, 5.5); sc.lineTo(R - 22, 1.5); sc.lineTo(R - 22, -1.5);
  sc.fill();
  sc.strokeStyle = 'rgba(0,0,0,.4)'; sc.lineWidth = 1; sc.stroke();
  sc.restore();

  // hub painted as a tiny lotus
  sc.fillStyle = '#c8d2dc';
  sc.beginPath(); sc.arc(cx, cy, 13, 0, 7); sc.fill();
  sc.fillStyle = '#ec4899';
  for (let i = 0; i < 8; i++) {
    const pa = (i / 8) * Math.PI * 2;
    sc.beginPath();
    sc.ellipse(cx + Math.cos(pa) * 6, cy + Math.sin(pa) * 6, 4, 2.4, pa, 0, 7);
    sc.fill();
  }
  sc.fillStyle = '#fbdb4a';
  sc.beginPath(); sc.arc(cx, cy, 3.6, 0, 7); sc.fill();

  // banner across the bottom
  sc.fillStyle = '#d92121';
  sc.beginPath(); sc.roundRect(cx - 62, W - 34, 124, 24, 12); sc.fill();
  sc.strokeStyle = '#f0a020'; sc.lineWidth = 2.5; sc.stroke();
  sc.fillStyle = '#fbdb4a';
  sc.font = `800 13px ${DEVA}`;
  sc.fillText('जय माता दी', cx, W - 21);
}

// ── radio UI ───────────────────────────────────────────────────────────────

function renderNowPlaying(info) {
  const el = UI.song;
  if (el.textContent !== info.title) {
    el.textContent = info.title;
    el.classList.toggle('scroll', info.title.length > 34);
  }
  UI.play.textContent = info.playing ? '⏸' : '▶';
  UI.eq.classList.toggle('on', info.playing);
  UI.track.textContent = info.total ? `Track ${info.index}/${info.total}` : 'Shuffled';
}

$('#btn-play').onclick = () => radio.toggle();
$('#btn-next').onclick = () => radio.next();
$('#btn-prev').onclick = () => radio.prev();
$('#btn-ff').onclick = () => radio.skip(10);
$('#btn-rw').onclick = () => radio.skip(-10);
$('#btn-mute').onclick = toggleMute;
$('#vol').oninput = (e) => { if (!muted) radio.setVolume(+e.target.value); };
$('#btn-auto').onclick = toggleAuto;
$('#btn-stop').onclick = toggleHandbrake;
$('#btn-time').onclick = cycleTimeMode;

// ── seek bar (click anywhere, or drag the knob) ───────────────────────────

const mmss = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
};

const seekBar = $('#seek-bar');
let scrubbing = false;

function seekFromPointer(e) {
  const r = seekBar.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  const frac = clamp(x / r.width, 0, 1);
  const { dur } = radio.time();
  if (dur > 0) radio.seek(frac * dur);
  // paint immediately so dragging feels attached to the finger
  UI.fill.style.width = (frac * 100) + '%';
  UI.knob.style.left = (frac * 100) + '%';
}

seekBar.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  seekBar.setPointerCapture?.(e.pointerId);
  seekFromPointer(e);
});
seekBar.addEventListener('pointermove', (e) => { if (scrubbing) seekFromPointer(e); });
addEventListener('pointerup', () => { scrubbing = false; });

let seekClock = 0;
function updateSeekUI(dt) {
  seekClock -= dt;
  if (seekClock > 0 || scrubbing) return;
  seekClock = 0.25;                       // 4 Hz is plenty for a progress bar
  const { cur, dur } = radio.time();
  UI.cur.textContent = mmss(cur);
  UI.dur.textContent = mmss(dur);
  const frac = dur > 0 ? clamp(cur / dur, 0, 1) : 0;
  UI.fill.style.width = (frac * 100) + '%';
  UI.knob.style.left = (frac * 100) + '%';
}

// ── road events ────────────────────────────────────────────────────────────

// ── the dhaba break ────────────────────────────────────────────────────────
// Every few km the truck pulls in for a scripted 30-second halt: diesel goes
// in, the driver eats, and the HUD narrates it. Any input skips it.

const BREAK = {
  phase: 'none',          // none | pending | resting
  timer: 0,
  nextAt: 2600,           // metres until the first stop
  line: 0,
  lineTimer: 0,
};

const BREAK_LINES = [
  { hi: 'दो परांठे, दाल मक्खनी — extra makkhan', en: 'Ordering: 2 paratha + dal makhani' },
  { hi: 'चाय आ गई ☕', en: 'Chai has arrived. Sip slowly.' },
  { hi: 'डीज़ल भरवा रहे हैं…', en: 'Filling diesel — 40 litres' },
  { hi: 'चारपाई पे 5 मिनट की झपकी', en: '5-minute nap on the charpai' },
  { hi: 'दोस्त से गपशप हो रही है', en: 'Gossiping with the dhaba owner' },
  { hi: 'टायर में हवा चेक कर लो', en: 'Checking tyre pressure' },
  { hi: 'पान खा के मुँह लाल', en: 'One paan for the road' },
  { hi: 'गाड़ी को पानी पिला दिया', en: 'Topping up the radiator' },
];

function startBreak() {
  BREAK.phase = 'resting';
  BREAK.timer = 30;
  BREAK.line = 0;
  BREAK.lineTimer = 0;
  S.handbrake = true;
  $('#btn-stop').classList.add('on');
  $('#t-stop').textContent = 'BRAKE ON';
  sfx.airBrake();
  toast('ढाबा आ गया — 30 सेकंड का ब्रेक', 'DHABA BREAK — 30s halt', true);
}

function endBreak(skipped) {
  BREAK.phase = 'none';
  BREAK.nextAt = S.dist + 2600 + Math.random() * 2200;
  S.handbrake = false;
  $('#btn-stop').classList.remove('on');
  $('#t-stop').textContent = 'HANDBRAKE';
  S.fuel = 100;
  toast(skipped ? 'ठीक है, चलो निकलते हैं' : 'पेट भर गया — चलो!',
        skipped ? 'Break skipped' : 'Fed, fuelled, rolling again', true);
}

function updateBreak(dt) {
  const banner = UI.breakBox;
  if (BREAK.phase === 'none') {
    // Arm the stop, then wait for a dhaba to actually come up.
    if (S.dist > BREAK.nextAt) BREAK.phase = 'pending';
    banner.classList.add('hidden');
    return;
  }
  if (BREAK.phase === 'pending') {
    const dh = world.nextDhaba();
    if (dh !== null && dh < 32 && S.speed < 3) startBreak();
    else banner.classList.add('hidden');     // hint text is set in the main loop
    return;
  }

  // resting
  BREAK.timer -= dt;
  BREAK.lineTimer -= dt;
  if (BREAK.lineTimer <= 0) {
    BREAK.lineTimer = 3.6;
    BREAK.line = (BREAK.line + 1) % BREAK_LINES.length;
  }
  const L = BREAK_LINES[BREAK.line];
  banner.classList.remove('hidden');
  banner.innerHTML =
    `<div class="bk-t">ढाबा ब्रेक · DHABA BREAK</div>
     <div class="bk-l">${L.hi}</div>
     <div class="bk-e">${L.en}</div>
     <div class="bk-c">${Math.ceil(BREAK.timer)}s</div>
     <div class="bk-s">press any drive key to skip</div>`;
  if (BREAK.timer <= 0) endBreak(false);
}

let nextEventAt = 400;
const EVENTS = [
  () => { // cow
    cowState.active = true;
    cowState.d = S.dist + 190;
    cowState.lane = (Math.random() < 0.5 ? -1 : 1) * Math.random() * LANE_LIMIT;
    cow.visible = true;
    toast('गाय आगे है! हॉर्न बजाओ', 'COW AHEAD — press H to horn', false);
  },
  () => toast('स्पीड ब्रेकर', 'Speed breaker — dheere!', false),
  () => toast('टोल नाका 500m', 'Toll naka ahead', true),
  () => toast('चाय पी लो', 'Dhaba ahead — chai break?', true),
  () => toast('घाट का मोड़', 'Sharp ghat turn coming', false),
];

// ── loop ───────────────────────────────────────────────────────────────────

let last = performance.now();
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  // Clamp BOTH ends: a rAF timestamp can predate the performance.now() captured
  // in a click/visibility handler, and a negative dt runs the whole integrator
  // backwards (speed climbs from drag, distance goes negative).
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!running) return;
  S.t += dt;

  // The road widens as more drivers join; keep the drivable half-width in step
  // (world.roadW eases toward its target inside world.update each frame).
  LANE_LIMIT = world.roadW / 2 - 1.35;

  // ---- input ----------------------------------------------------------
  let throttleIn, steerIn, brakeIn;
  if (S.auto) {
    [throttleIn, steerIn, brakeIn] = autopilot(dt);
  } else {
    // ↑/W accelerate, ↓/S/Space brake, ←/A left, →/D right.
    //
    // Sign convention: positive `steer` moves the truck toward +X. The chase
    // camera looks down +Z, and in a right-handed system +X is on the LEFT of
    // the screen — so pressing LEFT must produce a POSITIVE steer. Mapping it
    // the intuitive-looking way (left = −1) sent the truck the wrong way, and
    // took the yaw, the front wheels and the steering wheel with it, since all
    // three derive from this one value.
    throttleIn = (keys.w || keys.arrowup || touch.gas) ? 1 : 0;
    brakeIn = (keys.s || keys.arrowdown || keys[' '] || touch.brake) ? 1 : 0;
    steerIn = ((keys.a || keys.arrowleft || touch.left) ? 1 : 0) +
              ((keys.d || keys.arrowright || touch.right) ? -1 : 0);
  }
  // The brake is always live, autopilot or not — stamping on it must stop the
  // truck. Let go and the autopilot simply picks up again on the next frame.
  const manualBrake = keys.s || keys.arrowdown || keys[' '] || touch.brake;
  if (manualBrake) { brakeIn = 1; throttleIn = 0; }

  if (S.fuel <= 0) throttleIn = 0;
  // Handbrake overrides everything, in autopilot too.
  if (S.handbrake) { throttleIn = 0; brakeIn = 1; }
  // NB: no auto-retrigger while H is held. One press = one complete horn;
  // the next PRESS picks a new one. Holding used to restart a fresh tune every
  // time the cooldown lapsed, which sounded like the horn was channel-hopping.

  S.throttle = lerp(S.throttle, throttleIn, dt * 4);
  const wasBraking = S.braking;
  S.braking = brakeIn > 0;
  // air-brake hiss on release, like every lorry pulling up to a dhaba
  if (wasBraking && !S.braking && S.speed < 12) sfx.airBrake();
  S.steer = lerp(S.steer, steerIn, dt * 5.5);

  // ---- reverse gear ----------------------------------------------------
  // Hold the brake once you've come to a stop and the truck slots into reverse,
  // the way you'd actually back one up. Autopilot never reverses.
  if (S.auto || S.handbrake) { S.reversing = false; S.reverseHold = 0; }
  else if (!S.reversing) {
    if (brakeIn && S.speed < 0.15) {
      S.reverseHold += dt;
      if (S.reverseHold > 0.7) {
        S.reversing = true;
        S.reverseHold = 0;
        sfx.airBrake();
        toast('रिवर्स गियर', 'Reverse — hold ↓ to back up, ↑ to go forward', true);
      }
    } else S.reverseHold = 0;
  }

  // ---- longitudinal ---------------------------------------------------
  const grade = (roadY(S.dist + 6) - roadY(S.dist - 6)) / 12;   // climb costs speed
  if (S.reversing) {
    // speed is negative in reverse: ↓ pushes it further negative, ↑ arrests it
    let ra = 0;
    if (brakeIn) ra -= 3.4;
    if (throttleIn) ra += 6.5;
    ra += 0.6;                                                   // rolling resistance toward rest
    S.speed = clamp(S.speed + ra * dt, -REVERSE_MAX, 0);
    if (S.speed >= -0.02 && throttleIn > 0) {
      S.reversing = false;
      toast('आगे चलो', 'Back in forward gear', true);
    }
    // reversing beeper
    S.revBeep -= dt;
    if (S.speed < -0.3 && S.revBeep <= 0) { S.revBeep = 0.9; sfx.reverseBeep(); }
  } else {
    let a = S.throttle * 4.6 - grade * 8.5;
    a -= 0.45 + 0.0022 * S.speed * S.speed;                      // rolling + drag
    if (brakeIn) a -= 9.5;
    // Off the tarmac. Kept well below full throttle (4.6) — at 4.2 the two very
    // nearly cancelled and a truck that wandered onto the verge could never
    // climb back out, autopilot included.
    if (Math.abs(S.lane) > LANE_LIMIT) a -= 2.5;
    S.speed = clamp(S.speed + a * dt, 0, MAX_SPEED);
  }

  // ---- lateral --------------------------------------------------------
  // Grip comes from road speed regardless of direction; reversing mirrors the
  // steering, exactly as backing a real vehicle does.
  const grip = Math.min(1, Math.abs(S.speed) / 6);
  S.lane += S.steer * 7.2 * dt * grip * (S.speed < 0 ? -1 : 1);
  const over = Math.abs(S.lane) - LANE_LIMIT;
  if (over > 0) {
    S.lane = Math.sign(S.lane) * (LANE_LIMIT + Math.min(over, 2.2));
    S.offroad = 1;
    S.shake = Math.max(S.shake, Math.min(0.5, Math.abs(S.speed) / 40));
  } else S.offroad = Math.max(0, S.offroad - dt * 2);

  S.dist = Math.max(0, S.dist + S.speed * dt);      // reversing walks it back
  S.fuel = Math.max(0, S.fuel - dt * (0.075 + S.throttle * 0.34 + Math.abs(S.speed) * 0.006));
  S.hornCooldown = Math.max(0, S.hornCooldown - dt);
  S.shake = Math.max(0, S.shake - dt * 1.6);

  // ---- world ----------------------------------------------------------
  world.update(dt, S.dist, Math.abs(S.speed), S.t, S.lane);
  const night = world.night;

  // ---- other drivers + upload billboards ------------------------------
  multiplayer.update(dt, S.dist, S.lane, driver.name, driver.color, night);
  billboards.update(dt, S.dist, S.lane, Math.abs(S.speed) * KMH, night, S.t, world.roadW);

  // ---- place the truck on the road ------------------------------------
  const h0 = roadHeading(S.dist);
  truck.position.set(Math.cos(h0) * S.lane, 0, -Math.sin(h0) * S.lane);
  const bump = Math.sin(S.dist * 1.7) * 0.02 + Math.sin(S.dist * 5.3) * 0.012;
  truck.position.y = bump * Math.min(1, Math.abs(S.speed) / 10) + S.offroad * Math.sin(S.dist * 9) * 0.06;
  truck.rotation.y = h0 + S.steer * 0.045;
  truck.rotation.z = -S.steer * 0.035 * grip;                    // body roll into the turn
  truck.rotation.x = grade * 0.5 + (S.braking ? 0.014 : 0) - S.throttle * 0.008;

  updateTruck(truck, dt, S.speed, S.steer, S.t, night > 0.5);
  setBrakeLights(truck, S.braking);
  const lampOn = Math.max(0, (night - 0.35) / 0.65);      // fade in around dusk
  for (const b of beams) b.intensity = lampOn * HEADLIGHT_CD;
  spill.intensity = lampOn * 38;

  // ---- exhaust smoke ---------------------------------------------------
  smokeTimer -= dt;
  if (smokeTimer <= 0 && Math.abs(S.speed) > 0.3) {
    smokeTimer = 0.055 + (1 - S.throttle) * 0.09;
    truck.localToWorld(tmpV.copy(truck.userData.stackTip));
    emitSmoke(tmpV, S.throttle > 0.7 && S.speed < 12);
  }
  for (const s of smoke) {
    if (s.userData.life <= 0) { s.material.opacity = 0; continue; }
    s.userData.life -= dt * 0.42;
    s.position.y += s.userData.vy * dt;
    s.position.x += s.userData.vx * dt;
    s.position.z -= S.speed * dt;
    const k = s.userData.life;
    s.scale.setScalar(0.5 + (1 - k) * s.userData.grow * 2.4);
    s.material.opacity = Math.max(0, k * (s.userData.puff ? 0.5 : 0.28));
    s.material.color.setScalar(s.userData.puff ? 0.28 : 0.62);
  }

  // ---- cow -------------------------------------------------------------
  cowState.hitCooldown = Math.max(0, cowState.hitCooldown - dt);
  if (cowState.active) {
    const rel = cowState.d - S.dist;
    const h = roadHeading(cowState.d);
    cow.position.set(
      roadCenterX(cowState.d) - roadCenterX(S.dist) + Math.cos(h) * cowState.lane,
      roadY(cowState.d) - roadY(S.dist),
      rel + Math.sin(h) * -cowState.lane
    );
    cow.rotation.y = h + Math.PI / 2 + Math.sin(S.t) * 0.15;
    if (rel < 3 && rel > -6 && Math.abs(cowState.lane - S.lane) < 2 && cowState.hitCooldown === 0) {
      cowState.hitCooldown = 3;
      cowState.active = false;
      cow.visible = false;
      S.speed *= 0.35;
      S.shake = 1.1;
      toast('अरे! गाय को बचाओ!', 'You clipped the cow — slow down!', false);
    }
    if (rel < -30) { cowState.active = false; cow.visible = false; }
  }

  // ---- refuel at a dhaba -----------------------------------------------
  // Refuel prompt. It used to nag about every dhaba in sight even on a full
  // tank, which read like a bug — now it only speaks up when there is actually
  // something to do: you're low, you're empty, or a break is due.
  const dh = world.nextDhaba();
  const lowFuel = S.fuel < 45;
  let hintText = '';
  if (dh !== null && dh < 26 && Math.abs(S.speed) * KMH < 22) {
    if (S.fuel < 99) {
      S.fuel = Math.min(100, S.fuel + dt * 45);
      hintText = `⛽ भर रहा है… ${Math.round(S.fuel)}%`;
      if (S.fuel >= 99.5) toast('टंकी फुल', 'Tank full — chalo!', true);
    } else {
      hintText = '☕ चाय पी लो — dhaba';
    }
  } else if (lowFuel && dh !== null && dh < 250) {
    hintText = `⛽ ढाबा ${Math.round(dh)}m — diesel ${Math.round(S.fuel)}%, rukna padega`;
  }
  if (S.fuel <= 0) hintText = '⛽ डीज़ल खत्म! Coast to a dhaba';
  if (BREAK.phase === 'pending' && dh !== null && dh < 140) {
    hintText = `🛑 ब्रेक टाइम — dhaba ${Math.round(dh)}m, dheere`;
  }
  if (hintText !== lastDhaba) { UI.dhaba.textContent = hintText; lastDhaba = hintText; }

  // ---- dhaba break -----------------------------------------------------
  updateBreak(dt);

  // ---- random events ---------------------------------------------------
  if (S.dist > nextEventAt) {
    nextEventAt = S.dist + 550 + Math.random() * 900;
    if (!cowState.active) EVENTS[(Math.random() * EVENTS.length) | 0]();
  }

  // ---- camera ----------------------------------------------------------
  const CAM = CAMS[S.cam];
  if (CAM.orbit) {
    syncOrbitToCam();
    // spherical offset around the truck, driven by the mouse
    const r = (CAM.orbitRadius ?? 26) * orbit.zoom;
    tmpV.set(
      Math.cos(orbit.pitch) * Math.sin(orbit.yaw) * r,
      Math.sin(orbit.pitch) * r,
      -Math.cos(orbit.pitch) * Math.cos(orbit.yaw) * r
    );
    truck.localToWorld(tmpV);
  } else {
    truck.localToWorld(tmpV.copy(CAM.pos));
  }
  // The cabin view is rigidly attached — smoothing it would make the whole
  // interior slide around the driver.
  camPos.lerp(tmpV, CAM.inside ? 1 : 1 - Math.pow(0.0016, dt));
  const shake = S.shake * 0.35 + (S.offroad * 0.06);
  camera.position.copy(camPos);
  camera.position.x += Math.sin(S.t * 31) * shake;
  camera.position.y += Math.cos(S.t * 27) * shake * 0.8;
  if (CAM.orbit) camera.lookAt(truck.position.x, truck.position.y + (CAM.aimY ?? 2), truck.position.z);
  else {
    truck.localToWorld(camLook.copy(CAM.look));
    camera.lookAt(camLook);
  }
  camera.rotation.z += S.steer * 0.012 + Math.sin(S.t * 19) * shake * 0.02;
  if (Math.abs(camera.fov - CAM.fov) > 0.1) {
    camera.fov = lerp(camera.fov, CAM.fov + Math.abs(S.speed) * 0.16, dt * 3);
    camera.updateProjectionMatrix();
  }

  // ---- audio -----------------------------------------------------------
  sfx.updateEngine(Math.abs(S.speed), S.throttle);

  // ---- hud -------------------------------------------------------------
  // Repainting the dial and rewriting DOM text 60×/sec costs more than it's
  // worth; 30 Hz is indistinguishable on a needle and halves the layout churn.
  hudClock -= dt;
  if (hudClock <= 0) {
    hudClock = 1 / 30;
    const sp = Math.abs(S.speed);
    const gear = S.reversing ? 'R' : S.handbrake ? 'P'
      : sp < 0.4 ? 'N' : sp < 5 ? '1' : sp < 10 ? '2'
      : sp < 16 ? '3' : sp < 23 ? '4' : '5';
    drawSpeedo(Math.abs(S.speed) * KMH, gear);

    // digital speed for phones, where the analog dial is hidden
    if (UI.mspeed) {
      const kmh = Math.round(Math.abs(S.speed) * KMH);
      if (kmh !== lastKmh) {
        UI.mspeed.textContent = S.reversing ? `R ${kmh}` : kmh;
        UI.mmood.textContent = moodFor(kmh).hi;
        lastKmh = kmh;
      }
    }
    const km = (S.dist / 1000).toFixed(1);
    if (km !== lastKm) { UI.km.textContent = km; lastKm = km; }
    UI.fuel.style.width = S.fuel + '%';
    const hrs = (world.timeOfDay * 24 + 6) % 24;
    const clock = `${String(hrs | 0).padStart(2, '0')}:${String(((hrs % 1) * 60) | 0).padStart(2, '0')}`;
    if (clock !== lastClock) { UI.clock.textContent = clock; lastClock = clock; }
  }
  updateSeekUI(dt);

  // The mirror only matters from the driver's seat; skip the extra pass elsewhere.
  if (CAM.inside) renderMirror();

  // bloom rises at night, when there's actually something to glow
  // Night bloom kept low: bright halos around every oncoming lamp were
  // washing out the road itself.
  bloom.strength = 0.16 + night * 0.26;

  if (QUALITY.bloom) composer.render();
  else renderer.render(scene, camera);

  // ---- adaptive quality -------------------------------------------------
  QUALITY.samples.push(dt);
  if (QUALITY.samples.length >= 90) {
    const avg = QUALITY.samples.reduce((a, b) => a + b, 0) / QUALITY.samples.length;
    QUALITY.samples.length = 0;
    const fps = 1 / avg;
    if (fps < 45 && QUALITY.checked === 0) {
      QUALITY.checked = 1;
      QUALITY.bloom = false;                       // glow is the first thing to go
      console.info(`[truck-sim] ${fps.toFixed(0)} fps — bloom disabled for smoothness`);
    } else if (fps < 40 && QUALITY.checked === 1) {
      QUALITY.checked = 2;
      QUALITY.scale = 0.75;                        // then render resolution
      resize();
      console.info(`[truck-sim] ${fps.toFixed(0)} fps — render scale 0.75`);
    }
  }
}

// ── autopilot ──────────────────────────────────────────────────────────────
// Keeps the left-hand lane (India drives on the left), eases off for curves,
// brakes for cows and slow traffic, and drifts out to overtake when it's clear.

let autoTargetLane = LANE;
let overtaking = 0;

function autopilot(dt) {
  const cruise = 19;                                   // ~68 km/h, a sane loaded-lorry speed
  const AUTO_MAX = 80 / 3.6;                           // autopilot never exceeds 80 km/h
  const curve = Math.abs(roadCenterX(S.dist + 70) - roadCenterX(S.dist) - (roadCenterX(S.dist + 35) - roadCenterX(S.dist)) * 2);
  let target = cruise - Math.min(9, curve * 1.6);

  // closest same-direction vehicle ahead in our lane
  let blocker = null;
  for (const v of world.traffic) {
    if (v.oncoming) continue;
    const rel = v.d - S.dist;
    if (rel > 2 && rel < 75 && Math.abs(v.lane - S.lane) < 2.6) {
      if (!blocker || rel < blocker.d - S.dist) blocker = v;
    }
  }
  if (blocker) {
    const rel = blocker.d - S.dist;
    // Only worth overtaking something meaningfully slower than we want to go.
    const worthIt = blocker.speed < cruise - 1.5;
    // Is the oncoming side clear? Judge by time-to-meet, not raw distance —
    // a lorry 150 m away closing slowly is a fine gap; one closing fast isn't.
    let clear = true;
    for (const v of world.traffic) {
      if (!v.oncoming) continue;
      const r = v.d - S.dist;
      if (r < -25) continue;
      const closing = Math.max(1, S.speed - v.speed);      // v.speed is negative
      if (r / closing < 5.5) { clear = false; break; }     // under 5.5 s: too tight
    }
    if (clear && worthIt && rel < 55 && S.speed > 7) {
      overtaking = 3.2;
    } else if (!overtaking) {
      target = Math.min(target, blocker.speed * 0.97);
      if (rel < 18) target = Math.min(target, blocker.speed * 0.75);
    }
  }

  overtaking = Math.max(0, overtaking - dt);
  autoTargetLane = overtaking > 0 ? -LANE * 0.85 : LANE;

  // cow: brake hard and honk
  if (cowState.active) {
    const rel = cowState.d - S.dist;
    if (rel > 0 && rel < 90 && Math.abs(cowState.lane - S.lane) < 2.4) {
      target = Math.min(target, 5);
      if (S.hornCooldown === 0 && rel < 70) doHorn();
    }
  }

  // dhaba stop — when low on diesel, or when a scheduled break is armed
  const dh = world.nextDhaba();
  if (S.fuel < 30 && dh !== null && dh < 60) target = Math.min(target, 4);
  if (BREAK.phase === 'pending' && dh !== null && dh < 110) {
    // ease down early so we're actually stopped at the dhaba, not past it
    target = Math.min(target, dh < 28 ? 0 : dh * 0.09);
  }
  if (S.fuel <= 0) target = 0;

  target = Math.min(target, AUTO_MAX);                 // hard ceiling, whatever else asked for
  const err = target - S.speed;
  const throttle = clamp(err * 0.4, 0, 1);
  const brake = err < -2.2 ? 1 : 0;
  // Steer harder when we're off the road, so recovery is decisive.
  const offRoad = Math.abs(S.lane) > LANE_LIMIT;
  const steer = clamp((autoTargetLane - S.lane) * (offRoad ? 1.1 : 0.55), -1, 1);
  return [throttle, steer, brake];
}

// ── boot ───────────────────────────────────────────────────────────────────

// Decode the horn samples at the first gesture of any kind. An AudioContext
// can't exist before one, and waiting only for the START button means ?nointro
// and touch users would get the synthesized fallback forever.
{
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    sfx.loadHorns().then((n) => console.info(`[truck-sim] ${n} horn samples ready`));
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      removeEventListener(ev, arm, true);
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    addEventListener(ev, arm, true);
  }
}

// Pay all first-bind texture uploads now, not mid-drive.
{
  const n = warmTruckTextures(renderer) + world.warmTextures();
  console.info(`[truck-sim] ${n} textures pre-uploaded`);
}

// ── mobile ────────────────────────────────────────────────────────────────
// Phone GPUs can't carry bloom + a 2048 shadow map + full-res rendering, and a
// stuttering truck is worse than a slightly plainer one. Detect once and trim.
const IS_MOBILE = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
if (IS_MOBILE) {
  QUALITY.bloom = false;
  QUALITY.scale = 0.8;
  world.sun.shadow.mapSize.set(1024, 1024);
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

// camera button (touch)
$('#tc-cam')?.addEventListener('click', (e) => {
  e.preventDefault();
  S.cam = (S.cam + 1) % CAMS.length;
  toast('कैमरा', CAMS[S.cam].name, true);
});
// Block the double-tap-to-zoom / pull-to-refresh gestures that otherwise make
// a full-screen canvas game unusable on a phone.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
addEventListener('orientationchange', () => setTimeout(() => resize(), 250));

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * QUALITY.scale);
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ── boot ───────────────────────────────────────────────────────────────────
// The world is already alive behind the start card: autopilot is on by default
// and the truck is driving down NH-44 before anyone clicks anything. START
// ENGINE only adds sound and hands over the option of steering.
S.auto = true;
$('#btn-auto').classList.add('on');
$('#t-mode').textContent = 'AUTOPILOT';
S.speed = 16;                                   // already rolling
running = true;
requestAnimationFrame(frame);

// URL switches — handy for jumping straight in, and for automated screenshots:
//   ?nointro   skip the start card (no audio; that still needs a click)
//   ?cam=0..4  pick a camera        ?tod=0..1  set time of day
//   ?dist=<m>  start further along the highway
{
  const q = new URLSearchParams(location.search);
  // reflect the real starting time mode in the HUD
  $('#t-timemode').textContent = TIME_MODES.find((m) => m.id === world.timeMode)?.label ?? 'INDIA TIME';
  if (q.has('nointro')) {
    $('#start').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    S.started = true;
  }
  if (q.has('cam')) S.cam = clamp(+q.get('cam') | 0, 0, CAMS.length - 1);
  // ?layout — dump on-screen control boxes, for checking the mobile layout
  if (q.has('layout')) {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.86);'
      + 'color:#8ef0bd;font:11px/1.35 monospace;padding:10px;overflow:auto;white-space:pre';
    const ids = ['tc-left','tc-right','tc-gas','tc-brake','tc-horn','tc-cam',
                 'btn-auto','btn-stop','btn-time','t-mspeed'];
    const W = innerWidth, H = innerHeight;
    let txt = `viewport ${W}x${H}  dpr ${devicePixelRatio}\n`
      + `matches(max-width:820px)=${matchMedia('(max-width:820px)').matches}\n\n`;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { txt += `${id.padEnd(10)} MISSING\n`; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const off = r.right > W + 0.5 || r.left < -0.5 || r.bottom > H + 0.5 || r.top < -0.5;
      txt += `${id.padEnd(10)} x${r.left.toFixed(0).padStart(4)}..${r.right.toFixed(0).padStart(4)}`
           + ` y${r.top.toFixed(0).padStart(4)}..${r.bottom.toFixed(0).padStart(4)}`
           + ` disp=${cs.display} ${off ? '  <<< OFF-SCREEN' : ''}\n`;
    }
    box.textContent = txt;
    setTimeout(() => document.body.appendChild(box), 600);
  }
  if (q.has('tod')) { world.timeOfDay = clamp(+q.get('tod'), 0, 1); world.timeMode = 'fixed'; }
  if (q.has('dist')) S.dist = Math.max(0, +q.get('dist') || 0);
}

// Debug/inspection hook — lets you poke at the sim from the console, and lets
// automated checks step it without waiting on requestAnimationFrame.
window.__sim = {
  S, BREAK, QUALITY, CAMS, orbit, world, truck, radio, sfx, presence,
  driver, multiplayer, billboards,
  renderer, mirrorRT, mirrorCam, get mirrorFrames(){ return mirrorFrames; },
  step(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { last = performance.now() - dt * 1000; frame(performance.now()); }
    return { dist: S.dist, speed: S.speed, lane: S.lane, fuel: S.fuel };
  },
};

$('#btn-start').addEventListener('click', async () => {
  const btn = $('#btn-start');
  btn.disabled = true;
  btn.innerHTML = 'STARTING…<small>engine garam ho raha hai</small>';

  // lock in the driver's name — typed, or the one we picked for them
  const typed = ($('#driver-name')?.value || '').trim().slice(0, 18);
  driver.name = typed || driver.name || randomDriverName();
  saveDriver();

  sfx.startEngine();          // both need the click gesture
  sfx.loadHorns().then((n) => console.info(`[truck-sim] ${n} horn samples ready`));
  await radio.init();
  radio.start();

  const start = $('#start');
  start.classList.add('going');
  setTimeout(() => start.classList.add('hidden'), 520);
  $('#hud').classList.remove('hidden');
  S.started = true;

  toast('चलो! सफ़र शुरू', 'NH-44 · Delhi → Amritsar', true);
  setTimeout(() => toast('ऑटोपायलट चालू है — P दबा के खुद चलाओ',
                         'Autopilot on — press P to drive yourself', true), 3600);
  setTimeout(() => toast('हॉर्न ओके प्लीज़', 'Hold H for the tune horn', true), 7200);
});

// pause the clock when the tab is hidden so you don't return to an empty tank
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { running = false; sfx.stopEngine(); }
  else { running = true; last = performance.now(); if (S.started) sfx.startEngine(); }
});
