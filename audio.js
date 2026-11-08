/**
 * BOWLING 2600 DELUXE - Dual Audio Engine (Modern Stereo + Atari 2600 TIA Synthesizer)
 * Implements both rich procedural modern bowling alley audio and the exact TIA sound
 * registers from Bowling.bin ($F688-$F6AB).
 */

class BowlingAudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.mode = 'modern'; // 'modern' | 'tia'
    this.rollNodes = null;
    this.noiseBuffer = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this._createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _createNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Generate LFSR-like & white noise samples
    let lfsr = 0x1f;
    for (let i = 0; i < bufferSize; i++) {
      if (i % 28 === 0) {
        const bit = ((lfsr >> 0) ^ (lfsr >> 2)) & 1;
        lfsr = (lfsr >> 1) | (bit << 4);
      }
      const poly = (lfsr & 1) ? 0.6 : -0.6;
      const white = (Math.random() * 2 - 1) * 0.4;
      data[i] = poly + white;
    }
    this.noiseBuffer = buffer;
  }

  setMode(mode) {
    this.stopRolling();
    this.mode = mode;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopRolling();
    }
    return this.muted;
  }

  playMoveTick() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    if (this.mode === 'tia') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.03);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    }

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
  }

  playApproachStep(stepIndex) {
    if (this.muted) return;
    this.init();
    if (this.mode === 'tia') return; // Original ROM is silent during steps 1..4
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const baseFreq = 110 + stepIndex * 18;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.06);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  startRolling() {
    if (this.muted) return;
    this.init();
    this.stopRolling();

    const now = this.ctx.currentTime;

    if (this.mode === 'tia') {
      // Authentic ROM $F690: AUDC0 = $0F (poly5), AUDF0 = $1F, AUDV0 = $80 & $0F
      const osc = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(58, now);

      mod.type = 'square';
      mod.frequency.setValueAtTime(19, now);
      modGain.gain.setValueAtTime(22, now);

      gain.gain.setValueAtTime(0.11, now);

      mod.connect(modGain);
      modGain.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      mod.start(now);

      this.rollNodes = { osc, mod, gain, mode: 'tia' };
    } else {
      // Modern Stereo Bowling Ball Thud + Hardwood Rolling Rumble
      // 1. Initial ball drop thud on maple lane
      const thudOsc = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(135, now);
      thudOsc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
      thudGain.gain.setValueAtTime(0.28, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      thudOsc.connect(thudGain);
      thudGain.connect(this.ctx.destination);
      thudOsc.start(now);
      thudOsc.stop(now + 0.16);

      // 2. Continuous filtered rolling noise + low resonant hum with stereo panner
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(190, now);
      filter.Q.setValueAtTime(2.4, now);

      const subOsc = this.ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.setValueAtTime(68, now);

      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.09, now);

      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.01, now);
      masterGain.gain.linearRampToValueAtTime(0.18, now + 0.08);

      const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

      noise.connect(filter);
      filter.connect(masterGain);
      subOsc.connect(subGain);
      subGain.connect(masterGain);

      if (panner) {
        panner.pan.setValueAtTime(-0.55, now);
        masterGain.connect(panner);
        panner.connect(this.ctx.destination);
      } else {
        masterGain.connect(this.ctx.destination);
      }

      noise.start(now);
      subOsc.start(now);

      this.rollNodes = {
        noise,
        subOsc,
        filter,
        masterGain,
        panner,
        mode: 'modern'
      };
    }
  }

  updateRolling(progress, isCurving) {
    if (!this.rollNodes || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.rollNodes.mode === 'tia') {
      // Modulate volume like frame counter $80 & $0F in ROM
      const pulse = 0.06 + ((Math.floor(progress * 60) % 16) / 16) * 0.09;
      this.rollNodes.gain.gain.setTargetAtTime(pulse, now, 0.015);
    } else {
      // Pan from left (-0.55) to right (+0.55) as ball rolls toward pin deck
      if (this.rollNodes.panner) {
        const pan = -0.55 + Math.min(1, Math.max(0, progress)) * 1.1;
        this.rollNodes.panner.pan.setTargetAtTime(pan, now, 0.03);
      }
      // Pitch rises slightly with spin/curve
      const freq = 180 + progress * 90 + (isCurving ? 45 : 0);
      this.rollNodes.filter.frequency.setTargetAtTime(freq, now, 0.03);
    }
  }

  stopRolling() {
    if (!this.rollNodes) return;
    try {
      if (this.rollNodes.osc) this.rollNodes.osc.stop();
      if (this.rollNodes.mod) this.rollNodes.mod.stop();
      if (this.rollNodes.noise) this.rollNodes.noise.stop();
      if (this.rollNodes.subOsc) this.rollNodes.subOsc.stop();
    } catch (_) {}
    this.rollNodes = null;
  }

  /**
   * Plays pin collision sound.
   * ROM $F69B-$F6A9: $A5 starts at 8, decrements each frame,
   * AUDF1 = $A5 ^ $0F, AUDC1 = $0C, AUDV1 = $A5
   */
  playPinHit(comboCount = 1) {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    if (this.mode === 'tia') {
      // Exact Atari 2600 TIA $0C tone sweep for 8 frames (8 / 60s = 0.133s)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';

      for (let a5 = 8; a5 >= 1; a5--) {
        const stepTime = now + (8 - a5) * (1 / 60);
        const audf1 = (a5 ^ 0x0f) & 0x1f;
        // TIA $0C frequency = 31400 / 3 / (audf1 + 1)
        const freq = 10466 / (audf1 + 1);
        osc.frequency.setValueAtTime(freq, stepTime);
        gain.gain.setValueAtTime((a5 / 15) * 0.22, stepTime);
      }
      gain.gain.setValueAtTime(0.001, now + 8 / 60);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } else {
      // Modern Realistic Hardwood Maple Pin Clatter (layered wooden resonances + crack)
      const layers = Math.min(3, 1 + Math.floor(comboCount / 3));
      for (let i = 0; i < layers; i++) {
        const delay = i * 0.018 + Math.random() * 0.012;
        const t = now + delay;

        // Sharp wooden crack
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        const basePitch = 480 + Math.random() * 380;
        osc.frequency.setValueAtTime(basePitch, t);
        osc.frequency.exponentialRampToValueAtTime(140, t + 0.09);

        osc2.type = 'square';
        osc2.frequency.setValueAtTime(basePitch * 1.58, t);
        osc2.frequency.exponentialRampToValueAtTime(290, t + 0.055);

        gain.gain.setValueAtTime(0.22 / layers, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

        if (this.ctx.createStereoPanner) {
          const pan = this.ctx.createStereoPanner();
          pan.pan.setValueAtTime(0.45 + (Math.random() - 0.5) * 0.3, t);
          osc.connect(gain);
          osc2.connect(gain);
          gain.connect(pan);
          pan.connect(this.ctx.destination);
        } else {
          osc.connect(gain);
          osc2.connect(gain);
          gain.connect(this.ctx.destination);
        }

        osc.start(t);
        osc2.start(t);
        osc.stop(t + 0.12);
        osc2.stop(t + 0.07);
      }
    }
  }

  playGutter() {
    if (this.muted) return;
    this.init();
    if (this.mode === 'tia') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.18);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playCelebration(type) {
    if (this.muted) return;
    this.init();
    if (this.mode === 'tia') return; // Original ROM only flashes colors silently on strike/spare

    const now = this.ctx.currentTime;
    let notes = [];
    if (type === 'strike') {
      notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    } else if (type === 'spare') {
      notes = [440, 554.37, 659.25]; // A4 C#5 E5
    } else if (type === 'gameover') {
      notes = [392.0, 493.88, 587.33, 783.99]; // G4 B4 D5 G5
    }

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.085;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  }
}

window.bowlingAudio = new BowlingAudioEngine();
