// audio.js — two independent sound systems:
//   1. Music  : the YouTube IFrame player, driving a real playlist, always shuffled.
//   2. SFX    : WebAudio-synthesized pressure horn + engine rumble (no asset files).

// "Driver ki Playlist 🚛 — Bus • Truck • Majdoor"
export const PLAYLIST_ID = 'PLO1WqL1Pm6ic';
// Kept as a second chance if the first can't be embedded.
export const BACKUP_PLAYLIST_ID = 'PLeatb7hupNV_AWUl_7ttbsKeCQh8tF5N4';

// Verified individual video IDs. Used only if the playlist itself fails to load
// (private/region-blocked), so the radio is never silent.
const FALLBACK = [
  { id: 'GjPGVVebVUc', title: 'Zindagi Ek Safar Hai Suhana — Kishore Kumar' },
  { id: 'DuqZWlNEfnQ', title: 'Musafir Hoon Yaaron — Kishore Kumar' },
  { id: 'qfCt1UZAXMQ', title: 'Yeh Dosti Hum Nahi Todenge — Sholay' },
  { id: 'a364x2pDMZ8', title: 'Chal Chal Chal Mere Saathi — Haathi Mere Saathi' },
  { id: 'ID5OsqrqeqI', title: 'Khaike Paan Banaras Wala — Don' },
  { id: '3V8Y8GGnLvk', title: 'Gaadi Bula Rahi Hai — Dost' },
];

// ── music ──────────────────────────────────────────────────────────────────

export class Radio {
  constructor(onChange) {
    this.player = null;
    this.ready = false;
    this.playing = false;
    this.volume = 65;
    this.usingFallback = false;
    this.triedBackup = false;
    this.fallbackIndex = 0;
    this.onChange = onChange || (() => {});
    this.failCount = 0;
  }

  /** Injects the IFrame API and builds the hidden player. Resolves when ready. */
  init() {
    return new Promise((resolve) => {
      const build = () => {
        this.player = new YT.Player('yt-player', {
          height: '180', width: '320',
          playerVars: {
            listType: 'playlist',
            list: PLAYLIST_ID,
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              this.ready = true;
              this.player.setShuffle(true);      // shuffle is always on, per design
              this.player.setVolume(this.volume);
              resolve(this);
            },
            onStateChange: (e) => this._onState(e),
            onError: (e) => this._onError(e),
          },
        });
      };

      if (window.YT && window.YT.Player) return build();
      window.onYouTubeIframeAPIReady = build;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
      // If YouTube is unreachable entirely, don't hang the game start.
      setTimeout(() => { if (!this.ready) resolve(this); }, 6000);
    });
  }

  _onState(e) {
    this.playing = e.data === YT.PlayerState.PLAYING;
    if (e.data === YT.PlayerState.PLAYING) this.failCount = 0;
    if (e.data === YT.PlayerState.ENDED && this.usingFallback) this.next();
    this.onChange(this.info());
  }

  _onError() {
    // 101/150 = embedding disabled, 100 = removed. Skip the offending track;
    // if the whole playlist proves unusable, fall back a step at a time:
    // main playlist → backup playlist → individual verified videos.
    this.failCount++;
    if (this.failCount > 3 && !this.triedBackup && !this.usingFallback) {
      this.triedBackup = true;
      this.failCount = 0;
      try {
        this.player.loadPlaylist({ listType: 'playlist', list: BACKUP_PLAYLIST_ID });
        this.player.setShuffle(true);
        return;
      } catch { /* fall through to single videos */ }
    }
    if (this.failCount > 3 && !this.usingFallback) {
      this.usingFallback = true;
      this.failCount = 0;
      this._playFallback(0);
    } else {
      this.next();
    }
  }

  _playFallback(i) {
    this.fallbackIndex = ((i % FALLBACK.length) + FALLBACK.length) % FALLBACK.length;
    this.player?.loadVideoById(FALLBACK[this.fallbackIndex].id);
    this.onChange(this.info());
  }

  /** Kick off playback from a random point in the shuffled playlist. */
  start() {
    if (!this.ready) return;
    this.player.setShuffle(true);
    const n = this.player.getPlaylist()?.length || 0;
    if (n > 0) this.player.playVideoAt((Math.random() * n) | 0);
    else this._playFallback((Math.random() * FALLBACK.length) | 0);
    this.playing = true;
  }

  toggle() {
    if (!this.ready) return;
    if (this.playing) this.player.pauseVideo();
    else this.player.playVideo();
  }

  next() {
    if (!this.ready) return;
    if (this.usingFallback) this._playFallback(this.fallbackIndex + 1);
    else this.player.nextVideo();
  }

  prev() {
    if (!this.ready) return;
    if (this.usingFallback) this._playFallback(this.fallbackIndex - 1);
    else this.player.previousVideo();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, v | 0));
    this.player?.setVolume(this.volume);
  }

  /** Current position and length of the playing track, in seconds. */
  time() {
    try {
      return {
        cur: this.player?.getCurrentTime?.() || 0,
        dur: this.player?.getDuration?.() || 0,
      };
    } catch { return { cur: 0, dur: 0 }; }
  }

  /** Jump to an absolute position (seconds). */
  seek(sec) {
    if (!this.ready) return;
    const { dur } = this.time();
    this.player.seekTo(Math.max(0, dur ? Math.min(sec, dur - 0.5) : sec), true);
  }

  /** Nudge forward/back by `delta` seconds. */
  skip(delta) { this.seek(this.time().cur + delta); }

  /** Briefly duck the music so the horn cuts through. */
  duck(ms = 700) {
    if (!this.ready) return;
    clearTimeout(this._duckT);
    this.player.setVolume(Math.round(this.volume * 0.35));
    this._duckT = setTimeout(() => this.player?.setVolume(this.volume), ms);
  }

  info() {
    if (this.usingFallback) {
      return { title: FALLBACK[this.fallbackIndex].title, playing: this.playing, index: this.fallbackIndex + 1, total: FALLBACK.length };
    }
    let title = 'Tuning the radio…';
    let index = 0, total = 0;
    try {
      title = this.player?.getVideoData?.()?.title || title;
      index = (this.player?.getPlaylistIndex?.() ?? -1) + 1;
      total = this.player?.getPlaylist?.()?.length || 0;
    } catch { /* player not ready yet */ }
    return { title, playing: this.playing, index, total };
  }
}

