import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, FileUp, Loader2, X } from 'lucide-react';
import { DEFAULT_MEDIAPIPE_ASR_MODEL } from '../constants/animals';
import { NeuralTtsState } from '../services/thaiNeuralTts';
import { AsrEngineMode, TranscriberState } from '../types/game';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-[#181B22] border border-white/10 p-6 sm:p-7 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <h2 id="rules-modal-title" className="font-display text-xl font-bold">
            กติกาการเล่น หมูหมากาไก่
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="ปิดหน้าต่างกติกา"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ol className="mt-5 space-y-3.5 text-sm sm:text-base text-zinc-300 leading-relaxed">
          <li>
            <span className="font-semibold text-white">1. เลือกระดับความยาก:</span>{' '}
            ง่าย (0.5 วินาที/ภาพ) · กลาง (0.35 วินาที/ภาพ) · ยาก (0.2 วินาที/ภาพ)
          </li>
          <li>
            <span className="font-semibold text-white">2. สุ่มภาพสัตว์ 8 ภาพ:</span>{' '}
            ระบบสุ่มภาพจาก หมู หมา กา และไก่ เรียงจากซ้ายไปขวา (ซ้ำกันได้) และแสดงให้เห็นตลอดทั้งรอบ
          </li>
          <li>
            <span className="font-semibold text-white">3. เสียงนำจังหวะและช่วงตอบ:</span>{' '}
            ฟังเสียงนำ “หมู → หมา → กา → ไก่ → หนึ่ง → สอง → สาม → สี่” จากนั้นพูดชื่อสัตว์ทั้ง 8 ภาพจากซ้ายไปขวาให้ตรงกับจังหวะที่ไฮไลต์ (ไม่มีเสียงเฉลย)
          </li>
          <li>
            <span className="font-semibold text-white">4. เกมละ 5 รอบ (คะแนนเต็ม 5 คะแนน):</span>{' '}
            พูดถูกครบทั้ง 8 ภาพในแต่ละรอบได้ <span className="text-emerald-400 font-semibold">+1 คะแนน</span>{' '}
            หากพูดผิด ข้ามภาพ หรือไม่ทันจังหวะได้ 0 คะแนนในรอบนั้น แล้วเล่นต่อจนครบ 5 รอบ (หรือจบเมื่อกดหยุดเล่น)
          </li>
        </ol>

        <div className="mt-5 rounded-xl bg-[#111318] border border-white/10 p-4 text-sm">
          <div className="text-zinc-400 text-xs mb-1">ตัวอย่างลำดับภาพ 8 ใบ</div>
          <div className="font-display font-semibold text-amber-300">
            ไก่ → หมู → หมา → หมา → กา → ไก่ → หมู → กา
          </div>
          <div className="text-zinc-400 text-xs mt-1.5">
            พูดตามจังหวะที่เลือก (0.5 / 0.35 / 0.2 วินาทีต่อคำ) ให้ครบ 8 ภาพต่อรอบ
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-sm hover:bg-amber-400 transition-colors whitespace-nowrap"
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  );
};

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  engineMode: AsrEngineMode;
  onEngineModeChange: (mode: AsrEngineMode) => void;
  speakLeadIn: boolean;
  onSpeakLeadInChange: (val: boolean) => void;
  showLabels: boolean;
  onShowLabelsChange: (val: boolean) => void;
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceURI: string | null;
  onSelectVoiceURI: (uri: string | null) => void;
  onPreviewLeadIn: () => void;
  neuralTtsState: NeuralTtsState;
  transcriberState: TranscriberState;
  webSpeechSupported: boolean;
  onLoadModelUrl: (url: string) => Promise<void>;
  onLoadModelFile: (file: File) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  engineMode,
  onEngineModeChange,
  speakLeadIn,
  onSpeakLeadInChange,
  showLabels,
  onShowLabelsChange,
  availableVoices,
  selectedVoiceURI,
  onSelectVoiceURI,
  onPreviewLeadIn,
  neuralTtsState,
  transcriberState,
  webSpeechSupported,
  onLoadModelUrl,
  onLoadModelFile,
}) => {
  const [modelUrl, setModelUrl] = useState(DEFAULT_MEDIAPIPE_ASR_MODEL);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const isLoading = transcriberState.status === 'loading_model';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-[#181B22] border border-white/10 p-6 sm:p-7 text-zinc-100 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <h2 id="settings-modal-title" className="font-display text-xl font-bold">
            ตั้งค่าเสียงและ MediaPipe AudioTranscriber
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="ปิดหน้าต่างตั้งค่า"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {/* Lead-in Voice Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-sm text-white">
                  Text-to-Speech เสียงพูดนำจังหวะภาษาไทย
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  พูด “หมู หมา กา ไก่ 1 2 3 4” พร้อมเสียงนกหวีดให้จังหวะก่อนเริ่มตอบ
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSpeakLeadInChange(!speakLeadIn)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  speakLeadIn
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-white/10 text-zinc-300 hover:bg-white/15'
                }`}
              >
                {speakLeadIn ? 'เปิดเสียง TTS' : 'เฉพาะเสียงนกหวีด'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <select
                value={selectedVoiceURI ?? ''}
                onChange={(e) =>
                  onSelectVoiceURI(e.target.value ? e.target.value : null)
                }
                aria-label="เลือกเสียงพูด TTS"
                className="flex-1 min-w-0 rounded-lg bg-[#111318] border border-white/15 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-amber-400"
              >
                <option value="">
                  Neural Thai TTS บนเบราว์เซอร์ (อัตโนมัติ · ไม่ต้องพึ่งเสียง OS)
                </option>
                {availableVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    เบราว์เซอร์: {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onPreviewLeadIn}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ทดสอบ TTS + นกหวีด
              </button>
            </div>

            <div className="text-[11px] text-zinc-400 flex items-center gap-2">
              {neuralTtsState.status === 'ready' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-emerald-300">
                    เสียงพูดภาษาไทย (MMS-TTS-THA) พร้อมใช้งานแล้ว
                  </span>
                </>
              )}
              {neuralTtsState.status === 'loading' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">
                    กำลังเตรียมเสียงพูดภาษาไทยบนเบราว์เซอร์ ({neuralTtsState.progress}%)...
                  </span>
                </>
              )}
              {neuralTtsState.status === 'error' && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span className="text-red-300">
                    {neuralTtsState.errorMessage ?? 'โหลดเสียงพูดไทยไม่สำเร็จ'}
                  </span>
                </>
              )}
              {neuralTtsState.status === 'idle' && (
                <span>
                  กด “ทดสอบ TTS + นกหวีด” หรือ “เริ่มเกม” เพื่อเตรียมเสียงพูดภาษาไทยบนเบราว์เซอร์
                </span>
              )}
            </div>
          </div>

          {/* Animal Label Visibility Toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold text-sm text-white">
                แสดงป้ายชื่อสัตว์ใต้ภาพ (หมู หมา กา ไก่)
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">
                ซ่อนป้ายชื่อระหว่างเล่นเกมเพื่อทดสอบการจำและมองภาพสัตว์ล้วนๆ
              </div>
            </div>
            <button
              type="button"
              onClick={() => onShowLabelsChange(!showLabels)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showLabels
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-white/10 text-zinc-300 hover:bg-white/15'
              }`}
            >
              {showLabels ? 'แสดงชื่อสัตว์' : 'ซ่อนชื่อสัตว์'}
            </button>
          </div>

          <hr className="border-white/10" />

          {/* Recognition Engine Mode */}
          <div>
            <div className="font-semibold text-sm text-white mb-2">
              ระบบถอดเสียงพูด (ทำงานบนเบราว์เซอร์ 100%)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    id: 'hybrid',
                    label: 'อัตโนมัติ (แนะนำ)',
                    desc: 'Thai ASR + MediaPipe',
                  },
                  {
                    id: 'webspeech',
                    label: 'Thai Web Speech',
                    desc: webSpeechSupported ? 'พร้อมใช้งานทันที' : 'ไม่รองรับในเบราว์เซอร์นี้',
                  },
                  {
                    id: 'mediapipe',
                    label: 'MediaPipe เท่านั้น',
                    desc: 'ต้องโหลดโมเดล .litertlm',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onEngineModeChange(opt.id)}
                  className={`text-left p-3 rounded-xl border transition-colors ${
                    engineMode === opt.id
                      ? 'bg-amber-500/15 border-amber-400 text-white'
                      : 'bg-[#111318] border-white/10 text-zinc-300 hover:border-white/25'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <hr className="border-white/10" />

          {/* MediaPipe AudioTranscriber Loader */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-sm text-white">
                <Cpu className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <span>MediaPipe AudioTranscriber (.litertlm)</span>
              </div>
              <span className="text-xs text-zinc-400">
                WASM: /wasm · YAMNet:{' '}
                {transcriberState.classifierReady ? 'พร้อม' : 'รอเปิดไมค์'}
              </span>
            </div>

            <div className="rounded-xl bg-[#111318] border border-white/10 p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">สถานะโมเดล</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-zinc-200">
                  {transcriberState.status === 'ready' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  {transcriberState.status === 'loading_model' && (
                    <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  )}
                  {transcriberState.status === 'error' && (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                  {transcriberState.status === 'ready'
                    ? `พร้อมใช้งาน (${transcriberState.modelName})`
                    : transcriberState.status === 'loading_model'
                      ? `กำลังโหลด ${transcriberState.modelName}...`
                      : transcriberState.status === 'error'
                        ? 'โหลดไม่สำเร็จ'
                        : 'ยังไม่ได้โหลดไฟล์โมเดล'}
                </span>
              </div>
              {transcriberState.errorMessage && (
                <div className="text-red-400 text-[11px]">
                  {transcriberState.errorMessage}
                </div>
              )}
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                โหมดอัตโนมัติใช้ MediaPipe Audio WASM + Thai Speech Recognition เพื่อความแม่นยำคำไทย “หมู หมา กา ไก่” ทันที หรือคุณสามารถโหลดไฟล์โมเดล{' '}
                <code className="font-mono text-zinc-300">.litertlm</code>{' '}
                (เช่น Parakeet / TinyGemma) มารันบนเบราว์เซอร์ได้โดยตรง
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={modelUrl}
                onChange={(e) => setModelUrl(e.target.value)}
                placeholder="URL ของไฟล์ .litertlm"
                className="flex-1 min-w-0 rounded-lg bg-[#111318] border border-white/15 px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                disabled={isLoading || !modelUrl.trim()}
                onClick={() => void onLoadModelUrl(modelUrl.trim())}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
              >
                {isLoading ? 'กำลังโหลด...' : 'โหลดจาก URL'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".litertlm,.tflite,.bin"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void onLoadModelFile(file);
                  }
                }}
              />
              <button
                type="button"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#111318] border border-white/15 hover:border-white/30 text-xs font-medium text-zinc-200 transition-colors"
              >
                <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
                เลือกไฟล์ .litertlm จากเครื่อง
              </button>
              <span className="text-[11px] text-zinc-500">
                ประมวลผล 100% บนอุปกรณ์ของคุณ
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-sm hover:bg-amber-400 transition-colors"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
};
