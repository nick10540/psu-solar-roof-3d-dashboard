/**
 * RefreshCadenceSettings — how often each site's figures are refetched.
 *
 * Two knobs per site, in seconds, floored at 30:
 *
 *   powerSec   /power + /energy (today)        "what is happening now"
 *   energySec  /energy?MONTH + CO2             "what has accumulated"
 *
 * Each pair costs 2 upstream SolarEdge calls per site per tick, and the plan
 * charges per MINUTE as well as per month. That arithmetic is on screen rather
 * than in a doc comment, and checked against the ceilings /health reports
 * rather than any figure hard-coded here: the 30-second floor is affordable by
 * the minute and ruinous by the month, and an operator setting this on a
 * touchscreen five minutes before a ceremony has no other way to know.
 *
 * The intervals are only a request. worker/src/config.ts clamps every one of
 * them, so nothing typed here can drive the backend below its own floor.
 */

import React, { useMemo, useState } from 'react';
import {
  SiteRefreshIntervals,
  SolarEdgeBackendLimits,
  SolarEdgeRawSite,
  MIN_REFRESH_INTERVAL_SEC,
  MAX_REFRESH_INTERVAL_SEC,
  clampRefreshIntervalSec,
} from '../types';
import { Clock, Zap, Activity, AlertCircle, Sigma, RotateCcw } from 'lucide-react';

interface RefreshCadenceSettingsProps {
  /** Cadence for every site without an override. */
  intervals: SiteRefreshIntervals;
  /** Per-site overrides, keyed by site ID as a string. */
  siteIntervals: Record<string, SiteRefreshIntervals>;
  /** The site IDs the dashboard actually polls — bound pins plus manual IDs. */
  activeSiteIds: number[];
  /** Account site list, for display names. May not cover a freshly typed ID. */
  sites: SolarEdgeRawSite[];
  /** Ceilings the backend reported. Null until /health has answered. */
  limits: SolarEdgeBackendLimits | null;
  onChange: (next: {
    intervals: SiteRefreshIntervals;
    siteIntervals: Record<string, SiteRefreshIntervals>;
  }) => void;
}

/** Presets a gloved finger can hit on a kiosk. */
const PRESETS: Array<{ label: string; sec: number }> = [
  { label: '30 วิ', sec: 30 },
  { label: '1 นาที', sec: 60 },
  { label: '5 นาที', sec: 300 },
  { label: '15 นาที', sec: 900 },
  { label: '30 นาที', sec: 1800 },
];

