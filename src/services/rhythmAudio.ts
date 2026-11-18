import { BEAT_INTERVAL_MS, LEAD_IN_WORDS } from '../constants/animals';
import { NeuralTtsState, ThaiNeuralTtsService } from './thaiNeuralTts';

export class RhythmAudioEngine {
  private ctx: AudioContext | null = null;
  private rafId: number | null = null;
  private activeOscillators: Set<AudioNode> = new Set();
  private activeUtterances: Set<SpeechSynthesisUtterance> = new Set();
  private cancelled = false;
  private lastSpokenLeadBeat = -1;
  private thaiVoice: SpeechSynthesisVoice | null = null;
  private preferredVoiceURI: string | null = null;
  private voicesListenerAttached = false;
  private neuralTts: ThaiNeuralTtsService;
  private neuralStateListeners = new Set<(state: NeuralTtsState) => void>();

  constructor() {
    this.neuralTts = new ThaiNeuralTtsService((state) => {
      this.neuralStateListeners.forEach((cb) => cb(state));
    });
  }

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.loadThaiVoice();
    return this.ctx;
  }

  public getNeuralTtsState(): NeuralTtsState {
    return this.neuralTts.getState();
  }

  public subscribeNeuralTtsState(
    cb: (state: NeuralTtsState) => void
  ): () => void {
    this.neuralStateListeners.add(cb);
    cb(this.neuralTts.getState());
    return () => {
      this.neuralStateListeners.delete(cb);
    };
  }

  public async warmupThaiTts(): Promise<boolean> {
    const ctx = this.ensureContext();
    return this.neuralTts.warmup(ctx);
  }

  public hasBrowserThaiVoice(): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }
    return window.speechSynthesis
      .getVoices()
      .some((v) => v.lang.toLowerCase().startsWith('th'));
  }

  public getAvailableThaiVoices(): SpeechSynthesisVoice[] {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    const voices = window.speechSynthesis.getVoices();
    return voices.filter((v) => v.lang.toLowerCase().startsWith('th'));
  }

  public setPreferredVoiceURI(uri: string | null): void {
    this.preferredVoiceURI = uri;
    this.loadThaiVoice();
  }

  public subscribeVoicesChanged(callback: () => void): () => void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return () => {};
    }
    const handler = () => {
      this.loadThaiVoice();
      callback();
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
    };
  }

  private loadThaiVoice(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!this.voicesListenerAttached) {
      this.voicesListenerAttached = true;
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        this.loadThaiVoice();
      });
    }
    const voices = window.speechSynthesis.getVoices();
    if (this.preferredVoiceURI) {
      const exact = voices.find((v) => v.voiceURI === this.preferredVoiceURI);
      if (exact) {
        this.thaiVoice = exact;
        return;
      }
    }
    const th =
      voices.find((v) => v.lang.toLowerCase().startsWith('th')) ?? null;
    this.thaiVoice = th;
  }

  private scheduleNeuralWord(
    word: string,
    whenCtxTime: number,
    stepSec: number
  ): boolean {
    if (!this.ctx) return false;
    const buffer = this.neuralTts.getWordBuffer(word);
    if (!buffer) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    // Fit word cleanly inside the beat slot if user selects Fast (0.2s / 0.35s)
    const maxAllowedDur = Math.max(0.18, stepSec * 0.92);
    if (buffer.duration > maxAllowedDur) {
      src.playbackRate.value = Math.min(1.85, buffer.duration / maxAllowedDur);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1.15, whenCtxTime);

    src.connect(gain);
    gain.connect(this.ctx.destination);

    this.activeOscillators.add(src);
    src.onended = () => {
      this.activeOscillators.delete(src);
    };
    src.start(whenCtxTime);
    return true;
  }

  private speakLeadWordFallback(word: string, beatIntervalMs: number): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.loadThaiVoice();
    if (!this.thaiVoice) return;

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = 'th-TH';
      utter.voice = this.thaiVoice;
      utter.rate = Math.min(2.8, Math.max(1.45, 760 / beatIntervalMs));
      utter.pitch = 1.05;
      utter.volume = 1.0;

      this.activeUtterances.add(utter);
      const cleanup = () => {
        this.activeUtterances.delete(utter);
      };
      utter.onend = cleanup;
      utter.onerror = cleanup;

      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore Web Speech errors
    }
  }

  private scheduleTone(
    whenCtxTime: number,
    freq: number,
    gainPeak: number,
    durationSec = 0.08
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, whenCtxTime);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(120, freq * 0.65),
      whenCtxTime + durationSec
    );

    gain.gain.setValueAtTime(0.0001, whenCtxTime);
    gain.gain.exponentialRampToValueAtTime(gainPeak, whenCtxTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, whenCtxTime + durationSec);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    this.activeOscillators.add(osc);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
    };
    osc.start(whenCtxTime);
    osc.stop(whenCtxTime + durationSec + 0.01);
  }

  /**
   * Synthesizes a crisp short whistle beat using detuned dual sine tones,
   * a 42 Hz pea-whistle trill LFO, and bandpass-filtered breath air.
   */
  private scheduleWhistleBeat(
    whenCtxTime: number,
    baseFreq: number,
    gainPeak: number,
    durationSec = 0.085
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    const masterGain = ctx.createGain();

    oscA.type = 'sine';
    oscB.type = 'sine';
    oscA.frequency.setValueAtTime(baseFreq, whenCtxTime);
    oscB.frequency.setValueAtTime(baseFreq * 1.042, whenCtxTime);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(42, whenCtxTime);
    lfoDepth.gain.setValueAtTime(85, whenCtxTime);
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscA.frequency);
    lfoDepth.connect(oscB.frequency);

    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * (durationSec + 0.02)));
    const noiseBuffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(baseFreq, whenCtxTime);
    bandpass.Q.setValueAtTime(3.2, whenCtxTime);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gainPeak * 0.25, whenCtxTime);

    masterGain.gain.setValueAtTime(0.0001, whenCtxTime);
    masterGain.gain.exponentialRampToValueAtTime(gainPeak, whenCtxTime + 0.008);
    masterGain.gain.setValueAtTime(gainPeak * 0.85, whenCtxTime + durationSec * 0.65);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, whenCtxTime + durationSec);

    oscA.connect(masterGain);
    oscB.connect(masterGain);
    noiseSrc.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.activeOscillators.add(oscA);
    this.activeOscillators.add(oscB);
    this.activeOscillators.add(lfo);
    this.activeOscillators.add(noiseSrc);

    oscA.onended = () => {
      this.activeOscillators.delete(oscA);
      this.activeOscillators.delete(oscB);
      this.activeOscillators.delete(lfo);
      this.activeOscillators.delete(noiseSrc);
    };

    const stopTime = whenCtxTime + durationSec + 0.01;
    oscA.start(whenCtxTime);
    oscB.start(whenCtxTime);
    lfo.start(whenCtxTime);
    noiseSrc.start(whenCtxTime);
    oscA.stop(stopTime);
    oscB.stop(stopTime);
    lfo.stop(stopTime);
    noiseSrc.stop(stopTime);
  }

  public playPassChime(): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      this.scheduleTone(now + idx * 0.08, freq, 0.16, 0.22);
    });
  }

  public playFailTone(): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime + 0.02;
    this.scheduleTone(now, 311.13, 0.2, 0.16);
    this.scheduleTone(now + 0.14, 220.0, 0.22, 0.28);
  }

  /**
   * Ensures in-browser Thai Neural TTS is loaded (if no browser th-TH voice or preferred),
   * then plays "หมู → หมา → กา → ไก่ → 1 → 2 → 3 → 4" synchronized with whistle beats.
   */
  public async playLeadInPreview(callbacks: {
    beatIntervalMs?: number;
    speakLeadIn?: boolean;
    onBeat?: (beatIndex: number) => void;
    onComplete?: () => void;
  }): Promise<void> {
    this.stop();
    this.cancelled = false;
    this.lastSpokenLeadBeat = -1;

    const intervalMs = callbacks.beatIntervalMs ?? BEAT_INTERVAL_MS;
    const speak = callbacks.speakLeadIn ?? true;
    const ctx = this.ensureContext();

    if (speak && !this.neuralTts.isReady() && !this.preferredVoiceURI) {
      await this.neuralTts.warmup(ctx);
      if (this.cancelled) return;
    }

    const lookaheadSec = 0.08;
    const startCtxTime = ctx.currentTime + lookaheadSec;
    const startPerfMs = performance.now() + lookaheadSec * 1000;
    const stepSec = intervalMs / 1000;
    const whistleDurSec = Math.min(0.085, stepSec * 0.42);

    const useNeural = speak && this.neuralTts.isReady() && !this.preferredVoiceURI;

    for (let i = 0; i < 8; i++) {
      const t = startCtxTime + i * stepSec;
      const freq = i < 4 ? 2550 : i === 7 ? 2950 : 2720;
      const gain = i === 7 ? 0.1 : 0.065;
      this.scheduleWhistleBeat(t, freq, gain, whistleDurSec);
      if (useNeural) {
        this.scheduleNeuralWord(LEAD_IN_WORDS[i], t, stepSec);
      }
    }

    let lastEmittedBeat = -1;
    const tick = () => {
      if (this.cancelled) return;
      const elapsedMs = performance.now() - startPerfMs;
      if (elapsedMs >= 0) {
        const currentBeat = Math.floor(elapsedMs / intervalMs);
        if (currentBeat !== lastEmittedBeat && currentBeat < 8) {
          lastEmittedBeat = currentBeat;
          callbacks.onBeat?.(currentBeat);
          if (speak && !useNeural && currentBeat !== this.lastSpokenLeadBeat) {
            this.lastSpokenLeadBeat = currentBeat;
            this.speakLeadWordFallback(LEAD_IN_WORDS[currentBeat], intervalMs);
          }
        }
        if (elapsedMs >= 8 * intervalMs) {
          callbacks.onComplete?.();
          return;
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Runs one full 16-beat round timeline at the chosen beat interval:
   * - Beats 0..7: 8 lead-in beats ("หมู → หมา → กา → ไก่ → หนึ่ง → สอง → สาม → สี่")
   * - Beats 8..15: 8 answer beats (pure whistle rhythm beats only, NO spoken words)
   */
  public startRoundTimeline(callbacks: {
    beatIntervalMs?: number;
    speakLeadIn: boolean;
    onLeadInBeat: (beatIndex: number, word: string) => void;
    onAnswerPhaseStart: (answerStartPerfMs: number) => void;
    onAnswerBeat: (beatIndex: number) => void;
    onAnswerPhaseEnd: () => void;
  }): void {
    this.stop();
    this.cancelled = false;
    this.lastSpokenLeadBeat = -1;

    const intervalMs = callbacks.beatIntervalMs ?? BEAT_INTERVAL_MS;
    const ctx = this.ensureContext();
    if (callbacks.speakLeadIn && !this.neuralTts.isReady()) {
      void this.neuralTts.warmup(ctx);
    }

    const lookaheadSec = 0.1;
    const startCtxTime = ctx.currentTime + lookaheadSec;
    const startPerfMs = performance.now() + lookaheadSec * 1000;
    const stepSec = intervalMs / 1000;
    const whistleDurSec = Math.min(0.085, stepSec * 0.42);
    const useNeural =
      callbacks.speakLeadIn &&
      this.neuralTts.isReady() &&
      !this.preferredVoiceURI;

    // Schedule all 8 lead-in whistle beats + Thai TTS audio (beats 0..7)
    for (let i = 0; i < 8; i++) {
      const t = startCtxTime + i * stepSec;
      const freq = i < 4 ? 2550 : i === 7 ? 2950 : 2720;
      const gain = i === 7 ? 0.1 : 0.065;
      this.scheduleWhistleBeat(t, freq, gain, whistleDurSec);
      if (useNeural) {
        this.scheduleNeuralWord(LEAD_IN_WORDS[i], t, stepSec);
      }
    }

    // Schedule all 8 answer-phase whistle beats (beats 8..15 -> answer indices 0..7)
    // Pure whistle beats only — no answer speech!
    for (let j = 0; j < 8; j++) {
      const t = startCtxTime + (8 + j) * stepSec;
      const freq = j === 0 ? 3150 : 2850;
      const gain = j === 0 ? 0.125 : 0.095;
      this.scheduleWhistleBeat(t, freq, gain, whistleDurSec);
    }

    let lastEmittedBeat = -1;
    let answerStarted = false;

    const tick = () => {
      if (this.cancelled) return;
      const nowPerf = performance.now();
      const elapsedMs = nowPerf - startPerfMs;

      if (elapsedMs >= 0) {
        const currentBeat = Math.floor(elapsedMs / intervalMs);

        if (currentBeat !== lastEmittedBeat && currentBeat < 16) {
          lastEmittedBeat = currentBeat;

          if (currentBeat < 8) {
            const word = LEAD_IN_WORDS[currentBeat];
            callbacks.onLeadInBeat(currentBeat, word);
            if (
              callbacks.speakLeadIn &&
              !useNeural &&
              currentBeat !== this.lastSpokenLeadBeat
            ) {
              this.lastSpokenLeadBeat = currentBeat;
              this.speakLeadWordFallback(word, intervalMs);
            }
          } else {
            if (!answerStarted) {
              answerStarted = true;
              callbacks.onAnswerPhaseStart(startPerfMs + 8 * intervalMs);
            }
            callbacks.onAnswerBeat(currentBeat - 8);
          }
        }

        if (elapsedMs >= 16 * intervalMs) {
          if (!answerStarted) {
            answerStarted = true;
            callbacks.onAnswerPhaseStart(startPerfMs + 8 * intervalMs);
          }
          callbacks.onAnswerPhaseEnd();
          return;
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    this.cancelled = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.activeOscillators.forEach((node) => {
      try {
        if ('stop' in node && typeof (node as OscillatorNode).stop === 'function') {
          (node as OscillatorNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    });
    this.activeOscillators.clear();
    this.activeUtterances.clear();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }
}
