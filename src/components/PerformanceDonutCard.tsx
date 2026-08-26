/**
 * Bottom-Left Card: ประสิทธิภาพระบบ (System Performance Gauge & Metrics)
 * Transparent Glassmorphic Design
 */

import React from 'react';
import { SolarEdgeSiteOverview } from '../types';

interface PerformanceDonutCardProps {
  overview: SolarEdgeSiteOverview;
}

export const PerformanceDonutCard: React.FC<PerformanceDonutCardProps> = ({ overview }) => {
  const percentage = overview.performanceRatio;
  // Circular gauge math
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div
      id="card-system-performance"
      className="glass-panel p-3 rounded-3xl w-full max-w-[290px] shadow-2xl transition-all duration-300 border border-sky-500/20 backdrop-blur-md"
    >
      {/* Title */}
      <h2 className="text-xs font-bold text-white mb-2 pb-1 border-b border-sky-500/15">
        ประสิทธิภาพระบบ
      </h2>

      <div className="flex items-center justify-between gap-2.5">
        {/* Radial Circular Donut Gauge */}
        <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 88 88">
            {/* Background track */}
            <circle
              cx="44"
              cy="44"
              r={radius}
              fill="transparent"
              stroke="#0f172a"
              strokeWidth="6"
            />
            {/* Progress Bar (Emerald) */}
            <circle
              cx="44"
              cy="44"
              r={radius}
              fill="transparent"
              stroke="#10b981"
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out drop-shadow-[0_0_8px_rgba(16,185,129,0.7)]"
            />
          </svg>

          {/* Inner Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs sm:text-sm font-black font-mono text-white tracking-tight leading-none">
              {percentage.toFixed(1)}%
            </span>
            <span className="text-[8px] text-emerald-400 font-medium tracking-tight mt-0.5">
              PR Ratio
            </span>
          </div>
        </div>

        {/* Right Stats Metrics */}
        <div className="flex-1 space-y-1.5 text-right">
          <div>
            <p className="text-[9px] text-slate-400">แผงโซลาร์เซลล์</p>
            <p className="text-xs font-bold font-mono text-slate-100">
              {overview.totalPanels.toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">แผง</span>
            </p>
          </div>

          <div>
            <p className="text-[9px] text-slate-400">กำลังติดตั้งรวม</p>
            <p className="text-xs font-bold font-mono text-sky-300">
              {overview.totalCapacityKwp.toLocaleString('en-US', { minimumFractionDigits: 1 })} <span className="text-[9px] text-slate-400 font-normal">kWp</span>
            </p>
          </div>

          <div>
            <p className="text-[9px] text-slate-400">พื้นที่ติดตั้ง</p>
            <p className="text-xs font-bold font-mono text-emerald-300">
              {overview.totalAreaM2.toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">m²</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
