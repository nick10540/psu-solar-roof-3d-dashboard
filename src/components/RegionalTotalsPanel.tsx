/**
 * RegionalTotalsPanel.tsx
 * Combined production across every mapped site, shown bottom-right of the map.
 *
 *   1. กำลังติดตั้งรวม            (MWp)      - hero figure
 *   2. Production Today | Production Accumulated   (kWh)
 *   3. Reduce CO2       | Tree                     (ton Carbon eq / trees)
 *
 * Notes for anyone editing this:
 *
 *  - Every figure is a `MetricValue`, i.e. `number | null`. `null` renders as
 *    "no data", never as 0 - zero is a real reading at night and must stay
 *    distinguishable from "not connected".
 *  - CO2 and Tree are DERIVED from the accumulated figure displayed directly
 *    above them. On a 72" screen people check the arithmetic.
 *  - Uses `glass-panel-static` (no backdrop-filter): a large blurred panel over
 *    a live WebGL map re-rasterises every frame the map moves.
 */

import React from 'react';
import { Zap, Sun, BatteryCharging, Leaf, Trees, Database, WifiOff } from 'lucide-react';
import { RegionalTotals, MetricValue } from '../services/siteMetricsService';
import {
  co2TonsFromKwh,
  treesFromKwh,
  formatNumber,
} from '../utils/energyEquivalents';
import { NO_DATA } from './metricDisplay';

interface RegionalTotalsPanelProps {
  totals: RegionalTotals;
}

/** Format a metric, or the em-dash placeholder when there is nothing to show. */
function fmt(value: MetricValue, decimals = 0): string {
  return value === null ? NO_DATA : formatNumber(value, decimals);
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  tone: string;
  hasData: boolean;
}

const Metric: React.FC<MetricProps> = ({ icon, label, value, unit, tone, hasData }) => (
  <div className="bg-slate-900/70 rounded-xl border border-sky-500/15 px-2.5 py-2">
    <div className="flex items-center gap-1 text-[10px] text-slate-400 leading-none mb-1.5">
      <span className={hasData ? tone : 'text-slate-600'}>{icon}</span>
      <span className="font-medium truncate">{label}</span>
    </div>
    <div className="flex items-baseline gap-1 font-mono">
      <span className={`text-lg font-bold leading-none ${hasData ? tone : 'text-slate-600'}`}>
        {value}
      </span>
      {hasData && <span className="text-[9px] text-slate-400 font-normal">{unit}</span>}
    </div>
  </div>
);

const RegionalTotalsPanelImpl: React.FC<RegionalTotalsPanelProps> = ({ totals }) => {
  const { hasData, mode, siteCount, sitesWithData } = totals;

  const capacityMwp: MetricValue =
    totals.totalCapacityKwp === null ? null : totals.totalCapacityKwp / 1000;
  const accumulated = totals.lifetimeEnergyKwh;
  const co2Tons: MetricValue = accumulated === null ? null : co2TonsFromKwh(accumulated);
  const trees: MetricValue = accumulated === null ? null : treesFromKwh(accumulated);

  const isLive = mode === 'live';
  /** Some pins reporting, some not - say so rather than implying a full picture. */
  const partial = hasData && sitesWithData < siteCount;

  return (
    <div className="glass-panel-static rounded-2xl border border-sky-500/30 shadow-2xl px-3 py-2.5 w-[268px]">
      {/* Header: name the data source, so nobody has to guess what they are looking at */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-700/60">
        <span className="text-[11px] font-bold text-amber-300 tracking-wide">
          ผลผลิตรวม {siteCount} วิทยาเขต
        </span>
        <span
          className={`text-[8.5px] font-mono px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 ${
            isLive
              ? 'text-emerald-300 bg-emerald-950/80 border-emerald-600/40'
              : 'text-amber-300 bg-amber-950/70 border-amber-600/40'
          }`}
        >
          {isLive ? <Database className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
          {isLive ? 'LIVE API' : 'MOCK'}
        </span>
      </div>

      {/* Not connected yet: state it plainly instead of showing zeros */}
      {!hasData && (
        <div className="flex items-start gap-2 bg-slate-900/70 rounded-xl border border-slate-700/60 px-2.5 py-2 mb-1.5">
          <WifiOff className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
          <div className="text-[10px] text-slate-400 leading-snug">
            <div className="font-bold text-slate-300 mb-0.5">ยังไม่มีข้อมูลจาก SolarEdge</div>
            เลือกไซต์จาก API มาผูกกับหมุดก่อน จึงจะแสดงค่าจริง
          </div>
        </div>
      )}

      {partial && (
        <div className="text-[9.5px] text-amber-300/90 bg-amber-950/40 border border-amber-700/30 rounded-lg px-2 py-1 mb-1.5">
          แสดงเฉพาะ {sitesWithData} ไซต์ที่ผูก API แล้ว
        </div>
      )}

      {/* Row 1 - hero: total installed capacity */}
      <div className="bg-gradient-to-r from-sky-950/80 to-slate-900/70 rounded-xl border border-sky-500/25 px-3 py-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 leading-none mb-1.5">
          <Zap className={`w-3 h-3 ${hasData ? 'text-sky-400' : 'text-slate-600'}`} />
          <span className="font-medium">กำลังติดตั้งรวม</span>
        </div>
        <div className="flex items-baseline gap-1.5 font-mono">
          <span
            className={`text-3xl font-bold leading-none ${
              hasData ? 'text-sky-300' : 'text-slate-600'
            }`}
          >
            {fmt(capacityMwp, capacityMwp !== null && capacityMwp >= 100 ? 0 : 2)}
          </span>
          {capacityMwp !== null && (
            <span className="text-xs text-sky-400/80 font-normal">MWp</span>
          )}
        </div>
      </div>

      {/* Row 2 - production */}
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        <Metric
          icon={<Sun className="w-3 h-3" />}
          label="Production Today"
          value={fmt(totals.todayEnergyKwh, 1)}
          unit="kWh"
          tone="text-amber-300"
          hasData={totals.todayEnergyKwh !== null}
        />
        <Metric
          icon={<BatteryCharging className="w-3 h-3" />}
          label="Production Accum."
          value={fmt(accumulated, 0)}
          unit="kWh"
          tone="text-emerald-300"
          hasData={accumulated !== null}
        />
      </div>

      {/* Row 3 - environmental equivalents, derived from the row above */}
      <div className="grid grid-cols-2 gap-1.5">
        <Metric
          icon={<Leaf className="w-3 h-3" />}
          label="Reduce CO2"
          value={fmt(co2Tons, 1)}
          unit="ton Carbon eq"
          tone="text-teal-300"
          hasData={co2Tons !== null}
        />
        <Metric
          icon={<Trees className="w-3 h-3" />}
          label="Tree"
          value={fmt(trees, 0)}
          unit="trees"
          tone="text-lime-300"
          hasData={trees !== null}
        />
      </div>
    </div>
  );
};

/** Memoised: re-renders only when the totals actually change, not on camera moves. */
export const RegionalTotalsPanel = React.memo(RegionalTotalsPanelImpl);
RegionalTotalsPanel.displayName = 'RegionalTotalsPanel';