// ── sound effects ──────────────────────────────────────────────────────────

/**
 * Real recorded horns, shipped in audio/horns/. These are what a truck on the
 * GT Road actually sounds like — the synthesized set below stays as a fallback
 * for when decoding fails or the files haven't loaded yet.
 */
export const HORN_FILES = [
  { file: 'musical-2.mp3',       hi: 'म्यूज़िकल हॉर्न १', en: 'Musical horn I' },
  { file: 'musical-4.mp3',       hi: 'म्यूज़िकल हॉर्न २', en: 'Musical horn II' },
  { file: 'musical-5.mp3',       hi: 'म्यूज़िकल हॉर्न ३', en: 'Musical horn III' },
  { file: 'kangana.mp3',         hi: 'कंगना तेरा नी',    en: 'Kangana Tera Ni' },
  { file: 'magic-in-the-air.mp3', hi: 'मैजिक इन द एयर',  en: 'Magic In The Air' },
  { file: 'baby-shark.mp3',      hi: 'बेबी शार्क',       en: 'Baby Shark' },
];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.engineOn = false;
    this.hornBuffers = [];     // decoded samples, in HORN_FILES order
    this.lastHorn = -1;        // so we never repeat the same horn twice running
    this._hornNode = null;     // currently sounding sample
  }

  /**
   * Decode the horn samples up front. Called on the first user gesture, since
   * an AudioContext can't exist before one.
   */
  async loadHorns(base = 'audio/horns/') {
    const ctx = this._ensure();
    await Promise.all(HORN_FILES.map(async (h, i) => {
      try {
        const res = await fetch(base + h.file);
        if (!res.ok) throw new Error(res.status);
        this.hornBuffers[i] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) {
        console.warn('[truck-sim] horn failed to load:', h.file, e);
        this.hornBuffers[i] = null;      // synthesized fallback covers it
      }
    }));
    return this.hornBuffers.filter(Boolean).length;
  }

  /**
   * Play a decoded horn sample in full.
   * One press plays the WHOLE horn — these are tunes, and cutting them off after
   * a second turns "Kangana Tera Ni" into a beep. Returns its length in seconds,
   * or 0 if that slot isn't loaded.
   */
  _playHornSample(i) {
    const buf = this.hornBuffers[i];
    if (!buf) return 0;
    const ctx = this._ensure();
    // A new press interrupts the one still sounding, so presses don't stack.
    try { this._hornNode?.stop(); } catch { /* already ended */ }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.85;
    src.connect(g).connect(this.master);
    src.start();
    this._hornNode = src;
    this.lastHorn = i;
    return buf.duration;
  }

  /**
   * A different horn every time — never the same one twice in a row — and always
   * played through to the end. Returns the horn's info plus its `duration`, so
   * the caller can hold off retriggering until the tune has finished.
   */
  randomHorn(long = false) {
    if (!this.enabled) return null;
    const available = this.hornBuffers.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    if (!available.length) {
      // Samples not decoded (yet, or at all) — still vary the synth horn, or
      // every press sounds identical and the whole point is lost.
      const types = Sfx.HORNS.map((h) => h.id);
      let t = types[(Math.random() * types.length) | 0];
      if (t === this.lastSynth && types.length > 1) {
        t = types[(types.indexOf(t) + 1) % types.length];
      }
      this.lastSynth = t;
      this.horn(true, t);                       // full phrase, not a stub
      const info = Sfx.HORNS.find((h) => h.id === t);
      return info ? { ...info, duration: t === 'tune' ? 2.1 : 1.7 } : null;
    }
    let i = available[(Math.random() * available.length) | 0];
    if (available.length > 1 && i === this.lastHorn) {
      i = available[(available.indexOf(i) + 1) % available.length];
    }
    const duration = this._playHornSample(i);
    return { ...HORN_FILES[i], duration };
  }

  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /**
   * One note of the horn: a stack of detuned reed tones that don't start
   * together (which is what makes a real air horn sound "thick"), with the
   * pressure bend up at the attack and down at the release.
   */
  _hornNote(freq, at, dur, level = 1) {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, at);
    bus.gain.linearRampToValueAtTime(0.4 * level, at + 0.028);
    bus.gain.setValueAtTime(0.4 * level, at + Math.max(0.05, dur - 0.09));
    bus.gain.exponentialRampToValueAtTime(0.001, at + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.7;
    bus.connect(lp).connect(this.master);

    // fundamental + fifth + octave, each a touch late and a touch detuned
    [[1, 0, 'sawtooth', 0.5], [1.5, 0.010, 'sawtooth', 0.32], [2, 0.019, 'square', 0.17]]
      .forEach(([mult, delay, type, amp]) => {
        const o = ctx.createOscillator();
        o.type = type;
        const f = freq * mult;
        o.frequency.setValueAtTime(f * 0.94, at + delay);
        o.frequency.linearRampToValueAtTime(f, at + delay + 0.05);
        o.frequency.setValueAtTime(f, at + dur - 0.07);
        o.frequency.linearRampToValueAtTime(f * 0.93, at + dur);
        const g = ctx.createGain();
        g.gain.value = amp;
        o.connect(g).connect(bus);
        o.start(at + delay);
        o.stop(at + dur + 0.05);
      });
  }

  /**
   * The horn bank. These are the types actually bolted to North Indian lorries,
   * synthesized rather than sampled (no rights issues, no download, no latency).
   * Cycle them in game with `G`.
   */
  static HORNS = [
    { id: 'pressure', hi: 'प्रेशर हॉर्न', en: 'Pressure horn' },
    { id: 'tune',     hi: 'म्यूज़िकल हॉर्न', en: 'Musical tune horn' },
    { id: 'tarzan',   hi: 'टार्ज़न हॉर्न', en: 'Tarzan whooper' },
    { id: 'chord',    hi: 'पाँच तुरही',   en: '5-trumpet chord' },
    { id: 'peep',     hi: 'पीप-पीप',     en: 'Double peep' },
  ];

  horn(long = false, type = this.hornType || 'pressure') {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t0 = ctx.currentTime + 0.01;

    switch (type) {
      case 'tune':
        return this._tuneHorn(t0, long);

      case 'tarzan': {
        // The whooper: one siren voice gliding up and back down. Unmistakable,
        // and the single most annoying thing on the Grand Trunk Road.
        const sweeps = long ? 3 : 1;
        for (let i = 0; i < sweeps; i++) {
          const at = t0 + i * 0.72;
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(300, at);
          o.frequency.exponentialRampToValueAtTime(1150, at + 0.32);
          o.frequency.exponentialRampToValueAtTime(320, at + 0.68);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 3;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.3, at + 0.04);
          g.gain.setValueAtTime(0.3, at + 0.58);
          g.gain.exponentialRampToValueAtTime(0.001, at + 0.7);
          o.connect(lp).connect(g).connect(this.master);
          o.start(at); o.stop(at + 0.75);
        }
        return;
      }

      case 'chord': {
        // Five trumpets sounding together — a big fat major-sixth stack.
        const dur = long ? 1.7 : 0.6;
        [261.6, 329.6, 392, 440, 523.3].forEach((f, i) => {
          this._hornNote(f, t0 + i * 0.008, dur, 0.62);
        });
        return;
      }

      case 'peep': {
        // Two quick taps, the "peep peep" of a hurried mini-truck.
        this._hornNote(880, t0, 0.11, 0.8);
        this._hornNote(880, t0 + 0.17, 0.11, 0.8);
        if (long) {
          this._hornNote(880, t0 + 0.34, 0.11, 0.8);
          this._hornNote(1046, t0 + 0.51, 0.2, 0.8);
        }
        return;
      }

      default: {                        // pressure horn
        if (!long) {
          this._hornNote(392, t0, 0.42);
          this._hornNote(523, t0 + 0.13, 0.34, 0.85);
        } else {
          this._hornNote(392, t0, 1.5);
          this._hornNote(523, t0 + 0.06, 1.44, 0.85);
          this._hornNote(659, t0 + 0.12, 1.38, 0.55);
        }
        return;
      }
    }
  }

  /**
   * The musical tune horn: a bright major-pentatonic hook in the Punjabi
   * dhol-beat rhythm those multi-trumpet horns are famous for. This is an
   * original phrase in that style, not a transcription of any recording.
   */
  _tuneHorn(t0, long) {
    if (!long) {
      this._hornNote(392, t0, 0.4);
      this._hornNote(587, t0 + 0.14, 0.32, 0.85);
      return;
    }
    // [semitone-from-G4, start beat, length in beats]
    const BEAT = 0.17;
    const TUNE = [
      [0, 0, 1], [4, 1, 1], [7, 2, 1], [4, 3, 0.5], [0, 3.5, 0.5],
      [7, 4, 1], [9, 5, 1], [7, 6, 1], [4, 7, 1],
      [0, 8, 1.5], [4, 9.5, 0.5], [0, 10, 2],
    ];
    for (const [semi, beat, len] of TUNE) {
      const f = 392 * Math.pow(2, semi / 12);          // G4 root
      this._hornNote(f, t0 + beat * BEAT, len * BEAT * 0.92, 0.95);
    }
  }

  /**
   * Builds one loop of big-diesel chug.
   *
   * A truck doesn't buzz like a bike — the sound is a train of discrete
   * combustion events. At a lorry idle (~650 rpm, 6 cylinders, 4-stroke)
   * that's ~33 firings/sec, and each firing is a low thump plus injector
   * clatter, sitting on a broadband block rumble. Building the loop out of
   * actual pulses and then scrubbing it with playbackRate gives the real
   * chug-chug that a stack of oscillators can never produce.
   */
  _dieselLoop(ctx) {
    const rate = ctx.sampleRate;
    const FIRE = 20;                          // reference firings/sec at playbackRate 1
    const PERIODS = 40;                       // whole periods → seamless length
    const period = rate / FIRE;
    const len = Math.round(period * PERIODS);
    const fade = 700;                         // crossfade samples to kill the wrap click

    // Render len+fade, priming the filter state, then fold the tail into the head.
    const raw = new Float32Array(len + fade);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < raw.length; i++) {
      const t = (i % period) / rate;          // seconds since this cylinder fired
      const n = Math.random() * 2 - 1;

      // combustion thump — low, fast-decaying, with a slightly detuned second hit
      let s = Math.sin(2 * Math.PI * 46 * t) * Math.exp(-t * 40) * 1.0;
      s += Math.sin(2 * Math.PI * 92 * t) * Math.exp(-t * 78) * 0.32;
      s += Math.sin(2 * Math.PI * 31 * t) * Math.exp(-t * 26) * 0.45;   // sub weight

      // injector / valve clatter: a very short noise transient on each firing
      s += n * Math.exp(-t * 190) * 0.55;

      // block rumble — two cascaded one-pole lowpasses on noise
      lp += (n - lp) * 0.030;
      lp2 += (lp - lp2) * 0.030;
      s += lp2 * 2.6;

      raw[i] = s * 0.34;
    }
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    d.set(raw.subarray(0, len));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + raw[len + i] * (1 - k);
    }
    return buf;
  }

  /** Continuous diesel; playbackRate is engine speed, so pitch AND chug rate track together. */
  startEngine() {
    if (this.engineOn) return;
    const ctx = this._ensure();
    this.engineOn = true;

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    // heavy lowpass keeps it in truck territory; the peak adds chest.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.9;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 88; body.Q.value = 1.1; body.gain.value = 9;
    this.engFilter = lp;
    this.engGain.connect(body).connect(lp).connect(this.master);

    this.engSrc = ctx.createBufferSource();
    this.engSrc.buffer = this._dieselLoop(ctx);
    this.engSrc.loop = true;
    this.engSrc.playbackRate.value = 1;
    this.engSrc.connect(this.engGain);
    this.engSrc.start();

    // turbo whine — quiet, high, and load-dependent. This is the detail that
    // makes it read as "loaded truck" rather than "generator".
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 700;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    this.turbo.start();
  }

  updateEngine(speed, throttle) {
    if (!this.engineOn || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // idle 1.0 → ~2.6 at full chat; load raises it slightly without changing road speed
    const rpm = 1.0 + Math.min(1.35, speed / 20) + throttle * 0.3;
    this.engSrc.playbackRate.setTargetAtTime(rpm, now, 0.16);
    this.engFilter.frequency.setTargetAtTime(200 + speed * 9 + throttle * 220, now, 0.18);
    this.engGain.gain.setTargetAtTime(0.34 + throttle * 0.2, now, 0.2);

    this.turbo.frequency.setTargetAtTime(620 + rpm * 780, now, 0.2);
    this.turboGain.gain.setTargetAtTime(throttle * 0.016 * Math.min(1, speed / 8), now, 0.3);
  }

  /** The reversing beeper — a plain square-wave chirp, as fitted. */
  reverseBeep() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.10, t0 + 0.01);
    g.gain.setValueAtTime(0.10, t0 + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.27);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.3);
  }

  /** The thud of a loaded lorry dropping into a pothole. */
  thud(force = 1) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t0 = ctx.currentTime;
    // low body boom
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4 * force + 0.05, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 0.36);
    // suspension/chassis rattle on top
    const len = Math.floor(ctx.sampleRate * 0.22);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = b;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.value = 0.16 * force;
    src.connect(bp).connect(ng).connect(this.master);
    src.start(t0);
  }

  /** The short hiss of a gutkha spit out of the window. */
  spit() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.3);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // sharp attack, quick decay — a wet "ptooey", not a long hiss
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * (k < 0.05 ? k / 0.05 : 1);
    }
    const src = ctx.createBufferSource();
    src.buffer = b;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t0);
    bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.25);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
  }

  /** Air-brake release — the loud pneumatic hiss every Indian truck makes. */
  airBrake() {
    if (!this.enabled) return;
    const ctx = this._ensure();
    const t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    const src = ctx.createBufferSource();
    src.buffer = b;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this.turboGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}
