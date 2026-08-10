// truck.js — builds the 3D lorry. Proportions follow a Tata LPT-style cabover:
// flat painted front, tall plank cargo body, twin rear axles, and the whole
// decorative kit (roof crown, marker lights, chain fringe, nimbu-mirchi, mudflaps).

import * as THREE from 'three';
import * as ART from './art.js';

const PAL = ART.PAL;

// Side/front/flap art is expensive and barely readable at traffic distance, so
// it's shared. The REAR panel is what you actually stare at for kilometres, so
// every truck gets its own — different owner, slogan and plate each time.
const REAR_POOL_SIZE = 10;

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const id = ART.randomTruckIdentity();
  SHARED = {
    heroId: id,
    heroFront: ART.cabFront({ name: id.owner, cutout: true }),
    heroCabSide: ART.cabSide(id),
    side: [ART.sidePanel({ transport: 'GOODS CARRIER' }), ART.sidePanel({})],
    trafficFront: [0, 1].map((i) => ART.cabFront({ name: ART.OWNERS[i], cutout: false })),
    trafficCabSide: [0, 1].map(() => ART.cabSide(ART.randomTruckIdentity())),
    flap: ART.mudflap('OK'),
    // Back panels are baked ONCE into a pool. Painting one is ~40 ms of canvas
    // work, so doing it while driving would drop a frame every time a lorry
    // recycled. Swapping a pooled texture is free.
    // Deal out DISTINCT slogans rather than sampling at random, or the
    // birthday problem puts the same line on two trucks in the same convoy.
    rearPool: ART.SLOGANS.slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, REAR_POOL_SIZE)
      .map((slogan) => {
        const rid = { ...ART.randomTruckIdentity(), slogan };
        return { id: rid, tex: ART.rearPanel(rid) };
      }),
  };
  return SHARED;
}

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.06, ...o });

// Real chrome on these trucks is polished hard and picks up the whole sky.
const chromeMat = () => new THREE.MeshStandardMaterial({
  color: PAL.chrome, roughness: 0.14, metalness: 1.0, envMapIntensity: 1.7,
});

// Enamel coach paint: fairly glossy, slightly reflective, over riveted panels.
let NORMAL = null;
const plankNormal = () => (NORMAL ||= ART.plankNormal());
const painted = (t, relief = true) => {
  const m = new THREE.MeshStandardMaterial({
    map: t, roughness: 0.42, metalness: 0.08, envMapIntensity: 0.75,
  });
  if (relief) {
    m.normalMap = plankNormal();
    m.normalScale = new THREE.Vector2(0.5, 0.5);
  }
  return m;
};

// One wheel: tyre + chrome hub + lug ring.
function buildWheel(r = 0.55, w = 0.34) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, w, 22),
    mat('#1a1a1c', { roughness: 0.95 })
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);

  for (const s of [-1, 1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.04, 18), chromeMat());
    hub.rotation.z = Math.PI / 2;
    hub.position.x = s * (w / 2 + 0.01);
    g.add(hub);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 12, 10), chromeMat());
    cap.position.x = s * (w / 2 + 0.05);
    g.add(cap);
  }
  return g;
}

// The hanging chain curtain under the rear bumper.
function buildChainFringe(width, y, z, count = 26) {
  const g = new THREE.Group();
  const linkMat = chromeMat();
  const geo = new THREE.CylinderGeometry(0.018, 0.018, 1, 5);
  for (let i = 0; i < count; i++) {
    const len = 0.22 + (i % 3) * 0.07 + Math.sin(i * 1.7) * 0.05;
    const m = new THREE.Mesh(geo, linkMat);
    m.scale.y = len;
    m.position.set(-width / 2 + (i / (count - 1)) * width, y - len / 2, z);
    m.userData.phase = i * 0.5;
    m.userData.len = len;
    g.add(m);
  }
  return g;
}

// Nimbu-mirchi: the lemon-and-seven-chillies charm strung on the front bumper.
function buildNimbuMirchi() {
  const g = new THREE.Group();
  const thread = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5),
    mat('#e8e0c8')
  );
  thread.position.y = -0.25;
  g.add(thread);
  const lemon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), mat('#c8d92a'));
  lemon.position.y = -0.5;
  g.add(lemon);
  for (let i = 0; i < 7; i++) {
    const chilli = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.2, 7), mat('#159a2e'));
    const a = (i / 7) * Math.PI * 2;
    chilli.position.set(Math.cos(a) * 0.075, -0.63, Math.sin(a) * 0.075);
    chilli.rotation.x = Math.PI;
    chilli.rotation.z = Math.cos(a) * 0.3;
    g.add(chilli);
  }
  return g;
}

/**
 * Everything you see from the driver's seat. The nimbu-mirchi strung across the
 * windscreen is the whole point — no North Indian truck runs without one hung
 * to catch the evil eye, and it's the first thing you notice from inside.
 */
