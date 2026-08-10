// art.js — procedural North-Indian truck-art texture painter.
//
// Real lorry art is layered: a saturated ground colour, a scalloped border band,
// a central "hero" motif (deity, peacock, lotus, tiger, Kashmir valley), then
// hand-lettered slogans in Devanagari + English, then chrome/mirror accents.
// Every texture here is painted in that same order so the panels read as one truck.

import * as THREE from 'three';

export const PAL = {
  teal:     '#0e9488',
  deepTeal: '#065f56',
  seaGreen: '#13a892',
  red:      '#d92121',
  deepRed:  '#9b1414',
  orange:   '#f5741a',
  saffron:  '#f0a020',
  yellow:   '#fbdb4a',
  cream:    '#fdf6e3',
  pink:     '#ec4899',
  magenta:  '#b81d64',
  blue:     '#1e40af',
  skyBlue:  '#38bdf8',
  green:    '#16a34a',
  purple:   '#6d28d9',
  black:    '#141414',
  chrome:   '#c8d2dc',
};

// Rotating slogan bank — every truck that spawns gets a different back panel.
// These are the genuine article: lines actually painted on Indian lorries.
export const SLOGANS = [
  // the classics
  { hi: 'बुरी नज़र वाले तेरा मुँह काला', en: 'BURI NAZAR WALE TERA MUH KALA' },
  { hi: 'देखो मगर प्यार से',            en: 'DEKHO MAGAR PYAR SE' },
  { hi: 'आगे भगवान, पीछे शैतान',        en: 'AAGE BHAGWAN, PEECHE SHAITAN' },
  { hi: 'गाड़ी मालिक की, माल आपका',      en: 'GAADI MALIK KI, MAAL AAPKA' },
  { hi: 'सौ में सत्तर बेईमान',           en: 'SAU MEIN SATTAR BEIMAAN' },
  { hi: 'तेल देखो, तेल की धार देखो',     en: 'TEL DEKHO, TEL KI DHAAR DEKHO' },
  { hi: 'दिल तो बच्चा है जी',            en: 'DIL TO BACHCHA HAI JI' },
  { hi: 'बचके भाई, मैं UP से हूँ',       en: 'BACHKE BHAI — MAIN UP SE HOON' },
  { hi: 'पापा की परी',                  en: 'PAPA KI PARI' },
  { hi: 'चलती का नाम गाड़ी',             en: 'CHALTI KA NAAM GAADI' },
  { hi: 'माँ का आशीर्वाद',              en: 'MAA KA AASHIRWAD' },
  { hi: 'हॉर्न बजाओ, नींद खुल जाएगी',    en: 'HORN BAJAO, NEEND KHUL JAYEGI' },

  // speed, the way lorry painters put it
  { hi: 'धीरे चलोगे तो बार-बार मिलोगे',  en: 'TEZ CHALOGE TO HARIDWAR MILOGE' },
  { hi: 'दम है तो क्रॉस कर',             en: 'DUM HAI TO CROSS KAR' },
  { hi: 'सावधानी हटी, सब्ज़ी-पूड़ी बंटी',  en: 'SAAVDHANI HATI, SABZI-POORI BANTI' },
  { hi: 'हवा से बातें करता है',          en: 'HAWA SE BAATEIN KARTA HAI' },
  { hi: 'यह तूफ़ान मेल से कम नहीं',       en: 'YEH TOOFAN MAIL SE KAM NAHI' },
  { hi: 'धीरे चल प्यारे, जीवन अनमोल है',  en: 'DHEERE CHAL PYARE' },

  // devotional
  { hi: 'गंगा तेरा पानी अमृत',           en: 'GANGA TERA PAANI AMRIT' },
  { hi: 'किस्मत तेरी दासी है',           en: 'KISMAT TERI DAASI HAI' },
  { hi: 'सड़कों का राजा',                en: 'SADKON KA RAJA' },
  { hi: 'या रब तेरा ही आसरा',            en: 'YA RAB TERA HI AASRA' },

  // the funny ones
  { hi: 'मालिक की गाड़ी, ड्राइवर का पसीना', en: 'MALIK KI GAADI, DRIVER KA PASEENA' },
  { hi: 'जल मत पगली, किस्तों पे आई है',   en: 'JAL MAT PAGLI, KISTON PE AAYI HAI' },
  { hi: 'मैं भी बड़ा होकर ट्रक बनूँगा',    en: 'BADA HOKAR TRUCK BANOONGA' },
  { hi: 'लटक मत, पटक दूँगी',             en: 'LATAK MAT, PATAK DOONGI' },
  { hi: 'अनार कली भर कर चली',           en: 'ANAR KALI BHAR KAR CHALI' },
  { hi: 'नीम का पेड़ चंदन से कम नहीं',    en: 'HAMARA GURGAON LONDON SE KAM NAHI' },
  { hi: 'हँस मत पगली, प्यार हो जाएगा',    en: 'HANS MAT PAGLI' },
  { hi: 'भगवान बचाए डॉक्टर, पुलिस और हसीनों से', en: 'BHAGWAN BACHAYE IN TEENON SE' },

  // the public-service ones they also paint
  { hi: 'जब बेटी नहीं बचाओगे, बहू कहाँ से लाओगे', en: 'BETI BACHAO' },
  { hi: 'बाल विवाह करना अपराध है',       en: 'BAAL VIVAH APRADH HAI' },
];

