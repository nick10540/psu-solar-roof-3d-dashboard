/**
 * metricDisplay.tsx
 * The shared vocabulary for putting a `MetricValue` on screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * `siteMetricsService` decides what a site is *allowed* to show. This file is
 * the other half: how a `null` looks, and how a figure states where it came
 * from. Both halves have to live in one place, because the bug they exist to
 * prevent is a component quietly inventing its own answer:
 *
 *     const power = overview ? overview.currentPowerKw : site.currentPowerKw;
 *
 * Every surface that prints a site figure imports from here rather than
 * defining its own em-dash and its own caption wording. A second copy is
 * exactly how the map and the site sub-page drifted apart in the first place.
 */

import React from 'react';
import { MetricValue, ResolvedSiteMetrics } from '../services/siteMetricsService';

/** Rendered wherever a metric is `null`. Never 0 - 0 kW is a real night-time reading. */
export const NO_DATA = '—';

/**
 * A metric, or the placeholder when there is nothing to show.
 *
 * `decimals` omitted uses `toLocaleString` (thousands separators, natural
 * precision); passing a number uses `toFixed` for a stable column width.
 */
export function fmt(value: MetricValue, decimals?: number): string {
  if (value === null) return NO_DATA;
  return decimals === undefined ? value.toLocaleString() : value.toFixed(decimals);
}

/** The two different ways a site can have nothing to show. */
export function noDataHeadline(metrics: ResolvedSiteMetrics): string {
  return metrics.isBound ? 'ไม่มีข้อมูลจาก API' : 'ยังไม่ได้ผูก API';
}

/** Dot colour for a source, shared by the captions and the status chips. */
export function sourceTone(metrics: ResolvedSiteMetrics): string {
  return metrics.source === 'live'
    ? 'bg-emerald-400'
    : metrics.source === 'mock'
      ? 'bg-amber-400'
      : 'bg-slate-600';
}

/**
 * The line under a headline figure saying where that figure came from.
 *
 * Every metric card carries one, so no number is left unattributed.
 * "SolarEdge Active Inverters" used to sit under the power reading whether or
 * not a SolarEdge site was connected at all.
 */
export const SourceCaption: React.FC<{
  metrics: ResolvedSiteMetrics;
  /** Used only when the figure really is a live reading. */
  liveLabel: string;
  className?: string;
}> = ({ metrics, liveLabel, className }) => {
  const text =
    metrics.source === 'live'
      ? liveLabel
      : metrics.source === 'mock'
        ? 'ข้อมูลจำลอง (Mock)'
        : noDataHeadline(metrics);

  return (
    <div className={`text-[10px] text-slate-400 mt-1 flex items-center gap-1 ${className ?? ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceTone(metrics)}`} />
      <span className="truncate">{text}</span>
    </div>
  );
};
