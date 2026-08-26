/**
 * BuildingListSidebar.tsx
 * 5 Regional Sites Sidebar for MEA Solar Roof Smart Dashboard
 * Features:
 * - List of 5 Regional Solar Sites with Live Telemetry
 * - Current Power (kW), Total Energy (kWh), Installed Capacity (kWp)
 * - Click to navigate to Site Subpage (หน้าย่อย)
 */

import React, { useState, useMemo } from 'react';
import { BuildingInfo, BuildingSiteBinding, SolarEdgeTransformedOverview } from '../types';
import { 
  Search, 
  Zap, 
  Building2, 
  CheckCircle2, 
  ChevronRight, 
  X, 
  Link2, 
  MapPin, 
  Plus, 
  Trash2, 
  RotateCcw,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';

interface BuildingListSidebarProps {
  buildings: BuildingInfo[];
  selectedBuildingId: number | null;
  bindings?: Record<number, BuildingSiteBinding>;
  overviews?: Record<number, SolarEdgeTransformedOverview>;
  onSelectBuilding: (building: BuildingInfo | null) => void;
  onOpenBindingModal?: (building: BuildingInfo) => void;
  onOpenAddModal?: () => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  onResetToDefaults?: () => void;
  isMobileView?: boolean;
}

export const BuildingListSidebar: React.FC<BuildingListSidebarProps> = ({
  buildings,
  selectedBuildingId,
  bindings = {},
  overviews = {},
  onSelectBuilding,
  onOpenBindingModal,
  onOpenAddModal,
  onOpenDeleteDialog,
  onResetToDefaults,
  isMobileView = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const filteredBuildings = useMemo(() => {
    return buildings.filter((bld) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        bld.id.toString().includes(term) ||
        bld.name.toLowerCase().includes(term) ||
        bld.code.toLowerCase().includes(term) ||
        (bld.province && bld.province.toLowerCase().includes(term))
      );
    });
  }, [buildings, searchTerm]);

  if (isCollapsed && !isMobileView) {
    return (
      <button
        id="btn-expand-building-sidebar"
        onClick={() => setIsCollapsed(false)}
        className="glass-panel px-3 py-2 rounded-2xl text-xs text-sky-300 hover:text-white flex items-center gap-2 shadow-2xl border border-sky-500/30 transition-all cursor-pointer backdrop-blur-md"
      >
        <Building2 className="w-4 h-4 text-sky-400" />
        <span className="font-bold">5 ไซต์ MEA Solar Roof</span>
        <span className="bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded-full text-[10px] font-mono">
          {buildings.length}
        </span>
      </button>
    );
  }

  return (
    <div
      id="sidebar-building-list"
      className={`glass-panel p-3.5 rounded-3xl flex flex-col gap-2.5 shadow-2xl border border-sky-500/20 text-slate-100 backdrop-blur-md ${
        isMobileView ? 'w-full max-h-none' : 'w-72 lg:w-84 max-h-[calc(100vh-195px)]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sky-500/15 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-amber-500/30 to-sky-600/30 text-amber-300 flex items-center justify-center border border-amber-400/40">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white leading-none">5 ไซต์ MEA Solar Roof</h3>
            <span className="text-[10px] text-slate-400 font-mono">
              กำลังติดตั้งรวม {buildings.reduce((sum, b) => sum + b.capacityKwp, 0).toLocaleString()} kWp
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onOpenAddModal && (
            <button
              id="btn-sidebar-add-building"
              onClick={onOpenAddModal}
              title="เพิ่มหมุดไซต์ใหม่"
              className="p-1 px-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/30 flex items-center gap-1 text-[11px] font-bold transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มไซต์</span>
            </button>
          )}

          {!isMobileView && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
              title="ย่อแถบข้าง"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          id="input-search-building"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="ค้นหาชื่อไซต์, จังหวัด..."
          className="w-full bg-slate-900/60 border border-sky-500/20 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400/60 transition-colors"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Scrollable Sites List */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 max-h-[360px] custom-scrollbar">
        {filteredBuildings.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">
            ไม่พบไซต์ที่ตรงกับการค้นหา
          </div>
        ) : (
          filteredBuildings.map((site) => {
            const isSelected = selectedBuildingId === site.id;
            const binding = bindings[site.id];
            const overview = binding?.siteId ? overviews[binding.siteId] : null;

            const currentPowerKw = overview ? overview.currentPowerKw : site.currentPowerKw;
            const lifetimeEnergyKwh = overview ? overview.lifetimeEnergyKwh : site.lifetimeEnergyKwh;
            const lifetimeFormatted = lifetimeEnergyKwh >= 10000 
              ? `${(lifetimeEnergyKwh / 1000).toFixed(1)} MWh` 
              : `${Math.round(lifetimeEnergyKwh).toLocaleString()} kWh`;

            return (
              <div
                key={site.id}
                id={`sidebar-building-item-${site.id}`}
                onClick={() => onSelectBuilding(site)}
                className={`p-2.5 rounded-2xl cursor-pointer transition-all border text-left flex flex-col gap-1.5 group ${
                  isSelected
                    ? 'bg-amber-950/40 border-amber-400/90 shadow-[0_0_14px_rgba(245,158,11,0.3)]'
                    : 'bg-slate-900/60 hover:bg-slate-800/80 border-sky-500/20 hover:border-sky-400/40'
                }`}
              >
                {/* Row 1: Site Number, Name, and Capacity */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 shrink-0 rounded-lg bg-gradient-to-tr from-sky-600 to-blue-500 text-white flex items-center justify-center text-xs font-mono font-bold shadow">
                      {site.id}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs font-bold text-white truncate leading-tight group-hover:text-amber-300 transition-colors">
                          {site.name}
                        </h4>
                        <span className="text-[9px] bg-sky-950/80 text-sky-300 px-1 rounded font-mono border border-sky-600/30 shrink-0">
                          {site.code}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">จังหวัด{site.province || site.name}</span>
                    </div>
                  </div>

                  {/* Drill-down link */}
                  <span className="text-[10px] text-amber-300 font-semibold flex items-center gap-0.5 shrink-0 group-hover:translate-x-0.5 transition-transform">
                    <span>ดูหน้าย่อย</span>
                    <ChevronRight className="w-3 h-3" />
                  </span>
                </div>

                {/* Row 2: 3 Metrics: กำลังผลิตปัจจุบัน (kW), พลังงานรวม (kWh), กำลังติดตั้ง (kWp) */}
                <div className="grid grid-cols-3 gap-1 text-center bg-slate-950/70 p-1.5 rounded-xl border border-slate-800/80">
                  <div>
                    <div className="text-[8px] text-slate-400">กำลังผลิต</div>
                    <div className="font-bold font-mono text-[11px] text-amber-300 flex items-center justify-center gap-0.5">
                      <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                      <span>{currentPowerKw.toFixed(1)}</span>
                    </div>
                    <div className="text-[8px] text-slate-500 font-mono">kW</div>
                  </div>

                  <div>
                    <div className="text-[8px] text-slate-400">พลังงานรวม</div>
                    <div className="font-bold font-mono text-[11px] text-emerald-300">
                      {lifetimeFormatted}
                    </div>
                    <div className="text-[8px] text-slate-500 font-mono">สะสม</div>
                  </div>

                  <div>
                    <div className="text-[8px] text-slate-400">กำลังติดตั้ง</div>
                    <div className="font-bold font-mono text-[11px] text-sky-300">
                      {site.capacityKwp.toFixed(0)}
                    </div>
                    <div className="text-[8px] text-slate-500 font-mono">kWp</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-sky-500/15 flex items-center justify-between text-[11px] text-slate-400">
        <span>ครบทั้ง <strong>5 ไซต์</strong> ภูมิภาค</span>
        
        {onResetToDefaults && (
          <button
            type="button"
            onClick={onResetToDefaults}
            title="คืนค่าเริ่มต้น 5 ไซต์ MEA"
            className="text-[10px] text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>คืนค่า 5 ไซต์</span>
          </button>
        )}
      </div>
    </div>
  );
};
