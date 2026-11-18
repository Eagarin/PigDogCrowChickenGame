import { AnimalConfig, AnimalId } from '../types/game';

export const ANIMALS: Record<AnimalId, AnimalConfig> = {
  pig: {
    id: 'pig',
    thaiName: 'หมู',
    englishName: 'Pig',
    imagePath: '/src/assets/images/animal_pig_1794801609151.jpg',
    accentHex: '#F472B6',
    synonyms: [
      'หมู',
      'หมู่',
      'หมู้',
      'หมุ',
      'มู',
      'มู่',
      'มู้',
      'หมู่',
      'หมูๆ',
      'moo',
      'mu',
      'pig',
    ],
  },
  dog: {
    id: 'dog',
    thaiName: 'หมา',
    englishName: 'Dog',
    imagePath: '/src/assets/images/animal_dog_1794801608977.jpg',
    accentHex: '#F59E0B',
    synonyms: [
      'หมา',
      'หม่า',
      'หม้า',
      'หม๊า',
      'มา',
      'ม่า',
      'ม้า',
      'ม๊า',
      'หมาๆ',
      'maa',
      'ma',
      'mah',
      'dog',
    ],
  },
  crow: {
    id: 'crow',
    thaiName: 'กา',
    englishName: 'Crow',
    imagePath: '/src/assets/images/animal_crow_1794801608939.jpg',
    accentHex: '#60A5FA',
    synonyms: [
      'กา',
      'ก่า',
      'ก้า',
      'ก๊า',
      'ก๋า',
      'กะ',
      'ก๊าา',
      'กาๆ',
      'kaa',
      'ka',
      'ga',
      'gaa',
      'crow',
      'car',
    ],
  },
  chicken: {
    id: 'chicken',
    thaiName: 'ไก่',
    englishName: 'Chicken',
    imagePath: '/src/assets/images/animal_chicken_1794801609784.jpg',
    accentHex: '#FB923C',
    synonyms: [
      'ไก่',
      'ไก',
      'ไก้',
      'ไก่อ',
      'ใกล้',
      'ไกล',
      'ไข้',
      'ไข่',
      'ไกว',
      'กาย',
      'ก่าย',
      'kai',
      'gai',
      'guy',
      'chicken',
    ],
  },
};

export const ANIMAL_IDS: AnimalId[] = ['pig', 'dog', 'crow', 'chicken'];

export const LEAD_IN_WORDS: string[] = [
  'หมู',
  'หมา',
  'กา',
  'ไก่',
  'หนึ่ง',
  'สอง',
  'สาม',
  'สี่',
];

export const LEAD_IN_DISPLAY_LABELS: string[] = [
  'หมู',
  'หมา',
  'กา',
  'ไก่',
  '1',
  '2',
  '3',
  '4',
];

export const BEAT_INTERVAL_MS = 500;
export const BEATS_PER_PHASE = 8;
export const TOTAL_ROUNDS_PER_GAME = 5;
export const PHASE_DURATION_MS = BEAT_INTERVAL_MS * BEATS_PER_PHASE; // 4000ms

export const DIFFICULTIES: Record<
  'easy' | 'medium' | 'hard',
  {
    id: 'easy' | 'medium' | 'hard';
    label: string;
    beatIntervalMs: number;
    phaseDurationSec: number;
  }
> = {
  easy: {
    id: 'easy',
    label: 'ง่าย',
    beatIntervalMs: 500,
    phaseDurationSec: 4.0,
  },
  medium: {
    id: 'medium',
    label: 'กลาง',
    beatIntervalMs: 350,
    phaseDurationSec: 2.8,
  },
  hard: {
    id: 'hard',
    label: 'ยาก',
    beatIntervalMs: 200,
    phaseDurationSec: 1.6,
  },
};

export const DIFFICULTY_LIST = [
  DIFFICULTIES.easy,
  DIFFICULTIES.medium,
  DIFFICULTIES.hard,
];

export const DEFAULT_MEDIAPIPE_ASR_MODEL =
  'https://huggingface.co/litert-community/parakeet-tdt-0.6b-v3/resolve/main/parakeet_tdt_0.6b_v3_5s_i8_stateful.litertlm';

export const DEFAULT_YAMNET_MODEL =
  'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';

export function generateRandomSequence(length = BEATS_PER_PHASE): AnimalId[] {
  const result: AnimalId[] = [];
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ANIMAL_IDS.length);
    result.push(ANIMAL_IDS[idx]);
  }
  return result;
}
