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
