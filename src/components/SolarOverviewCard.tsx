/**
 * Top-Left Overview Card: ภาพรวมการผลิตไฟฟ้า
 * Glassmorphic transparent design
 */

import React from 'react';
import { Zap, Calendar, Database, Leaf } from 'lucide-react';
import { SolarEdgeSiteOverview } from '../types';

interface SolarOverviewCardProps {
  overview: SolarEdgeSiteOverview;
  isLiveUpdating?: boolean;
}

export const SolarOverviewCard: React.FC<SolarOverviewCardProps> = ({ overview, isLiveUpdating }) => {
  return (
    <div
      id="card-solar-overview"
      className="glass-panel p-3.5 rounded-3xl w-full max-w-[310px] shadow-2xl transition-all duration-300 border border-sky-500/20 backdrop-blur-md"
    >
      {/* Title */}
      <div className="flex items-center justify-between mb-2.5 border-b border-sky-500/15 pb-1.5">
        <h2 className="text-xs font-bold tracking-wide text-white flex items-center gap-1.5">
          <span>ภาพรวมการผลิตไฟฟ้า</span>
        </h2>
        {isLiveUpdating && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            LIVE
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* Current Power (กำลังผลิตปัจจุบัน) */}
        <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-inner">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-slate-300 font-medium">กำลังผลิตปัจจุบัน</span>
          </div>
          <div className="text-right">
            <span className="text-sm sm:text-base font-bold font-mono text-emerald-300 tracking-tight">
              {overview.currentPowerKw.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 font-mono">kW</span>
          </div>
        </div>

        {/* Energy Today (พลังงานที่ผลิตวันนี้) */}
        <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-sky-500/20 hover:border-sky-500/40 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shadow-inner">
              <Calendar className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-slate-300 font-medium">พลังงานที่ผลิตวันนี้</span>
          </div>
          <div className="text-right">
            <span className="text-sm sm:text-base font-bold font-mono text-sky-200 tracking-tight">
              {overview.todayEnergyKwh.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 font-mono">kWh</span>
          </div>
        </div>

        {/* Lifetime Energy (พลังงานที่ผลิตทั้งหมด) */}
        <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-amber-500/20 hover:border-amber-500/40 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shadow-inner">
              <Database className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-slate-300 font-medium">พลังงานรวมทั้งหมด</span>
          </div>
          <div className="text-right">
            <span className="text-sm sm:text-base font-bold font-mono text-amber-200 tracking-tight">
              {Math.round(overview.lifetimeEnergyKwh).toLocaleString('en-US')}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 font-mono">kWh</span>
          </div>
        </div>

        {/* CO2 Reduction (ลดการปล่อย CO2) */}
        <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-900/40 border border-teal-500/20 hover:border-teal-500/40 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center shadow-inner">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs text-slate-300 font-medium">ลดการปล่อย CO₂</span>
          </div>
          <div className="text-right">
            <span className="text-sm sm:text-base font-bold font-mono text-teal-200 tracking-tight">
              {overview.co2ReducedTons.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-[10px] text-slate-400 ml-1 font-mono">ตัน</span>
          </div>
        </div>
      </div>
    </div>
  );
};
