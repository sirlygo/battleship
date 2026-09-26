// Synthesized sound: effects, generative music and ocean ambience — no audio files.

const MUTE_KEY = 'battleship:muted';
const VOLUME_KEY = 'battleship:volumes';
const DEFAULT_VOLUMES = { effects: 0.8, music: 0.35, ambience: 0 };

// A minor progression: Am – F – C – G (root, third, fifth in Hz).
const CHORDS = [
  [110.0, 130.81, 164.81],
  [87.31, 110.0, 130.81],
  [130.81, 164.81, 196.0],
  [98.0, 123.47, 146.83],
];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

class Sound {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.buses = {};
    this.volumes = readJson(VOLUME_KEY, DEFAULT_VOLUMES);
    this.mood = 'calm';
    this.musicTimer = null;
    this.ambienceStarted = false;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    const unlock = () => {
      const ctx = this.ensure();
      if (!ctx) return;
      const start = () => this.startBackground();
      if (ctx.state === 'suspended') ctx.resume().then(start);
      else start();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp);

    ['effects', 'music', 'ambience'].forEach((name) => {
      const gain = ctx.createGain();
      gain.gain.value = this.busLevel(name);
      gain.connect(this.master);
      this.buses[name] = gain;
    });

    // Echo shared by the music's plucked notes.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.36;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.echo.connect(tone).connect(feedback).connect(this.echo);
    tone.connect(this.buses.music);

    const length = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Perceived loudness: sliders feel linear when squared.
  busLevel(name) {
    const v = this.volumes[name] ?? 0;
    const scale = name === 'effects' ? 0.6 : name === 'music' ? 0.5 : 0.6;
    return v * v * scale;
  }