function buildCabInterior(cabW, cabH, cabL, noseZ, deckY) {
  const g = new THREE.Group();
  const glassZ = noseZ - 0.06;

  // ── interior shell ───────────────────────────────────────────────────────
  // The cab's outer faces are painted on the OUTSIDE. Showing those same faces
  // to the driver renders every slogan back-to-front, so the cabin gets its own
  // inward-facing shell of plain trim: five panels plus the windscreen liner.
  const cy = deckY + cabH / 2 - 0.06;
  const trimSide = mat('#3a4048', { roughness: 0.9 });
  const trimDark = mat('#23272d', { roughness: 0.95 });
  const shell = [
    // [w, h, position, rotation] — each normal points inward
    [cabL, cabH, [-cabW / 2 + 0.02, cy, noseZ - cabL / 2], [0, Math.PI / 2, 0], trimSide],
    [cabL, cabH, [cabW / 2 - 0.02, cy, noseZ - cabL / 2], [0, -Math.PI / 2, 0], trimSide],
    [cabW, cabL, [0, cy + cabH / 2 - 0.02, noseZ - cabL / 2], [Math.PI / 2, 0, 0], trimDark],
    [cabW, cabL, [0, cy - cabH / 2 + 0.02, noseZ - cabL / 2], [-Math.PI / 2, 0, 0], trimDark],
    [cabW, cabH, [0, cy, noseZ - cabL + 0.02], [0, 0, 0], trimSide],
  ];
  for (const [w, h, p, r, m] of shell) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    panel.position.set(...p);
    panel.rotation.set(...r);
    g.add(panel);
  }

  // Windscreen liner — plain padded board with the same glass hole.
  const liner = new THREE.Mesh(
    new THREE.PlaneGeometry(cabW, cabH),
    new THREE.MeshStandardMaterial({
      map: ART.cabLiner(), alphaTest: 0.5, side: THREE.FrontSide, roughness: 0.85,
    })
  );
  liner.position.set(0, cy, glassZ - 0.02);
  liner.rotation.y = Math.PI;          // normal points back into the cabin
  g.add(liner);

  // Dashboard — kept low and well forward. Sitting it close to the eye point
  // turns the bottom half of the cabin view into a featureless slab.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.14, 0.30, 0.36), mat('#2b2b30'));
  dash.position.set(0, deckY + 0.70, glassZ - 0.30);
  g.add(dash);
  // dash cloth — always a bright printed one
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.18, 0.045, 0.38), mat('#d8342a'));
  cloth.position.set(0, deckY + 0.87, glassZ - 0.30);
  g.add(cloth);

  // Steering wheel — sits low and well forward of the eye point, otherwise it
  // fills the entire cabin view.
  const wheelPos = new THREE.Vector3(0.52, deckY + 0.98, glassZ - 0.52);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 8, 22), mat('#151518'));
  wheel.position.copy(wheelPos);
  wheel.rotation.x = -1.02;
  g.add(wheel);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.019, 0.019), mat('#20202a'));
    spoke.position.copy(wheelPos);
    spoke.rotation.set(-1.02, 0, (i / 3) * Math.PI * 2);
    g.add(spoke);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), mat('#1b1b20'));
  column.position.set(wheelPos.x, wheelPos.y - 0.16, wheelPos.z - 0.09);
  column.rotation.x = 0.55;
  g.add(column);
  g.userData.wheelMesh = wheel;

  // deity idol on the dash, lit by a tiny diya
  const idol = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 10), mat('#e8a020'));
  idol.position.set(-0.34, deckY + 1.18, glassZ - 0.42);
  g.add(idol);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#ffcf6a', emissive: '#ff9a20', emissiveIntensity: 1.4 })
  );
  halo.position.set(-0.34, deckY + 1.34, glassZ - 0.42);
  halo.userData.diya = true;
  g.add(halo);

  // The windscreen hole spans v 0.389–0.654 of the cab face (see art.cabFront),
  // so anchor everything that hangs to the real top edge of the glass —
  // otherwise the fringe and the charm sit above it, hidden behind the liner.
  const glassTop = deckY - 0.06 + cabH * 0.654;

  // pom-pom fringe along the top of the windscreen
  const pom = [];
  for (let i = 0; i < 16; i++) {
    const c = ['#ec4899', '#fbdb4a', '#13a892', '#d92121', '#6d28d9'][i % 5];
    const strand = new THREE.Group();
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 4), mat('#e8dcc0'));
    thread.position.y = -0.035;
    strand.add(thread);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mat(c, { roughness: 1 }));
    ball.position.y = -0.09;
    strand.add(ball);
    // pushed right up against the glass so they read small from the seat
    strand.position.set(-cabW / 2 + 0.18 + i * ((cabW - 0.36) / 15), glassTop - 0.01, glassZ - 0.03);
    strand.userData.phase = i * 0.6;
    pom.push(strand);
    g.add(strand);
  }

  // THE nimbu-mirchi: one lemon and seven green chillies on a thread, hung
  // dead-centre of the windscreen to take the evil eye.
  // A real nimbu-mirchi is strung bottom-up: a lemon, then chillies threaded
  // nose-down one after another, then another lemon, then a last chilli. The
  // lemon is waxy and slightly bumpy; the chillies are glossy, curved and each
  // a slightly different length and shade. Getting those details in is the
  // difference between "red cones" and something you recognise.
  const charm = new THREE.Group();
  const lemonMat = new THREE.MeshStandardMaterial({ color: '#c8d63a', roughness: 0.52, metalness: 0.02 });
  const chilliMat = () => new THREE.MeshStandardMaterial({
    color: ['#c81c14', '#b8160f', '#d42a1c', '#a81410'][(Math.random() * 4) | 0],
    roughness: 0.28, metalness: 0.05, envMapIntensity: 1.1,   // chillies are shiny
  });
  const stalkMat = new THREE.MeshStandardMaterial({ color: '#4c7a24', roughness: 0.8 });

  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.5, 5), mat('#efe6cc'));
  thread.position.y = -0.25;
  charm.add(thread);

  // top lemon
  const lemon1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), lemonMat);
  lemon1.position.y = -0.10;
  lemon1.scale.set(1, 1.22, 1);
  charm.add(lemon1);
  const nub = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.022, 6), lemonMat);
  nub.position.y = -0.045;
  charm.add(nub);

  // the chillies, hanging in a slightly splayed bunch
  for (let i = 0; i < 7; i++) {
    const len = 0.115 + Math.random() * 0.055;
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const rad = 0.022 + Math.random() * 0.022;
    const ch = new THREE.Group();
    // tapered, slightly curved body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.004, len, 8, 3), chilliMat());
    body.position.y = -len / 2;
    ch.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.02, 7), body.material);
    tip.position.y = -len - 0.008;
    ch.add(tip);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.028, 5), stalkMat);
    stalk.position.y = 0.013;
    ch.add(stalk);
    ch.position.set(Math.cos(a) * rad, -0.185, Math.sin(a) * rad);
    ch.rotation.z = -Math.cos(a) * 0.34;      // splay outward
    ch.rotation.x = Math.sin(a) * 0.34;
    charm.add(ch);
  }

  // second lemon at the bottom of the string
  const lemon2 = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), lemonMat);
  lemon2.position.y = -0.40;
  lemon2.scale.set(1, 1.22, 1);
  charm.add(lemon2);
  // hung just off-centre, the way it actually is so it doesn't block the view
  // Hung off to one side and scaled down — a real nimbu-mirchi is a small
  // thing, and at arm's length from the eye it otherwise fills the windscreen.
  charm.scale.setScalar(0.72);
  charm.position.set(-0.40, glassTop - 0.015, glassZ - 0.03);
  g.add(charm);

  // A bottle stowed on the dash shelf — capped and upright, wedged against the
  // windscreen the way everything in a lorry cab ends up.
  const bottle = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#4a2a12', roughness: 0.12, metalness: 0.0,
    transparent: true, opacity: 0.82, envMapIntensity: 1.4,
  });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 14), glassMat);
  barrel.position.y = 0.085;
  bottle.add(barrel);
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.036, 0.055, 14), glassMat);
  shoulder.position.y = 0.198;
  bottle.add(shoulder);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.05, 12), glassMat);
  neck.position.y = 0.25;
  bottle.add(neck);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.018, 12),
    mat('#d4a017', { metalness: 0.85, roughness: 0.3 }));
  cap.position.y = 0.283;
  bottle.add(cap);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0375, 0.075, 14),
    mat('#e8e2d0', { roughness: 0.85 }));
  label.position.y = 0.085;
  bottle.add(label);
  bottle.position.set(-0.66, deckY + 0.87, glassZ - 0.30);
  bottle.rotation.z = 0.06;
  g.add(bottle);

  // rear-view mirror with a marigold garland looped over it
  // Rear-view mirror. The glass is a live render of the road behind (see
  // main.js), so it shows what's actually back there — headlights closing on
  // you at night included.
  const mirrorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.30, 0.10, 0.022),
    mat('#1b1b20', { roughness: 0.6 })
  );
  mirrorFrame.position.set(0.30, glassTop - 0.055, glassZ - 0.055);
  mirrorFrame.rotation.y = 0.22;                      // angled at the driver
  g.add(mirrorFrame);

  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(0.275, 0.082),
    new THREE.MeshBasicMaterial({ color: '#9aa4ae' })  // replaced with a live feed
  );
  mirror.position.copy(mirrorFrame.position);
  mirror.rotation.y = mirrorFrame.rotation.y + Math.PI;  // faces the driver
  // Offset toward the DRIVER (−z), not the windscreen. Pushed the other way the
  // frame sits in front of the glass and the mirror reads as a black slab.
  mirror.position.z -= 0.016 * Math.cos(mirrorFrame.rotation.y);
  mirror.position.x -= 0.016 * Math.sin(mirrorFrame.rotation.y);
  g.add(mirror);
  g.userData.mirror = mirror;
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.017, 7, 6), mat(i % 2 ? '#f0a020' : '#f0d020'));
    const a = (i / 6) * Math.PI;
    f.position.set(0.5 + Math.cos(a) * 0.11, glassTop - 0.075 - Math.sin(a) * 0.05, glassZ - 0.04);
    g.add(f);
  }

  g.userData = { pom, charm, halo, wheelMesh: g.userData.wheelMesh, mirror: g.userData.mirror };
  return g;
}

