// ---- Tiny synthesised sound effects (no external files) ----
export class Audio {
  ctx: AudioContext | null = null;
  enabled = true;
  last: Record<string, number> = {};
  master: GainNode | null = null;

  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); this.master = this.ctx.createGain(); this.master.gain.value = 0.35; this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
  }

  play(name: string) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    const minGap: Record<string, number> = { chop: 150, pick: 150, hit: 60, arrow: 80, stone: 200, alarm: 3000, death: 100 };
    if (this.last[name] && now - this.last[name] < (minGap[name] ?? 40)) return;
    this.last[name] = now;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    switch (name) {
      case 'click': this.tone(600, 0.04, 'square', 0.15); break;
      case 'place': this.tone(220, 0.08, 'triangle', 0.3); this.tone(330, 0.1, 'triangle', 0.3, 0.06); break;
      case 'complete': this.tone(440, 0.1, 'triangle', 0.3); this.tone(554, 0.1, 'triangle', 0.3, 0.1); this.tone(659, 0.2, 'triangle', 0.3, 0.2); break;
      case 'trained': this.tone(523, 0.08, 'square', 0.15); this.tone(659, 0.12, 'square', 0.15, 0.08); break;
      case 'equip': this.noise(0.08, 0.3, 1200); this.tone(880, 0.08, 'triangle', 0.2, 0.05); break;
      case 'chop': this.noise(0.05, 0.4, 900); break;
      case 'pick': this.noise(0.04, 0.3, 2500); this.tone(1800, 0.03, 'square', 0.08); break;
      case 'hit': this.noise(0.06, 0.4, 1500); this.tone(160, 0.06, 'square', 0.15); break;
      case 'arrow': this.noise(0.12, 0.15, 4000); break;
      case 'stone': this.noise(0.15, 0.3, 600); break;
      case 'death': this.tone(200, 0.25, 'sawtooth', 0.15); this.tone(120, 0.3, 'sawtooth', 0.12, 0.1); break;
      case 'destroy': this.noise(0.5, 0.5, 400); this.tone(80, 0.5, 'sawtooth', 0.2); break;
      case 'alarm': for (let i = 0; i < 3; i++) { this.tone(700, 0.12, 'square', 0.18, i * 0.18); this.tone(500, 0.12, 'square', 0.18, i * 0.18 + 0.09); } break;
      case 'message': this.tone(880, 0.06, 'sine', 0.2); this.tone(1100, 0.1, 'sine', 0.2, 0.07); break;
      case 'victory': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.3, i * 0.18)); break;
      case 'defeat': [400, 350, 300, 200].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.2, i * 0.3)); break;
    }
    void t;
  }

  // ---- music: a small looping modal tune ----
  musicOn = true;
  private musicTimer = 0;
  private musicStep = 0;
  private musicNext = 0;
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.musicNext = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 200);
  }
  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = 0; } }
  private scheduleMusic() {
    if (!this.ctx || !this.master || !this.musicOn || !this.enabled) return;
    const c = this.ctx;
    // D dorian: D E F G A B C, melody in 8th notes at ~92 bpm
    const beat = 60 / 92 / 2;
    const mel = [62, 65, 69, 67, 65, 62, 60, 62, 65, 69, 72, 69, 67, 65, 67, 65, 62, 60, 57, 60, 62, 65, 62, 60, 62, 0, 62, 65, 69, 67, 65, 62,
                 69, 72, 74, 72, 69, 67, 65, 67, 69, 72, 69, 67, 65, 62, 60, 62, 65, 67, 65, 62, 60, 57, 60, 62, 62, 0, 0, 0, 0, 0, 0, 0];
    const bass = [38, 0, 45, 0, 41, 0, 43, 0, 38, 0, 45, 0, 36, 0, 43, 0];
    while (this.musicNext < c.currentTime + 0.6) {
      const i = this.musicStep % mel.length;
      const n = mel[i];
      if (n) this.pluck(440 * Math.pow(2, (n - 69) / 12), beat * 1.8, 0.09, this.musicNext);
      if (i % 4 === 0) { const b = bass[(i / 4) % bass.length]; if (b) this.pluck(440 * Math.pow(2, (b - 69) / 12), beat * 3.5, 0.07, this.musicNext, 'triangle'); }
      if (i % 8 === 0) this.drum(this.musicNext);
      this.musicNext += beat; this.musicStep++;
    }
  }
  private pluck(freq: number, dur: number, vol: number, t: number, type: OscillatorType = 'triangle') {
    const c = this.ctx!;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.master!);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  private drum(t: number) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 0.3);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master!);
    o.start(t); o.stop(t + dur + 0.02);
  }
  private noise(dur: number, vol: number, cutoff: number) {
    const c = this.ctx!, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master!);
    src.start(t);
  }
}
