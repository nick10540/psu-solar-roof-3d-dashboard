/**
 * RegionalTotalsPanel.tsx
 * Combined production across every mapped site, shown over the map.
 *
 *   1. กำลังติดตั้งรวม            (kWp)      - hero figure
 *   2. พลังงานวันนี้ | พลังงานรวม                (kWh)
 *   3. ลดการปล่อย CO₂ | ปลูกต้นไม้เทียบเท่า        (tonCO₂ / ต้น)
 *
 * Labels are Thai, matching the pin cards on the map. Units are fixed
 * dashboard-wide: energy is always kWh and CO2 is always tonCO₂, never
 * switched by magnitude.
 *
 * Shape: a landscape box - hero cell on the left, the four secondary figures in
 * a 2x2 beside it. It was a tall portrait panel in the top-right corner; on the
 * ceremony screen that put the numbers in a column nobody's eye travels, so it
 * is now a wide band (see the placement note in Solar3DViewer).
 *
 * Text is sized off the featured (หาดใหญ่) pin card via
 * `featuredCardFontSizePx`, so the totals read at the same size as the biggest
 * card on the map rather than at the smaller size a corner panel could get away
 * with. Inline `font-size` because those are runtime values - Tailwind only
 * emits arbitrary-value classes it can see as literal strings in source.
 *
 * Notes for anyone editing this:
 *
 *  - Every figure is a `MetricValue`, i.e. `number | null`. `null` renders as
 *    "no data", never as 0 - zero is a real reading at night and must stay
 *    distinguishable from "not connected".
 *  - CO2 comes from SolarEdge's own environmental-benefits reading, and Tree
 *    is derived from that CO2 (not from kWh). The arithmetic therefore ties
 *    back to the portal rather than to the accumulated cell above it, which
 *    people on a 72" screen will check.
 *  - Uses `glass-panel-static` (no backdrop-filter): a large blurred panel over
 *    a live WebGL map re-rasterises every frame the map moves.
 */

import React from 'react';
import { Zap, Sun, BatteryCharging, Leaf, Trees, Database, WifiOff } from 'lucide-react';
import { RegionalTotals, MetricValue } from '../services/siteMetricsService';
import {
  co2TonsFromKg,
  treesFromCo2Kg,
} from '../utils/energyEquivalents';
import { featuredCardFontSizePx } from '../config/markerTypography';
import { NO_DATA } from './metricDisplay';
import { CountUp } from './CountUp';

/**
 * Sizes borrowed from the featured pin card, in px, resolved once at module
 * load. `hero` is the odd one out: it has no counterpart on a pin card, so it
 * keeps the 1.5x lead over the metric values it has always had.
 */
const FONT_PX = {
  title: featuredCardFontSizePx('title'),
  label: featuredCardFontSizePx('metricLabel'),
  value: featuredCardFontSizePx('metricValue'),
  unit: featuredCardFontSizePx('metricUnit'),
  status: featuredCardFontSizePx('statusText'),
  hero: featuredCardFontSizePx('metricValue') * 1.5,
} as const;

interface RegionalTotalsPanelProps {
  totals: RegionalTotals;
}


interface MetricProps {
  icon: React.ReactNode;
  label: string;
  /** The raw number, so the cell can animate to it. `null` renders as no-data. */
  value: MetricValue;
  decimals?: number;
  unit: string;
  tone: string;
  hasData: boolean;
}

const Metric: React.FC<MetricProps> = ({
  icon,
  label,
  value,
  decimals = 0,
  unit,
  tone,
  hasData,
}) => (
  <div className="bg-slate-900/70 rounded-xl border border-sky-500/15 px-3 py-2">
    <div
      className="flex items-center gap-1.5 text-slate-400 leading-none mb-1.5"
      style={{ fontSize: FONT_PX.label }}
    >
      <span className={hasData ? tone : 'text-slate-600'}>{icon}</span>
      <span className="font-medium truncate">{label}</span>
    </div>
    <div className="flex items-baseline gap-1 font-mono">
      <span
        className={`font-bold leading-none ${hasData ? tone : 'text-slate-600'}`}
        style={{ fontSize: FONT_PX.value }}
      >
        {value === null ? (
          NO_DATA
        ) : (
          <CountUp target={value} decimals={decimals} placeholder={NO_DATA} />
        )}
      </span>
      {hasData && (
        <span className="text-slate-400 font-normal" style={{ fontSize: FONT_PX.unit }}>
          {unit}
        </span>
      )}
    </div>
  </div>
);