  setVolume(name, value) {
    this.volumes[name] = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volumes));
    } catch {
      /* storage unavailable */
    }
    const bus = this.buses[name];
    if (bus && this.ctx) bus.gain.setTargetAtTime(this.busLevel(name), this.ctx.currentTime, 0.05);
    this.startBackground();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  setMood(mood) {
    this.mood = mood === 'battle' ? 'battle' : 'calm';
  }

  running() {
    return this.ctx && this.ctx.state === 'running';
  }

  ready() {
    const ctx = this.ensure();
    if (!ctx || this.muted || ctx.state !== 'running' || this.volumes.effects <= 0) return null;
    return ctx;
  }

  // ---- background layers -------------------------------------------------

  startBackground() {
    if (!this.running()) return;
    if (!this.ambienceStarted && this.volumes.ambience > 0) this.startAmbience();
    if (!this.musicTimer && this.volumes.music > 0) this.startMusic();
  }

  startAmbience() {
    const ctx = this.ctx;
    this.ambienceStarted = true;
    const layer = (freq, type, q, lfoRate, depth, base) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const swell = ctx.createGain();
      swell.gain.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = depth;
      lfo.connect(lfoDepth).connect(swell.gain);
      src.connect(filter).connect(swell).connect(this.buses.ambience);
      src.start(0, Math.random() * 2);
      lfo.start();
    };
    layer(380, 'lowpass', 0.7, 0.07, 0.35, 0.55); // rolling swell
    layer(1300, 'bandpass', 0.6, 0.11, 0.1, 0.12); // surface hiss
    layer(160, 'lowpass', 0.9, 0.045, 0.25, 0.4); // deep rumble
  }

  startMusic() {
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.running()) return;
      if (this.volumes.music <= 0) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
        return;
      }
      const battle = this.mood === 'battle';
      const beat = battle ? 0.3 : 0.5;
      while (next < this.ctx.currentTime + 0.6) {
        const barStep = step % 16;
        const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
        if (barStep === 0) this.pad(chord, next, beat * 16);
        const arpEvery = battle ? 1 : 2;
        if (barStep % arpEvery === 0 && Math.random() < (battle ? 0.8 : 0.6)) {
          const note = chord[Math.floor(Math.random() * chord.length)] * (Math.random() < 0.5 ? 4 : 2);
          this.pluck(note, next);
        }
        if (battle && barStep % 4 === 0) this.pulse(next, barStep === 0 ? 1 : 0.6);
        if (battle && barStep % 4 === 2) this.tick(next);
        next += beat;
        step += 1;
      }
    };
    this.musicTimer = setInterval(tick, 150);
    tick();
  }

  pad(chord, at, duration) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, at);
    filter.frequency.linearRampToValueAtTime(900, at + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(420, at + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.09, at + 1.2);
    gain.gain.setValueAtTime(0.09, at + duration - 1);
    gain.gain.linearRampToValueAtTime(0.0001, at + duration + 0.4);
    filter.connect(gain).connect(this.buses.music);
    chord.forEach((freq) => {
      [-6, 6].forEach((detune) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(at);
        osc.stop(at + duration + 0.5);
      });
    });
  }

  pluck(freq, at) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.07, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    osc.connect(gain);
    gain.connect(this.buses.music);
    gain.connect(this.echo);
    osc.start(at);
    osc.stop(at + 1);
  }

  pulse(at, strength) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, at);
    osc.frequency.exponentialRampToValueAtTime(40, at + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35 * strength, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(gain).connect(this.buses.music);
    osc.start(at);
    osc.stop(at + 0.4);
  }

  tick(at) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    src.connect(filter).connect(gain).connect(this.buses.music);
    src.start(at, Math.random());
    src.stop(at + 0.08);
  }

  // ---- effect primitives -------------------------------------------------

  noise({ duration, filter = 'lowpass', freq = 1000, q = 1, gain = 0.5, attack = 0.005, freqEnd = null, delay = 0 }) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.buses.effects);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  tone({ type = 'sine', freq = 440, freqEnd = null, duration = 0.2, gain = 0.3, attack = 0.01, delay = 0 }) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.buses.effects);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // ---- effects -----------------------------------------------------------

  click() {
    this.tone({ type: 'triangle', freq: 880, freqEnd: 660, duration: 0.06, gain: 0.12 });
  }

  place() {
    this.tone({ type: 'sine', freq: 180, freqEnd: 90, duration: 0.18, gain: 0.35 });
    this.noise({ duration: 0.25, filter: 'lowpass', freq: 600, gain: 0.2 });
  }

  rotate() {
    this.tone({ type: 'triangle', freq: 520, freqEnd: 780, duration: 0.08, gain: 0.1 });
  }

  error() {
    this.tone({ type: 'square', freq: 160, duration: 0.14, gain: 0.08 });
    this.tone({ type: 'square', freq: 120, duration: 0.18, gain: 0.08, delay: 0.1 });
  }

  fire() {
    this.tone({ type: 'sine', freq: 120, freqEnd: 40, duration: 0.35, gain: 0.8 });
    this.noise({ duration: 0.45, filter: 'lowpass', freq: 2200, freqEnd: 200, gain: 0.7 });
    this.tone({ type: 'sine', freq: 1400, freqEnd: 500, duration: 0.9, gain: 0.05, attack: 0.3, delay: 0.1 });
  }

  splash() {
    this.noise({ duration: 0.9, filter: 'bandpass', freq: 1400, freqEnd: 500, q: 0.8, gain: 0.6, attack: 0.02 });
    this.noise({ duration: 0.4, filter: 'lowpass', freq: 400, gain: 0.35 });
  }

  explosion(big = false) {
    this.tone({ type: 'sine', freq: 90, freqEnd: 28, duration: big ? 1.3 : 0.8, gain: 0.9 });
    this.noise({ duration: big ? 1.8 : 1.1, filter: 'lowpass', freq: 1800, freqEnd: 120, gain: 0.9 });
    this.noise({ duration: 0.25, filter: 'highpass', freq: 2500, gain: 0.25 });
    if (big) {
      [0.25, 0.5, 0.8].forEach((delay) =>
        this.noise({ duration: 0.7, filter: 'lowpass', freq: 900, freqEnd: 100, gain: 0.5, delay })
      );
    }
  }

  sunk() {
    this.explosion(true);
    [392, 311, 262].forEach((freq, i) =>
      this.tone({ type: 'sawtooth', freq, duration: 0.5, gain: 0.05, delay: 0.5 + i * 0.18 })
    );
  }

  yourTurn() {
    this.tone({ type: 'sine', freq: 660, duration: 0.14, gain: 0.18 });
    this.tone({ type: 'sine', freq: 990, duration: 0.22, gain: 0.18, delay: 0.12 });
  }

  joined() {
    [523, 659, 784].forEach((freq, i) => this.tone({ type: 'triangle', freq, duration: 0.2, gain: 0.14, delay: i * 0.09 }));
  }

  victory() {
    [523, 659, 784, 1047, 784, 1047].forEach((freq, i) =>
      this.tone({ type: 'triangle', freq, duration: 0.3, gain: 0.2, delay: i * 0.14 })
    );
  }

  defeat() {
    [392, 370, 349, 262].forEach((freq, i) =>
      this.tone({ type: 'sawtooth', freq, duration: 0.45, gain: 0.07, delay: i * 0.3 })
    );
  }

  // Board-game pieces
  clack() {
    this.noise({ duration: 0.09, filter: 'bandpass', freq: 2200, q: 2.5, gain: 0.5, attack: 0.002 });
    this.tone({ type: 'triangle', freq: 320, freqEnd: 180, duration: 0.08, gain: 0.25, attack: 0.002 });
  }

  capture() {
    this.clack();
    this.noise({ duration: 0.25, filter: 'lowpass', freq: 900, freqEnd: 200, gain: 0.5, delay: 0.05 });
    this.tone({ type: 'sine', freq: 140, freqEnd: 60, duration: 0.25, gain: 0.4, delay: 0.04 });
  }

  crown() {
    [784, 988, 1175, 1568].forEach((freq, i) =>
      this.tone({ type: 'triangle', freq, duration: 0.35, gain: 0.14, delay: i * 0.07 })
    );
  }

  message() {
    this.tone({ type: 'sine', freq: 1200, duration: 0.07, gain: 0.08 });
  }
}

export const sound = new Sound();
