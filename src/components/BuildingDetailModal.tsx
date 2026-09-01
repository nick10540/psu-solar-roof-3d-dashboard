/**
 * Building Detail Inspection Modal
 * Shows specific building solar stats, string telemetry, inverter monitoring, and SolarEdge Site binding status
 *
 * Like the map pins and the site sub-page, every figure here comes from the
 * resolved metrics rather than from `overview ? ... : building....`. See
 * services/siteMetricsService.ts for why that fallback is banned.
 */

import React from 'react';
import { BuildingInfo, SolarEdgeTransformedOverview, InverterInfo } from '../types';
import { DataSourceMode, ResolvedSiteMetrics } from '../services/siteMetricsService';
import { NO_DATA, fmt, noDataHeadline, SourceCaption } from './metricDisplay';
import { CountUp } from './CountUp';
import {
  X,
  Zap,
  Cpu,
  Clock,
  Link2,
  Thermometer,
  ShieldCheck,
  Sparkles,
  Calendar,
  BarChart3,
  MapPin,
  Trash2,
  WifiOff
} from 'lucide-react';

interface BuildingDetailModalProps {
  building: BuildingInfo | null;
  /**
   * What this building is allowed to display, resolved once in App by
   * resolveAllSiteMetrics - the very same entry its map pin renders from.
   */
  metrics: ResolvedSiteMetrics | null;
  /** Whether the dashboard as a whole is on the live API or the simulator. */
  mode: DataSourceMode;
  overview?: SolarEdgeTransformedOverview | null;
  onOpenBindingModal?: (building: BuildingInfo) => void;
  onEditLocation?: (building: BuildingInfo) => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  onClose: () => void;
}

/**
 * One inverter card, drawn from the simulator's own per-site figures.
 *
 * These replaced two hard-coded inverters with fixed serial numbers, fixed
 * string voltages and a permanent green ONLINE - identical for every site and
 * rendered in every mode. `building.inverters` at least varies per site and
 * moves with the simulation.
 */
const SimulatedInverterCard: React.FC<{ inverter: InverterInfo }> = ({ inverter }) => (
  <div className="p-3 rounded-2xl bg-slate-900/70 border border-sky-500/20 text-xs">
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2 mb-2">
      <div className="min-w-0">
        <span className="font-bold text-white font-mono">
          {inverter.id} ({inverter.model})
        </span>
        <span className="text-[10px] text-slate-400 block font-mono">
          {inverter.powerKw} / {inverter.maxPowerKw} kW • {inverter.efficiency}% Eff
        </span>
      </div>
      <div className="text-right shrink-0">
        <span
          className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
            inverter.status === 'normal'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {inverter.status === 'normal' ? 'จำลอง' : inverter.status.toUpperCase()}
        </span>
        <span className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-end gap-0.5">
          <Thermometer className="w-3 h-3 text-amber-400" />
          {inverter.temperatureC}°C
        </span>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
      {inverter.strings.map((str) => (
        <div key={str.stringId} className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
          <span className="text-[9px] text-slate-500 block">{str.stringId}</span>
          <span className="text-slate-200 font-bold">
            {str.voltageV} V • {str.currentA} A
          </span>
          <span className="text-amber-300 text-[10px] block">
            <CountUp target={str.powerW / 1000} decimals={2} /> kW
          </span>
        </div>
      ))}
    </div>
  </div>
);

