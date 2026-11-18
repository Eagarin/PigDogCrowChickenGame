import React, { useState } from 'react';
import { ANIMALS } from '../constants/animals';
import { HeadPosition } from '../services/faceTracker';
import { AnimalId, GameState } from '../types/game';

interface HeadAnimalOverlayProps {
  heads: HeadPosition[];
  animalId: AnimalId;
  beatIndex: number; // 0..7 when answering, -1 otherwise
  gameState: GameState;
  showLabel: boolean;
  stageWidth: number;
  stageHeight: number;
}

export const HeadAnimalOverlay: React.FC<HeadAnimalOverlayProps> = ({
  heads,
  animalId,
  beatIndex,
  gameState,
  showLabel,
  stageWidth,
  stageHeight,
}) => {
  const [imgError, setImgError] = useState(false);
  const animal = ANIMALS[animalId];

  if (heads.length === 0 || stageWidth === 0 || stageHeight === 0) {
    return null;
  }

  const isAnswering = gameState === 'ANSWERING';
  const isPass = gameState === 'ROUND_PASS';
  const isFail = gameState === 'ROUND_FAIL';

  const ringClass = isAnswering
    ? 'ring-4 ring-amber-400 shadow-[0_12px_28px_rgba(245,158,11,0.48)]'
    : isPass
      ? 'ring-4 ring-emerald-400 shadow-[0_12px_28px_rgba(16,185,129,0.45)]'
      : isFail
        ? 'ring-4 ring-red-400 shadow-[0_12px_28px_rgba(239,68,68,0.45)]'
        : 'ring-2 ring-white/80 shadow-[0_10px_24px_rgba(0,0,0,0.45)]';

  const pointerBg = isAnswering
    ? 'bg-amber-400'
    : isPass
      ? 'bg-emerald-400'
      : isFail
        ? 'bg-red-400'
        : 'bg-[#FAF7F2]';

  return (
    <div
      className="absolute inset-0 pointer-events-none z-20 overflow-hidden"
      aria-hidden="true"
    >
      {heads.map((head) => {
        const cardWidth = Math.max(82, Math.min(132, head.faceWidth * 0.72));
        const estimatedHeight = showLabel ? cardWidth + 28 : cardWidth + 8;

        // Center horizontally above forehead, clamped within stage bounds
        const clampedX = Math.max(
          cardWidth / 2 + 12,
          Math.min(stageWidth - cardWidth / 2 - 12, head.x)
        );
        // Position bottom of card slightly above top of detected face box
        const rawTop = head.y - estimatedHeight - Math.max(18, head.faceWidth * 0.16);
        const clampedTop = Math.max(10, Math.min(stageHeight - estimatedHeight - 24, rawTop));

        const leftPx = clampedX - cardWidth / 2;

        return (
          <div
            key={head.id}
            style={{
              width: `${cardWidth}px`,
              transform: `translate3d(${leftPx.toFixed(1)}px, ${clampedTop.toFixed(1)}px, 0)`,
            }}
            className="absolute top-0 left-0 flex flex-col items-center will-change-transform"
          >
            <div
              className={`w-full rounded-xl bg-[#FAF7F2] text-zinc-900 overflow-hidden ${ringClass}`}
            >
              <div className="relative aspect-square w-full p-1.5">
                {beatIndex >= 0 && (
                  <span className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-zinc-900/80 text-amber-300 font-mono text-[10px] font-bold leading-none tabular-nums">
                    {String(beatIndex + 1).padStart(2, '0')}
                  </span>
                )}
                {!imgError ? (
                  <img
                    src={animal.imagePath}
                    alt={animal.thaiName}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-contain rounded-lg"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full rounded-lg bg-zinc-200 flex items-center justify-center">
                    <span className="font-display text-lg font-bold text-zinc-700">
                      {showLabel ? animal.thaiName : '?'}
                    </span>
                  </div>
                )}
              </div>

              {showLabel && (
                <div
                  className={`px-1.5 py-1 text-center border-t font-display text-sm font-bold leading-tight ${
                    isAnswering
                      ? 'bg-amber-400 text-zinc-950 border-amber-500/40'
                      : isPass
                        ? 'bg-emerald-100 text-emerald-950 border-emerald-200'
                        : isFail
                          ? 'bg-red-100 text-red-950 border-red-200'
                          : 'bg-white text-zinc-900 border-zinc-200'
                  }`}
                >
                  {animal.thaiName}
                </div>
              )}
            </div>

            {/* Subtle pointer arrow toward detected head */}
            <div
              className={`w-3 h-3 -mt-1.5 rotate-45 ${pointerBg}`}
            />
          </div>
        );
      })}
    </div>
  );
};
