/**
 * Building Detail Inspection Modal
 * Shows specific building solar stats, string telemetry, inverter monitoring, and SolarEdge Site binding status
 */

import React from 'react';
import { BuildingInfo, BuildingSiteBinding, SolarEdgeTransformedOverview } from '../types';
import { 
  X, 
  Zap, 
  Layers, 
  Activity, 
  Cpu, 
  Sun, 
  Clock, 
  Link2, 
  CheckCircle2, 
  Thermometer, 
  ShieldCheck, 
  Sparkles,
  Calendar,
  BarChart3,
  MapPin,
  Trash2
} from 'lucide-react';

interface BuildingDetailModalProps {
  building: BuildingInfo | null;
  binding?: BuildingSiteBinding;
  overview?: SolarEdgeTransformedOverview | null;
  onOpenBindingModal?: (building: BuildingInfo) => void;
  onEditLocation?: (building: BuildingInfo) => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  onClose: () => void;
}

export const BuildingDetailModal: React.FC<BuildingDetailModalProps> = ({ 
  building, 
  binding,
  overview,
  onOpenBindingModal,
  onEditLocation,
  onOpenDeleteDialog,
  onClose 
}) => {
  if (!building) return null;

  const isBound = binding?.isBound && binding.siteId;

  return (
    <div
      id="modal-building-detail-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="modal-building-detail-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-sky-400/40 custom-scrollbar text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-sky-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-mono font-black text-lg shadow-[0_0_15px_rgba(56,189,248,0.5)] ${
              isBound ? 'bg-emerald-400 text-slate-950' : 'bg-sky-500 text-slate-950'
            }`}>
              {building.id}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {building.name}
                </h3>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-400/30 font-mono">
                  {building.code}
                </span>
                {isBound && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-400/40 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>SolarEdge Live (Site #{binding.siteId})</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">{building.enName} • {building.category}</p>
            </div>
          </div>

          <button
            id="btn-close-building-modal"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SolarEdge Site Binding Banner */}
        {overview ? (
          <div className="my-3.5 p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="font-bold text-white">ผูกข้อมูลกับ SolarEdge Site #{overview.siteId} ({overview.siteName})</span>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-sky-400" />
                  <span>ซิงค์ล่าสุด: {overview.lastUpdateTime}</span>
                </div>
              </div>
            </div>

            {onOpenBindingModal && (
              <button
                onClick={() => onOpenBindingModal(building)}
                className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-medium border border-sky-500/30 cursor-pointer"
              >
                ⚙️ เปลี่ยนการผูก Site
              </button>
            )}
          </div>
        ) : (
          <div className="my-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-sky-400" />
              <span>อาคารนี้ใช้ข้อมูลจำลองตามสเปกวิทยาเขต สามารถผูกกับ SolarEdge Site จริงได้</span>
            </div>

            {onOpenBindingModal && (
              <button
                onClick={() => onOpenBindingModal(building)}
                className="px-2.5 py-1 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[11px] font-medium border border-sky-500/30 cursor-pointer"
              >
                🔗 ผูก SolarEdge Site
              </button>
            )}
          </div>
        )}

        {/* Top 4 Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3">
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              กำลังผลิตขณะนี้
            </span>
            <div className="text-xl font-bold font-mono text-emerald-300 mt-1">
              {overview ? overview.currentPowerKw : building.currentPowerKw}{' '}
              <span className="text-xs text-slate-400 font-sans">kW</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              {overview ? `(${overview.currentPowerW.toLocaleString()} W)` : 'Live Simulated'}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-sky-400" />
              พลังงานผลิตวันนี้
            </span>
            <div className="text-xl font-bold font-mono text-sky-300 mt-1">
              {overview ? overview.dailyEnergyKwh : building.todayEnergyKwh}{' '}
              <span className="text-xs text-slate-400 font-sans">kWh</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              {overview ? `(${overview.dailyEnergyWh.toLocaleString()} Wh)` : 'สะสมประจำวัน'}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
              พลังงานผลิตเดือนนี้
            </span>
            <div className="text-xl font-bold font-mono text-indigo-300 mt-1">
              {overview ? `${overview.monthlyEnergyMwh} MWh` : `${(building.capacityKwp * 0.115).toFixed(1)} MWh`}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              {overview ? `(${overview.monthlyEnergyKwh.toLocaleString()} kWh)` : 'รอบเดือนปัจจุบัน'}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              กำลังติดตั้งรวม
            </span>
            <div className="text-xl font-bold font-mono text-amber-300 mt-1">
              {overview ? overview.peakPowerKwp : building.capacityKwp}{' '}
              <span className="text-xs text-slate-400 font-sans">kWp</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">{building.panelCount} แผง PV</span>
          </div>
        </div>

        {/* Inverter & String Telemetry List */}
        <div className="space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>Inverters & PV Strings ({building.inverterCount || 2} เครื่อง)</span>
            </h4>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Inverter ประสิทธิภาพ 98.6% (SolarEdge HD-Wave)</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Inverter 1 */}
            <div className="p-3 rounded-2xl bg-slate-900/70 border border-sky-500/20 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                <div>
                  <span className="font-bold text-white font-mono">INV-01 (SE66.6K)</span>
                  <span className="text-[10px] text-slate-400 block font-mono">Serial: SE-940182-A</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                    ONLINE
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">45.2°C</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[9px] text-slate-500 block">String 1</span>
                  <span className="text-slate-200 font-bold">742 V • 10.5 A</span>
                  <span className="text-emerald-400 text-[10px] block">7.79 kW</span>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[9px] text-slate-500 block">String 2</span>
                  <span className="text-slate-200 font-bold">740 V • 10.4 A</span>
                  <span className="text-emerald-400 text-[10px] block">7.69 kW</span>
                </div>
              </div>
            </div>

            {/* Inverter 2 */}
            <div className="p-3 rounded-2xl bg-slate-900/70 border border-sky-500/20 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                <div>
                  <span className="font-bold text-white font-mono">INV-02 (SE66.6K)</span>
                  <span className="text-[10px] text-slate-400 block font-mono">Serial: SE-940182-B</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                    ONLINE
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">46.0°C</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[9px] text-slate-500 block">String 3</span>
                  <span className="text-slate-200 font-bold">735 V • 9.2 A</span>
                  <span className="text-emerald-400 text-[10px] block">6.76 kW</span>
                </div>
                <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                  <span className="text-[9px] text-slate-500 block">String 4</span>
                  <span className="text-slate-200 font-bold">738 V • 9.3 A</span>
                  <span className="text-emerald-400 text-[10px] block">6.86 kW</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 pt-3 border-t border-sky-500/20 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {onEditLocation && (
              <button
                onClick={() => onEditLocation(building)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-950/70 text-amber-300 border border-amber-500/40 hover:bg-amber-900/80 font-medium text-xs transition-colors cursor-pointer"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>📍 ปรับตำแหน่งหมุด</span>
              </button>
            )}

            {onOpenDeleteDialog && (
              <button
                onClick={() => {
                  onClose();
                  onOpenDeleteDialog(building);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/70 text-rose-300 border border-rose-500/40 hover:bg-rose-900/80 font-medium text-xs transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>ลบหมุดไซต์นี้</span>
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg transition-colors cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
