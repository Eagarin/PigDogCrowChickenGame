import { pipeline } from '@huggingface/transformers';
import { LEAD_IN_WORDS } from '../constants/animals';

export type NeuralTtsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NeuralTtsState {
  status: NeuralTtsStatus;
  progress: number; // 0..100
  errorMessage?: string;
}

const THAI_TTS_MODEL = 'payam1394/traxlate-mms-tts-tha';

function trimAndNormalizePcm(
  samples: Float32Array,
  sampleRate: number
): Float32Array {
  const threshold = 0.015;
  let start = 0;
  let end = samples.length - 1;

  while (start < samples.length && Math.abs(samples[start]) < threshold) {
    start++;
  }
  while (end > start && Math.abs(samples[end]) < threshold) {
    end--;
  }

  // Keep a small 12ms margin around speech onset/offset
  const padSamples = Math.floor(sampleRate * 0.012);
  start = Math.max(0, start - padSamples);
  end = Math.min(samples.length - 1, end + padSamples);

  if (end <= start) {
    return samples;
  }

  const sliced = samples.slice(start, end + 1);
  let peak = 0;
  for (let i = 0; i < sliced.length; i++) {
    const abs = Math.abs(sliced[i]);
    if (abs > peak) peak = abs;
  }

  if (peak > 0.01) {
    const scale = 0.88 / peak;
    for (let i = 0; i < sliced.length; i++) {
      sliced[i] *= scale;
    }
  }

  // Gentle 8ms fade-in/out to prevent clicks
  const fadeLen = Math.min(Math.floor(sampleRate * 0.008), Math.floor(sliced.length / 4));
  for (let i = 0; i < fadeLen; i++) {
    const factor = i / fadeLen;
    sliced[i] *= factor;
    sliced[sliced.length - 1 - i] *= factor;
  }

  return sliced;
}

export class ThaiNeuralTtsService {
  private buffers = new Map<string, AudioBuffer>();
  private state: NeuralTtsState = { status: 'idle', progress: 0 };
  private initPromise: Promise<boolean> | null = null;
  private onStateChange?: (state: NeuralTtsState) => void;

  constructor(onStateChange?: (state: NeuralTtsState) => void) {
    this.onStateChange = onStateChange;
  }

  public getState(): NeuralTtsState {
    return this.state;
  }

  public getWordBuffer(word: string): AudioBuffer | undefined {
    return this.buffers.get(word);
  }

  public isReady(): boolean {
    return this.state.status === 'ready' && this.buffers.size === LEAD_IN_WORDS.length;
  }

  private emit(next: NeuralTtsState): void {
    this.state = next;
    this.onStateChange?.(next);
  }

  /**
   * Loads the quantized Thai VITS ONNX model in-browser and pre-renders
   * all 8 lead-in words ("หมู หมา กา ไก่ หนึ่ง สอง สาม สี่") into AudioBuffers.
   */
  public async warmup(audioCtx: AudioContext): Promise<boolean> {
    if (this.isReady()) return true;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.emit({ status: 'loading', progress: 5 });

      try {
        const fileProgress = new Map<string, number>();

        const synthesizer = await pipeline('text-to-speech', THAI_TTS_MODEL, {
          dtype: 'q8',
          progress_callback: (info: {
            status?: string;
            file?: string;
            progress?: number;
          }) => {
            if (info?.file && typeof info.progress === 'number') {
              fileProgress.set(info.file, info.progress);
              let total = 0;
              fileProgress.forEach((p) => {
                total += p;
              });
              const avg = Math.round(total / Math.max(1, fileProgress.size));
              // Reserve 75% for model download and 25% for synthesizing 8 words
              this.emit({
                status: 'loading',
                progress: Math.min(75, Math.max(5, Math.round(avg * 0.75))),
              });
            }
          },
        });

        for (let i = 0; i < LEAD_IN_WORDS.length; i++) {
          const word = LEAD_IN_WORDS[i];
          if (!this.buffers.has(word)) {
            const output = await synthesizer(word);
            const rawAudio = Array.isArray(output.audio)
              ? output.audio[0]
              : output.audio;
            if (!rawAudio) {
              throw new Error(`ไม่พบข้อมูลเสียงสำหรับคำว่า "${word}"`);
            }
            const cleanedPcm = trimAndNormalizePcm(
              rawAudio,
              output.sampling_rate
            );
            const buf = audioCtx.createBuffer(
              1,
              cleanedPcm.length,
              output.sampling_rate
            );
            buf.copyToChannel(new Float32Array(cleanedPcm), 0);
            this.buffers.set(word, buf);
          }
          const synthProgress =
            75 + Math.round(((i + 1) / LEAD_IN_WORDS.length) * 25);
          this.emit({ status: 'loading', progress: synthProgress });
        }

        if (typeof synthesizer.dispose === 'function') {
          await synthesizer.dispose();
        }

        this.emit({ status: 'ready', progress: 100 });
        return true;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'ไม่สามารถโหลดโมเดลเสียงพูดภาษาไทยได้';
        this.emit({ status: 'error', progress: 0, errorMessage: msg });
        this.initPromise = null;
        return false;
      }
    })();

    return this.initPromise;
  }
}
