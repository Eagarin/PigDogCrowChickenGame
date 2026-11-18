import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Square,
  User,
  Volume2,
  XCircle,
} from 'lucide-react';
import { AnimalCard } from './components/AnimalCard';
import { HeadAnimalOverlay } from './components/HeadAnimalOverlay';
import { RulesModal, SettingsModal } from './components/Modals';
import {
  ANIMALS,
  BEATS_PER_PHASE,
  DIFFICULTIES,
  DIFFICULTY_LIST,
  LEAD_IN_DISPLAY_LABELS,
  TOTAL_ROUNDS_PER_GAME,
  generateRandomSequence,
} from './constants/animals';
import { HeadPosition, HeadTrackerService } from './services/faceTracker';
import { BrowserAudioPipeline } from './services/mediapipeAudio';
import { RhythmAudioEngine } from './services/rhythmAudio';
import { evaluateRound, extractAnimalTokens } from './services/speechMatcher';
import { NeuralTtsState } from './services/thaiNeuralTts';
import {
  AnimalId,
  AsrEngineMode,
  DifficultyId,
  GameState,
  RoundResult,
  TranscriberState,
} from './types/game';

const HIGH_SCORE_KEY = 'moo_maa_kaa_kai_high_score';

export default function App() {
  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [sequence, setSequence] = useState<AnimalId[]>(() =>
    generateRandomSequence(BEATS_PER_PHASE)
  );
  const [score, setScore] = useState(0);
  const [roundNumber, setRoundNumber] = useState(0);
  const [highScore, setHighScore] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(HIGH_SCORE_KEY);
      return saved ? Math.max(0, parseInt(saved, 10) || 0) : 0;
    } catch {
      return 0;
    }
  });

  // Beat & Match tracking
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [leadInBeat, setLeadInBeat] = useState<number>(-1);
  const [answerBeat, setAnswerBeat] = useState<number>(-1);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micVolume, setMicVolume] = useState(0);

  // Media & Hardware permissions
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isTestingMic, setIsTestingMic] = useState(false);

  // Settings & Modals
  const [engineMode, setEngineMode] = useState<AsrEngineMode>('hybrid');
  const [speakLeadIn, setSpeakLeadIn] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [arHeadEnabled, setArHeadEnabled] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [neuralTtsState, setNeuralTtsState] = useState<NeuralTtsState>({
    status: 'idle',
    progress: 0,
  });
  const [isPreviewingTts, setIsPreviewingTts] = useState(false);
  const [previewBeat, setPreviewBeat] = useState<number>(-1);
  const [detectedHeads, setDetectedHeads] = useState<HeadPosition[]>([]);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriberState, setTranscriberState] = useState<TranscriberState>({
    status: 'idle',
    modelName: 'ยังไม่ได้โหลดโมเดล .litertlm',
    classifierReady: false,
  });

  const stageRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rhythmRef = useRef<RhythmAudioEngine | null>(null);
  const audioPipelineRef = useRef<BrowserAudioPipeline | null>(null);
  const headTrackerRef = useRef<HeadTrackerService | null>(null);
  const smoothedHeadsRef = useRef<HeadPosition[]>([]);
  const lastHeadSeenMsRef = useRef<number>(0);
  const nextRoundTimerRef = useRef<number | null>(null);
  const testMicTimerRef = useRef<number | null>(null);
  const isStoppedRef = useRef(false);

  // Mutable refs for latest values inside async timeline callbacks
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const engineModeRef = useRef(engineMode);
  engineModeRef.current = engineMode;
  const speakLeadInRef = useRef(speakLeadIn);
  speakLeadInRef.current = speakLeadIn;
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const highScoreRef = useRef(highScore);
  highScoreRef.current = highScore;

  // Initialize audio & MediaPipe engines once
  useEffect(() => {
    const rhythm = new RhythmAudioEngine();
    const pipeline = new BrowserAudioPipeline({
      onStateChange: (st) => setTranscriberState(st),
      onVolumeChange: (rms) => setMicVolume(Math.min(1, rms * 8)),
      onLiveTranscript: (txt) => setLiveTranscript(txt),
    });
    const headTracker = new HeadTrackerService();

    rhythmRef.current = rhythm;
    audioPipelineRef.current = pipeline;
    headTrackerRef.current = headTracker;

    // Warm up MediaPipe Audio & FaceDetector WASM in background
    void pipeline.initWasmAndClassifier().catch(() => {
      // Non-blocking
    });
    void headTracker.init().catch(() => {
      // Non-blocking
    });

    setAvailableVoices(rhythm.getAvailableThaiVoices());
    const unsubVoices = rhythm.subscribeVoicesChanged(() => {
      setAvailableVoices(rhythm.getAvailableThaiVoices());
    });
    const unsubNeuralTts = rhythm.subscribeNeuralTtsState((st) => {
      setNeuralTtsState(st);
    });

    return () => {
      unsubVoices();
      unsubNeuralTts();
      if (nextRoundTimerRef.current) window.clearTimeout(nextRoundTimerRef.current);
      if (testMicTimerRef.current) window.clearTimeout(testMicTimerRef.current);
      rhythm.stop();
      pipeline.dispose();
      headTracker.dispose();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Real-time MediaPipe FaceDetector loop for placing random animal above detected heads
  useEffect(() => {
    if (!cameraReady || !arHeadEnabled) {
      smoothedHeadsRef.current = [];
      setDetectedHeads([]);
      return;
    }

    let cancelled = false;
    let rafId = 0;

    const loop = async () => {
      const tracker = headTrackerRef.current;
      if (tracker && !tracker.isReady()) {
        await tracker.init();
      }

      const tick = () => {
        if (cancelled) return;
        const videoEl = videoRef.current;
        const stageEl = stageRef.current;
        if (videoEl && stageEl && tracker?.isReady()) {
          const w = stageEl.clientWidth;
          const h = stageEl.clientHeight;
          const rawHeads = tracker.detectHeads(videoEl, w, h);
          if (rawHeads !== null) {
            if (rawHeads.length > 0) {
              lastHeadSeenMsRef.current = performance.now();
              const prev = smoothedHeadsRef.current;
              const alpha = 0.36;
              const nextSmoothed = rawHeads.map((head, idx) => {
                const p = prev[idx];
                if (!p) return head;
                return {
                  ...head,
                  x: p.x + (head.x - p.x) * alpha,
                  y: p.y + (head.y - p.y) * alpha,
                  faceWidth: p.faceWidth + (head.faceWidth - p.faceWidth) * alpha,
                };
              });
              smoothedHeadsRef.current = nextSmoothed;
              setStageSize((cur) =>
                cur.width === w && cur.height === h ? cur : { width: w, height: h }
              );
              setDetectedHeads(nextSmoothed);
            } else if (performance.now() - lastHeadSeenMsRef.current > 450) {
              if (smoothedHeadsRef.current.length > 0) {
                smoothedHeadsRef.current = [];
                setDetectedHeads([]);
              }
            }
          }
        }
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
    };

    void loop();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [arHeadEnabled, cameraReady]);

  const attachVideoStream = useCallback((stream: MediaStream) => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {
        // Autoplay handled silently
      });
    }
  }, []);

  const requestMediaPermissions = useCallback(async (): Promise<boolean> => {
    if (streamRef.current && micReady) {
      return true;
    }
    setMediaError(null);

    try {
      // Try video + audio first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = stream;
      setCameraReady(stream.getVideoTracks().length > 0);
      setMicReady(stream.getAudioTracks().length > 0);
      attachVideoStream(stream);
      audioPipelineRef.current?.attachMicStream(stream);
      return true;
    } catch {
      // Fallback to audio-only if camera is unavailable or blocked
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = audioStream;
        setCameraReady(false);
        setMicReady(true);
        audioPipelineRef.current?.attachMicStream(audioStream);
        setMediaError('ไม่พบกล้องเว็บแคม หรือไม่ได้รับสิทธิ์กล้อง (กำลังใช้ไมโครโฟนอย่างเดียว)');
        return true;
      } catch {
        setCameraReady(false);
        setMicReady(false);
        setMediaError('กรุณาอนุญาตการใช้ไมโครโฟนและกล้องในเบราว์เซอร์เพื่อเล่นเกม');
        return false;
      }
    }
  }, [attachVideoStream, micReady]);

  // Attempt attaching video whenever videoRef mounts
  useEffect(() => {
    if (streamRef.current && cameraReady && videoRef.current) {
      attachVideoStream(streamRef.current);
    }
  }, [attachVideoStream, cameraReady, gameState]);

  const clearPendingTimers = useCallback(() => {
    if (nextRoundTimerRef.current !== null) {
      window.clearTimeout(nextRoundTimerRef.current);
      nextRoundTimerRef.current = null;
    }
    if (testMicTimerRef.current !== null) {
      window.clearTimeout(testMicTimerRef.current);
      testMicTimerRef.current = null;
    }
  }, []);

  const runSingleRound = useCallback(
    (nextRoundNum: number, freshSequence?: AnimalId[]) => {
      const rhythm = rhythmRef.current;
      const pipeline = audioPipelineRef.current;
      if (!rhythm || !pipeline) return;

      isStoppedRef.current = false;
      clearPendingTimers();
      setIsPreviewingTts(false);
      setPreviewBeat(-1);

      const activeDiff = DIFFICULTIES[difficultyRef.current];
      const roundSeq = freshSequence ?? generateRandomSequence(BEATS_PER_PHASE);
      setSequence(roundSeq);
      setRoundNumber(nextRoundNum);
      setLeadInBeat(-1);
      setAnswerBeat(-1);
      setLastResult(null);
      setLiveTranscript('');
      setGameState('LEAD_IN');

      const answerStartPerfRef = {
        current: performance.now() + BEATS_PER_PHASE * activeDiff.beatIntervalMs,
      };

      rhythm.startRoundTimeline({
        beatIntervalMs: activeDiff.beatIntervalMs,
        speakLeadIn: speakLeadInRef.current,
        onLeadInBeat: (beatIdx) => {
          if (isStoppedRef.current) return;
          setLeadInBeat(beatIdx);
        },
        onAnswerPhaseStart: (startPerfMs) => {
          if (isStoppedRef.current) return;
          answerStartPerfRef.current = startPerfMs;
          setLeadInBeat(-1);
          setGameState('ANSWERING');

          const mode = engineModeRef.current;
          const useWebSpeech = mode === 'hybrid' || mode === 'webspeech';
          pipeline.startAnswerCapture(
            startPerfMs,
            useWebSpeech,
            activeDiff.beatIntervalMs
          );
        },
        onAnswerBeat: (beatIdx) => {
          if (isStoppedRef.current) return;
          setAnswerBeat(beatIdx);
        },
        onAnswerPhaseEnd: () => {
          if (isStoppedRef.current) return;
          setAnswerBeat(-1);
          setGameState('ROUND_EVALUATING');

          const mode = engineModeRef.current;
          const preferMpOnly = mode === 'mediapipe';

          void pipeline.stopAndCollectAnswer(preferMpOnly).then((captured) => {
            if (isStoppedRef.current) return;

            const result = evaluateRound({
              roundNumber: nextRoundNum,
              difficulty: activeDiff.id,
              sequence: roundSeq,
              transcript: captured.transcript,
              beatVoiceActivity: captured.beatVoiceActivity,
              engineUsed: mode,
              durationMs: Math.round(
                performance.now() - answerStartPerfRef.current
              ),
            });

            setLastResult(result);
            setRoundHistory((prev) => [...prev, result]);

            if (result.passed) {
              rhythm.playPassChime();
              const updatedScore = scoreRef.current + 1;
              setScore(updatedScore);
              if (updatedScore > highScoreRef.current) {
                setHighScore(updatedScore);
                try {
                  localStorage.setItem(HIGH_SCORE_KEY, String(updatedScore));
                } catch {
                  // Ignore storage quota errors
                }
              }
            } else {
              rhythm.playFailTone();
            }

            if (nextRoundNum >= TOTAL_ROUNDS_PER_GAME) {
              setGameState('GAME_OVER');
            } else {
              setGameState(result.passed ? 'ROUND_PASS' : 'ROUND_FAIL');
              nextRoundTimerRef.current = window.setTimeout(() => {
                if (!isStoppedRef.current) {
                  runSingleRound(nextRoundNum + 1);
                }
              }, 1600);
            }
          });
        },
      });
    },
    [clearPendingTimers]
  );

  const handleStartGame = useCallback(async () => {
    setIsTestingMic(false);
    const ok = await requestMediaPermissions();
    if (!ok) return;

    if (
      engineModeRef.current === 'mediapipe' &&
      !audioPipelineRef.current?.isMediaPipeTranscriberReady()
    ) {
      setMediaError(
        'โหมด MediaPipe เท่านั้น ต้องโหลดไฟล์โมเดล .litertlm ในเมนูตั้งค่าก่อน หรือเลือกโหมดอัตโนมัติ'
      );
      setSettingsOpen(true);
      return;
    }

    rhythmRef.current?.ensureContext();
    if (speakLeadInRef.current && !selectedVoiceURI) {
      await rhythmRef.current?.warmupThaiTts();
    }
    setScore(0);
    setRoundHistory([]);
    runSingleRound(1);
  }, [requestMediaPermissions, runSingleRound, selectedVoiceURI]);

  const handleStopGame = useCallback(() => {
    isStoppedRef.current = true;
    clearPendingTimers();
    rhythmRef.current?.stop();
    audioPipelineRef.current?.abortCapture();
    setLeadInBeat(-1);
    setAnswerBeat(-1);

    if (
      gameState === 'LEAD_IN' ||
      gameState === 'ANSWERING' ||
      gameState === 'ROUND_EVALUATING' ||
      gameState === 'ROUND_PASS' ||
      gameState === 'ROUND_FAIL'
    ) {
      setLastResult({
        roundNumber,
        difficulty,
        sequence,
        slots: sequence.map((target, index) => ({
          index,
          target,
          heard: null,
          rawToken: '',
          beatDetected: false,
          matched: false,
        })),
        passed: false,
        reason: 'ผู้เล่นกดหยุดเล่นเกมก่อนครบ 5 รอบ',
        transcript: liveTranscript,
        engineUsed: engineMode,
        durationMs: 0,
      });
      setGameState('GAME_OVER');
    }
  }, [
    clearPendingTimers,
    difficulty,
    engineMode,
    gameState,
    liveTranscript,
    roundNumber,
    sequence,
  ]);

  const handleRestartGame = useCallback(async () => {
    isStoppedRef.current = true;
    clearPendingTimers();
    rhythmRef.current?.stop();
    audioPipelineRef.current?.abortCapture();
    setLeadInBeat(-1);
    setAnswerBeat(-1);

    const ok = await requestMediaPermissions();
    if (!ok) return;

    rhythmRef.current?.ensureContext();
    if (speakLeadInRef.current && !selectedVoiceURI) {
      await rhythmRef.current?.warmupThaiTts();
    }
    setScore(0);
    setRoundHistory([]);
    runSingleRound(1);
  }, [clearPendingTimers, requestMediaPermissions, runSingleRound, selectedVoiceURI]);

  const handleTestMic = useCallback(async () => {
    if (isTestingMic) {
      audioPipelineRef.current?.abortCapture();
      setIsTestingMic(false);
      if (testMicTimerRef.current) window.clearTimeout(testMicTimerRef.current);
      return;
    }

    const ok = await requestMediaPermissions();
    if (!ok || !audioPipelineRef.current) return;

    setLiveTranscript('');
    setIsTestingMic(true);
    const useWebSpeech = engineMode !== 'mediapipe';
    audioPipelineRef.current.startAnswerCapture(performance.now(), useWebSpeech);

    testMicTimerRef.current = window.setTimeout(() => {
      void audioPipelineRef.current
        ?.stopAndCollectAnswer(engineMode === 'mediapipe')
        .then((res) => {
          setLiveTranscript(res.transcript);
          setIsTestingMic(false);
        });
    }, 3500);
  }, [engineMode, isTestingMic, requestMediaPermissions]);

  const handlePreviewTts = useCallback(() => {
    const rhythm = rhythmRef.current;
    if (!rhythm) return;

    if (isPreviewingTts) {
      rhythm.stop();
      setIsPreviewingTts(false);
      setPreviewBeat(-1);
      return;
    }

    setIsPreviewingTts(true);
    setPreviewBeat(-1);
    void rhythm.playLeadInPreview({
      beatIntervalMs: DIFFICULTIES[difficulty].beatIntervalMs,
      speakLeadIn: true,
      onBeat: (b) => setPreviewBeat(b),
      onComplete: () => {
        setIsPreviewingTts(false);
        setPreviewBeat(-1);
      },
    });
  }, [difficulty, isPreviewingTts]);

  const isPlaying =
    gameState === 'LEAD_IN' ||
    gameState === 'ANSWERING' ||
    gameState === 'ROUND_EVALUATING' ||
    gameState === 'ROUND_PASS' ||
    gameState === 'ROUND_FAIL';

  const activeDiffConfig = DIFFICULTIES[difficulty];
  const beatDelayLabel = (activeDiffConfig.beatIntervalMs / 1000)
    .toString()
    .replace(/0+$/, '');
  const phaseSecLabel = activeDiffConfig.phaseDurationSec
    .toFixed(1)
    .replace(/\.0$/, '');

  const recognizedPreviewTokens = extractAnimalTokens(liveTranscript);

  const phaseSummaryText = (() => {
    switch (gameState) {
      case 'TITLE_MENU':
        return `พร้อมเริ่มเกม · เล่น ${TOTAL_ROUNDS_PER_GAME} รอบ (ความยาก: ${activeDiffConfig.label} ${beatDelayLabel} วิ)`;
      case 'LEAD_IN':
        return `รอบ ${roundNumber}/${TOTAL_ROUNDS_PER_GAME} · เสียงนำจังหวะ (${Math.max(1, leadInBeat + 1)}/8)`;
      case 'ANSWERING':
        return `รอบ ${roundNumber}/${TOTAL_ROUNDS_PER_GAME} · ช่วงตอบ! ภาพที่ ${Math.max(1, answerBeat + 1)}/8 (${beatDelayLabel} วิ/ภาพ)`;
      case 'ROUND_EVALUATING':
        return `รอบ ${roundNumber}/${TOTAL_ROUNDS_PER_GAME} · กำลังตรวจคำตอบ...`;
      case 'ROUND_PASS':
        return `ผ่านรอบที่ ${roundNumber}! +1 คะแนน · กำลังเริ่มรอบที่ ${roundNumber + 1}`;
      case 'ROUND_FAIL':
        return `ไม่ผ่านรอบที่ ${roundNumber} (0 คะแนน) · กำลังเริ่มรอบที่ ${roundNumber + 1}`;
      case 'GAME_OVER':
        return `จบเกมครบ ${roundHistory.length} รอบ · ได้ ${score}/${TOTAL_ROUNDS_PER_GAME} คะแนน`;
    }
  })();

  return (
    <div className="min-h-screen flex flex-col bg-[#111318] text-[#F4F4F5]">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-white/10 bg-[#111318]">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Title */}
          <a
            href="#top"
            onClick={(e) => e.preventDefault()}
            className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            หมูหมากาไก่
          </a>

          {/* Zone 2: Clean single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              กติกาการเล่น
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              MediaPipe &amp; เสียง
            </button>
            <button
              type="button"
              disabled={isPlaying}
              onClick={() => void handleTestMic()}
              className="hover:text-white disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isTestingMic ? 'กำลังทดสอบไมค์...' : 'ทดสอบไมค์'}
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            {!isPlaying ? (
              <button
                type="button"
                disabled={neuralTtsState.status === 'loading'}
                onClick={() => void handleStartGame()}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-zinc-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {neuralTtsState.status === 'loading'
                  ? `โหลดเสียงไทย ${neuralTtsState.progress}%`
                  : gameState === 'GAME_OVER'
                    ? 'เล่นอีกครั้ง'
                    : 'เริ่มเกม'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopGame}
                className="px-4 py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                หยุดเล่น
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 flex flex-col gap-5">
        {/* Unboxed Tabular Score, Difficulty Selector & Phase Header */}
        <section
          aria-label="สถิติเกมและความยาก"
          className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-white/10"
        >
          <div className="flex flex-wrap items-baseline gap-6 sm:gap-8">
            <div>
              <div className="text-xs text-zinc-400">คะแนนสะสม</div>
              <div className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 tabular-nums leading-none mt-1">
                {score}
                <span className="text-lg text-zinc-500 font-medium">
                  /{TOTAL_ROUNDS_PER_GAME}
                </span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden sm:block" aria-hidden="true" />

            <div>
              <div className="text-xs text-zinc-400">รอบที่</div>
              <div className="font-mono text-2xl sm:text-3xl font-bold text-white tabular-nums leading-none mt-1">
                {roundNumber}
                <span className="text-base text-zinc-500 font-medium">
                  /{TOTAL_ROUNDS_PER_GAME}
                </span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden sm:block" aria-hidden="true" />

            <div>
              <div className="text-xs text-zinc-400">คะแนนสูงสุด</div>
              <div className="font-mono text-2xl sm:text-3xl font-bold text-emerald-400 tabular-nums leading-none mt-1">
                {highScore}
                <span className="text-base text-zinc-500 font-medium">
                  /{TOTAL_ROUNDS_PER_GAME}
                </span>
              </div>
            </div>

            {/* 5-Round Match Stepper */}
            <div className="hidden sm:flex items-center gap-1.5 pl-2">
              {Array.from({ length: TOTAL_ROUNDS_PER_GAME }).map((_, idx) => {
                const record = roundHistory[idx];
                const isCurrent = isPlaying && roundNumber === idx + 1 && !record;
                return (
                  <div
                    key={idx}
                    title={`รอบที่ ${idx + 1}`}
                    className={`w-7 h-7 rounded-md font-mono text-xs font-bold flex items-center justify-center border transition-colors ${
                      record
                        ? record.passed
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                          : 'bg-red-500/20 border-red-400 text-red-300'
                        : isCurrent
                          ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                          : 'bg-white/5 border-white/10 text-zinc-500'
                    }`}
                  >
                    {idx + 1}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right side: Difficulty Segmented Control + Label Toggle + Hardware Status */}
          <div className="flex flex-col sm:flex-row sm:items-center xl:items-end xl:flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 whitespace-nowrap">ความยาก:</span>
                <div
                  role="group"
                  aria-label="เลือกระดับความยาก"
                  className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#181B22] border border-white/10"
                >
                  {DIFFICULTY_LIST.map((opt) => {
                    const selected = difficulty === opt.id;
                    const secText = (opt.beatIntervalMs / 1000)
                      .toString()
                      .replace(/0+$/, '');
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={isPlaying}
                        onClick={() => setDifficulty(opt.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                          selected
                            ? 'bg-amber-500 text-zinc-950 shadow-sm'
                            : 'text-zinc-300 hover:text-white disabled:opacity-50'
                        }`}
                      >
                        {opt.label} ({secText}s)
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLabels((prev) => !prev)}
                aria-pressed={showLabels}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showLabels
                    ? 'bg-[#181B22] border-white/15 text-zinc-200 hover:border-white/30'
                    : 'bg-amber-500/15 border-amber-400 text-amber-300'
                }`}
              >
                {showLabels ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {showLabels ? 'แสดงชื่อสัตว์' : 'ซ่อนชื่อสัตว์'}
              </button>

              <button
                type="button"
                onClick={() => setArHeadEnabled((prev) => !prev)}
                aria-pressed={arHeadEnabled}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  arHeadEnabled
                    ? 'bg-amber-500/15 border-amber-400 text-amber-300'
                    : 'bg-[#181B22] border-white/15 text-zinc-400 hover:border-white/30'
                }`}
              >
                <User className="w-3.5 h-3.5" aria-hidden="true" />
                {arHeadEnabled ? 'รูปบนหัว: เปิด' : 'รูปบนหัว: ปิด'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <span className="text-zinc-200 font-medium">{phaseSummaryText}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                {cameraReady ? (
                  <Camera className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <CameraOff className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
                )}
                {cameraReady ? 'กล้องพร้อม' : 'ยังไม่เปิดกล้อง'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                {micReady ? (
                  <Mic className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
                )}
                {micReady ? 'ไมโครโฟนพร้อม' : 'ยังไม่เปิดไมค์'}
              </span>
            </div>
          </div>
        </section>

        {mediaError && (
          <div
            role="alert"
            className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-xs sm:text-sm text-amber-200 flex items-center justify-between gap-4"
          >
            <span>{mediaError}</span>
            <button
              type="button"
              onClick={() => void requestMediaPermissions()}
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-950 font-semibold text-xs hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              ขอสิทธิ์อีกครั้ง
            </button>
          </div>
        )}

        {/* Focal Anchor: Live Webcam Arena + 8 Animal Cards Sequence */}
        <section
          ref={stageRef}
          aria-label="เวทีกล้องเว็บแคมและภาพสัตว์ 8 ภาพ"
          className="relative rounded-2xl overflow-hidden bg-[#181B22] border border-white/10 shadow-2xl min-h-[460px] lg:min-h-[540px] flex flex-col justify-between"
        >
          {/* Webcam Video Layer */}
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className={`absolute inset-0 w-full h-full object-cover scale-x-[-1] transition-opacity duration-300 ${
              cameraReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />

          {/* AR Head-Tracked Animal Overlay */}
          {cameraReady && arHeadEnabled && (
            <HeadAnimalOverlay
              heads={detectedHeads}
              animalId={
                gameState === 'ANSWERING' && answerBeat >= 0
                  ? sequence[answerBeat]
                  : sequence[0]
              }
              beatIndex={gameState === 'ANSWERING' ? answerBeat : -1}
              gameState={gameState}
              showLabel={showLabels}
              stageWidth={stageSize.width}
              stageHeight={stageSize.height}
            />
          )}

          {/* Studio Fallback Background when camera is not active */}
          {!cameraReady && (
            <div
              className="absolute inset-0 bg-[radial-gradient(circle_at_top,#262B38_0%,#14171F_60%,#0D0F14_100%)]"
              aria-hidden="true"
            />
          )}

          {/* Measured Contrast Scrim for Cards & Overlays */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#0D0F14]/95 via-[#0D0F14]/45 to-[#0D0F14]/65 pointer-events-none"
            aria-hidden="true"
          />

          {/* Top Arena Banner: Lead-in Metronome Words / Answer Timer / Results */}
          <div className="relative z-10 px-4 sm:px-6 pt-5 pb-3 flex flex-col items-center justify-center min-h-[130px]">
            {gameState === 'TITLE_MENU' && !isPreviewingTts && (
              <div className="text-center max-w-2xl">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-white text-balance">
                  มองภาพ 8 ตัว แล้วพูดให้ตรงจังหวะ 5 รอบ (เต็ม 5 คะแนน)
                </h1>
                <p className="mt-2 text-sm text-zinc-300">
                  ระดับ <span className="text-amber-300 font-semibold">{activeDiffConfig.label}</span> (จังหวะละ {beatDelayLabel} วินาที · รอบละ {phaseSecLabel} วินาที) — ฟังเสียง TTS “หมู หมา กา ไก่ 1 2 3 4” พร้อมนกหวีด แล้วพูดตามภาพที่ไฮไลต์
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  {!micReady && (
                    <button
                      type="button"
                      onClick={() => void requestMediaPermissions()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" aria-hidden="true" />
                      เปิดกล้องและไมโครโฟน
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePreviewTts}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <Volume2 className="w-4 h-4" aria-hidden="true" />
                    {neuralTtsState.status === 'loading'
                      ? `กำลังโหลดเสียงพูดไทย (${neuralTtsState.progress}%)...`
                      : 'ฟังเสียง TTS: หมู หมา กา ไก่ 1 2 3 4 + นกหวีด'}
                  </button>
                </div>
              </div>
            )}

            {(gameState === 'LEAD_IN' || isPreviewingTts) && (
              <div className="w-full max-w-3xl text-center">
                <div className="text-xs font-medium text-amber-300 mb-2.5">
                  {isPreviewingTts
                    ? neuralTtsState.status === 'loading'
                      ? `กำลังเตรียมเสียงพูดไทยครั้งแรก (${neuralTtsState.progress}%)...`
                      : `กำลังเล่นเสียงพูดไทย TTS + นกหวีด (${beatDelayLabel} วินาที/คำ)`
                    : `รอบ ${roundNumber}/${TOTAL_ROUNDS_PER_GAME} · ฟังเสียงนำ TTS + นกหวีด (${beatDelayLabel} วินาที/คำ) · เตรียมพูดเมื่อจบเลข 4`}
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 sm:gap-2">
                  {LEAD_IN_DISPLAY_LABELS.map((word, idx) => {
                    const activeIdx = isPreviewingTts ? previewBeat : leadInBeat;
                    const isCurrent = activeIdx === idx;
                    const isDone = activeIdx > idx;
                    return (
                      <div
                        key={word}
                        className={`py-2 px-1 rounded-lg font-display text-sm sm:text-base font-bold transition-transform duration-100 ${
                          isCurrent
                            ? 'bg-amber-400 text-zinc-950 scale-105 shadow-lg'
                            : isDone
                              ? 'bg-white/15 text-zinc-300'
                              : 'bg-black/40 text-zinc-400 border border-white/10'
                        }`}
                      >
                        {word}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {gameState === 'ANSWERING' && (
              <div className="w-full max-w-2xl text-center">
                <div className="inline-flex items-center gap-2 text-amber-300 font-display text-xl sm:text-2xl font-bold">
                  <Volume2 className="w-6 h-6" aria-hidden="true" />
                  <span>
                    พูดเลย! รอบ {roundNumber}/{TOTAL_ROUNDS_PER_GAME} · ภาพที่ {Math.max(1, answerBeat + 1)} / 8
                  </span>
                </div>
                {/* 8-beat visual metronome progress bar */}
                <div className="mt-3 grid grid-cols-8 gap-1.5">
                  {Array.from({ length: BEATS_PER_PHASE }).map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-2 rounded-sm transition-colors duration-75 ${
                        idx === answerBeat
                          ? 'bg-amber-400'
                          : idx < answerBeat
                            ? 'bg-amber-400/40'
                            : 'bg-white/15'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-2 text-xs text-zinc-300 font-mono tabular-nums">
                  {((BEATS_PER_PHASE - Math.max(0, answerBeat)) * (activeDiffConfig.beatIntervalMs / 1000)).toFixed(2).replace(/0$/, '')}s เหลืออยู่ · {beatDelayLabel}s / ภาพ
                </div>
              </div>
            )}

            {gameState === 'ROUND_EVALUATING' && (
              <div className="text-center">
                <div className="font-display text-xl font-bold text-white">
                  กำลังตรวจคำตอบรอบที่ {roundNumber}...
                </div>
              </div>
            )}

            {gameState === 'ROUND_PASS' && (
              <div className="flex flex-col items-center text-center">
                <div className="inline-flex items-center gap-2 font-display text-2xl sm:text-3xl font-bold text-emerald-400">
                  <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
                  <span>ผ่านรอบที่ {roundNumber}! +1 คะแนน</span>
                </div>
                <p className="mt-1 text-sm text-zinc-200">
                  คะแนนสะสม {score}/{TOTAL_ROUNDS_PER_GAME} · กำลังเริ่มรอบที่ {roundNumber + 1}/{TOTAL_ROUNDS_PER_GAME}...
                </p>
              </div>
            )}

            {gameState === 'ROUND_FAIL' && lastResult && (
              <div className="flex flex-col items-center text-center max-w-2xl">
                <div className="inline-flex items-center gap-2 font-display text-2xl sm:text-3xl font-bold text-red-400">
                  <XCircle className="w-7 h-7" aria-hidden="true" />
                  <span>ไม่ผ่านรอบที่ {roundNumber} (0 คะแนน)</span>
                </div>
                <p className="mt-1 text-sm text-zinc-200">{lastResult.reason}</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  กำลังเริ่มรอบที่ {roundNumber + 1}/{TOTAL_ROUNDS_PER_GAME}...
                </p>
              </div>
            )}

            {gameState === 'GAME_OVER' && (
              <div className="w-full max-w-2xl rounded-xl bg-[#111318]/90 border border-white/15 px-5 py-4 text-center backdrop-blur-sm">
                <div className="inline-flex items-center gap-2 font-display text-xl sm:text-2xl font-bold text-white">
                  {score >= TOTAL_ROUNDS_PER_GAME ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-6 h-6 text-amber-400" aria-hidden="true" />
                  )}
                  <span>
                    สรุปผลเกม · คะแนน {score} / {TOTAL_ROUNDS_PER_GAME}
                  </span>
                </div>
                {lastResult && (
                  <p className="mt-1 text-sm text-zinc-200">
                    รอบสุดท้าย (รอบ {lastResult.roundNumber}): {lastResult.reason}
                  </p>
                )}
                {roundHistory.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs">
                    {roundHistory.map((item) => (
                      <span
                        key={item.roundNumber}
                        className={`inline-flex items-center gap-1 font-medium ${
                          item.passed ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {item.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        รอบ {item.roundNumber}: {item.passed ? '+1' : '0'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 8 Animal Cards Sequence — Always visible left to right from start through answer */}
          <div className="relative z-10 px-3 sm:px-6 pb-5 pt-2">
            <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
              {sequence.map((animalId, idx) => (
                <AnimalCard
                  key={`${roundNumber}-${idx}-${animalId}`}
                  animalId={animalId}
                  index={idx}
                  isLeadIn={gameState === 'LEAD_IN'}
                  isActiveBeat={gameState === 'ANSWERING' && answerBeat === idx}
                  isPastBeat={gameState === 'ANSWERING' && answerBeat > idx}
                  showLabel={showLabels}
                  evaluation={
                    gameState === 'ROUND_PASS' ||
                    gameState === 'ROUND_FAIL' ||
                    gameState === 'GAME_OVER'
                      ? lastResult?.slots[idx]
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        </section>

        {/* Controls + Live Mic Monitor Strip */}
        <section
          aria-label="ปุ่มควบคุมเกมและระดับเสียงไมโครโฟน"
          className="rounded-2xl bg-[#181B22] border border-white/10 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        >
          {/* Primary Game Controls: Start, Stop, Restart */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isPlaying || neuralTtsState.status === 'loading'}
              onClick={() => void handleStartGame()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:pointer-events-none text-zinc-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {neuralTtsState.status === 'loading'
                ? `กำลังโหลดเสียงไทย ${neuralTtsState.progress}%`
                : 'เริ่มเกม'}
            </button>

            <button
              type="button"
              disabled={!isPlaying}
              onClick={handleStopGame}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-500/90 hover:bg-red-500 disabled:opacity-35 disabled:pointer-events-none text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" aria-hidden="true" />
              หยุดเล่น
            </button>

            <button
              type="button"
              onClick={() => void handleRestartGame()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              เริ่มใหม่
            </button>

            <button
              type="button"
              disabled={isPlaying}
              onClick={handlePreviewTts}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-zinc-200 font-medium text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Volume2 className="w-4 h-4 text-amber-400" aria-hidden="true" />
              {isPreviewingTts ? 'หยุดเสียง TTS' : 'ฟัง TTS + นกหวีด'}
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="md:hidden inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-sm transition-colors whitespace-nowrap shrink-0"
            >
              ตั้งค่า
            </button>
          </div>

          {/* Live Mic Meter & Speech Recognition Readout */}
          <div className="flex-1 lg:max-w-lg flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                {isTestingMic
                  ? 'กำลังทดสอบไมค์ — ลองพูด “หมู หมา กา ไก่”'
                  : 'ระดับเสียงไมโครโฟน & คำที่ระบบได้ยิน'}
              </span>
              {transcriberState.lastCategory && (
                <span className="font-mono text-[11px] text-zinc-500">
                  YAMNet: {transcriberState.lastCategory}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Mic Level Bar */}
              <div
                className="w-28 sm:w-36 h-2 rounded-full bg-black/50 overflow-hidden shrink-0"
                aria-label="ระดับความดังไมโครโฟน"
              >
                <div
                  className="h-full bg-emerald-400 transition-transform duration-75 origin-left"
                  style={{
                    transform: `scaleX(${Math.max(0.04, micVolume)})`,
                  }}
                />
              </div>

              {/* Live Transcript Line */}
              <div className="flex-1 min-w-0 text-xs sm:text-sm text-zinc-200 truncate">
                {recognizedPreviewTokens.length > 0 ? (
                  <span>
                    ได้ยิน:{' '}
                    <span className="text-amber-300 font-semibold">
                      {recognizedPreviewTokens
                        .map((t) => ANIMALS[t.animalId].thaiName)
                        .join(' → ')}
                    </span>
                  </span>
                ) : liveTranscript ? (
                  <span className="text-zinc-300">ได้ยิน: {liveTranscript}</span>
                ) : (
                  <span className="text-zinc-500">
                    {micReady
                      ? 'รอรับเสียงพูด...'
                      : 'กดเริ่มเกมหรือทดสอบไมค์เพื่อเปิดใช้งานไมโครโฟน'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Modals */}
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        engineMode={engineMode}
        onEngineModeChange={setEngineMode}
        speakLeadIn={speakLeadIn}
        onSpeakLeadInChange={setSpeakLeadIn}
        showLabels={showLabels}
        onShowLabelsChange={setShowLabels}
        availableVoices={availableVoices}
        selectedVoiceURI={selectedVoiceURI}
        onSelectVoiceURI={(uri) => {
          setSelectedVoiceURI(uri);
          rhythmRef.current?.setPreferredVoiceURI(uri);
        }}
        onPreviewLeadIn={handlePreviewTts}
        neuralTtsState={neuralTtsState}
        transcriberState={transcriberState}
        webSpeechSupported={
          audioPipelineRef.current?.isSpeechRecognitionSupported() ?? true
        }
        onLoadModelUrl={async (url) => {
          await audioPipelineRef.current?.loadTranscriberModel(url);
        }}
        onLoadModelFile={async (file) => {
          await audioPipelineRef.current?.loadTranscriberModel(file);
        }}
      />
    </div>
  );
}