// The driver — moustache, turban or gamcha, checked shirt, arm on the window.
/**
 * The driver — a North Indian truck-wala uncle, built properly.
 *
 * The details that actually make him read as one: a heavy moustache with turned-up
 * ends, a full beard, a paunch that clears the steering wheel, a gamcha slung over
 * one shoulder, a tilak on the forehead, rudraksh at the wrist, and a pagdi or
 * topi rather than a bare head. Faces are read from the eyebrows and the beard
 * line before anything else, so those get the most geometry.
 */
function buildDriver(o = {}) {
  const g = new THREE.Group();
  const pick = (a) => a[(Math.random() * a.length) | 0];

  const skinTone = pick(['#a9713f', '#96602f', '#b8804a', '#8a5527']);
  const skin = mat(skinTone, { roughness: 0.82 });
  const hairCol = pick(['#1a1008', '#241608', '#0e0904', '#3a2a1a']);
  const greying = Math.random() < 0.4;
  const beardCol = greying ? '#6b655d' : hairCol;   // moustache colour
  const hair = mat(hairCol, { roughness: 1 });
  const beardMat = mat(beardCol, { roughness: 1 });

  const headwear = pick(['pagdi', 'pagdi', 'topi', 'gamcha']);
  const clothCol = pick(['#e23b2e', '#f0a020', '#1e6fd9', '#e8e4d8', '#1f8a4a']);

  // ── body: shirt, paunch, collar ──────────────────────────────────────────
  const shirtCol = pick(['#2e6ea8', '#7a8f3a', '#b8532e', '#e8e2d0', '#4a4f8a']);
  const shirt = mat(shirtCol, { roughness: 0.95 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.6, 0.34), shirt);
  torso.position.y = 0.32;
  g.add(torso);

  // the uncle paunch — sits proud of the shirt front
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), shirt);
  belly.position.set(0, 0.22, 0.12);
  belly.scale.set(1.05, 0.82, 0.72);
  g.add(belly);

  // open collar + a vest showing at the neck
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), shirt);
  collar.position.y = 0.6;
  g.add(collar);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.26), mat('#e8e4dc'));
  vest.position.set(0, 0.57, 0.06);
  g.add(vest);

  // gold chain against the vest
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 6, 16),
    mat('#d8a828', { metalness: 0.9, roughness: 0.25 }));
  chain.position.set(0, 0.55, 0.14);
  chain.rotation.x = 1.35;
  g.add(chain);

  // gamcha slung over the shoulder
  const gamcha = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.52, 0.36), mat('#e04a3a', { roughness: 1 }));
  gamcha.position.set(-0.21, 0.36, 0.02);
  gamcha.rotation.z = 0.06;
  g.add(gamcha);

  // ── head ─────────────────────────────────────────────────────────────────
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.152, 18, 16), skin);
  head.position.y = 0.78;
  head.scale.set(1, 1.06, 0.98);
  g.add(head);

  // jaw, squared off so the beard has something to sit on
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.108, 14, 12), skin);
  jaw.position.set(0, 0.708, 0.042);
  jaw.scale.set(1.02, 0.82, 1.0);
  g.add(jaw);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.085, 8), skin);
  nose.position.set(0, 0.775, 0.15);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);

  // ── ears: helix rim, inner bowl, lobe ────────────────────────────────────
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), skin);
    ear.position.set(sx * 0.148, 0.782, 0.008);
    ear.scale.set(0.42, 1.05, 0.8);
    g.add(ear);
    const helix = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.008, 6, 14), skin);
    helix.position.set(sx * 0.156, 0.786, 0.008);
    helix.rotation.y = Math.PI / 2;
    g.add(helix);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), mat('#7a4e26', { roughness: 0.9 }));
    bowl.position.set(sx * 0.152, 0.78, 0.014);
    bowl.scale.set(0.5, 1, 0.8);
    g.add(bowl);
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), skin);
    lobe.position.set(sx * 0.15, 0.742, 0.006);
    lobe.scale.set(0.5, 1, 0.85);
    g.add(lobe);

    // ── eyes: white, brown iris, pupil, glint, heavy lid and eye-bag ───────
    const ex = sx * 0.058, ey = 0.812, ez = 0.128;
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), mat('#e8e4dc', { roughness: 0.35 }));
    white.position.set(ex, ey, ez);
    white.scale.set(1, 0.72, 0.62);
    g.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 10, 8), mat('#4a2c14', { roughness: 0.3 }));
    iris.position.set(ex, ey, ez + 0.016);
    iris.scale.z = 0.5;
    g.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 8, 8), mat('#0a0705'));
    pupil.position.set(ex, ey, ez + 0.021);
    pupil.scale.z = 0.5;
    g.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 6, 6), mat('#ffffff', { roughness: 0.1 }));
    glint.position.set(ex - sx * 0.005, ey + 0.006, ez + 0.023);
    g.add(glint);
    // upper lid — heavy, the way a tired uncle's sits
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8, 0, 7, 0, Math.PI * 0.5), skin);
    lid.position.set(ex, ey + 0.005, ez - 0.002);
    lid.scale.set(1, 0.5, 0.66);
    lid.rotation.x = -0.28;
    g.add(lid);
    // bag under the eye
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), mat('#8f5c2a', { roughness: 0.95 }));
    bag.position.set(ex, ey - 0.024, ez - 0.004);
    bag.scale.set(1, 0.34, 0.5);
    g.add(bag);
    // thick brow, angled inward
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.022, 0.032), hair);
    brow.position.set(ex, 0.845, 0.132);
    brow.rotation.z = sx * 0.16;
    g.add(brow);
    const browIn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.019, 0.03), hair);
    browIn.position.set(sx * 0.026, 0.841, 0.136);
    browIn.rotation.z = sx * 0.4;
    g.add(browIn);
  }

  // ── nose: bridge, tip, nostrils ──────────────────────────────────────────
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.075, 0.05), skin);
  bridge.position.set(0, 0.8, 0.136);
  bridge.rotation.x = -0.16;
  g.add(bridge);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 10), skin);
  tip.position.set(0, 0.766, 0.158);
  tip.scale.set(1.05, 0.85, 1);
  g.add(tip);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), skin);
    wing.position.set(sx * 0.024, 0.762, 0.146);
    wing.scale.set(0.8, 0.8, 0.9);
    g.add(wing);
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), mat('#3a2412'));
    nostril.position.set(sx * 0.015, 0.752, 0.158);
    g.add(nostril);
  }

  // ── mouth: lips, and a gutkha-stained lower lip ──────────────────────────
  // Lips are rounded and sit forward of the beard line. Boxes here read as two
  // painted bars across the face.
  const lipU = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mat('#6e3324', { roughness: 0.75 }));
  lipU.position.set(0, 0.7185, 0.152);
  lipU.scale.set(1.15, 0.3, 0.42);
  g.add(lipU);
  const lipL = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mat('#7d3c2b', { roughness: 0.75 }));
  lipL.position.set(0, 0.7045, 0.152);
  lipL.scale.set(1.05, 0.38, 0.44);
  g.add(lipL);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat('#33110d'));
  mouth.position.set(0, 0.7115, 0.148);
  mouth.scale.set(1.1, 0.16, 0.3);
  g.add(mouth);

  // ── THE moustache ────────────────────────────────────────────────────────
  // The one feature that makes him read as a truck-wala uncle. Built in three
  // parts for volume — a thick body under the nose, a pad each side, and waxed
  // tips turned up at the ends. It must sit PROUD of the lips (z 0.152) and
  // just below the nose, or it vanishes inside the head.
  const stacheBody = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 12), beardMat);
  stacheBody.position.set(0, 0.7385, 0.156);
  stacheBody.scale.set(1.6, 0.5, 0.62);
  g.add(stacheBody);
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), beardMat);
    pad.position.set(sx * 0.058, 0.7355, 0.15);
    pad.scale.set(1.2, 0.58, 0.66);
    g.add(pad);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.004, 0.078, 8), beardMat);
    wax.position.set(sx * 0.106, 0.7495, 0.142);
    wax.rotation.z = sx * -1.0;
    wax.rotation.x = -0.25;
    g.add(wax);
  }

  // cheeks, so the face isn't a sphere
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 10), skin);
    cheek.position.set(sx * 0.088, 0.766, 0.098);
    cheek.scale.set(0.85, 0.78, 0.6);
    g.add(cheek);
  }

  // forehead creases — a lifetime of squinting at the road
  for (let i = 0; i < 2; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.0035, 0.006), mat('#8a5f34', { roughness: 1 }));
    line.position.set(0, 0.868 + i * 0.02, 0.138);
    g.add(line);
  }

  // neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.1, 12), skin);
  neck.position.set(0, 0.638, 0.02);
  g.add(neck);

  // Clean-shaven but for the moustache — the beard read as a mask over the
  // whole lower face, and the moustache is what carries the character anyway.
  // A little stubble shadow along the jaw keeps it from looking plastic.
  const stubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 18, 16, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4),
    mat(greying ? '#7d6a58' : '#6a4e33', { roughness: 1 })
  );
  stubble.position.set(0, 0.778, -0.002);
  stubble.scale.set(1.0, 0.98, 0.88);
  g.add(stubble);

  // tilak on the forehead
  const tilak = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.012), mat('#c8342a'));
  tilak.position.set(0, 0.872, 0.128);
  g.add(tilak);

  // ── headwear ─────────────────────────────────────────────────────────────
  if (headwear === 'pagdi') {
    // wrapped turban: stacked bands, each rotated a little
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.128 - i * 0.013, 0.03, 8, 20),
        mat(clothCol, { roughness: 1 })
      );
      band.position.y = 0.872 + i * 0.031;
      band.rotation.x = Math.PI / 2;
      band.rotation.z = i * 0.35;
      g.add(band);
    }
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), mat(clothCol, { roughness: 1 }));
    crown.position.y = 0.972;
    crown.scale.y = 0.62;
    g.add(crown);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04), mat(clothCol, { roughness: 1 }));
    tail.position.set(-0.12, 0.9, -0.09);
    tail.rotation.z = 0.4;
    g.add(tail);
  } else if (headwear === 'topi') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.14, 0.085, 16), mat(clothCol, { roughness: 1 }));
    cap.position.y = 0.905;
    g.add(cap);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.128, 16), mat(clothCol, { roughness: 1 }));
    top.position.y = 0.948;
    top.rotation.x = -Math.PI / 2;
    g.add(top);
  } else {
    // gamcha tied round the head
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.038, 8, 18), mat('#e8e4d8', { roughness: 1 }));
    wrap.position.y = 0.872;
    wrap.rotation.x = Math.PI / 2;
    g.add(wrap);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), mat('#e8e4d8', { roughness: 1 }));
    knot.position.set(0.1, 0.885, -0.1);
    g.add(knot);
    // thinning hair on top
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, 7, 0, Math.PI * 0.45), hair);
    top.position.y = 0.79;
    g.add(top);
  }

  // ── right arm out of the window, with rudraksh and a ring ────────────────
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.3, 4, 8), skin);
  arm.position.set(0.3, 0.42, 0.06);
  arm.rotation.z = -0.85;
  g.add(arm);
  // rolled-up sleeve
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.11, 10), shirt);
  sleeve.position.set(0.19, 0.53, 0.05);
  sleeve.rotation.z = -0.85;
  g.add(sleeve);
  const thread = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 6, 14),
    mat('#8a2a18', { roughness: 0.9 }));
  thread.position.set(0.42, 0.29, 0.07);
  thread.rotation.y = Math.PI / 2;
  thread.rotation.x = -0.85;
  g.add(thread);

  // left hand resting on the wheel
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), skin);
  armL.position.set(-0.24, 0.44, 0.16);
  armL.rotation.set(-0.55, 0, 0.5);
  g.add(armL);

  g.userData.head = head;
  g.userData.stubble = stubble;
  g.userData.mouth = mouth;
  return g;
}