export const BuildingDetailModal: React.FC<BuildingDetailModalProps> = ({
  building,
  metrics,
  mode,
  overview,
  onOpenBindingModal,
  onEditLocation,
  onOpenDeleteDialog,
  onClose
}) => {
  if (!building || !metrics) return null;

  /** Genuine SolarEdge readings for a site explicitly mapped to this pin. */
  const isLive = metrics.source === 'live';
  /** Simulated figures. Allowed - but never unlabelled. */
  const isSimulated = metrics.source === 'mock';
  /** Not mapped to a SolarEdge site, or mapped but not reporting. */
  const hasNoData = !metrics.hasData;

  /**
   * The overview is consulted only for detail the resolved metrics do not
   * carry: site name, sync time, monthly production, and the raw W / Wh the
   * API reported. Gating it on `isLive` means a simulated payload can never
   * supply any of them.
   */
  const live = isLive ? overview ?? null : null;

  /** Dims a figure with nothing behind it, matching the map's no-data pins. */
  const tone = (colour: string) => (hasNoData ? 'text-slate-600' : colour);

  // Monthly production is not part of ResolvedSiteMetrics - only the API
  // reports it. The mock estimate is kept but no longer masquerades as a
  // reading; it is captioned as simulated like everything else in mock mode.
  const monthlyKwh = live
    ? live.monthlyEnergyKwh
    : isSimulated
      ? building.capacityKwp * 115
      : null;
  // A node, not a string: the digits ease to the new reading, the unit does not.
  const monthlyText =
    monthlyKwh === null ? (
      NO_DATA
    ) : (
      <>
        <CountUp target={monthlyKwh} decimals={0} />
        <span className="text-xs text-slate-400 font-sans"> kWh</span>
      </>
    );

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
            {/* The id badge was emerald whenever a binding existed, whether or
                not anything was actually reporting through it. */}
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center font-mono font-black text-lg shadow-[0_0_15px_rgba(56,189,248,0.5)] ${
                isLive
                  ? 'bg-emerald-400 text-slate-950'
                  : hasNoData
                    ? 'bg-slate-700 text-slate-400'
                    : 'bg-sky-500 text-slate-950'
              }`}
            >
              {building.id}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {building.name}
                </h3>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-400/30 font-mono">
                  {building.code}
                </span>

                {/* "SolarEdge Live" is claimed only when a reading backs it. */}
                {isLive && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-400/40 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>SolarEdge Live (Site #{metrics.siteId})</span>
                  </span>
                )}
                {isSimulated && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-400/40 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span>Mock Simulator</span>
                  </span>
                )}
                {hasNoData && (
                  <span className="text-[10px] bg-slate-800/80 text-slate-400 px-2 py-0.5 rounded-full border border-slate-600/50 font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                    <span>
                      {noDataHeadline(metrics)}
                      {metrics.isBound ? ` (Site #${metrics.siteId})` : ''}
                    </span>
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

        {/* SolarEdge Site Binding Banner. Three states now: "no overview" used
            to collapse "we are simulating on purpose" together with "the live
            API has nothing for this pin" into one reassuring sentence. */}
        {live ? (
          <div className="my-3.5 p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="font-bold text-white">
                  ผูกข้อมูลกับ SolarEdge Site #{live.siteId} ({live.siteName})
                </span>
                <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-sky-400" />
                  <span>ซิงค์ล่าสุด: {live.lastUpdateTime}</span>
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
        ) : isSimulated ? (
          <div className="my-3.5 p-3 rounded-2xl bg-amber-950/40 border border-amber-600/40 flex items-center justify-between flex-wrap gap-2 text-xs text-amber-200/90">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-amber-400 shrink-0" />
              <span>ทุกตัวเลขในหน้านี้เป็นข้อมูลจำลองตามสเปกวิทยาเขต ไม่ใช่ค่าที่วัดได้จริง</span>
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
        ) : (
          <div className="my-3.5 p-3 rounded-2xl bg-slate-900/60 border border-slate-700/60 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-300">
            <div className="flex items-start gap-2">
              <WifiOff className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold text-slate-200">{noDataHeadline(metrics)}</span>
                <div className="text-[10px] text-slate-400 leading-snug">
                  {metrics.isBound
                    ? `ผูกกับ SolarEdge Site #${metrics.siteId} แล้ว แต่ยังไม่มีค่าที่อ่านได้จาก API`
                    : 'เลือก SolarEdge Site มาผูกกับหมุดนี้ก่อน จึงจะแสดงค่าจริงได้'}
                </div>
              </div>
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
              <Zap className={`w-3.5 h-3.5 ${tone('text-emerald-400')}`} />
              กำลังผลิตขณะนี้
            </span>
            <div className={`text-xl font-bold font-mono mt-1 ${tone('text-emerald-300')}`}>
              <CountUp target={metrics.currentPowerKw} decimals={1} placeholder={NO_DATA} />
              {metrics.currentPowerKw !== null && (
                <span className="text-xs text-slate-400 font-sans"> kW</span>
              )}
            </div>
            <SourceCaption
              metrics={metrics}
              liveLabel={live ? `SolarEdge • ${live.currentPowerW.toLocaleString()} W` : ''}
            />
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Calendar className={`w-3.5 h-3.5 ${tone('text-sky-400')}`} />
              พลังงานผลิตวันนี้
            </span>
            <div className={`text-xl font-bold font-mono mt-1 ${tone('text-sky-300')}`}>
              <CountUp target={metrics.todayEnergyKwh} placeholder={NO_DATA} />
              {metrics.todayEnergyKwh !== null && (
                <span className="text-xs text-slate-400 font-sans"> kWh</span>
              )}
            </div>
            <SourceCaption
              metrics={metrics}
              liveLabel={live ? `SolarEdge • ${live.dailyEnergyWh.toLocaleString()} Wh` : ''}
            />
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <BarChart3 className={`w-3.5 h-3.5 ${tone('text-indigo-400')}`} />
              พลังงานผลิตเดือนนี้
            </span>
            <div className={`text-xl font-bold font-mono mt-1 ${tone('text-indigo-300')}`}>
              {monthlyText}
            </div>
            <SourceCaption
              metrics={metrics}
              liveLabel={live ? `SolarEdge • ${live.monthlyEnergyKwh.toLocaleString()} kWh` : ''}
            />
            {isSimulated && (
              <span className="text-[10px] text-slate-500 font-mono">ประมาณการจากกำลังติดตั้ง</span>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <ShieldCheck className={`w-3.5 h-3.5 ${tone('text-amber-400')}`} />
              กำลังติดตั้งรวม
            </span>
            <div className={`text-xl font-bold font-mono mt-1 ${tone('text-amber-300')}`}>
              <CountUp target={metrics.capacityKwp} decimals={0} placeholder={NO_DATA} />
              {metrics.capacityKwp !== null && (
                <span className="text-xs text-slate-400 font-sans"> kWp</span>
              )}
            </div>
            <SourceCaption metrics={metrics} liveLabel="จาก SolarEdge API" />
            {/* Panel count is not in the API - printing the hand-entered figure
                under a live capacity would imply it was measured too. */}
            {isSimulated && (
              <span className="text-[10px] text-slate-500 font-mono">{building.panelCount} แผง PV</span>
            )}
          </div>
        </div>

        {/* Inverter & String Telemetry. Nothing here is invented any more: the
            simulator's own per-site figures, or an explicit empty state. */}
        <div className="space-y-3 mt-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>
                Inverters &amp; PV Strings
                {isSimulated && ` (${building.inverterCount} เครื่อง)`}
              </span>
            </h4>
            {/* Was a flat "ประสิทธิภาพ 98.6% (SolarEdge HD-Wave)" on every site
                in every mode - a spec sheet presented as a measurement. */}
            {isSimulated && (
              <span className="text-[10px] text-amber-300 flex items-center gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>ค่าจำลอง • ประสิทธิภาพออกแบบ {building.efficiencyRatio}%</span>
              </span>
            )}
          </div>

          {isLive && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-8 rounded-2xl bg-slate-900/60 border border-sky-500/20">
              <Cpu className="w-8 h-8 text-slate-700" />
              <div className="text-xs text-slate-400 font-medium">ไม่มีข้อมูลระดับอุปกรณ์</div>
              <p className="text-[10px] text-slate-500 leading-snug max-w-[22rem]">
                ข้อมูลรายอินเวอร์เตอร์และ PV String ต้องใช้สิทธิ์{' '}
                <span className="font-mono text-slate-400">DEVICE_DATA</span> ซึ่งยังไม่ได้เปิดใช้ —
                ตอนนี้ดึงเฉพาะข้อมูลระดับไซต์
              </p>
            </div>
          )}

          {hasNoData && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-8 rounded-2xl bg-slate-900/60 border border-slate-700/50">
              <WifiOff className="w-8 h-8 text-slate-700" />
              <div className="text-xs text-slate-400 font-medium">{noDataHeadline(metrics)}</div>
              <p className="text-[10px] text-slate-500 leading-snug max-w-[22rem]">
                {metrics.isBound
                  ? 'ยังไม่มีค่าที่อ่านได้จาก API สำหรับไซต์นี้'
                  : 'ไซต์นี้ยังไม่ได้เลือก SolarEdge Site — ผูกกับ API ก่อนจึงจะแสดงข้อมูลอุปกรณ์ได้'}
              </p>
            </div>
          )}

          {isSimulated && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {building.inverters.map((inv) => (
                <SimulatedInverterCard key={inv.id} inverter={inv} />
              ))}
            </div>
          )}
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

          <div className="flex items-center gap-2">
            {/* Same chip as the regional totals panel, so every surface agrees
                on which mode the dashboard is in. */}
            <span
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-bold ${
                mode === 'live'
                  ? 'text-emerald-300 bg-emerald-950/80 border-emerald-600/40'
                  : 'text-amber-300 bg-amber-950/70 border-amber-600/40'
              }`}
            >
              {mode === 'live' ? 'LIVE API' : 'MOCK'}
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg transition-colors cursor-pointer"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
