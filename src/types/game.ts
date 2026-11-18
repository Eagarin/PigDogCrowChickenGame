export type AnimalId = 'pig' | 'dog' | 'crow' | 'chicken';

export interface AnimalConfig {
  id: AnimalId;
  thaiName: string;
  englishName: string;
  imagePath: string;
  accentHex: string;
  synonyms: string[];
}

export type DifficultyId = 'easy' | 'medium' | 'hard';

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  beatIntervalMs: number;
  phaseDurationSec: number;
}

export type GameState =
  | 'TITLE_MENU'
  | 'LEAD_IN'
  | 'ANSWERING'
  | 'ROUND_EVALUATING'
  | 'ROUND_PASS'
  | 'ROUND_FAIL'
  | 'GAME_OVER';

export type AsrEngineMode = 'hybrid' | 'mediapipe' | 'webspeech';

export type TranscriberStatus =
  | 'idle'
  | 'wasm_ready'
  | 'loading_model'
  | 'ready'
  | 'error';

export interface SlotEvaluation {
  index: number;
  target: AnimalId;
  heard: AnimalId | null;
  rawToken: string;
  beatDetected: boolean;
  matched: boolean;
}

export interface RoundResult {
  roundNumber: number;
  difficulty: DifficultyId;
  sequence: AnimalId[];
  slots: SlotEvaluation[];
  passed: boolean;
  reason: string;
  transcript: string;
  engineUsed: AsrEngineMode;
  durationMs: number;
}

export interface TranscriberState {
  status: TranscriberStatus;
  modelName: string;
  errorMessage?: string;
  classifierReady: boolean;
  lastCategory?: string;
}