export const OWNERS = [
  'बबलू ट्रांसपोर्ट कंपनी',
  'पप्पू रोडलाइन्स — भरोसे का नाम',
  'शेरे पंजाब कैरियर',
  'मुन्ना भाई ट्रांसपोर्ट',
  'बाहुबली रोडवेज',
  'जुगाड़ ट्रांसपोर्ट कंपनी',
  'छोटू कैरियर सर्विस',
  'किंग खान रोडलाइन्स',
  'गोलू मोटर ट्रांसपोर्ट',
  'सिंघम ट्रांसपोर्ट कंपनी',
  'टिंकू भाई गुड्स कैरियर',
  'लल्लन जी ट्रांसपोर्ट',
];

export const PLATES = [
  'HR 55 AL 1613', 'PB 10 CK 4207', 'UP 78 BN 9021',
  'RJ 14 GA 3355', 'DL 1L V 7788', 'HP 37 C 2109',
  'BR 01 PP 4200', 'MP 09 JG 7860', 'UK 07 BB 1947',
];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

function cvs(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  return [c, x];
}

function tex(c, repX = 1, repY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repX !== 1 || repY !== 1) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repX, repY);
  }
  return t;
}

// ── primitive motifs ────────────────────────────────────────────────────────

// Scalloped arch band — the fringed edging painted along every panel border.
function scallops(x, cx, cy, w, r, color, count) {
  x.fillStyle = color;
  x.beginPath();
  const step = w / count;
  for (let i = 0; i < count; i++) {
    x.moveTo(cx - w / 2 + i * step, cy);
    x.arc(cx - w / 2 + i * step + step / 2, cy, step / 2, Math.PI, 0);
  }
  x.fill();
}

// Lotus — the single most common motif; also stands in for the "O" of HORN OK.
export function lotus(x, cx, cy, r, petal = PAL.pink, core = PAL.yellow) {
  const layers = [
    { n: 8, len: 1.0, w: 0.34, c: petal, rot: 0 },
    { n: 8, len: 0.72, w: 0.30, c: PAL.cream, rot: Math.PI / 8 },
    { n: 6, len: 0.46, w: 0.28, c: petal, rot: 0 },
  ];
  for (const L of layers) {
    x.fillStyle = L.c;
    for (let i = 0; i < L.n; i++) {
      const a = L.rot + (i / L.n) * Math.PI * 2;
      x.save();
      x.translate(cx, cy);
      x.rotate(a);
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(r * L.w, -r * L.len * 0.55, 0, -r * L.len);
      x.quadraticCurveTo(-r * L.w, -r * L.len * 0.55, 0, 0);
      x.fill();
      x.strokeStyle = 'rgba(0,0,0,.28)';
      x.lineWidth = r * 0.03;
      x.stroke();
      x.restore();
    }
  }
  x.fillStyle = core;
  x.beginPath(); x.arc(cx, cy, r * 0.2, 0, 7); x.fill();
  x.strokeStyle = PAL.deepRed; x.lineWidth = r * 0.05; x.stroke();
}

// Peacock — painted on nearly every side panel, tail fanned toward the rear.
export function peacock(x, cx, cy, s) {
  // fanned tail
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI * 0.82 + (i / 10) * Math.PI * 0.64;
    const len = s * (1.5 + Math.sin(i / 10 * Math.PI) * 0.45);
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
    x.strokeStyle = i % 2 ? PAL.seaGreen : PAL.blue;
    x.lineWidth = s * 0.075;
    x.beginPath(); x.moveTo(cx, cy);
    x.quadraticCurveTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 - s * 0.25, ex, ey);
    x.stroke();
    // eye of the feather
    x.fillStyle = PAL.saffron;
    x.beginPath(); x.ellipse(ex, ey, s * 0.17, s * 0.22, a, 0, 7); x.fill();
    x.fillStyle = PAL.purple;
    x.beginPath(); x.ellipse(ex, ey, s * 0.10, s * 0.14, a, 0, 7); x.fill();
    x.fillStyle = PAL.seaGreen;
    x.beginPath(); x.arc(ex, ey, s * 0.05, 0, 7); x.fill();
  }
  // body
  x.fillStyle = PAL.blue;
  x.beginPath(); x.ellipse(cx, cy + s * 0.1, s * 0.24, s * 0.42, 0, 0, 7); x.fill();
  // neck + head
  x.strokeStyle = PAL.blue; x.lineWidth = s * 0.17; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx, cy - s * 0.2);
  x.quadraticCurveTo(cx + s * 0.42, cy - s * 0.5, cx + s * 0.4, cy - s * 0.88);
  x.stroke();
  x.fillStyle = PAL.blue;
  x.beginPath(); x.arc(cx + s * 0.4, cy - s * 0.95, s * 0.13, 0, 7); x.fill();
  x.fillStyle = PAL.saffron; // beak
  x.beginPath(); x.moveTo(cx + s * 0.51, cy - s * 0.95);
  x.lineTo(cx + s * 0.72, cy - s * 0.9); x.lineTo(cx + s * 0.51, cy - s * 0.86); x.fill();
  // crest
  x.strokeStyle = PAL.seaGreen; x.lineWidth = s * 0.03;
  for (let i = 0; i < 3; i++) {
    x.beginPath();
    x.moveTo(cx + s * 0.4, cy - s * 1.06);
    x.lineTo(cx + s * (0.32 + i * 0.08), cy - s * 1.24);
    x.stroke();
  }
}

