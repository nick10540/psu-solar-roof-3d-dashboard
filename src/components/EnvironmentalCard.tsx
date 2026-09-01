/**
 * Bottom-Right Card: ประโยชน์ต่อสิ่งแวดล้อม (Environmental Benefits)
 * Transparent Glassmorphic Design
 */

import React from 'react';
import { Trees, Fuel, Factory } from 'lucide-react';
import { SolarEdgeSiteOverview } from '../types';

interface EnvironmentalCardProps {
  overview: SolarEdgeSiteOverview;
}

export const EnvironmentalCard: React.FC<EnvironmentalCardProps> = ({ overview }) => {
  return (
    <div
      id="card-environmental-benefits"
      className="glass-panel p-3 rounded-3xl w-full max-w-[290px] shadow-2xl transition-all duration-300 border border-sky-500/20 backdrop-blur-md"
    >
      {/* Title */}
      <h2 className="text-xs font-bold text-white mb-2 pb-1 border-b border-sky-500/15">
        ประโยชน์ต่อสิ่งแวดล้อม
      </h2>

      <div className="space-y-1.5">
        {/* Trees Planted Equivalent */}
        <div className="flex items-center justify-between p-1.5 rounded-2xl bg-slate-900/40 border border-emerald-500/15 hover:border-emerald-500/30 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-600/30 text-emerald-300 flex items-center justify-center shadow">
              <Trees className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] text-slate-200 font-medium">ปลูกต้นไม้เทียบเท่า</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold font-mono text-emerald-300">
              {overview.treesPlanted.toLocaleString()}
            </span>
            <span className="text-[9px] text-slate-400 ml-1 font-mono">ต้น</span>
          </div>
        </div>

        {/* Oil Saved */}
        <div className="flex items-center justify-between p-1.5 rounded-2xl bg-slate-900/40 border border-sky-500/15 hover:border-sky-500/30 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-sky-600/30 text-sky-300 flex items-center justify-center shadow">
              <Fuel className="w-3 h-3" />
            </div>
            <span className="text-[11px] text-slate-200 font-medium">ลดการใช้น้ำมัน</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold font-mono text-sky-200">
              {overview.oilSavedLiters.toLocaleString()}
            </span>
            <span className="text-[9px] text-slate-400 ml-1 font-mono">ลิตร</span>
          </div>
        </div>

        {/* CO2 Emissions Avoided */}
        <div className="flex items-center justify-between p-1.5 rounded-2xl bg-slate-900/40 border border-teal-500/15 hover:border-teal-500/30 transition-colors">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-teal-600/30 text-teal-300 flex items-center justify-center shadow">
              <Factory className="w-3 h-3" />
            </div>
            <span className="text-[11px] text-slate-200 font-medium">ลดการปล่อย CO₂</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold font-mono text-teal-200">
              {overview.co2ReducedTons.toLocaleString('en-US', { minimumFractionDigits: 1 })}
            </span>
            <span className="text-[9px] text-slate-400 ml-1 font-mono">tonCO₂</span>
          </div>
        </div>
      </div>
    </div>
  );
};