/**
 * Build a complete truck.
 * @param {object} o  { hero:boolean, variant:number }
 */
export function buildTruck(o = {}) {
  const S = shared();
  const v = (o.variant | 0);
  // Hero gets a dedicated panel; traffic draws from the pre-baked pool so every
  // lorry on the road still reads differently, at no runtime cost.
  const slot = o.hero ? null : S.rearPool[v % S.rearPool.length];
  const identity = o.hero ? S.heroId : slot.id;
  const skin = {
    id: identity,
    rear: o.hero ? ART.rearPanel(identity) : slot.tex,
    side: S.side[o.hero ? 0 : v % S.side.length],
    front: o.hero ? S.heroFront : S.trafficFront[v % S.trafficFront.length],
    cabSide: o.hero ? S.heroCabSide : S.trafficCabSide[v % S.trafficCabSide.length],
    flap: S.flap,
  };
  const truck = new THREE.Group();

  // Real convoys are not identical trucks. Vary the body so a 10-tyre short
  // hauler and a long 16-tyre goods carrier read as different lorries, and
  // give each one its own tarp and cab paint.
  const R = (a, b) => a + Math.random() * (b - a);
  const spec = o.hero
    ? { bodyH: 2.55, bodyL: 6.4, tarp: '#1d4ed8', cabTop: PAL.red }
    : {
        bodyH: R(2.15, 2.95),
        bodyL: R(5.2, 7.4),
        tarp: ['#1d4ed8', '#0f766e', '#7c2d12', '#4338ca', '#166534', '#9a3412'][(Math.random() * 6) | 0],
        cabTop: [PAL.red, PAL.saffron, PAL.blue, PAL.green, PAL.magenta][(Math.random() * 5) | 0],
      };

  const bodyW = 2.5, bodyH = spec.bodyH, bodyL = spec.bodyL;   // cargo box
  const cabW = 2.42, cabH = 2.34, cabL = 2.25;    // cab
  const deckY = 1.32;                              // top of chassis rails
  const noseZ = 4.55;                              // front-most point

  // ── chassis rails ─────────────────────────────────────────────────────────
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, bodyL + 2.6), mat('#2c2f33', { metalness: 0.5 }));
  chassis.position.set(0, 1.06, 0);
  chassis.castShadow = true;
  truck.add(chassis);

  // ── cargo body ────────────────────────────────────────────────────────────
  // BoxGeometry already orients the +X and -X faces so a texture reads the
  // right way round from outside on BOTH flanks. Mirroring one of them (which
  // an earlier version did) is what made the lettering come out backwards.
  const sideMat = painted(skin.side);
  const bodyMats = [
    sideMat,                                            // +X right flank
    sideMat,                                            // -X left flank
    mat('#1f6f63'),                                     // +Y open top
    mat('#22262b'),                                     // -Y underside
    mat('#c2410c'),                                     // +Z headboard (faces cab)
    painted(skin.rear),                                 // -Z THE back panel
  ];

  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyL), bodyMats);
  body.position.set(0, deckY + bodyH / 2, -1.35);
  body.castShadow = true; body.receiveShadow = true;
  truck.add(body);

  // ── chrome trim: corner posts, rub rails and a capping strip ─────────────
  // Real bodies are timber planks bound by metal strapping — the trim is what
  // breaks up the big flat faces and gives the light something to catch.
  const trim = chromeMat();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, bodyH, 0.09), trim);
      post.position.set(sx * (bodyW / 2 + 0.02), deckY + bodyH / 2, -1.35 + sz * (bodyL / 2 - 0.05));
      truck.add(post);
    }
    // rub rail down each flank
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, bodyL - 0.1), trim);
    rail.position.set(sx * (bodyW / 2 + 0.02), deckY + bodyH * 0.36, -1.35);
    truck.add(rail);
  }
  // capping strip along the top edge of the rear panel
  const cap = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.06, 0.09, 0.09), trim);
  cap.position.set(0, deckY + bodyH, -1.35 - bodyL / 2);
  truck.add(cap);

  // tarpaulin bundle lashed on top
  const tarp = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.92, 0.55, bodyL * 0.82),
    mat(spec.tarp, { roughness: 0.95 })
  );
  tarp.position.set(0, deckY + bodyH + 0.26, -1.35);
  tarp.castShadow = true;
  truck.add(tarp);
  for (let i = 0; i < 5; i++) { // lashing ropes
    const rope = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 5, 16, Math.PI), mat('#e8dcc0'));
    rope.rotation.y = Math.PI / 2;
    rope.scale.set(1, 0.95, 2.1);
    rope.position.set(0, deckY + bodyH + 0.24, -1.35 - bodyL * 0.34 + i * (bodyL * 0.17));
    truck.add(rope);
  }

  // ── cab ───────────────────────────────────────────────────────────────────
  const cabSideMat = painted(skin.cabSide);
  // Front face is double-sided and transparent where the windscreen was punched
  // out, so the cockpit camera looks through real glass at the real road.
  const frontMat = painted(skin.front, false);
  frontMat.alphaTest = 0.5;      // hard cutout, so no transparency sorting

  const cab = new THREE.Mesh(new THREE.BoxGeometry(cabW, cabH, cabL), [
    cabSideMat.clone(), cabSideMat.clone(),
    mat(spec.cabTop),                                   // roof
    mat('#22262b'),                                     // floor
    frontMat,                                           // +Z painted face + glass
    mat('#8a1c1c'),                                     // back of cab
  ]);
  // Traffic trucks have no interior shell, so their cab must be closed off or
  // you'd see through the (unpunched) front. The hero's interior does that job.
  if (!o.hero) for (const m of cab.material) m.side = THREE.DoubleSide;
  cab.position.set(0, deckY + cabH / 2 - 0.06, noseZ - cabL / 2);
  cab.castShadow = true;
  truck.add(cab);

  // ── roof crown / visor — the scalloped decorative canopy ──────────────────
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(cabW + 0.16, 0.42, 0.5),
    [mat(PAL.saffron), mat(PAL.saffron), mat(PAL.red), mat(PAL.red), painted(ART.hoarding(), false), mat(PAL.red)]
  );
  crown.position.set(0, deckY + cabH + 0.14, noseZ - 0.2);
  crown.castShadow = true;
  truck.add(crown);

  // scalloped fringe hanging off the crown
  for (let i = 0; i < 13; i++) {
    const sc = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 10, 0, Math.PI),
      new THREE.MeshStandardMaterial({
        color: [PAL.yellow, PAL.pink, PAL.seaGreen][i % 3],
        side: THREE.DoubleSide, roughness: 0.6,
      })
    );
    sc.rotation.z = Math.PI;
    sc.position.set(-cabW / 2 + 0.09 + i * (cabW / 12), deckY + cabH - 0.08, noseZ + 0.045);
    truck.add(sc);
  }

  // ── marker lights across the crown ────────────────────────────────────────
  const markers = [];
  for (let i = 0; i < 9; i++) {
    const c = [PAL.red, PAL.yellow, PAL.seaGreen, PAL.skyBlue][i % 4];
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 10, 8),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.09, roughness: 0.35 })
    );
    m.position.set(-cabW / 2 + 0.14 + i * ((cabW - 0.28) / 8), deckY + cabH + 0.38, noseZ - 0.22);
    m.userData.phase = i * 0.7;
    markers.push(m);
    truck.add(m);
  }

  // ── bumpers ───────────────────────────────────────────────────────────────
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.42, 0.26), chromeMat());
  frontBumper.position.set(0, 0.86, noseZ + 0.1);
  frontBumper.castShadow = true;
  truck.add(frontBumper);

  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.22), chromeMat());
  rearBumper.position.set(0, 0.82, -4.6);
  truck.add(rearBumper);

  const fringe = buildChainFringe(2.4, 0.68, -4.62, 26);
  truck.add(fringe);

  const charm = buildNimbuMirchi();
  charm.position.set(0.85, 0.84, noseZ + 0.18);
  truck.add(charm);

  // ── headlamps & tail lamps ────────────────────────────────────────────────
  const lampGlass = new THREE.MeshStandardMaterial({
    color: '#f0e8cc', emissive: '#fff0b8', emissiveIntensity: 0.07, roughness: 0.2,
  });
  const headlamps = [];
  for (const sx of [-0.86, 0.86]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 18), lampGlass);
    h.rotation.x = Math.PI / 2;
    h.position.set(sx, 1.44, noseZ + 0.03);
    headlamps.push(h);
    truck.add(h);
  }
  const tailMat = new THREE.MeshStandardMaterial({
    color: '#7c0e0e', emissive: '#ff2a1a', emissiveIntensity: 0.10, roughness: 0.35,
  });
  const taillamps = [];
  for (const sx of [-1.02, 1.02]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.08), tailMat.clone());
    t.position.set(sx, 1.0, -4.68);
    taillamps.push(t);
    truck.add(t);
  }

  // ── exhaust stack ─────────────────────────────────────────────────────────
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 12), chromeMat());
  stack.position.set(-1.22, 2.0, 1.9);
  stack.castShadow = true;
  truck.add(stack);
  const rainCap = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.12, 12), chromeMat());
  rainCap.position.set(-1.22, 3.36, 1.9);
  truck.add(rainCap);

  // ── the kit that makes it unmistakably an Indian lorry ───────────────────

  // Air-horn trumpets on the cab roof. The single most recognisable fitting on
  // a North Indian truck, and the reason it can play a tune at all.
  const hornBank = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const len = 0.5 - i * 0.07;
    const trumpet = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, len, 12), chromeMat());
    body.rotation.z = Math.PI / 2;
    trumpet.add(body);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.16, 14, 1, true), chromeMat());
    bell.rotation.z = -Math.PI / 2;
    bell.position.x = len / 2 + 0.07;
    bell.material.side = THREE.DoubleSide;
    trumpet.add(bell);
    trumpet.position.set(-0.28 + i * 0.005, 0.06 + i * 0.001, -0.11 + i * 0.075);
    hornBank.add(trumpet);
  }
  hornBank.position.set(0.1, deckY + cabH + 0.42, noseZ - 0.85);
  hornBank.rotation.y = Math.PI;                 // bells face forward
  truck.add(hornBank);

  // Long-arm wing mirrors, held out on brackets so the driver can see past the
  // body — always oversized on these trucks.
  for (const sx of [-1, 1]) {
    const armH = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6), chromeMat());
    armH.rotation.z = Math.PI / 2;
    armH.position.set(sx * (cabW / 2 + 0.21), deckY + cabH - 0.42, noseZ - 0.22);
    truck.add(armH);
    const armV = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), chromeMat());
    armV.position.set(sx * (cabW / 2 + 0.4), deckY + cabH - 0.62, noseZ - 0.22);
    truck.add(armV);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.42, 0.24),
      new THREE.MeshStandardMaterial({ color: '#8a929c', metalness: 0.95, roughness: 0.18 })
    );
    glass.position.set(sx * (cabW / 2 + 0.4), deckY + cabH - 0.82, noseZ - 0.22);
    glass.castShadow = true;
    truck.add(glass);
  }

  // Spare tyre slung under the bed, jerry can and toolbox on the chassis rail.
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 18), mat('#1a1a1c', { roughness: 0.95 }));
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, 0.75, -1.35 + bodyL / 2 - 1.1);
  truck.add(spare);

  const diesel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 14), chromeMat());
  diesel.rotation.z = Math.PI / 2;
  diesel.rotation.y = Math.PI / 2;
  diesel.position.set(1.15, 0.85, 1.0);
  truck.add(diesel);

  const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.7), mat('#3a4048', { metalness: 0.4 }));
  toolbox.position.set(-1.15, 0.9, 0.6);
  truck.add(toolbox);

  const jerry = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.32), mat('#4a6a2a'));
  jerry.position.set(-1.2, 1.12, -0.4);
  truck.add(jerry);

  // The chappal hung off the bumper to take the evil eye — as real as the
  // nimbu-mirchi, and every bit as common.
  const chappal = new THREE.Group();
  const strapT = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), mat('#e8dcc0'));
  strapT.position.y = -0.15;
  chappal.add(strapT);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.045), mat('#5b3a22', { roughness: 1 }));
  sole.position.y = -0.42;
  chappal.add(sole);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10, Math.PI), mat('#2a1a10'));
  strap.position.set(0, -0.35, 0.03);
  chappal.add(strap);
  chappal.position.set(-0.85, 0.84, noseZ + 0.18);
  truck.add(chappal);

  // Retroreflective tape — red/white on the rear, mandated on Indian lorries
  // and instantly recognisable in headlights.
  const tapeMat = (c) => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.35, metalness: 0.1, emissive: c, emissiveIntensity: 0.08,
  });
  for (let i = 0; i < 10; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(bodyW / 10, 0.09, 0.03),
      tapeMat(i % 2 ? '#e8e4dc' : '#c81c14'));
    seg.position.set(-bodyW / 2 + bodyW / 20 + i * (bodyW / 10), deckY + 0.12, -1.35 - bodyL / 2 - 0.02);
    truck.add(seg);
  }
  // amber tape down each flank
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, bodyL / 9),
        tapeMat(i % 2 ? '#e8a020' : '#e8e4dc'));
      seg.position.set(sx * (bodyW / 2 + 0.03), deckY + 0.1,
        -1.35 - bodyL / 2 + bodyL / 18 + i * (bodyL / 8.5));
      truck.add(seg);
    }
  }

  // Mudguards over the rear bogie
  for (const sx of [-1, 1]) {
    for (const gz of [-2.1, -3.25]) {
      const guard = new THREE.Mesh(
        new THREE.CylinderGeometry(0.78, 0.78, 0.92, 14, 1, true, 0, Math.PI),
        mat('#22262b', { roughness: 0.85, side: THREE.DoubleSide })
      );
      guard.rotation.z = Math.PI / 2;
      guard.position.set(sx * 1.2, 0.62, gz);
      truck.add(guard);
    }
  }

  // Front indicator lamps and a plate on the bumper
  for (const sx of [-1.16, 1.16]) {
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.07),
      new THREE.MeshStandardMaterial({ color: '#c87a10', emissive: '#e8901a', emissiveIntensity: 0.12 }));
    ind.position.set(sx, 1.12, noseZ + 0.02);
    truck.add(ind);
  }
  const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.2, 0.03), mat('#f0ece0'));
  frontPlate.position.set(0, 0.86, noseZ + 0.2);
  truck.add(frontPlate);

  // Rope hooks along the body rail — how the tarp actually gets lashed down
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 5, 10), chromeMat());
      hook.position.set(sx * (bodyW / 2 + 0.02), deckY + 0.3,
        -1.35 - bodyL / 2 + 0.4 + i * ((bodyL - 0.8) / 6));
      hook.rotation.y = Math.PI / 2;
      truck.add(hook);
    }
  }

  // Cab step below the door
  for (const sx of [-1, 1]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.5), chromeMat());
    step.position.set(sx * (cabW / 2 + 0.04), 0.72, noseZ - cabL * 0.55);
    truck.add(step);
  }

  // rear ladder up to the load bed
  for (const sx of [-0.25, 0.25]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.3, 6), chromeMat());
    rail.position.set(sx, 1.35, -1.35 - bodyL / 2 - 0.12);
    truck.add(rail);
  }
  for (let i = 0; i < 4; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 6), chromeMat());
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0, 0.85 + i * 0.32, -1.35 - bodyL / 2 - 0.12);
    truck.add(rung);
  }

  // ── wheels: single front axle, twin rear axles (dual tyres) ───────────────
  const wheels = [];
  const addWheel = (x, z, r = 0.55) => {
    const w = buildWheel(r);
    w.position.set(x, r, z);
    wheels.push(w);
    truck.add(w);
    return w;
  };
  const steerWheels = [addWheel(-1.12, 3.2), addWheel(1.12, 3.2)];
  for (const z of [-2.1, -3.25]) {
    for (const x of [-1.02, -1.38, 1.02, 1.38]) addWheel(x, z);
  }

  // mudflaps behind the rear bogie
  const flapMat = new THREE.MeshStandardMaterial({ map: skin.flap, side: THREE.DoubleSide, roughness: 0.95 });
  for (const sx of [-1.2, 1.2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.6), flapMat);
    f.position.set(sx, 0.34, -3.86);
    // Turn to face astern — a mudflap is only ever read from behind, and left
    // facing forward its "OK / TATA" comes out back-to-front.
    f.rotation.y = Math.PI;
    truck.add(f);
  }

  // ── driver (+ khalasi riding shotgun) ─────────────────────────────────────
  const driver = buildDriver();
  driver.position.set(0.62, deckY + 0.34, noseZ - cabL * 0.62);
  driver.rotation.y = Math.PI;
  truck.add(driver);
  if (o.hero) {
    const khalasi = buildDriver();
    khalasi.scale.setScalar(0.92);
    khalasi.position.set(-0.66, deckY + 0.3, noseZ - cabL * 0.62);
    khalasi.rotation.y = Math.PI;
    truck.add(khalasi);
  }

  // Cab interior only for the hero truck — traffic trucks never get looked into.
  let interior = null;
  if (o.hero) {
    interior = buildCabInterior(cabW, cabH, cabL, noseZ, deckY);
    truck.add(interior);
  }

  truck.userData = {
    wheels, steerWheels, markers, headlamps, taillamps, fringe, charm, driver,
    identity: skin.id, stack, interior, body,
    stackTip: new THREE.Vector3(-1.22, 3.3, 1.9),
  };
  return truck;
}

