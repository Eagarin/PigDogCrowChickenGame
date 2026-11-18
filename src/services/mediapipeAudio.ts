import {
  AudioClassifier,
  AudioTranscriber,
  FilesetResolver,
} from '@mediapipe/tasks-audio';
import {
  BEAT_INTERVAL_MS,
  BEATS_PER_PHASE,
  DEFAULT_MEDIAPIPE_ASR_MODEL,
  DEFAULT_YAMNET_MODEL,
} from '../constants/animals';
import { TranscriberState } from '../types/game';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function downsampleTo16k(
  input: Float32Array,
  inputSampleRate: number
): Float32Array {
  if (inputSampleRate === 16000) {
    return new Float32Array(input);
  }
  const ratio = inputSampleRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = srcIdx - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

export class BrowserAudioPipeline {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;

  private audioFileset: Awaited<
    ReturnType<typeof FilesetResolver.forAudioTasks>
  > | null = null;
  private transcriber: AudioTranscriber | null = null;
  private classifier: AudioClassifier | null = null;

  private recognition: SpeechRecognitionLike | null = null;
  private finalTranscriptChunks: string[] = [];
  private latestInterimTranscript = '';
  private mediapipeTranscriptChunks: string[] = [];

  private isCapturingAnswer = false;
  private answerStartPerfMs = 0;
  private currentBeatIntervalMs = BEAT_INTERVAL_MS;
  private beatVoiceActivity: boolean[] = Array(BEATS_PER_PHASE).fill(false);
  private noiseFloorRms = 0.012;
  private currentVolume = 0;

  // Buffers for MediaPipe streaming chunks (16kHz)
  private pcmBuffer: number[] = [];
  private state: TranscriberState = {
    status: 'idle',
    modelName: 'ยังไม่ได้โหลดโมเดล .litertlm',
    classifierReady: false,
  };

  private onStateChange?: (state: TranscriberState) => void;
  private onVolumeChange?: (rms: number) => void;
  private onLiveTranscript?: (text: string) => void;

  constructor(callbacks?: {
    onStateChange?: (state: TranscriberState) => void;
    onVolumeChange?: (rms: number) => void;
    onLiveTranscript?: (text: string) => void;
  }) {
    this.onStateChange = callbacks?.onStateChange;
    this.onVolumeChange = callbacks?.onVolumeChange;
    this.onLiveTranscript = callbacks?.onLiveTranscript;
  }

  public getState(): TranscriberState {
    return this.state;
  }

  public isSpeechRecognitionSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  public isMediaPipeTranscriberReady(): boolean {
    return this.transcriber !== null && this.state.status === 'ready';
  }

  private emitState(patch: Partial<TranscriberState>): void {
    this.state = { ...this.state, ...patch };
    this.onStateChange?.(this.state);
  }

  /**
   * Initializes MediaPipe WASM fileset from local /wasm directory and loads YAMNet audio classifier.
   */
  public async initWasmAndClassifier(): Promise<void> {
    if (!this.audioFileset) {
      this.audioFileset = await FilesetResolver.forAudioTasks('/wasm');
      this.emitState({
        status: this.transcriber ? 'ready' : 'wasm_ready',
      });
    }
    if (!this.classifier) {
      try {
        this.classifier = await AudioClassifier.createFromOptions(
          this.audioFileset,
          {
            baseOptions: { modelAssetPath: DEFAULT_YAMNET_MODEL },
            maxResults: 2,
            scoreThreshold: 0.25,
          }
        );
        this.emitState({ classifierReady: true });
      } catch {
        // Non-blocking: classifier is optional telemetry
        this.emitState({ classifierReady: false });
      }
    }
  }

  /**
   * Loads a MediaPipe AudioTranscriber (.litertlm) model from URL or local File.
   */
  public async loadTranscriberModel(
    source: string | File = DEFAULT_MEDIAPIPE_ASR_MODEL
  ): Promise<void> {
    const label =
      typeof source === 'string'
        ? source.split('/').pop() || 'parakeet_tdt_0.6b_v3.litertlm'
        : source.name;

    this.emitState({
      status: 'loading_model',
      modelName: label,
      errorMessage: undefined,
    });

    try {
      await this.initWasmAndClassifier();
      if (!this.audioFileset) {
        throw new Error('WASM fileset not initialized');
      }

      if (this.transcriber) {
        this.transcriber.close();
        this.transcriber = null;
      }

      if (typeof source === 'string') {
        this.transcriber = await AudioTranscriber.createFromOptions(
          this.audioFileset,
          {
            baseOptions: {
              modelAssetPath: source,
              delegate: 'CPU',
            },
            sampleRateHz: 16000,
            enableInterimResults: true,
          }
        );
      } else {
        const buffer = new Uint8Array(await source.arrayBuffer());
        this.transcriber = await AudioTranscriber.createFromOptions(
          this.audioFileset,
          {
            baseOptions: {
              modelAssetBuffer: buffer,
              delegate: 'CPU',
            },
            sampleRateHz: 16000,
            enableInterimResults: true,
          }
        );
      }

      await this.transcriber.prewarm();
      this.emitState({
        status: 'ready',
        modelName: label,
        errorMessage: undefined,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'ไม่สามารถโหลดโมเดล MediaPipe ได้';
      this.emitState({
        status: 'error',
        errorMessage: msg,
      });
      throw err;
    }
  }

  /**
   * Attaches live microphone MediaStream to a 16kHz audio analysis & MediaPipe buffer pipeline.
   */
  public attachMicStream(stream: MediaStream): void {
    this.detachMicStream();

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    this.audioCtx = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (ev) => {
      const raw = ev.inputBuffer.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < raw.length; i++) {
        sumSq += raw[i] * raw[i];
      }
      const rms = Math.sqrt(sumSq / raw.length);
      this.currentVolume = rms;
      this.onVolumeChange?.(rms);

      // Adapt noise floor smoothly when NOT in answer window
      if (!this.isCapturingAnswer) {
        this.noiseFloorRms = this.noiseFloorRms * 0.96 + rms * 0.04;
        return;
      }

      const elapsedMs = performance.now() - this.answerStartPerfMs;
      const threshold = Math.max(0.018, this.noiseFloorRms * 2.1);
      const maxWindowMs = BEATS_PER_PHASE * this.currentBeatIntervalMs + 250;

      if (rms > threshold && elapsedMs >= -120 && elapsedMs <= maxWindowMs) {
        const beatIdx = Math.min(
          BEATS_PER_PHASE - 1,
          Math.max(
            0,
            Math.floor(
              (elapsedMs + this.currentBeatIntervalMs * 0.2) /
                this.currentBeatIntervalMs
            )
          )
        );
        this.beatVoiceActivity[beatIdx] = true;
      }

      // Downsample to 16kHz PCM for MediaPipe AudioTranscriber & AudioClassifier
      const pcm16k = downsampleTo16k(raw, ctx.sampleRate);
      for (let i = 0; i < pcm16k.length; i++) {
        this.pcmBuffer.push(pcm16k[i]);
      }

      // Run MediaPipe AudioClassifier every ~0.5s (8000 samples) if available
      if (this.classifier && this.pcmBuffer.length >= 8000) {
        try {
          const slice = new Float32Array(this.pcmBuffer.slice(-15600));
          const res = this.classifier.classify(slice, 16000);
          const top = res[0]?.classifications?.[0]?.categories?.[0];
          if (top?.categoryName) {
            this.emitState({ lastCategory: top.categoryName });
          }
        } catch {
          // Ignore non-fatal classifier tick issues
        }
      }

      // Stream chunks to MediaPipe AudioTranscriber every ~0.5s when model is loaded
      if (this.transcriber && this.pcmBuffer.length >= 8000) {
        const chunk = new Float32Array(this.pcmBuffer.splice(0, 8000));
        void this.transcriber
          .transcribeStream(chunk)
          .then((res) => {
            if (res?.text?.trim()) {
              this.mediapipeTranscriptChunks.push(res.text.trim());
              this.emitCombinedLiveTranscript();
            }
          })
          .catch(() => {
            // Ignore transient chunk error
          });
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    this.sourceNode = source;
    this.processorNode = processor;
    this.silentGain = silentGain;
  }

  public detachMicStream(): void {
    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }

  private emitCombinedLiveTranscript(): void {
    const webText = [
      ...this.finalTranscriptChunks,
      this.latestInterimTranscript,
    ]
      .join(' ')
      .trim();
    const mpText = this.mediapipeTranscriptChunks.join(' ').trim();
    this.onLiveTranscript?.(webText || mpText);
  }

  /**
   * Starts speech recognition & MediaPipe 16kHz streaming capture for the answer window.
   */
  public startAnswerCapture(
    answerStartPerfMs: number,
    useWebSpeech: boolean,
    beatIntervalMs: number = BEAT_INTERVAL_MS
  ): void {
    this.answerStartPerfMs = answerStartPerfMs;
    this.currentBeatIntervalMs = beatIntervalMs;
    this.isCapturingAnswer = true;
    this.finalTranscriptChunks = [];
    this.latestInterimTranscript = '';
    this.mediapipeTranscriptChunks = [];
    this.pcmBuffer = [];
    this.beatVoiceActivity = Array(BEATS_PER_PHASE).fill(false);

    if (useWebSpeech) {
      const Ctor = getSpeechRecognitionCtor();
      if (Ctor) {
        try {
          if (this.recognition) {
            this.recognition.abort();
          }
          const rec = new Ctor();
          rec.lang = 'th-TH';
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 3;

          rec.onresult = (event) => {
            let interim = '';
            const finals: string[] = [];
            for (let i = 0; i < event.results.length; i++) {
              const r = event.results[i];
              const text = r[0]?.transcript ?? '';
              if (r.isFinal) {
                finals.push(text);
              } else {
                interim += ' ' + text;
              }
            }
            this.finalTranscriptChunks = finals;
            this.latestInterimTranscript = interim.trim();
            this.emitCombinedLiveTranscript();
          };

          rec.onerror = () => {
            // Keep going cleanly; evaluator handles empty transcript gracefully
          };

          rec.start();
          this.recognition = rec;
        } catch {
          this.recognition = null;
        }
      }
    }
  }

  /**
   * Stops answer capture after a short 500ms ASR flush grace window and returns combined result.
   */
  public async stopAndCollectAnswer(preferMediaPipeOnly: boolean): Promise<{
    transcript: string;
    mediapipeTranscript: string;
    webSpeechTranscript: string;
    beatVoiceActivity: boolean[];
  }> {
    // Allow 450ms for the 8th spoken syllable at t=3.5-4.0s to finish arriving in ASR
    await new Promise((resolve) => setTimeout(resolve, 480));
    this.isCapturingAnswer = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      this.recognition = null;
    }

    if (this.transcriber) {
      try {
        if (this.pcmBuffer.length > 0) {
          const remaining = new Float32Array(this.pcmBuffer.splice(0));
          const res = await this.transcriber.transcribeStream(remaining);
          if (res?.text?.trim()) {
            this.mediapipeTranscriptChunks.push(res.text.trim());
          }
        }
        const finalMp = await this.transcriber.finishStream();
        if (finalMp?.text?.trim()) {
          this.mediapipeTranscriptChunks.push(finalMp.text.trim());
        }
      } catch {
        // Ignore stream finish errors
      }
    }

    const webSpeechTranscript = [
      ...this.finalTranscriptChunks,
      this.latestInterimTranscript,
    ]
      .join(' ')
      .trim();

    // Deduplicate consecutive identical segments from MediaPipe streaming
    const mediapipeTranscript = Array.from(
      new Set(this.mediapipeTranscriptChunks.filter(Boolean))
    )
      .join(' ')
      .trim();

    const transcript = preferMediaPipeOnly
      ? mediapipeTranscript
      : webSpeechTranscript || mediapipeTranscript;

    return {
      transcript,
      mediapipeTranscript,
      webSpeechTranscript,
      beatVoiceActivity: [...this.beatVoiceActivity],
    };
  }

  public abortCapture(): void {
    this.isCapturingAnswer = false;
    this.pcmBuffer = [];
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Ignore
      }
      this.recognition = null;
    }
  }

  public getCurrentVolume(): number {
    return this.currentVolume;
  }

  public dispose(): void {
    this.abortCapture();
    this.detachMicStream();
    if (this.transcriber) {
      this.transcriber.close();
      this.transcriber = null;
    }
    if (this.classifier) {
      this.classifier.close();
      this.classifier = null;
    }
  }
}
