<div align="center">

# 🚛 HORN OK PLEASE

### भारतीय ट्रक ड्राइवर सिमुलेटर · Indian Truck Driver Simulator

**Drive a hand-painted North Indian lorry down NH-44 with the dhaba radio on shuffle.**

*धीरे चलोगे तो बार-बार मिलोगे, तेज़ चलोगे तो हरिद्वार मिलोगे*

[![three.js](https://img.shields.io/badge/three.js-r169-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![No build step](https://img.shields.io/badge/build%20step-none-16a34a)](#running-it)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-000000?logo=vercel)](#deploying)
![Size](https://img.shields.io/badge/total%20size-1.2%20MB-f0a020)

</div>

---

## What this is

An endless-highway driving toy built in a weekend of iterations. Every painted panel —
`HORN [🪷] PLEASE`, the nazar eyes, the peacocks, the Kashmir-valley vignette, the number
plates — is **drawn at runtime onto a `<canvas>`** and mapped onto the geometry. No
downloaded 3D models, no texture packs, no build step.

The truck never actually moves. It sits at `z = 0` and the entire world is rebuilt each
frame from one scalar: metres travelled.

---

## Running it

ES modules need a real server — opening `index.html` from the filesystem won't work.

```bash
git clone https://github.com/vijaygupta18/horn-ok-please.git
cd horn-ok-please
python3 -m http.server 8777
# open http://localhost:8777
```

Then hit **START ENGINE** — that click is required, because browsers block audio until a
user gesture.

---

## Controls

| Key | Action |
|:---|:---|
| `↑` `W` | accelerate |
| `↓` `S` `Space` | brake — works **during autopilot too**. Keep holding at a standstill and it slots into **reverse** |
| `←` `→` `A` `D` | steer |
| `X` | handbrake |
| `H` | **horn — a different one every press** |
| `G` | full-length horn, named on screen |
| `P` | autopilot (on by default) |
| `T` | time: India time → Day → Night → Fast cycle |
| `C` | camera: chase · cabin · bonnet · cinematic · top |
| `N` `B` | next / previous track |
| `J` `L` | seek ∓10s · `0`–`9` jump to % · `K` play/pause |
| `M` | mute |

**Top and cinematic views are mouse-orbitable** — drag to swing round the truck,
scroll to zoom. Each keeps its own framing.
On phones, on-screen controls appear automatically.

---

## Features

<table>
<tr><td width="50%" valign="top">

### 🎨 Procedural truck art
32 real lorry slogans, 12 transport-company names, 9 number plates — dealt out so **no
two trucks on the road read alike**. Peacocks, lotuses, scalloped borders and Devanagari
lettering, all painted in code.

### 🛣️ The highway
Curving, rolling NH-44 with NHAI green direction boards counting down real towns
(Sonipat → Amritsar), BRO safety signs (*"BE GENTLE ON MY CURVES"*), dhabas, petrol
pumps, a toll plaza, villages, temples and shrines.

### 🌗 Real Indian time
Opens at the **actual current time in India**. Load it at 9pm and you're on a dark
highway with the headlamps on and 2,600 stars overhead, Milky Way included.

</td><td width="50%" valign="top">

### 📯 Six real horns
Musical tune horns, *Kangana Tera Ni*, *Magic In The Air*, *Baby Shark* — picked at
random on every press, never the same one twice running.

### 🚚 The cab
See-through windscreen, pom-pom fringe, a **live wing mirror** rendering the road behind
you, and a proper nimbu-mirchi — waxy lemons top and bottom, seven glossy curved chillies
with green stalks — swinging with the truck.

### ☕ Dhaba breaks
Every few kilometres the truck pulls in for a **30-second halt**. The tank fills, the
driver eats, and the HUD narrates it: *"दो परांठे, दाल मक्खनी — extra makkhan"*.

</td></tr>
</table>

---

## The radio

Plays **"Driver ki Playlist 🚛 — Bus • Truck • Majdoor"** (200 tracks) through the YouTube
IFrame API with `setShuffle(true)` forced on every load — shuffle is never off.
**YouTube Premium is not required.**

Three levels of fallback so it's never silent: unembeddable track → skipped; whole
playlist unusable → backup playlist; that fails → individually verified video IDs.

---

## Drivers online

The counter is **real**. Every visitor heartbeats `/api/presence`; anyone who goes quiet
for 25s drops off, so the number is the actual count of people on the site.

With no API reachable (plain `http.server`), it falls back to counting browser tabs on
your own machine over a baseline of 13 — and the status dot turns grey to say so. Hover
it and the tooltip tells you which number you're looking at.

For a count shared across serverless instances, set `KV_REST_API_URL` and
`KV_REST_API_TOKEN` (Vercel KV or Upstash). Without them it uses per-instance memory —
still real people, just not pooled.

---

## How it's built

```
index.html          shell + HUD
css/style.css       UI painted as lorry signage
js/art.js           procedural truck-art textures (canvas → CanvasTexture)
js/truck.js         the lorry, its cab interior and its paint
js/world.js         endless road, sky, scenery, traffic
js/audio.js         YouTube radio + horn samples + synthesized engine
js/presence.js      drivers-online counter
js/main.js          game loop, driving model, autopilot, cameras
api/presence.js     serverless presence endpoint (zero dependencies)
```

**Rendering** — three.js r169 via importmap, ACES tone mapping, PCF soft shadows,
`UnrealBloomPass`, and a PMREM environment probe built from a painted equirectangular sky
so the chrome actually reflects something. Painted panels carry a computed normal map
giving plank seams and rivets.

**The engine is not a stack of oscillators** (that reads as a motorbike). It's a rendered
loop of discrete combustion events — low thump, injector clatter, block rumble — scrubbed
with `playbackRate`, so pitch and chug rate rise together the way a diesel does. Turbo
whine and air-brake hiss on top.

**Performance** — holds **100% of frames under 16.7 ms**. Board artwork is baked into
texture pools and swapped for free; expensive canvas work is deferred to
`requestIdleCallback`; textures are uploaded to the GPU before the drive starts.

---

## Bugs worth remembering

Every one of these was found by looking at rendered output, not by reading code:

| Symptom | Cause |
|:---|:---|
| Entire world rendered black | Shadow camera's `far` was nearer than the light — every surface failed the depth test |
| Odometer counted backwards | rAF's timestamp can *predate* a `performance.now()` taken in a click handler → negative `dt` on frame one |
| Lettering mirrored | `BoxGeometry` already orients ±X correctly; mirroring one flank is what breaks it. Roadside boards had the opposite bug — their lettered face is +Z, but the driver travels toward +Z |
| Windscreen wouldn't cut through | `destination-out` erases in proportion to *source* alpha; the grime pass left a translucent fill, so the hole came out 94% opaque |
| 1.3-second frame spikes | Recycling a hoarding repainted a 1024×512 canvas mid-drive |
| Headlights invisible at night | three.js r155+ uses physical units — `intensity: 3` is effectively off |
| Traffic vanished after 300 m | `v.d` incremented as a *relative* offset but read as a *world* distance |
| Every mobile control lost its position | `env(safe-area-inset-*)` with no fallback invalidates the whole `calc()` |
| Steering inverted | +X is screen-**left** when the camera looks down +Z, so "left" must produce a *positive* steer |
| Truck could get stuck on the verge forever | Off-road drag (4.2 m/s²) almost exactly cancelled full throttle (4.6) |
| Horn repeated itself | `randomHorn` fell through to a single default synth type before the mp3s decoded |

---

## Mobile

Fully playable. Analog dial swaps for a digital readout, the radio becomes a slim bottom
bar, controls sit in the thumb corners inside the notch-safe area. Bloom off and render
scale 0.8 on touch devices — a smooth truck beats a glowing one. Pinch-zoom, double-tap
zoom and pull-to-refresh are all suppressed.

---

## Deploying

Static + one serverless function. No build step.

```bash
npx vercel --prod
```

`vercel.json` sets immutable caching for `audio/` and sensible security headers.

---

## Debug switches

```
?nointro     skip the start card        ?cam=0..4   pick a camera
?tod=0..1    pin a time of day          ?dist=<m>   start further along
?layout      dump control boxes + viewport size (for checking mobile)
```

`window.__sim` exposes live state plus `step(n)` for scripted testing.

---

## Credits

Slogans and signage are the real thing — *Buri Nazar Wale Tera Muh Kala*, *Aage Bhagwan
Peeche Shaitan*, *Jal Mat Pagli Kiston Pe Aayi Hai*, *Main Bhi Bada Hokar Truck Banoonga*
— alongside the Border Roads Organisation's genuinely excellent safety boards.

NH-44 details (4,112 km Srinagar → Kanyakumari, fuel stops every 40–60 km) and the
*Horn OK Please* origin theories are from public sources.

<div align="center">

**बुरी नज़र वाले तेरा मुँह काला** 🪷

</div>