/**
 * Repaint a truck's back panel with a brand new owner, slogan and plate.
 * Called when a traffic truck recycles, so the lorry that just overtook you
 * is never the one you read three kilometres ago.
 */
export function refreshRearPanel(truck, inUse) {
  const body = truck.userData?.body;
  if (!body || !SHARED) return;
  const pool = SHARED.rearPool;
  // Skip panels another lorry on screen is already wearing, so you never see
  // the same slogan twice in one convoy.
  const start = (Math.random() * pool.length) | 0;
  let slot = pool[start];
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(start + i) % pool.length];
    if (!inUse || !inUse.has(cand.tex)) { slot = cand; break; }
  }
  const m = body.material[5];
  if (m.map === slot.tex) return;          // already wearing this one
  // Swapping one map for another needs no `needsUpdate`: the shader defines are
  // unchanged, and setting it forces a costly program recompile mid-drive.
  m.map = slot.tex;                        // pooled — never disposed
  truck.userData.identity = slot.id;
}

/** Per-frame animation: wheel spin, steering, swinging chains, blinking lights. */
export function updateTruck(truck, dt, speed, steerAngle, t, night) {
  const u = truck.userData;
  const spin = (speed / 0.55) * dt;
  for (const w of u.wheels) w.children[0].rotation.x -= spin;
  for (const w of u.steerWheels) w.rotation.y = steerAngle * 0.55;

  // chains and charm swing with speed + a little road chatter
  const sway = Math.sin(t * 4.2) * Math.min(0.5, speed / 26);
  for (const link of u.fringe.children) {
    link.rotation.x = sway * 0.9 + Math.sin(t * 6 + link.userData.phase) * 0.06;
  }
  u.charm.rotation.z = sway * 0.7;
  u.charm.rotation.x = Math.sin(t * 3.1) * 0.12;

  // marker lights chase at night, dim by day
  for (const m of u.markers) {
    const on = night ? 0.30 + Math.sin(t * 3 + m.userData.phase) * 0.22 : 0.10;
    m.material.emissiveIntensity = on;
  }
  for (const h of u.headlamps) h.material.emissiveIntensity = night ? 0.75 : 0.10;

  // driver bobs over the road surface
  u.driver.position.y = 1.66 + Math.sin(t * 9) * 0.012 * Math.min(1, speed / 12);

  // interior: everything hanging swings against acceleration and road chatter
  if (u.interior) {
    const iu = u.interior.userData;
    const swing = sway * 1.4;
    iu.charm.rotation.z = swing;
    iu.charm.rotation.x = Math.sin(t * 3.4) * 0.16 + Math.min(0.3, speed / 60);
    for (const p of iu.pom) {
      p.rotation.z = swing * 0.8 + Math.sin(t * 5 + p.userData.phase) * 0.12;
    }
    iu.halo.material.emissiveIntensity = 1.1 + Math.sin(t * 7) * 0.35;   // flickering diya
    if (iu.wheelMesh) iu.wheelMesh.rotation.z = -steerAngle * 1.9;       // driver turns the wheel
  }
}

export function setBrakeLights(truck, on) {
  for (const t of truck.userData.taillamps) t.material.emissiveIntensity = on ? 1.1 : 0.16;
}


/**
 * Upload every pooled texture to the GPU before the drive starts.
 * The first time a texture is bound, three.js uploads it — a 1024×768 panel
 * costs ~150 ms, which lands as a visible stutter the first time a lorry
 * recycles. Paying it during loading instead is free.
 */
export function warmTruckTextures(renderer) {
  if (!SHARED) return 0;
  const list = [
    ...SHARED.rearPool.map((r) => r.tex),
    ...SHARED.side, SHARED.heroFront, SHARED.heroCabSide, SHARED.flap,
    ...SHARED.trafficFront, ...SHARED.trafficCabSide,
  ].filter(Boolean);
  for (const t of list) renderer.initTexture(t);
  return list.length;
}