// The painted "nazar" eyes that flank the rear slogan.
export function eye(x, cx, cy, s, flip = 1) {
  x.save(); x.translate(cx, cy); x.scale(flip, 1);
  x.fillStyle = PAL.cream;
  x.beginPath(); x.ellipse(0, 0, s, s * 0.58, 0, 0, 7); x.fill();
  x.strokeStyle = PAL.black; x.lineWidth = s * 0.09; x.stroke();
  x.fillStyle = '#2a5d8f';
  x.beginPath(); x.arc(s * 0.08, 0, s * 0.36, 0, 7); x.fill();
  x.fillStyle = PAL.black;
  x.beginPath(); x.arc(s * 0.08, 0, s * 0.17, 0, 7); x.fill();
  x.fillStyle = PAL.cream;
  x.beginPath(); x.arc(s * 0.0, -s * 0.13, s * 0.07, 0, 7); x.fill();
  // lashes
  x.strokeStyle = PAL.black; x.lineWidth = s * 0.07; x.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.78 + (i / 4) * Math.PI * 0.56;
    x.beginPath();
    x.moveTo(Math.cos(a) * s * 0.94, Math.sin(a) * s * 0.54);
    x.lineTo(Math.cos(a) * s * 1.24, Math.sin(a) * s * 0.86);
    x.stroke();
  }
  x.restore();
}

