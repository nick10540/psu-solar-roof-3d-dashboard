/**
 * BuildingBindingModal.tsx
 * Maps a site pin to a SolarEdge Site ID. Persists in LocalStorage and the map
 * balloon updates from it.
 *
 * The "Primary Metric" chooser was removed: the balloon shows three fixed
 * values (current power / lifetime energy / installed capacity), so the choice
 * changed nothing. This modal now does one job - pick which SolarEdge site
 * feeds this pin.
 */

import React, { useState } from 'react';
import { 
  BuildingInfo, 
  SolarEdgeRawSite, 
  SolarEdgeTransformedOverview, 
  BindingDisplayMetric, 
  BuildingSiteBinding 
} from '../types';
import {
  X,
  Link2,
  Unlink,
  CheckCircle2,
  Clock,
  Sparkles,
  Building2
} from 'lucide-react';

interface BuildingBindingModalProps {
  building: BuildingInfo;
  availableSites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  currentBinding?: BuildingSiteBinding;
  onSaveBinding: (binding: BuildingSiteBinding) => void;
  onClose: () => void;
}

export const BuildingBindingModal: React.FC<BuildingBindingModalProps> = ({
  building,
  availableSites,
  overviews,
  currentBinding,
  onSaveBinding,
  onClose,
}) => {
  // Selected site ID (null for mock simulator)
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(
    currentBinding?.isBound ? currentBinding.siteId : null
  );

  /**
   * The map balloon shows three fixed values (power / lifetime energy /
   * installed capacity), so there is nothing for the operator to choose here
   * any more. `primaryMetric` is kept on the persisted binding purely so
   * existing saved records stay readable; it no longer affects rendering.
   */
  const primaryMetric: BindingDisplayMetric = currentBinding?.primaryMetric || 'currentPower';

  const activeSite = availableSites.find((s) => s.id === selectedSiteId) || null;
  const activeOverview = selectedSiteId ? overviews[selectedSiteId] : null;

  // Save handler
  const handleSave = () => {
    const isBound = selectedSiteId !== null;
    const newBinding: BuildingSiteBinding = {
      buildingId: building.id,
      siteId: selectedSiteId,
      siteName: activeSite?.name,
      primaryMetric,
      customCapacityKwp: activeSite?.peakPower || building.capacityKwp,
      isBound,
      boundAt: isBound ? new Date().toISOString() : undefined,
    };

    onSaveBinding(newBinding);
    onClose();
  };

  // Unbind / Revert to simulator handler
  const handleUnbind = () => {
    const unbindObj: BuildingSiteBinding = {
      buildingId: building.id,
      siteId: null,
      primaryMetric: 'currentPower',
      isBound: false,
    };
    onSaveBinding(unbindObj);
    onClose();
  };

  return (
    <div
      id="modal-building-binding-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="modal-building-binding-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-xl shadow-2xl border border-sky-400/40 text-slate-100 max-h-[90vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-sky-500/20 pb-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500 text-slate-950 flex items-center justify-center font-mono font-black text-lg shadow-[0_0_12px_rgba(56,189,248,0.6)] shrink-0">
              {building.id}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">{building.name}</h3>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-400/30 font-mono">
                  {building.code}
                </span>
              </div>
              <p className="text-xs text-slate-400">เชื่อมโยงข้อมูล SolarEdge Monitoring API เข้ากับอาคารนี้</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. SolarEdge Site Selection Dropdown & Options */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-sky-400" />
              <span>เลือก SolarEdge Site ID จากบัญชี (Account Sites)</span>
            </label>

            <select
              id="select-solaredge-site-id"
              value={selectedSiteId === null ? 'mock' : selectedSiteId}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedSiteId(val === 'mock' ? null : Number(val));
              }}
              className="w-full bg-slate-900/90 border border-sky-500/30 rounded-xl px-3 py-2.5 text-slate-100 font-sans focus:outline-none focus:border-sky-400 text-xs shadow-inner"
            >
              <option value="mock">🤖 โหมดจำลองข้อมูล (Simulated Mock Data / Unbound)</option>
              {availableSites.map((site) => (
                <option key={site.id} value={site.id}>
                  🟢 Site #{site.id} — {site.name} ({site.peakPower} kWp)
                </option>
              ))}
            </select>
          </div>

          {/* Active Site Real-time Data Preview Banner */}
          {activeOverview ? (
            <div className="p-3.5 rounded-2xl bg-sky-950/40 border border-sky-400/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-300 flex items-center gap-1.5 text-[11px]">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>ข้อมูลที่ดึงได้จาก SolarEdge Site #{activeOverview.siteId}</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {activeOverview.isMockData ? 'SolarEdge Demo' : 'Live Connected'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-1">
                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">กำลังผลิตปัจจุบัน</span>
                  <span className="text-sm font-bold font-mono text-emerald-300">
                    {activeOverview.currentPowerKw} kW
                  </span>
                  <span className="text-[9px] text-slate-500 block font-mono">({activeOverview.currentPowerW.toLocaleString()} W)</span>
                </div>

                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">ผลิตได้วันนี้</span>
                  <span className="text-sm font-bold font-mono text-sky-300">
                    {activeOverview.dailyEnergyKwh} kWh
                  </span>
                  <span className="text-[9px] text-slate-500 block font-mono">({activeOverview.dailyEnergyWh.toLocaleString()} Wh)</span>
                </div>

                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">ผลิตได้เดือนนี้</span>
                  <span className="text-sm font-bold font-mono text-indigo-300">
                    {activeOverview.monthlyEnergyMwh} MWh
                  </span>
                  <span className="text-[9px] text-slate-500 block font-mono">({activeOverview.monthlyEnergyKwh.toLocaleString()} kWh)</span>
                </div>

                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">พลังงานสะสม</span>
                  <span className="text-sm font-bold font-mono text-amber-300">
                    {activeOverview.lifetimeEnergyMwh} MWh
                  </span>
                  <span className="text-[9px] text-slate-500 block font-mono">(Lifetime)</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-sky-400" />
                  <span>เวลาอัปเดตล่าสุด: {activeOverview.lastUpdateTime}</span>
                </span>
                <span className="text-sky-300 font-mono">Peak: {activeOverview.peakPowerKwp} kWp</span>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-slate-900/50 border border-slate-800 text-slate-400 text-[11px] flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
              <span>อาคารนี้ยังไม่ได้ผูกกับ SolarEdge Site (จะใช้ข้อมูลจำลองตามโมเดลวิทยาเขตหาดใหญ่)</span>
            </div>
          )}


          {/*
            Balloon preview.

            The metric picker that used to sit above this was removed: the map
            balloon now always shows the same three fixed values, so choosing a
            "primary metric" had no effect on anything. This preview mirrors
            those three values instead of a single chosen one.
          */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-sky-500/20">
            <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">
              ตัวอย่าง Balloon ที่จะแสดงบนแผนที่:
            </span>

            <div className="glass-panel p-2.5 rounded-xl border border-sky-400/40 text-xs">
              <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-700/60">
                <div className="w-7 h-7 rounded-lg bg-sky-500 text-slate-950 font-bold font-mono flex items-center justify-center text-xs shrink-0">
                  {building.id}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-white text-xs truncate">{building.name}</div>
                  <div className="text-[10px] text-sky-300 font-mono truncate">
                    {selectedSiteId
                      ? `Site #${selectedSiteId} (${activeSite?.name || ''})`
                      : 'ยังไม่ได้ผูก SolarEdge Site'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">กำลังผลิต</div>
                  <div className="font-bold font-mono text-[11px] text-amber-300">
                    {activeOverview ? `${activeOverview.currentPowerKw.toFixed(1)}` : '—'}
                    <span className="text-[8px] text-amber-400/80 font-normal ml-0.5">kW</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">พลังงานรวม</div>
                  <div className="font-bold font-mono text-[11px] text-emerald-300">
                    {activeOverview ? `${activeOverview.lifetimeEnergyMwh.toFixed(1)}` : '—'}
                    <span className="text-[8px] text-emerald-400/80 font-normal ml-0.5">MWh</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">กำลังติดตั้ง</div>
                  <div className="font-bold font-mono text-[11px] text-sky-300">
                    {activeOverview ? `${activeOverview.peakPowerKwp.toFixed(0)}` : '—'}
                    <span className="text-[8px] text-sky-400/80 font-normal ml-0.5">kWp</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 mt-2 leading-snug">
              ในโหมด Live API ค่าทั้งสามจะขึ้นเป็น <span className="font-mono text-slate-400">—</span> จนกว่าจะผูกไซต์
              และ SolarEdge ส่งค่ากลับมา · ในโหมด Mock จะใช้ค่าจำลองของหมุดนี้
            </p>
          </div>
          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-sky-500/20">
            {currentBinding?.isBound ? (
              <button
                type="button"
                id="btn-unbind-building"
                onClick={handleUnbind}
                className="px-3 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>ยกเลิกการผูก (กลับสู่โหมดจำลอง)</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-xs"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                id="btn-save-building-binding"
                onClick={handleSave}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold shadow-lg transition-colors cursor-pointer text-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกการผูกข้อมูล</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