const RegionalTotalsPanelImpl: React.FC<RegionalTotalsPanelProps> = ({ totals }) => {
  const { hasData, mode, siteCount, sitesWithData } = totals;

  // kWp, not MWp: the per-site cards print kWp, and a headline in a
  // different unit invites the two to be read as the same scale.
  const capacityKwp: MetricValue = totals.totalCapacityKwp;
  const accumulated = totals.lifetimeEnergyKwh;

  // CO2 and trees now come from SolarEdge's own CO2 figure rather than from
  // lifetime kWh x 0.56. The old derivation disagreed with the portal on
  // both counts, and trees by roughly 7x.
  const co2Tons: MetricValue = totals.co2Kg === null ? null : co2TonsFromKg(totals.co2Kg);
  const trees: MetricValue = totals.co2Kg === null ? null : treesFromCo2Kg(totals.co2Kg);

  const isLive = mode === 'live';
  /** Some pins reporting, some not - say so rather than implying a full picture. */
  const partial = hasData && sitesWithData < siteCount;

  return (
    <div className="glass-panel-static rounded-2xl border border-sky-500/30 shadow-2xl px-4 py-3 w-[620px]">
      {/* Header: name the data source, so nobody has to guess what they are looking at */}
      <div className="flex items-center justify-between gap-3 pb-2 mb-2.5 border-b border-slate-700/60">
        <span
          className="font-bold text-amber-300 tracking-wide"
          style={{ fontSize: FONT_PX.title }}
        >
          ผลผลิตรวม {siteCount} วิทยาเขต
        </span>
        <span
          className={`font-mono px-2 py-0.5 rounded border font-bold flex items-center gap-1 shrink-0 ${
            isLive
              ? 'text-emerald-300 bg-emerald-950/80 border-emerald-600/40'
              : 'text-amber-300 bg-amber-950/70 border-amber-600/40'
          }`}
          style={{ fontSize: FONT_PX.status }}
        >
          {isLive ? <Database className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          {isLive ? 'LIVE API' : 'MOCK'}
        </span>
      </div>

      {/* Not connected yet: state it plainly instead of showing zeros */}
      {!hasData && (
        <div className="flex items-start gap-2 bg-slate-900/70 rounded-xl border border-slate-700/60 px-3 py-2 mb-2">
          <WifiOff className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
          <div className="text-slate-400 leading-snug" style={{ fontSize: FONT_PX.status }}>
            <div className="font-bold text-slate-300 mb-0.5">ยังไม่มีข้อมูลจาก SolarEdge</div>
            เลือกไซต์จาก API มาผูกกับหมุดก่อน จึงจะแสดงค่าจริง
          </div>
        </div>
      )}

      {partial && (
        <div
          className="text-amber-300/90 bg-amber-950/40 border border-amber-700/30 rounded-lg px-2.5 py-1 mb-2"
          style={{ fontSize: FONT_PX.status }}
        >
          แสดงเฉพาะ {sitesWithData} ไซต์ที่ผูก API แล้ว
        </div>
      )}

      {/* Body: hero on the left, the four secondary figures 2x2 to its right. */}
      <div className="flex items-stretch gap-2">
        {/* Hero: total installed capacity */}
        <div className="bg-gradient-to-b from-sky-950/80 to-slate-900/70 rounded-xl border border-sky-500/25 px-3 py-2 w-[214px] shrink-0 flex flex-col justify-center">
          <div
            className="flex items-center gap-1.5 text-slate-400 leading-none mb-2"
            style={{ fontSize: FONT_PX.label }}
          >
            <Zap className={`w-4 h-4 ${hasData ? 'text-sky-400' : 'text-slate-600'}`} />
            <span className="font-medium">กำลังติดตั้งรวม</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span
              className={`font-bold leading-none ${hasData ? 'text-sky-300' : 'text-slate-600'}`}
              style={{ fontSize: FONT_PX.hero }}
            >
              {capacityKwp === null ? (
                NO_DATA
              ) : (
                <CountUp
                  target={capacityKwp}
                  decimals={0}
                  duration={1100}
                />
              )}
            </span>
            {capacityKwp !== null && (
              <span
                className="text-sky-400/80 font-normal"
                style={{ fontSize: FONT_PX.unit }}
              >
                kWp
              </span>
            )}
          </div>
        </div>

        {/* Production, then the environmental equivalents derived from it */}
        <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
          <Metric
            icon={<Sun className="w-4 h-4" />}
            label="พลังงานวันนี้"
            value={totals.todayEnergyKwh}
            decimals={1}
            unit="kWh"
            tone="text-amber-300"
            hasData={totals.todayEnergyKwh !== null}
          />
          <Metric
            icon={<BatteryCharging className="w-4 h-4" />}
            label="พลังงานรวม"
            value={accumulated}
            unit="kWh"
            tone="text-emerald-300"
            hasData={accumulated !== null}
          />
          <Metric
            icon={<Leaf className="w-4 h-4" />}
            label="ลดการปล่อย CO₂"
            value={co2Tons}
            decimals={1}
            unit="tonCO₂"
            tone="text-teal-300"
            hasData={co2Tons !== null}
          />
          <Metric
            icon={<Trees className="w-4 h-4" />}
            label="ปลูกต้นไม้เทียบเท่า"
            value={trees}
            unit="ต้น"
            tone="text-lime-300"
            hasData={trees !== null}
          />
        </div>
      </div>
    </div>
  );
};

/** Memoised: re-renders only when the totals actually change, not on camera moves. */
export const RegionalTotalsPanel = React.memo(RegionalTotalsPanelImpl);
RegionalTotalsPanel.displayName = 'RegionalTotalsPanel';