// Repeating paisley/floral vine used for every border band.
function vineBorder(x, bx, by, bw, bh, base, accent) {
  x.fillStyle = base;
  x.fillRect(bx, by, bw, bh);
  const horiz = bw > bh;
  const n = Math.max(3, Math.round((horiz ? bw : bh) / (horiz ? bh : bw) * 1.1));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cx = horiz ? bx + t * bw : bx + bw / 2;
    const cy = horiz ? by + bh / 2 : by + t * bh;
    const r = (horiz ? bh : bw) * 0.34;
    x.fillStyle = i % 2 ? accent : PAL.cream;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = i % 2 ? PAL.cream : accent;
    x.beginPath(); x.arc(cx, cy, r * 0.45, 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(0,0,0,.35)';
  x.lineWidth = Math.max(2, (horiz ? bh : bw) * 0.06);
  x.strokeRect(bx, by, bw, bh);
}

// Hand-painted lettering: thick fill, dark outline, offset drop shadow.
// `maxW` shrinks the type to fit, so a long slogan never runs off the panel.
function signPaint(x, text, cx, cy, size, fill, outline = PAL.black,
                   font = 'Impact, "Arial Black", sans-serif', maxW = 0) {
  x.font = `900 ${size}px ${font}`;
  if (maxW > 0) {
    const w = x.measureText(text).width;
    if (w > maxW) {
      size = Math.max(10, size * (maxW / w));
      x.font = `900 ${size}px ${font}`;
    }
  }
  x.lineJoin = 'round';
  x.fillStyle = 'rgba(0,0,0,.4)';
  x.fillText(text, cx + size * 0.05, cy + size * 0.06);
  x.strokeStyle = outline;
  x.lineWidth = size * 0.16;
  x.strokeText(text, cx, cy);
  x.fillStyle = fill;
  x.fillText(text, cx, cy);
}

const DEVA = '"Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif';
function devanagari(x, text, cx, cy, size, fill, outline = PAL.black, maxW = 0) {
  signPaint(x, text, cx, cy, size, fill, outline, DEVA, maxW);
}

/**
 * Cut a fully transparent rounded rectangle out of the canvas.
 * `destination-out` scales the erase by the source alpha, so the fill style is
 * forced opaque here — inheriting a translucent one leaves a ghost of the hole.
 */
function punchHole(x, bx, by, bw, bh, r = 16) {
  x.save();
  x.globalCompositeOperation = 'destination-out';
  x.globalAlpha = 1;
  x.fillStyle = '#000';
  x.beginPath(); x.roundRect(bx, by, bw, bh, r); x.fill();
  x.restore();
}

// Subtle weathering so the paint doesn't look like flat vector art.
function grime(x, w, h, amount = 0.13) {
  const g = x.createLinearGradient(0, h * 0.45, 0, h);
  g.addColorStop(0, 'rgba(60,45,25,0)');
  g.addColorStop(1, `rgba(50,38,20,${amount * 2.4})`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(${(Math.random() * 60) | 0},${(Math.random() * 50) | 0},20,${Math.random() * amount})`;
    const s = rnd(2, 16);
    x.fillRect(Math.random() * w, rnd(h * 0.3, h), s, s * rnd(0.4, 3));
  }
}

// ── panels ──────────────────────────────────────────────────────────────────

// THE back of the truck. HORN OK PLEASE, the lotus "O", nazar eyes, slogan.
export function rearPanel(opts = {}) {
  const slogan = opts.slogan || pick(SLOGANS);
  const W = 1024, H = 768;
  const [c, x] = cvs(W, H);

  x.fillStyle = PAL.deepTeal; x.fillRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PAL.teal); g.addColorStop(1, PAL.deepTeal);
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  // border bands
  vineBorder(x, 0, 0, W, 62, PAL.red, PAL.saffron);
  vineBorder(x, 0, H - 62, W, 62, PAL.red, PAL.saffron);
  vineBorder(x, 0, 62, 62, H - 124, PAL.orange, PAL.magenta);
  vineBorder(x, W - 62, 62, 62, H - 124, PAL.orange, PAL.magenta);
  scallops(x, W / 2, 62, W - 124, 26, PAL.yellow, 16);

  // owner banner, with the nazar eyes flanking it at the top so they don't
  // sit on top of the HORN OK PLEASE lettering
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(215, 92, W - 430, 78);
  devanagari(x, opts.owner || pick(OWNERS), W / 2, 131, 42, PAL.yellow, PAL.black, W - 470);
  eye(x, 140, 131, 54, 1);
  eye(x, W - 140, 131, 54, -1);

  // HORN [lotus] PLEASE — the lotus replaces the O, exactly as painted for real
  signPaint(x, 'HORN', W / 2 - 272, 302, 92, PAL.yellow, PAL.deepRed);
  lotus(x, W / 2 - 8, 298, 86, PAL.pink, PAL.yellow);
  signPaint(x, 'K', W / 2 + 84, 302, 92, PAL.yellow, PAL.deepRed);
  signPaint(x, 'PLEASE', W / 2 + 268, 302, 78, PAL.yellow, PAL.deepRed);

  // slogan block
  x.fillStyle = 'rgba(0,0,0,.3)';
  x.beginPath(); x.roundRect(110, 400, W - 220, 118, 22); x.fill();
  devanagari(x, slogan.hi, W / 2, 442, 52, PAL.cream, PAL.deepRed, W - 260);
  signPaint(x, slogan.en, W / 2, 496, 30, PAL.yellow, PAL.black, undefined, W - 260);

  // lower advisories
  signPaint(x, 'USE DIPPER AT NIGHT', W / 2 - 220, 570, 27, PAL.cream);
  signPaint(x, 'WAIT FOR SIDE', W / 2 + 230, 570, 27, PAL.cream);

  // number plate
  x.fillStyle = PAL.cream;
  x.beginPath(); x.roundRect(W / 2 - 190, 600, 380, 78, 8); x.fill();
  x.strokeStyle = PAL.black; x.lineWidth = 6; x.stroke();
  // The plate box is 380px wide; a 13-character plate at 52px monospace is
  // ~400px, which clipped the last digit off the right. Fit it to the box.
  const plate = opts.plate || pick(PLATES);
  let ps = 52;
  x.font = `900 ${ps}px "Courier New", monospace`;
  const pw = x.measureText(plate).width;
  if (pw > 340) { ps = Math.floor(ps * 340 / pw); x.font = `900 ${ps}px "Courier New", monospace`; }
  x.fillStyle = PAL.black;
  x.fillText(plate, W / 2, 641);

  grime(x, W, H, 0.16);
  return tex(c);
}

// Long cargo-body flank: peacock, lotus, mountains, slogan ribbon.
export function sidePanel(opts = {}) {
  const W = 2048, H = 640;
  const [c, x] = cvs(W, H);

  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PAL.seaGreen); g.addColorStop(0.55, PAL.teal); g.addColorStop(1, PAL.deepTeal);
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  vineBorder(x, 0, 0, W, 54, PAL.saffron, PAL.magenta);
  vineBorder(x, 0, H - 54, W, 54, PAL.saffron, PAL.magenta);

  // Kashmir-valley vignette — snow peaks + lake, a stock lorry-art scene
  const vx = W * 0.5, vy = H * 0.5, vw = 460, vh = 300;
  x.save();
  x.beginPath(); x.roundRect(vx - vw / 2, vy - vh / 2, vw, vh, 26); x.clip();
  const sky = x.createLinearGradient(0, vy - vh / 2, 0, vy + vh / 2);
  sky.addColorStop(0, '#7dd3fc'); sky.addColorStop(1, '#e0f2fe');
  x.fillStyle = sky; x.fillRect(vx - vw / 2, vy - vh / 2, vw, vh);
  x.fillStyle = '#94a3b8';
  for (const [px, pw, ph] of [[-140, 200, 150], [10, 240, 190], [160, 190, 140]]) {
    x.beginPath();
    x.moveTo(vx + px - pw / 2, vy + 60);
    x.lineTo(vx + px, vy + 60 - ph);
    x.lineTo(vx + px + pw / 2, vy + 60);
    x.fill();
    x.fillStyle = PAL.cream;
    x.beginPath();
    x.moveTo(vx + px - pw * 0.16, vy + 60 - ph * 0.68);
    x.lineTo(vx + px, vy + 60 - ph);
    x.lineTo(vx + px + pw * 0.16, vy + 60 - ph * 0.68);
    x.fill();
    x.fillStyle = '#64748b';
  }
  x.fillStyle = '#2563eb'; x.fillRect(vx - vw / 2, vy + 60, vw, vh);
  x.fillStyle = PAL.green;
  x.beginPath(); x.ellipse(vx, vy + 62, vw * 0.6, 26, 0, 0, 7); x.fill();
  x.restore();
  x.strokeStyle = PAL.yellow; x.lineWidth = 12;
  x.beginPath(); x.roundRect(vx - vw / 2, vy - vh / 2, vw, vh, 26); x.stroke();
  x.strokeStyle = PAL.deepRed; x.lineWidth = 4; x.stroke();

  peacock(x, W * 0.17, H * 0.62, 150);
  peacock(x, W * 0.83, H * 0.62, 150);
  lotus(x, W * 0.33, H * 0.5, 96);
  lotus(x, W * 0.67, H * 0.5, 96);

  signPaint(x, opts.transport || 'GOODS CARRIER', W * 0.5, H - 92, 40, PAL.yellow, PAL.deepRed);
  grime(x, W, H, 0.18);
  return tex(c);
}

// Cabover front: painted visor, grille, deity niche, marker-light strip.
export function cabFront(opts = {}) {
  const W = 1024, H = 1024;
  const [c, x] = cvs(W, H);

  x.fillStyle = PAL.cream; x.fillRect(0, 0, W, H);
  // upper painted visor band
  const g = x.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, PAL.red); g.addColorStop(1, PAL.orange);
  x.fillStyle = g; x.fillRect(0, 0, W, 300);
  scallops(x, W / 2, 300, W, 34, PAL.yellow, 14);
  devanagari(x, 'श्री गणेशाय नमः', W / 2, 108, 62, PAL.yellow, PAL.black, W - 140);
  devanagari(x, opts.name || 'बबलू ट्रांसपोर्ट कंपनी', W / 2, 205, 46, PAL.cream, PAL.deepRed, W - 120);

  // windscreen — punched right through to transparent so the cockpit camera
  // can see the road, with the real glass and decorations modelled in 3D.
  x.fillStyle = '#16202b';
  x.beginPath(); x.roundRect(70, 340, W - 140, 300, 20); x.fill();
  x.strokeStyle = PAL.chrome; x.lineWidth = 14; x.stroke();

  // lower painted apron + grille
  const g2 = x.createLinearGradient(0, 660, 0, H);
  g2.addColorStop(0, PAL.teal); g2.addColorStop(1, PAL.deepTeal);
  x.fillStyle = g2; x.fillRect(0, 660, W, H - 660);
  vineBorder(x, 0, 660, W, 46, PAL.magenta, PAL.yellow);

  x.fillStyle = '#20272e';
  x.beginPath(); x.roundRect(230, 740, W - 460, 150, 14); x.fill();
  x.strokeStyle = PAL.chrome; x.lineWidth = 10; x.stroke();
  x.fillStyle = PAL.chrome;
  for (let i = 0; i < 6; i++) x.fillRect(248, 760 + i * 23, W - 496, 10);

  // headlamps
  for (const hx of [128, W - 128]) {
    x.fillStyle = PAL.chrome;
    x.beginPath(); x.arc(hx, 812, 78, 0, 7); x.fill();
    const lg = x.createRadialGradient(hx - 20, 792, 6, hx, 812, 62);
    lg.addColorStop(0, '#fffbe8'); lg.addColorStop(1, '#d8c489');
    x.fillStyle = lg;
    x.beginPath(); x.arc(hx, 812, 60, 0, 7); x.fill();
  }
  lotus(x, W / 2, 950, 56, PAL.pink, PAL.yellow);
  grime(x, W, H, 0.12);

  // Punch the glass out LAST — grime would otherwise fill the hole back in.
  // NB: destination-out erases in proportion to the SOURCE alpha, so the fill
  // style must be fully opaque or the hole only gets partially cut.
  if (opts.cutout) punchHole(x, 84, 354, W - 168, 272);
  return tex(c);
}

/**
 * Inside face of the cab front. The painted exterior has to be double-sided so
 * the punched-out windscreen doesn't let you see through the whole truck — but
 * seen from the driver's seat that paint reads BACKWARDS. This liner sits just
 * behind it: plain trimmed board, same window hole, correct from inside.
 */
export function cabLiner() {
  const W = 1024, H = 1024;
  const [c, x] = cvs(W, H);
  x.fillStyle = '#2a2f36'; x.fillRect(0, 0, W, H);
  // padded vinyl look above the screen, where the sun visor sits
  x.fillStyle = '#3a4048'; x.fillRect(0, 0, W, 330);
  x.fillStyle = '#20252b';
  for (let i = 0; i < 26; i++) x.fillRect(0, 40 + i * 11, W, 3);
  // a strip of tinsel tape along the header, as they all have
  vineBorder(x, 0, 300, W, 34, PAL.magenta, PAL.yellow);
  // dashboard top below the glass
  x.fillStyle = '#23272d'; x.fillRect(0, 640, W, H - 640);

  punchHole(x, 84, 354, W - 168, 272);
  return tex(c);
}

// Cab flank — door with owner name, small lotus, side window.
export function cabSide(opts = {}) {
  const W = 1024, H = 1024;
  const [c, x] = cvs(W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PAL.red); g.addColorStop(0.34, PAL.orange); g.addColorStop(0.35, PAL.cream);
  g.addColorStop(1, PAL.teal);
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  x.fillStyle = '#16202b';
  x.beginPath(); x.roundRect(150, 120, 740, 300, 18); x.fill();
  x.strokeStyle = PAL.chrome; x.lineWidth = 12; x.stroke();

  vineBorder(x, 0, 430, W, 52, PAL.magenta, PAL.yellow);
  lotus(x, 250, 640, 110);
  devanagari(x, opts.owner || 'बबलू ट्रांसपोर्ट', 640, 600, 58, PAL.deepRed, PAL.yellow, 700);
  signPaint(x, 'ALL INDIA PERMIT', 640, 690, 34, PAL.blue, PAL.cream, undefined, 700);
  signPaint(x, opts.plate || 'HR 55 AL 1613', 512, 830, 46, PAL.black, PAL.cream, '"Courier New", monospace', 780);
  vineBorder(x, 0, H - 60, W, 60, PAL.saffron, PAL.magenta);
  grime(x, W, H, 0.15);
  return tex(c);
}

// Black rubber mudflap with reflective lettering.
export function mudflap(text = 'OK') {
  const [c, x] = cvs(256, 256);
  x.fillStyle = '#1b1b1b'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#3a3a3a'; x.lineWidth = 8; x.strokeRect(10, 10, 236, 236);
  signPaint(x, text, 128, 118, 90, PAL.cream, PAL.black);
  signPaint(x, 'TATA', 128, 200, 40, PAL.saffron, PAL.black);
  return tex(c);
}

// Road surface: worn asphalt + centre dashes; v-repeat scrolls for motion.
/**
 * Road surface — an Indian state-highway one, not a German autobahn.
 *
 * What actually makes a road read as Indian: bitumen patches over old repairs in
 * a slightly different shade, crocodile cracking where the surface has fatigued,
 * ragged unsealed edges, gravel washed onto the shoulder, and lane markings worn
 * down to dashes and gaps. Potholes themselves are separate decals (see
 * `pothole()`), since they need to line up with the bumps you feel.
 */
export function roadTexture() {
  const [c, x] = cvs(512, 512);
  x.fillStyle = '#3b3b40'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 40 + Math.random() * 42;
    x.fillStyle = `rgba(${v},${v},${v + 5},${Math.random() * 0.5})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, rnd(1, 5), rnd(1, 5));
  }

  // bitumen repair patches — always a shade off from the road around them
  for (let i = 0; i < 7; i++) {
    const px = Math.random() * 512, py = Math.random() * 512;
    const pw = rnd(45, 150), ph = rnd(35, 120);
    x.fillStyle = `rgba(${20 + Math.random() * 26 | 0},${20 + Math.random() * 24 | 0},24,.75)`;
    x.beginPath();
    // irregular blob, not a rectangle
    x.moveTo(px, py);
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      x.lineTo(px + Math.cos(a) * pw * 0.5 * rnd(0.7, 1.15),
               py + Math.sin(a) * ph * 0.5 * rnd(0.7, 1.15));
    }
    x.closePath(); x.fill();
  }

  // crocodile cracking — fatigued surface breaking into plates
  x.strokeStyle = 'rgba(14,14,16,.62)';
  for (let i = 0; i < 4; i++) {
    const cx0 = Math.random() * 512, cy0 = Math.random() * 512;
    const r = rnd(30, 70);
    x.lineWidth = rnd(1, 2.4);
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2, a2 = a + rnd(-1, 1);
      x.beginPath();
      x.moveTo(cx0 + Math.cos(a) * r * Math.random(), cy0 + Math.sin(a) * r * Math.random());
      x.lineTo(cx0 + Math.cos(a2) * r * Math.random(), cy0 + Math.sin(a2) * r * Math.random());
      x.stroke();
    }
  }

  // long tar seams
  x.strokeStyle = 'rgba(20,20,22,.55)'; x.lineWidth = 7;
  for (let i = 0; i < 5; i++) {
    x.beginPath();
    x.moveTo(Math.random() * 512, 0);
    x.bezierCurveTo(Math.random() * 512, 170, Math.random() * 512, 340, Math.random() * 512, 512);
    x.stroke();
  }

  // ragged, broken edges with gravel spilling onto the shoulder
  for (const edge of [26, 482]) {
    x.fillStyle = 'rgba(120,98,64,.5)';
    for (let i = 0; i < 130; i++) {
      const yy = Math.random() * 512;
      x.fillRect(edge + rnd(-16, 16), yy, rnd(2, 11), rnd(2, 8));
    }
  }

  // worn lane markings — faded, chipped, never continuous
  const paint = (px, py, pw, ph) => {
    x.fillStyle = `rgba(232,228,216,${rnd(0.45, 0.92)})`;
    x.fillRect(px, py, pw, ph);
    // chip bits out of the paint
    x.fillStyle = 'rgba(59,59,64,.85)';
    for (let i = 0; i < 5; i++) {
      x.fillRect(px + rnd(-1, pw), py + Math.random() * ph, rnd(2, pw), rnd(2, 9));
    }
  };
  paint(248, 40, 16, 190);
  paint(248, 300, 16, 190);
  paint(24, 0, 9, 512);
  paint(479, 0, 9, 512);
  return tex(c, 1, 1);
}