/** "90 วิ" / "5 นาที" / "1.5 ชม." — whichever reads shortest. */
function humaniseSec(sec: number): string {
  if (sec < 60) return `${sec} วิ`;
  if (sec < 3600) {
    const m = sec / 60;
    return `${Number.isInteger(m) ? m : m.toFixed(1)} นาที`;
  }
  const h = sec / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} ชม.`;
}

/**
 * One seconds field.
 *
 * Holds the raw text while it is being typed and only clamps on blur —
 * clamping per keystroke turns "300" into 30 the moment the first digit lands,
 * which makes the field feel broken and is how an operator ends up polling
 * twenty times faster than they meant to.
 */
const SecondsInput: React.FC<{
  value: number;
  fallback: number;
  disabled?: boolean;
  onCommit: (sec: number) => void;
}> = ({ value, fallback, disabled, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="relative">
      <input
        type="number"
        inputMode="numeric"
        min={MIN_REFRESH_INTERVAL_SEC}
        max={MAX_REFRESH_INTERVAL_SEC}
        step={10}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
        onBlur={() => {
          if (draft !== null) onCommit(clampRefreshIntervalSec(draft, fallback));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          // Enter inside the settings form would submit and close it before
          // the value had been committed.
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
        className="w-20 bg-slate-950/80 border border-slate-700 focus:border-sky-500 rounded-lg px-2 py-1 text-xs font-mono text-white outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-500 pointer-events-none">
        วิ
      </span>
    </div>
  );
};

export const RefreshCadenceSettings: React.FC<RefreshCadenceSettingsProps> = ({
  intervals,
  siteIntervals,
  activeSiteIds,
  sites,
  limits,
  onChange,
}) => {
  const nameFor = (siteId: number): string =>
    sites.find((s) => s.id === siteId)?.name || `SolarEdge Site #${siteId}`;

  const effectiveFor = (siteId: number): SiteRefreshIntervals =>
    siteIntervals[String(siteId)] ?? intervals;

  const setGlobal = (patch: Partial<SiteRefreshIntervals>) =>
    onChange({ intervals: { ...intervals, ...patch }, siteIntervals });

  const setOverride = (siteId: number, patch: Partial<SiteRefreshIntervals>) =>
    onChange({
      intervals,
      siteIntervals: {
        ...siteIntervals,
        [String(siteId)]: { ...effectiveFor(siteId), ...patch },
      },
    });

  const clearOverride = (siteId: number) => {
    const next = { ...siteIntervals };
    delete next[String(siteId)];
    onChange({ intervals, siteIntervals: next });
  };

  /**
   * What this cadence costs upstream.
   *
   * Counted over the sites the dashboard actually asks for, not the whole
   * account list: an unbound site in the account costs nothing. Two calls per
   * pair per tick, plus one metadata call per site per day.
   */
  const cost = useMemo(() => {
    let callsPerMin = 0;
    for (const siteId of activeSiteIds) {
      const iv = effectiveFor(siteId);
      callsPerMin += 120 / iv.powerSec + 120 / iv.energySec;
    }

    const perDay = callsPerMin * 60 * 24 + activeSiteIds.length;
    return {
      callsPerMin,
      perDay,
      perMonth: perDay * 30,
      overMinute: !!limits && callsPerMin > limits.maxCallsPerMin,
      overMonth: !!limits && perDay * 30 > limits.monthlyCallBudget,
      daysOfBudget: limits && perDay > 0 ? limits.monthlyCallBudget / perDay : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSiteIds, intervals, siteIntervals, limits]);

  return (
    <div className="p-3 rounded-2xl bg-slate-900/50 border border-sky-500/20 space-y-3">
      <label className="text-slate-300 font-semibold flex items-center gap-1.5 flex-wrap">
        <Clock className="w-3.5 h-3.5 text-sky-400" />
        <span>ความถี่การดึงข้อมูล (Refresh Interval)</span>
        <span className="text-[10px] font-mono text-slate-500">
          ขั้นต่ำ {limits?.minRefreshIntervalSec ?? MIN_REFRESH_INTERVAL_SEC} วินาที
        </span>
      </label>

      {/* --- global default ------------------------------------------------ */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="text-[11px] font-semibold text-slate-200">
                กำลังผลิต Real-time + พลังงานวันนี้
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              <span className="font-mono">/power</span> +{' '}
              <span className="font-mono">/energy</span> — 2 ครั้ง/ไซต์ ต่อรอบ
            </p>
          </div>
          <SecondsInput
            value={intervals.powerSec}
            fallback={intervals.powerSec}
            onCommit={(sec) => setGlobal({ powerSec: sec })}
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={`p-${preset.sec}`}
              type="button"
              onClick={() => setGlobal({ powerSec: preset.sec })}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-colors cursor-pointer ${
                intervals.powerSec === preset.sec
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex items-start justify-between gap-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Sigma className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="text-[11px] font-semibold text-slate-200">
                พลังงานสะสม (เดือน / ปี / รวม) + CO₂
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
              <span className="font-mono">/energy?MONTH</span> +{' '}
              <span className="font-mono">/environmental-benefits</span> — 2 ครั้ง/ไซต์ ต่อรอบ
            </p>
          </div>
          <SecondsInput
            value={intervals.energySec}
            fallback={intervals.energySec}
            onCommit={(sec) => setGlobal({ energySec: sec })}
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={`e-${preset.sec}`}
              type="button"
              onClick={() => setGlobal({ energySec: preset.sec })}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-colors cursor-pointer ${
                intervals.energySec === preset.sec
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* --- per-site overrides -------------------------------------------- */}
      {activeSiteIds.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-sky-400" />
            <span>ตั้งค่าแยกรายไซต์ (ไม่ตั้ง = ใช้ค่าด้านบน)</span>
          </div>

          {activeSiteIds.map((siteId) => {
            const key = String(siteId);
            const hasOverride = !!siteIntervals[key];
            const iv = effectiveFor(siteId);

            return (
              <div
                key={siteId}
                className={`flex items-center justify-between gap-2 p-2 rounded-xl border text-[11px] ${
                  hasOverride
                    ? 'bg-sky-950/30 border-sky-500/30'
                    : 'bg-slate-950/40 border-slate-800'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-200">{nameFor(siteId)}</div>
                  <div className="text-[9px] text-slate-500 font-mono">
                    #{siteId} · {humaniseSec(iv.powerSec)} / {humaniseSec(iv.energySec)}
                    {!hasOverride && ' (ค่าเริ่มต้น)'}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <SecondsInput
                    value={iv.powerSec}
                    fallback={intervals.powerSec}
                    onCommit={(sec) => setOverride(siteId, { powerSec: sec })}
                  />
                  <SecondsInput
                    value={iv.energySec}
                    fallback={intervals.energySec}
                    onCommit={(sec) => setOverride(siteId, { energySec: sec })}
                  />
                  <button
                    type="button"
                    onClick={() => clearOverride(siteId)}
                    disabled={!hasOverride}
                    title="กลับไปใช้ค่าเริ่มต้น"
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-sky-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- what it costs ------------------------------------------------- */}
      <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5">
        <div className="text-[10px] text-slate-400 font-semibold">
          ประมาณการเรียก SolarEdge API ({activeSiteIds.length} ไซต์ ขณะเปิดหน้าจอ)
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <span className="text-[9px] text-slate-500 block">ต่อนาที</span>
            <span
              className={`text-xs font-bold font-mono ${
                cost.overMinute ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {cost.callsPerMin.toFixed(1)}
            </span>
            {limits && (
              <span className="text-[9px] text-slate-600 block font-mono">
                / {limits.maxCallsPerMin}
              </span>
            )}
          </div>
          <div>
            <span className="text-[9px] text-slate-500 block">ต่อวัน</span>
            <span className="text-xs font-bold font-mono text-sky-300">
              {Math.round(cost.perDay).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-[9px] text-slate-500 block">ต่อเดือน</span>
            <span
              className={`text-xs font-bold font-mono ${
                cost.overMonth ? 'text-rose-300' : 'text-indigo-300'
              }`}
            >
              {Math.round(cost.perMonth).toLocaleString()}
            </span>
            {limits && (
              <span className="text-[9px] text-slate-600 block font-mono">
                / {limits.monthlyCallBudget.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {!limits && (
          <p className="text-[10px] text-slate-500 leading-snug">
            ยังไม่ทราบเพดานของ backend — กด &quot;ตรวจสอบสถานะ&quot; ด้านบน เพื่อดึงค่าจริงมาเทียบ
          </p>
        )}

        {cost.overMinute && limits && (
          <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-600/40 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              เกินเพดาน {limits.maxCallsPerMin} ครั้ง/นาที — backend จะ<strong>หยุดรอ</strong>
              จนถึงรอบนาทีถัดไป ทำให้ค่าบนจออัปเดตช้ากว่าที่ตั้งไว้ ตั้งช้าลง หรือขยาย{' '}
              <span className="font-mono">SOLAREDGE_MAX_CALLS_PER_MIN</span>{' '}
              เท่าที่แพ็กเกจอนุญาตจริง
            </span>
          </div>
        )}

        {cost.overMonth && limits && (
          <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-600/40 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              เกินงบ {limits.monthlyCallBudget.toLocaleString()} ครั้ง/เดือน
              {cost.daysOfBudget !== null && (
                <> — จะหมดในราว {cost.daysOfBudget.toFixed(1)} วัน</>
              )}{' '}
              หลังจากนั้น backend จะเสิร์ฟข้อมูลจากแคชแทนการดึงใหม่
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
