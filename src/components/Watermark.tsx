/**
 * Watermark.tsx
 * Component to display the demo watermark across the application.
 * 
 * 💡 TO REMOVE OR TOGGLE OFF THIS WATERMARK:
 * Change `ENABLE_DEMO_WATERMARK = false` in this file, or remove <Watermark /> from App.tsx.
 */

import React from 'react';

/**
 * 💡 MASTER SWITCH: Set this to `false` to remove/disable the watermark completely.
 */
export const ENABLE_DEMO_WATERMARK = true;

interface WatermarkProps {
  text?: string;
  subtext?: string;
}

export const Watermark: React.FC<WatermarkProps> = ({
  text = 'PRECISE DIGITAL ECONOMY 2026',
  subtext = 'FOR DEMO ONLY',
}) => {
  if (!ENABLE_DEMO_WATERMARK) {
    return null;
  }

  return (
    <div
      id="demo-watermark-overlay"
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-50 select-none overflow-hidden flex flex-col justify-between p-4 sm:p-6"
    >
      {/* 1. Subtle Diagonal Repeating Background Stamp Pattern */}
      <div className="absolute inset-0 opacity-[0.035] flex flex-wrap items-center justify-around gap-20 -rotate-12 scale-110 pointer-events-none">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="text-white font-mono font-bold tracking-widest text-sm sm:text-base uppercase whitespace-nowrap"
          >
            {text} • {subtext}
          </div>
        ))}
      </div>

      {/* Spacer: keeps the badges pinned to the bottom of the flex column.
          The security badge used to float at top-centre, where it collided with
          the ceremony masthead over the map. */}
      <div aria-hidden="true" />

      {/* 2. Bottom-Left Floating Security Badge.
          The bottom-right corner stamp that used to sit alongside this was
          removed: it landed on top of the regional totals panel, covering the
          CO2 and tree figures. One badge plus the background stamp is enough to
          mark the build as a demo. */}
      <div className="mb-14 md:mb-1 self-start bg-slate-950/60 backdrop-blur-sm border border-amber-400/25 px-3 py-1 rounded-full shadow-lg flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[10px] sm:text-xs font-mono font-semibold tracking-wider text-amber-300/90 uppercase">
          {text} — <span className="text-amber-400 font-bold">{subtext}</span>
        </span>
      </div>
    </div>
  );
};