export function groundTexture() {
  const [c, x] = cvs(512, 512);
  x.fillStyle = '#b58b4a'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3200; i++) {
    const p = [['#c79c58', 1], ['#9c7238', 1], ['#7c8f3e', 0.8], ['#d8b276', 1]][(Math.random() * 4) | 0];
    x.globalAlpha = p[1] * Math.random();
    x.fillStyle = p[0];
    x.fillRect(Math.random() * 512, Math.random() * 512, rnd(2, 12), rnd(2, 12));
  }
  x.globalAlpha = 1;
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;   // tiling is driven by the ribbon's UVs
  return t;
}

// Roadside hoarding — dhaba ads, tyre shops, "Fresh Tandoori Roti".
export function hoarding() {
  const boards = [
    { t: 'पप्पू दा ढाबा',        s: 'KHANA KHAO, BIWI KO BHOOL JAO', bg: PAL.red,     fg: PAL.yellow },
    { t: 'टिंकू टायर पंचर',       s: '24 GHANTE • KABHI BHI AAO',     bg: PAL.blue,    fg: PAL.cream },
    { t: 'बबलू लस्सी सेंटर',      s: 'EK GLASS, POORA DIN THANDA',    bg: PAL.green,   fg: PAL.yellow },
    { t: 'शेरे पंजाब ढाबा',       s: 'MAKKHAN WALI ROTI • FREE PYAZ', bg: PAL.magenta, fg: PAL.cream },
    { t: 'जुगाड़ मोटर वर्क्स',     s: 'KUCH BHI THEEK KAR DENGE',      bg: PAL.orange,  fg: PAL.black },
    { t: 'चाय पी लो सरकार',       s: 'CHAI • PARATHA • GAPSHAP',      bg: PAL.purple,  fg: PAL.yellow },
    { t: 'मुन्ना भाई ढाबा',       s: 'MAA JAISA KHANA, BILL BAAP JAISA', bg: PAL.deepRed, fg: PAL.cream },
    { t: 'गोलगप्पा जंक्शन',       s: '10 KE 6 • 20 KE 15',            bg: PAL.teal,    fg: PAL.yellow },
    { t: 'सिंघम ट्रक ढाबा',       s: 'TRUCK PARKING FREE • CHARPAI AC', bg: PAL.blue,  fg: PAL.yellow },
    { t: 'लल्लन जी का होटल',      s: 'SWAAD AISA, GAADI KHUD RUKEGI', bg: PAL.red,     fg: PAL.cream },
  ];
  const b = pick(boards);
  const [c, x] = cvs(1024, 512);
  x.fillStyle = b.bg; x.fillRect(0, 0, 1024, 512);
  vineBorder(x, 0, 0, 1024, 44, PAL.yellow, PAL.deepRed);
  vineBorder(x, 0, 468, 1024, 44, PAL.yellow, PAL.deepRed);
  devanagari(x, b.t, 512, 190, 100, b.fg, PAL.black, 900);
  signPaint(x, b.s, 512, 320, 44, b.fg, PAL.black, undefined, 920);
  signPaint(x, '★ ★ ★', 512, 400, 40, PAL.yellow);
  grime(x, 1024, 512, 0.2);
  return tex(c);
}

