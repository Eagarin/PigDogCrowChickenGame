import React, { useState } from 'react';
import { Check, Volume2, X } from 'lucide-react';
import { ANIMALS } from '../constants/animals';
import { AnimalId, SlotEvaluation } from '../types/game';

interface AnimalCardProps {
  animalId: AnimalId;
  index: number;
  isActiveBeat: boolean;
  isPastBeat: boolean;
  isLeadIn: boolean;
  showLabel?: boolean;
  evaluation?: SlotEvaluation;
}

export const AnimalCard: React.FC<AnimalCardProps> = ({
  animalId,
  index,
  isActiveBeat,
  isPastBeat,
  isLeadIn,
  showLabel = true,
  evaluation,
}) => {
  const [imgError, setImgError] = useState(false);
  const animal = ANIMALS[animalId];

  const isEvaluated = Boolean(evaluation);
  const passed = evaluation?.matched ?? false;

  let containerClasses =
    'relative flex flex-col overflow-hidden rounded-xl bg-[#FAF7F2] text-zinc-900 transition-transform duration-150 ease-out select-none';

  if (isEvaluated) {
    if (passed) {
      containerClasses +=
        ' ring-2 ring-emerald-500 shadow-[0_8px_24px_rgba(16,185,129,0.28)]';
    } else {
      containerClasses +=
        ' ring-2 ring-red-500 shadow-[0_8px_24px_rgba(239,68,68,0.28)]';
    }
  } else if (isActiveBeat) {
    containerClasses +=
      ' -translate-y-2 scale-[1.04] ring-4 ring-amber-400 shadow-[0_14px_32px_rgba(245,158,11,0.42)] z-10';
  } else if (isPastBeat) {
    containerClasses += ' opacity-70 ring-1 ring-white/20';
  } else if (isLeadIn) {
    containerClasses += ' ring-1 ring-white/25';
  } else {
    containerClasses += ' ring-1 ring-black/15';
  }

  return (
    <div className={containerClasses}>
      {/* Top index + status row */}
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1 text-xs font-mono font-semibold text-zinc-500 tabular-nums">
        <span>{String(index + 1).padStart(2, '0')}</span>
        {isActiveBeat && !isEvaluated && (
          <span className="inline-flex items-center gap-1 text-amber-700 font-sans font-bold text-[11px]">
            <Volume2 className="w-3 h-3" aria-hidden="true" />
            พูด
          </span>
        )}
        {isEvaluated && (
          <span
            className={`inline-flex items-center gap-0.5 font-sans font-semibold text-[11px] ${
              passed ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {passed ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ถูก
              </>
            ) : (
              <>
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                ผิด
              </>
            )}
          </span>
        )}
      </div>

      {/* Animal Illustration */}
      <div className={`relative aspect-square w-full px-2 ${!showLabel && !isEvaluated ? 'pb-2' : ''}`}>
        {!imgError ? (
          <img
            src={animal.imagePath}
            alt={showLabel ? animal.thaiName : `ภาพสัตว์ที่ ${index + 1}`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-contain rounded-lg"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full rounded-lg bg-zinc-200 flex items-center justify-center">
            <span className="font-display text-2xl font-bold text-zinc-700">
              {showLabel || isEvaluated ? animal.thaiName : '?'}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Thai Label (optional during play, always visible for evaluation feedback) */}
      {(showLabel || isEvaluated) ? (
        <div
          className={`mt-1 px-2 py-1.5 text-center border-t ${
            isActiveBeat && !isEvaluated
              ? 'bg-amber-400 text-zinc-950 border-amber-500/40'
              : isEvaluated
                ? passed
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-red-50 text-red-900 border-red-200'
                : 'bg-white text-zinc-900 border-zinc-200/80'
          }`}
        >
          <div className="font-display text-base sm:text-lg font-bold leading-tight">
            {animal.thaiName}
          </div>
          {isEvaluated && !passed && (
            <div className="text-[11px] text-red-700 font-medium truncate">
              ได้ยิน:{' '}
              {evaluation?.heard
                ? ANIMALS[evaluation.heard].thaiName
                : '—'}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`h-2 w-full transition-colors ${
            isActiveBeat ? 'bg-amber-400' : 'bg-zinc-200/70'
          }`}
          aria-hidden="true"
        />
      )}
    </div>
  );
};
