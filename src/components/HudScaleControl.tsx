/**
 * HudScaleControl.tsx
 * Compact −/%/+ control for the operator's manual HUD-scale trim (see
 * hooks/useHudScaleTrim.ts), mirroring BrightnessControl.tsx's shape.
 *
 * Lives in the map's own control drawer (Solar3DViewer.tsx), not the header:
 * the trim reaches only the map view - marker cards and the totals band - so
 * a header copy would sit inert over the site sub-page. The drawer is also
 * the one place an operator can watch the cards resize live while adjusting,
 * without a settings modal covering the thing they are tuning.
 *
 * Click the percentage to snap back to 100% (automatic scale only), same as
 * BrightnessControl.
 */

import React from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useHudScaleTrim } from '../hooks/useHudScaleTrim';

export const HudScaleControl: React.FC = () => {
  const { percent, increase, decrease, reset, canIncrease, canDecrease, isDefault } =
    useHudScaleTrim();

  return (
    <div
      id="hud-scale-control"
      role="group"
      aria-label="ปรับขนาดการ์ดบนแผนที่"
      className="flex items-center gap-0.5 rounded-xl bg-slate-900/80 border border-slate-700 px-1 py-0.5 shrink-0"
      title="ปรับขนาดการ์ดและตัวเลขบนแผนที่ให้พอดีกับจอหน้างาน"
    >
      <Maximize
        className={`w-3.5 h-3.5 ml-0.5 transition-colors ${
          isDefault ? 'text-slate-400' : 'text-amber-300'
        }`}
      />

      <button
        id="btn-hud-scale-down"
        onClick={decrease}
        disabled={!canDecrease}
        title="ลดขนาดการ์ด"
        aria-label="ลดขนาดการ์ดบนแผนที่"
        className="p-1 rounded-lg text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Minus className="w-3 h-3" />
      </button>

      <button
        id="btn-hud-scale-reset"
        onClick={reset}
        title="คืนค่าขนาดอัตโนมัติ (100%)"
        aria-label="คืนค่าขนาดการ์ดเป็นอัตโนมัติ"
        className={`min-w-[38px] text-center font-mono text-[11px] font-bold px-0.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-800 ${
          isDefault ? 'text-slate-300' : 'text-amber-300'
        }`}
      >
        {percent}%
      </button>

      <button
        id="btn-hud-scale-up"
        onClick={increase}
        disabled={!canIncrease}
        title="เพิ่มขนาดการ์ด"
        aria-label="เพิ่มขนาดการ์ดบนแผนที่"
        className="p-1 rounded-lg text-slate-300 hover:text-sky-300 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};