// Real destinations up the Delhi → Amritsar stretch of NH-44 (the old GT Road),
// ordered by how far along the highway they sit.
export const NH44_TOWNS = [
  { hi: 'सोनीपत',    en: 'Sonipat',     at: 45 },
  { hi: 'पानीपत',    en: 'Panipat',     at: 90 },
  { hi: 'करनाल',     en: 'Karnal',      at: 125 },
  { hi: 'कुरुक्षेत्र', en: 'Kurukshetra', at: 160 },
  { hi: 'अम्बाला',    en: 'Ambala',      at: 200 },
  { hi: 'लुधियाना',   en: 'Ludhiana',    at: 310 },
  { hi: 'जालंधर',    en: 'Jalandhar',   at: 360 },
  { hi: 'अमृतसर',    en: 'Amritsar',    at: 440 },
];

/**
 * NHAI direction board: IRC-67 green ground, white legend and border,
 * Devanagari over English with the distance in kilometres.
 * @param {number} km  how far along the highway the driver currently is
 */
export function destinationSign(km) {
  const W = 1024, H = 640;
  const [c, x] = cvs(W, H);
  x.fillStyle = '#0b6b39'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ffffff'; x.lineWidth = 10;
  x.strokeRect(18, 18, W - 36, H - 36);

  // next three towns still ahead of us
  const ahead = NH44_TOWNS.filter((t) => t.at > km).slice(0, 3);
  const rows = ahead.length ? ahead : NH44_TOWNS.slice(-3);

  rows.forEach((t, i) => {
    const y = 150 + i * 150;
    x.textAlign = 'left';
    x.font = `700 62px ${DEVA}`;
    x.fillStyle = '#ffffff';
    x.fillText(t.hi, 70, y - 26);
    x.font = '700 52px Arial, sans-serif';
    x.fillText(t.en, 70, y + 34);
    x.textAlign = 'right';
    x.font = '700 66px Arial, sans-serif';
    x.fillText(Math.max(1, Math.round(t.at - km)), W - 150, y);
    x.font = '700 34px Arial, sans-serif';
    x.fillText('km', W - 70, y + 8);
    x.textAlign = 'center';
  });
  grime(x, W, H, 0.1);
  return tex(c);
}

