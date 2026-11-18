import { ANIMALS, BEATS_PER_PHASE, DIFFICULTIES } from '../constants/animals';
import {
  AnimalId,
  AsrEngineMode,
  DifficultyId,
  RoundResult,
  SlotEvaluation,
} from '../types/game';

interface TokenMatch {
  animalId: AnimalId;
  raw: string;
}

// Build longest-first lookup table of Thai & phonetic synonyms
const SYNONYM_ENTRIES: Array<{ term: string; animalId: AnimalId }> = (() => {
  const list: Array<{ term: string; animalId: AnimalId }> = [];
  (Object.keys(ANIMALS) as AnimalId[]).forEach((id) => {
    ANIMALS[id].synonyms.forEach((syn) => {
      list.push({ term: syn.toLowerCase(), animalId: id });
    });
  });
  return list.sort((a, b) => b.term.length - a.term.length);
})();

/**
 * Extracts ordered animal tokens from continuous Thai/English speech transcripts.
 * Handles unspaced Thai strings like "ไก่หมูหมาหมากาไก่หมูกา" as well as spaced tokens.
 */
export function extractAnimalTokens(transcript: string): TokenMatch[] {
  const cleaned = transcript
    .toLowerCase()
    .replace(/[.,!?;:"'()\[\]{}\-_/\\|]+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const tokens: TokenMatch[] = [];
  let cursor = 0;

  while (cursor < cleaned.length) {
    if (/\s/.test(cleaned[cursor])) {
      cursor++;
      continue;
    }

    let matched = false;
    const remaining = cleaned.slice(cursor);

    for (const entry of SYNONYM_ENTRIES) {
      if (remaining.startsWith(entry.term)) {
        const isAscii = /^[a-z]+$/.test(entry.term);
        if (isAscii) {
          const nextChar = remaining[entry.term.length];
          if (nextChar && /[a-z]/.test(nextChar)) {
            continue;
          }
        }

        tokens.push({
          animalId: entry.animalId,
          raw: entry.term,
        });
        cursor += entry.term.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      cursor++;
    }
  }

  return tokens;
}

export interface EvaluationInput {
  roundNumber: number;
  difficulty: DifficultyId;
  sequence: AnimalId[];
  transcript: string;
  beatVoiceActivity: boolean[]; // length 8, whether mic registered speech onset in beat window
  engineUsed: AsrEngineMode;
  durationMs: number;
}

/**
 * Evaluates an 8-beat answer round strictly against the game rules:
 * - Must speak all 8 animals in exact left-to-right order within the phase time window
 * - Wrong word, skipped image, fewer/more than 8 words, or silent/missed rhythm => 0 points
 */
export function evaluateRound(input: EvaluationInput): RoundResult {
  const {
    roundNumber,
    difficulty,
    sequence,
    transcript,
    beatVoiceActivity,
    engineUsed,
    durationMs,
  } = input;

  const diffConfig = DIFFICULTIES[difficulty];
  const phaseSecLabel = diffConfig.phaseDurationSec.toFixed(1).replace(/\.0$/, '');
  const heardTokens = extractAnimalTokens(transcript);
  const activeBeatsCount = beatVoiceActivity.filter(Boolean).length;

  const slots: SlotEvaluation[] = sequence.map((target, index) => {
    const token = heardTokens[index];
    const beatDetected = Boolean(beatVoiceActivity[index]);
    const heard = token ? token.animalId : null;
    const matched = heard === target;
    return {
      index,
      target,
      heard,
      rawToken: token?.raw ?? '',
      beatDetected,
      matched,
    };
  });

  if (heardTokens.length === 0) {
    return {
      roundNumber,
      difficulty,
      sequence,
      slots,
      passed: false,
      reason:
        activeBeatsCount > 0
          ? 'ได้ยินเสียงพูดแต่ไม่สามารถถอดคำเป็นชื่อสัตว์ได้ กรุณาพูดให้ชัดเจนขึ้น'
          : `ไม่ได้ยินเสียงพูดในเวลาที่กำหนด (${phaseSecLabel} วินาที)`,
      transcript,
      engineUsed,
      durationMs,
    };
  }

  if (heardTokens.length < BEATS_PER_PHASE) {
    return {
      roundNumber,
      difficulty,
      sequence,
      slots,
      passed: false,
      reason: `พูดไม่ครบทั้ง 8 ภาพ (ถอดความได้ ${heardTokens.length}/8 คำ ภายใน ${phaseSecLabel} วินาที)`,
      transcript,
      engineUsed,
      durationMs,
    };
  }

  if (heardTokens.length > BEATS_PER_PHASE) {
    return {
      roundNumber,
      difficulty,
      sequence,
      slots,
      passed: false,
      reason: `พูดเกินจำนวน 8 คำ (${heardTokens.length} คำ)`,
      transcript,
      engineUsed,
      durationMs,
    };
  }

  const firstMismatch = slots.find((s) => !s.matched);
  if (firstMismatch) {
    const expectedThai = ANIMALS[firstMismatch.target].thaiName;
    const heardThai = firstMismatch.heard
      ? ANIMALS[firstMismatch.heard].thaiName
      : 'ไม่ทราบ';
    return {
      roundNumber,
      difficulty,
      sequence,
      slots,
      passed: false,
      reason: `ภาพที่ ${firstMismatch.index + 1} พูดผิด (ต้องพูด "${expectedThai}" แต่ได้ยิน "${heardThai}")`,
      transcript,
      engineUsed,
      durationMs,
    };
  }

  const minRequiredBeats = diffConfig.beatIntervalMs < 400 ? 5 : 6;
  if (activeBeatsCount < minRequiredBeats) {
    return {
      roundNumber,
      difficulty,
      sequence,
      slots,
      passed: false,
      reason: `จังหวะการพูดไม่ต่อเนื่อง (ตรวจจับเสียงตรงจังหวะได้ ${activeBeatsCount}/8 จังหวะ)`,
      transcript,
      engineUsed,
      durationMs,
    };
  }

  return {
    roundNumber,
    difficulty,
    sequence,
    slots,
    passed: true,
    reason: 'พูดถูกต้องครบทั้ง 8 ภาพ ตรงตามลำดับและจังหวะ (+1 คะแนน)',
    transcript,
    engineUsed,
    durationMs,
  };
}
