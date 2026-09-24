// Tiny synthesized sound kit — no audio files required.

const STORAGE_KEY = 'battleship:muted';

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const length = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  ready() {
    const ctx = this.ensure();
    if (!ctx || this.muted || ctx.state !== 'running') return null;
    return ctx;
  }

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
    src.connect(f).connect(g).connect(this.master);
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
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

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

  message() {
    this.tone({ type: 'sine', freq: 1200, duration: 0.07, gain: 0.08 });
  }
}

export const sound = new Sound();