// The Border Roads Organisation safety boards — genuinely the funniest
// signage on any highway in the world, and entirely real.
const SAFETY = [
  { a: 'नज़र हटी',        b: 'दुर्घटना घटी',            bg: '#f0a020', fg: '#141414' },
  { a: 'BE GENTLE',      b: 'ON MY CURVES',           bg: '#0b6b39', fg: '#ffffff' },
  { a: 'DARLING I LIKE YOU', b: 'BUT NOT SO FAST',    bg: '#d92121', fg: '#fbdb4a' },
  { a: 'SPEED THRILLS',  b: 'BUT KILLS',              bg: '#d92121', fg: '#ffffff' },
  { a: 'BETTER LATE',    b: 'THAN NEVER',             bg: '#1e40af', fg: '#ffffff' },
  { a: 'PEEP PEEP',      b: "DON'T SLEEP",            bg: '#f0a020', fg: '#141414' },
  { a: 'AFTER WHISKY',   b: 'DRIVING RISKY',          bg: '#8f1414', fg: '#fbdb4a' },
  { a: 'चल धीरे धीरे',    b: 'घर कोई इंतज़ार कर रहा है', bg: '#0b6b39', fg: '#ffffff' },
  { a: 'LIFE IS SHORT',  b: "DON'T MAKE IT SHORTER",  bg: '#d92121', fg: '#ffffff' },
  { a: 'HORN OK PLEASE', b: 'PAR THODA DHEERE',       bg: '#f0a020', fg: '#141414' },
  // straight off the back of real lorries
  { a: 'धीरे चलोगे तो बार-बार मिलोगे', b: 'तेज़ चलोगे तो हरिद्वार मिलोगे', bg: '#0b6b39', fg: '#fbdb4a' },
  { a: 'सावधानी हटी',     b: 'सब्ज़ी-पूड़ी बंटी',        bg: '#d92121', fg: '#ffffff' },
  { a: 'दम है तो क्रॉस कर', b: 'नहीं तो बर्दाश्त कर',    bg: '#1e40af', fg: '#fbdb4a' },
  { a: 'धीरे चल प्यारे',   b: 'जीवन अनमोल है',          bg: '#f0a020', fg: '#141414' },
  { a: 'सौंदर्य दर्शन ना करें', b: 'वरना देव दर्शन हो जाएंगे', bg: '#8f1414', fg: '#fbdb4a' },
  { a: 'हड्डियां टूटती हैं', b: 'तो दर्द होता है',        bg: '#0b6b39', fg: '#ffffff' },
];

