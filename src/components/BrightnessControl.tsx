/**
 * BrightnessControl.tsx
 * Compact −/%/+ control for page brightness, sits in the header so it is
 * reachable from both the map and the site sub-pages.
 *
 * Click the percentage to snap back to 100%.
 */

import React from 'react';
import { Sun, Minus, Plus } from 'lucide-react';
import { useScreenBrightness } from '../hooks/useScreenBrightness';

export const BrightnessControl: React.FC = () => {
  const { percent, increase, decrease, reset, canIncrease, canDecrease, isDefault } =
    useScreenBrightness();

  return (
    <div
      id="brightness-control"
      className="flex items-center gap-0.5 rounded-xl bg-slate-900/60 border border-sky-500/20 px-1 py-0.5 shrink-0"
      title="ปรับความสว่างของหน้าจอ"
    >
      <Sun
        className={`w-3.5 h-3.5 ml-0.5 transition-colors ${
          isDefault ? 'text-slate-400' : 'text-amber-300'
        }`}
      />

      <button
        id="btn-brightness-down"
        onClick={decrease}
        disabled={!canDecrease}
        title="ลดความสว่าง"
        className="p-1 rounded-lg text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Minus className="w-3 h-3" />
      </button>

      <button
        id="btn-brightness-reset"
        onClick={reset}
        title="คืนค่าความสว่างปกติ (100%)"
        className={`min-w-[38px] text-center font-mono text-[11px] font-bold px-0.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-800 ${
          isDefault ? 'text-slate-300' : 'text-amber-300'
        }`}
      >
        {percent}%
      </button>

      <button
        id="btn-brightness-up"
        onClick={increase}
        disabled={!canIncrease}
        title="เพิ่มความสว่าง"
        className="p-1 rounded-lg text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};