export function safetySign() {
  const s = pick(SAFETY);
  const W = 1024, H = 512;
  const [c, x] = cvs(W, H);
  x.fillStyle = s.bg; x.fillRect(0, 0, W, H);
  x.strokeStyle = s.fg; x.lineWidth = 9;
  x.strokeRect(22, 22, W - 44, H - 44);
  const dev = /[ऀ-ॿ]/.test(s.a + s.b);
  const f = dev ? DEVA : 'Arial, sans-serif';
  x.font = `800 84px ${f}`;
  x.fillStyle = s.fg;
  x.fillText(s.a, W / 2, 190);
  x.font = `800 66px ${f}`;
  x.fillText(s.b, W / 2, 320);
  x.font = '700 26px Arial, sans-serif';
  x.globalAlpha = 0.75;
  x.fillText('— BRO —', W / 2, 420);
  x.globalAlpha = 1;
  grime(x, W, H, 0.13);
  return tex(c);
}

// Kilometre milestone — white pillar, saffron cap, NH marking.
export function milestone(km) {
  const [c, x] = cvs(256, 512);
  x.fillStyle = PAL.cream; x.fillRect(0, 0, 256, 512);
  x.fillStyle = PAL.saffron; x.fillRect(0, 0, 256, 170);
  x.fillStyle = PAL.black;
  x.font = '900 62px Arial, sans-serif';
  x.fillText('NH', 128, 62);
  x.font = '900 76px Arial, sans-serif';
  x.fillText('44', 128, 130);
  x.fillStyle = PAL.black;
  x.font = '900 92px Arial, sans-serif';
  x.fillText(String(km), 128, 300);
  x.font = '900 40px Arial, sans-serif';
  x.fillText('km', 128, 372);
  grime(x, 256, 512, 0.25);
  return tex(c);
}

/**
 * Normal map for the cargo body: horizontal plank seams with a row of rivets
 * along each one. Without this the flanks read as flat printed cardboard;
 * with it the panel catches light like beaten sheet metal on a timber frame.
 */
export function plankNormal(planks = 7, rivets = 26) {
  const W = 1024, H = 512;
  const [c, x] = cvs(W, H);

  // Height field first, then differentiate it into a normal map.
  const h = new Float32Array(W * H);
  const seam = H / planks;
  for (let y = 0; y < H; y++) {
    // distance to nearest seam → a V-shaped groove
    const dy = Math.abs((y % seam) - seam / 2);
    const groove = Math.max(0, 1 - dy / 5);
    for (let xi = 0; xi < W; xi++) {
      let v = 1 - groove * 0.9;
      v -= Math.sin(xi * 0.21) * 0.012;           // faint sheet ripple
      h[y * W + xi] = v;
    }
  }
  // rivet bumps sitting on each seam
  for (let p = 0; p <= planks; p++) {
    const cy = Math.round(p * seam);
    for (let r = 0; r < rivets; r++) {
      const cxp = Math.round((r + 0.5) * (W / rivets));
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const yy = cy + dy, xx = cxp + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const d = Math.hypot(dx, dy);
          if (d < 3) h[yy * W + xx] += (1 - d / 3) * 0.55;
        }
      }
    }
  }

  const img = x.createImageData(W, H);
  const at = (xx, yy) => h[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
  for (let y = 0; y < H; y++) {
    for (let xi = 0; xi < W; xi++) {
      const nx = (at(xi - 1, y) - at(xi + 1, y)) * 2.2;
      const ny = (at(xi, y - 1) - at(xi, y + 1)) * 2.2;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * W + xi) * 4;
      img.data[i]     = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;                                      // NB: normal maps stay in linear space
}

export const randomTruckIdentity = () => ({
  owner: pick(OWNERS),
  plate: pick(PLATES),
  slogan: pick(SLOGANS),
});
