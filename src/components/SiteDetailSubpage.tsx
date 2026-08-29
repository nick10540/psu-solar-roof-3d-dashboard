/**
 * SiteDetailSubpage.tsx
 * Dedicated Sub-page (หน้าย่อย) for each of the 5 MEA Solar Roof Regional Sites:
 * 1. สุราษฎร์ธานี (Surat Thani) - 320 kWp
 * 2. ภูเก็ต (Phuket) - 450 kWp
 * 3. ตรัง (Trang) - 250 kWp
 * 4. หาดใหญ่ (Hatyai) - 380 kWp
 * 5. ปัตตานี (Pattani) - 200 kWp
 */

import React, { useState, useMemo } from 'react';
import { 
  BuildingInfo, 
  BuildingSiteBinding, 
  SolarEdgeTransformedOverview, 
  CampusWeather,
  TimeSeriesDataPoint,
  TimeRange
} from '../types';
import { totalInstalledKwp } from '../data/mockSolarData';
import { 
  ArrowLeft, 
  Zap, 
  Sun, 
  Layers, 
  Activity, 
  BarChart3, 
  Settings, 
  MapPin, 
  ShieldCheck, 
  Cpu, 
  Thermometer, 
  CheckCircle2, 
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Leaf,
  Calendar,
  Clock,
  Sparkles,
  Link2
} from 'lucide-react';

interface SiteDetailSubpageProps {
  site: BuildingInfo;
  allSites: BuildingInfo[];
  binding?: BuildingSiteBinding;
  overview?: SolarEdgeTransformedOverview | null;
  weather: CampusWeather;
  dayData: TimeSeriesDataPoint[];
  weekData: TimeSeriesDataPoint[];
  monthData: TimeSeriesDataPoint[];
  yearData: TimeSeriesDataPoint[];
  onBackToMainMap: () => void;
  onSelectSite: (site: BuildingInfo) => void;
  onOpenBindingModal: (site: BuildingInfo) => void;
  onOpenDetailInspectionModal?: (site: BuildingInfo) => void;
}

export const SiteDetailSubpage: React.FC<SiteDetailSubpageProps> = ({
  site,
  allSites,
  binding,
  overview,
  weather,
  dayData,
  weekData,
  monthData,
  yearData,
  onBackToMainMap,
  onSelectSite,
  onOpenBindingModal,
  onOpenDetailInspectionModal,
}) => {
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>('day');
  const [activeInverterTab, setActiveInverterTab] = useState<number>(0);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  // Scaled time series dataset for this specific site's capacity.
  //
  // The divisor was hard-coded to 6000, but the fleet totals 1,600 kWp and the
  // shared dataset in generateDayPowerData is calibrated to exactly that. Every
  // per-site chart was therefore reading ~3.75x low. Deriving the fleet total
  // from `allSites` also keeps this correct as pins are added or removed.
  const fleetCapacityKwp = useMemo(() => totalInstalledKwp(allSites), [allSites]);
  const capacityRatio = fleetCapacityKwp > 0 ? site.capacityKwp / fleetCapacityKwp : 0;
  
  /**
   * Today's curve: the site's own measurements when the backend has them,
   * otherwise the shared simulation scaled by this site's share of the fleet.
   *
   * The measured series is quarter-hourly and stops at the last reported
   * sample, so the line ends where the data does rather than running flat to
   * midnight.
   */
  const measuredCurve = overview?.powerCurveToday;

  const siteDayData = useMemo(() => {
    if (measuredCurve?.length) {
      return measuredCurve.map((p) => {
        const at = new Date(p.timestamp);
        return {
          timestamp: p.timestamp,
          timeLabel: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
          powerKw: p.powerKw,
          // Not measured. Zero keeps the chart's own maths safe; nothing draws
          // these while a measured curve is in play.
          clearSkyPotentialKw: 0,
          energyKwh: 0,
          irradianceWm2: 0,
          ambientTempC: 0,
          moduleTempC: 0,
        };
      });
    }

    return dayData.map((d) => ({
      ...d,
      powerKw: Math.round(d.powerKw * capacityRatio * 10) / 10,
      clearSkyPotentialKw: Math.round(d.clearSkyPotentialKw * capacityRatio * 10) / 10,
      energyKwh: Math.round(d.energyKwh * capacityRatio * 10) / 10,
    }));
  }, [measuredCurve, dayData, capacityRatio]);

  const siteWeekData = useMemo(() => weekData.map((d) => ({
    ...d,
    powerKw: Math.round(d.powerKw * capacityRatio * 10) / 10,
    energyKwh: Math.round(d.energyKwh * capacityRatio * 10) / 10,
  })), [weekData, capacityRatio]);

  const siteMonthData = useMemo(() => monthData.map((d) => ({
    ...d,
    powerKw: Math.round(d.powerKw * capacityRatio * 10) / 10,
    energyKwh: Math.round(d.energyKwh * capacityRatio * 10) / 10,
  })), [monthData, capacityRatio]);

  const siteYearData = useMemo(() => yearData.map((d) => ({
    ...d,
    energyKwh: Math.round(d.energyKwh * capacityRatio * 10) / 10,
  })), [yearData, capacityRatio]);

  const currentDataset =
    selectedTimeRange === 'day' ? siteDayData :
    selectedTimeRange === 'week' ? siteWeekData :
    selectedTimeRange === 'month' ? siteMonthData : siteYearData;

  /** Is the range on screen drawn from measurements rather than simulation? */
  const isMeasuredRange = selectedTimeRange === 'day' && !!measuredCurve?.length;

  const currentPowerKw = overview ? overview.currentPowerKw : site.currentPowerKw;
  const todayEnergyKwh = overview ? overview.dailyEnergyKwh : site.todayEnergyKwh;
  const lifetimeEnergyKwh = overview ? overview.lifetimeEnergyKwh : site.lifetimeEnergyKwh;

  /**
   * Is this page showing measured data?
   *
   * When it is, anything we cannot measure must NOT fall back to the building's
   * mock figures. The headline numbers were already live while the capacity,
   * panel count, chart and inverter panel below stayed simulated — so the page
   * showed 380 kWp for a site the API reports as 1500 kWp, under a real
   * production figure. Mixed provenance is worse than either alone: it makes
   * the invented parts look verified.
   */
  const isLive = !!overview && !overview.isMockData;

  // Capacity comes from the API once live — site.capacityKwp is a hand-entered
  // estimate and was wrong by a factor of ~4 on every site.
  const capacityKwp = isLive ? overview!.peakPowerKwp : site.capacityKwp;

  const lifetimeFormatted = lifetimeEnergyKwh >= 10000 
    ? `${(lifetimeEnergyKwh / 1000).toFixed(1)} MWh` 
    : `${Math.round(lifetimeEnergyKwh).toLocaleString()} kWh`;

  const selectedInverter = site.inverters[activeInverterTab] || site.inverters[0];

  // SVG Chart Calculations
  const chartWidth = 700;
  const chartHeight = 220;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;
  const graphWidth = chartWidth - padLeft - padRight;
  const graphHeight = chartHeight - padTop - padBottom;

  const maxVal = useMemo(() => {
    if (!currentDataset || currentDataset.length === 0) return 100;
    const values = currentDataset.map((d) => (selectedTimeRange === 'day' ? d.powerKw : d.energyKwh));
    return Math.max(...values, 10);
  }, [currentDataset, selectedTimeRange]);

  const maxY = Math.ceil(maxVal * 1.15);

  const chartPaths = useMemo(() => {
    if (!currentDataset || currentDataset.length === 0) return { lineD: '', areaD: '', points: [] };

    const pts = currentDataset.map((d, i) => {
      const x = padLeft + (i / (currentDataset.length - 1)) * graphWidth;
      const val = selectedTimeRange === 'day' ? d.powerKw : d.energyKwh;
      const y = padTop + graphHeight - (val / maxY) * graphHeight;
      return { x, y, data: d };
    });

    const lineD = pts.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
    const baselineY = padTop + graphHeight;
    const areaD = `${lineD} L ${pts[pts.length - 1].x} ${baselineY} L ${pts[0].x} ${baselineY} Z`;

    return { lineD, areaD, points: pts };
  }, [currentDataset, graphWidth, graphHeight, padLeft, padTop, maxY, selectedTimeRange]);

  return (
    <div className="w-full h-full overflow-y-auto bg-slate-950 text-slate-100 flex flex-col p-2 sm:p-4 gap-3 font-['Prompt',sans-serif]">
      {/* 1. Top Subpage Navigation Bar */}
      <div className="glass-panel px-3 sm:px-4 py-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 border border-sky-500/20 shadow-xl backdrop-blur-md">
        {/* Back Button & Site Title */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onBackToMainMap}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-400/40 text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow"
          >
            <ArrowLeft className="w-4 h-4 text-sky-300" />
            <span>กลับสู่แผนที่หลัก 5 ไซต์</span>
          </button>

          <div className="h-6 w-px bg-slate-700 hidden sm:block" />

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-lg font-bold text-white tracking-wide flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>MEA Solar Roof - {site.name}</span>
              </h2>
              <span className="text-[10px] font-mono bg-sky-950/80 text-sky-300 px-2 py-0.5 rounded border border-sky-500/40 font-bold">
                {site.code}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 font-light hidden sm:block">
              {site.enName} • จังหวัด{site.province || site.name}
            </p>
          </div>
        </div>

        {/* 5-Site Quick Switcher Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-sky-500/20 text-xs">
          {allSites.map((s) => {
            const isCurrent = s.id === site.id;
            return (
              <button
                key={s.id}
                onClick={() => onSelectSite(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                  isCurrent
                    ? 'bg-amber-500/30 text-amber-200 font-bold border border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <MapPin className="w-3 h-3 text-sky-400" />
                <span>{s.shortName || s.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Key Metrics Row (4 Core Telemetry Cards for this Site) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {/* Metric 1: กำลังผลิตปัจจุบัน (kW) */}
        <div className="glass-panel p-3.5 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/30 via-slate-900/80 to-slate-950 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-amber-300 mb-1">
            <span className="font-medium">กำลังผลิตปัจจุบัน (kW)</span>
            <Zap className="w-4 h-4 text-amber-400 animate-pulse" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight flex items-baseline gap-1">
            <span>{currentPowerKw.toFixed(1)}</span>
            <span className="text-xs font-normal text-amber-300/80">kW</span>
          </div>
          <div className="text-[10px] text-slate-300 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>SolarEdge Active Inverters</span>
          </div>
          <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
        </div>

        {/* Metric 2: พลังงานผลิตวันนี้ (kWh) */}
        <div className="glass-panel p-3.5 rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/30 via-slate-900/80 to-slate-950 shadow-xl">
          <div className="flex items-center justify-between text-xs text-sky-300 mb-1">
            <span className="font-medium">พลังงานที่ผลิตได้วันนี้</span>
            <Sun className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight flex items-baseline gap-1">
            <span>{todayEnergyKwh.toLocaleString()}</span>
            <span className="text-xs font-normal text-sky-300/80">kWh</span>
          </div>
          <div className="text-[10px] text-slate-300 mt-1">
            ประมาณการรายได้ ~฿{(todayEnergyKwh * 4.2).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>

        {/* Metric 3: พลังงานผลิตทั้งหมด (Lifetime Energy) */}
        <div className="glass-panel p-3.5 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 via-slate-900/80 to-slate-950 shadow-xl">
          <div className="flex items-center justify-between text-xs text-emerald-300 mb-1">
            <span className="font-medium">พลังงานผลิตได้ทั้งหมด</span>
            <Leaf className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight flex items-baseline gap-1">
            <span>{lifetimeFormatted}</span>
          </div>
          <div className="text-[10px] text-slate-300 mt-1 flex items-center gap-1">
            <span className="text-emerald-300 font-bold">ลด CO₂:</span>
            <span>~{(lifetimeEnergyKwh * 0.0005).toFixed(1)} ตัน</span>
          </div>
        </div>

        {/* Metric 4: กำลังติดตั้งจริง (kWp) & SolarEdge Info */}
        <div className="glass-panel p-3.5 rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-950/30 via-slate-900/80 to-slate-950 shadow-xl">
          <div className="flex items-center justify-between text-xs text-blue-300 mb-1">
            <span className="font-medium">กำลังติดตั้งจริง (kWp)</span>
            <ShieldCheck className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white tracking-tight flex items-baseline gap-1">
            <span>{capacityKwp.toFixed(0)}</span>
            <span className="text-xs font-normal text-blue-300/80">kWp</span>
          </div>
          <div className="text-[10px] text-slate-300 mt-1 flex items-center justify-between">
            {/* Panel count is not in the API — showing the hand-entered figure
                next to a live capacity would imply it was measured too. */}
            <span>{isLive ? 'จาก SolarEdge API' : `${site.panelCount} แผง PV`}</span>
            <button
              onClick={() => onOpenBindingModal(site)}
              className="text-amber-300 font-bold underline hover:text-amber-200 cursor-pointer"
            >
              ตั้งค่า SolarEdge API
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Content: Chart & Technical Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 flex-1 min-h-0">
        {/* Left 2 Cols: Generation Curves & Hourly Performance */}
        <div className="lg:col-span-2 glass-panel p-3 sm:p-4 rounded-2xl border border-sky-500/20 shadow-xl flex flex-col gap-3">
          {/* Chart Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-sky-400" />
              <h3 className="font-bold text-sm text-white">กราฟกำลังการผลิตไฟฟ้า Solar Roof ({site.name})</h3>
              {/* Only the daily curve is measured. The other ranges are still a
                  shared simulation scaled by capacity, and on a live page that
                  has to be labelled or it reads as data. */}
              {isLive && (
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    isMeasuredRange
                      ? 'text-emerald-300 bg-emerald-950/50 border-emerald-600/40'
                      : 'text-amber-300 bg-amber-950/50 border-amber-600/40'
                  }`}
                >
                  {isMeasuredRange ? 'วัดจริง' : 'จำลอง'}
                </span>
              )}
            </div>

            {/* Time Range Pills */}
            <div className="flex items-center gap-1 bg-slate-900/80 p-0.5 rounded-xl border border-sky-500/20 text-xs">
              {(['day', 'week', 'month', 'year'] as TimeRange[]).map((tr) => (
                <button
                  key={tr}
                  onClick={() => setSelectedTimeRange(tr)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    selectedTimeRange === tr
                      ? 'bg-sky-500/30 text-white font-bold border border-sky-400'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tr === 'day' ? 'รายวัน' : tr === 'week' ? 'รายสัปดาห์' : tr === 'month' ? 'รายเดือน' : 'รายปี'}
                </button>
              ))}
            </div>
          </div>

          {/* SVG Area Chart */}
          <div className="w-full relative h-64 sm:h-72">
            <svg 
              viewBox={`0 0 ${chartWidth} ${chartHeight}`} 
              className="w-full h-full overflow-visible"
            >
              <defs>
                <linearGradient id="sitePowerGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {[0, 0.5, 1].map((pct, idx) => {
                const y = padTop + graphHeight * pct;
                const val = Math.round(maxY * (1 - pct));
                return (
                  <g key={idx}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={chartWidth - padRight}
                      y2={y}
                      stroke="rgba(255,255,255,0.08)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 4}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor="end"
                      fontFamily="monospace"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Area & Line */}
              {chartPaths.areaD && (
                <path d={chartPaths.areaD} fill="url(#sitePowerGrad)" />
              )}
              {chartPaths.lineD && (
                <path
                  d={chartPaths.lineD}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points & X Axis Labels */}
              {chartPaths.points.map((p, idx) => {
                const isHovered = hoveredPointIndex === idx;
                const showLabel = idx % Math.ceil(chartPaths.points.length / 6) === 0;

                return (
                  <g key={idx}>
                    {showLabel && (
                      <text
                        x={p.x}
                        y={chartHeight - 8}
                        fill="#94a3b8"
                        fontSize="10"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {p.data.timeLabel}
                      </text>
                    )}

                    {/* Interactive hover circle */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isHovered ? 6 : 3}
                      fill={isHovered ? '#fbbf24' : '#f59e0b'}
                      stroke="#ffffff"
                      strokeWidth={isHovered ? 2 : 1}
                      className="transition-all cursor-pointer"
                      onMouseEnter={() => setHoveredPointIndex(idx)}
                      onMouseLeave={() => setHoveredPointIndex(null)}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoveredPointIndex !== null && chartPaths.points[hoveredPointIndex] && (
              <div
                className="absolute pointer-events-none glass-panel px-3 py-1.5 rounded-xl text-xs border border-amber-400 shadow-xl bg-slate-950/95 -translate-x-1/2 -translate-y-full mb-2"
                style={{
                  left: `${(chartPaths.points[hoveredPointIndex].x / chartWidth) * 100}%`,
                  top: `${(chartPaths.points[hoveredPointIndex].y / chartHeight) * 100}%`,
                }}
              >
                <div className="font-mono text-[10px] text-slate-400">
                  {chartPaths.points[hoveredPointIndex].data.timeLabel}
                </div>
                <div className="font-bold text-amber-300 font-mono">
                  {selectedTimeRange === 'day'
                    ? `${chartPaths.points[hoveredPointIndex].data.powerKw} kW`
                    : `${chartPaths.points[hoveredPointIndex].data.energyKwh} kWh`}
                </div>
              </div>
            )}
          </div>

          {/* Environmental Yield for this site */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs">
            <div className="bg-slate-900/60 p-2 rounded-xl border border-sky-500/10 text-center">
              <div className="text-[10px] text-slate-400">ลดการปล่อย CO₂</div>
              <div className="font-bold text-emerald-300 font-mono mt-0.5">
                ~{(todayEnergyKwh * 0.56 / 1000).toFixed(2)} ตัน/วัน
              </div>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-xl border border-sky-500/10 text-center">
              <div className="text-[10px] text-slate-400">เทียบเท่าปลูกต้นไม้</div>
              <div className="font-bold text-amber-300 font-mono mt-0.5">
                ~{Math.round(todayEnergyKwh * 0.08)} ต้น
              </div>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-xl border border-sky-500/10 text-center">
              <div className="text-[10px] text-slate-400">ประหยัดน้ำมันเชื้อเพลิง</div>
              <div className="font-bold text-sky-300 font-mono mt-0.5">
                ~{Math.round(todayEnergyKwh * 0.23)} ลิตร
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Inverter Diagnostics & String Telemetries */}
        <div className="glass-panel p-3 sm:p-4 rounded-2xl border border-sky-500/20 shadow-xl flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <h3 className="font-bold text-sm text-white">
                อินเวอร์เตอร์ SolarEdge{!isLive && ` (${site.inverterCount} เครื่อง)`}
              </h3>
            </div>
            {!isLive && (
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                ทำงานปกติ
              </span>
            )}
          </div>

          {/* Device-level telemetry needs the DEVICE_DATA scope and per-inverter
              endpoints; this dashboard reads site-level figures only. Showing
              the mock inverters here put four invented serial numbers, string
              voltages and currents on screen underneath live production —
              the most convincing fabrication on the whole page. */}
          {isLive && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-8">
              <Cpu className="w-8 h-8 text-slate-700" />
              <div className="text-xs text-slate-400 font-medium">ไม่มีข้อมูลระดับอุปกรณ์</div>
              <p className="text-[10px] text-slate-500 leading-snug max-w-[15rem]">
                ข้อมูลรายอินเวอร์เตอร์และ PV String ต้องใช้สิทธิ์ <span className="font-mono text-slate-400">DEVICE_DATA</span>{' '}
                ซึ่งยังไม่ได้เปิดใช้ — ตอนนี้ดึงเฉพาะข้อมูลระดับไซต์
              </p>
            </div>
          )}

          {/* Inverter Selector Tabs */}
          {!isLive && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {site.inverters.map((inv, idx) => (
              <button
                key={inv.id}
                onClick={() => setActiveInverterTab(idx)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all shrink-0 cursor-pointer ${
                  activeInverterTab === idx
                    ? 'bg-amber-500/30 text-amber-200 border border-amber-400'
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {inv.id}
              </button>
            ))}
          </div>
          )}

          {/* Active Inverter Telemetry Details */}
          {!isLive && selectedInverter && (
            <div className="bg-slate-900/80 p-3 rounded-xl border border-sky-500/20 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-800">
                <span className="text-slate-300 font-semibold">{selectedInverter.model}</span>
                <span className="text-sky-300 font-mono">{selectedInverter.efficiency}% Eff</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">กำลังผลิตปัจจุบัน</div>
                  <div className="font-bold font-mono text-amber-300 mt-0.5">
                    {selectedInverter.powerKw} / {selectedInverter.maxPowerKw} kW
                  </div>
                </div>

                <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400">อุณหภูมิอินเวอร์เตอร์</div>
                  <div className="font-bold font-mono text-slate-200 mt-0.5 flex items-center gap-1">
                    <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                    <span>{selectedInverter.temperatureC}°C</span>
                  </div>
                </div>
              </div>

              {/* String Currents & Voltages */}
              <div>
                <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>PV Strings ({selectedInverter.strings.length} สตริง)</span>
                  <span className="text-[10px] text-slate-400 font-mono">แรงดัน/กระแส</span>
                </div>

                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {selectedInverter.strings.map((str) => (
                    <div
                      key={str.stringId}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950/80 border border-slate-800/80 text-[11px] font-mono"
                    >
                      <span className="text-sky-300 font-bold">{str.stringId}</span>
                      <div className="flex items-center gap-2 text-slate-300">
                        <span>{str.voltageV} V</span>
                        <span className="text-slate-600">|</span>
                        <span>{str.currentA} A</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-amber-300 font-bold">{(str.powerW / 1000).toFixed(2)} kW</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action Button: Open Binding Settings */}
          <button
            onClick={() => onOpenBindingModal(site)}
            className="w-full py-2 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg mt-auto"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>จัดการเชื่อมต่อ SolarEdge Site API</span>
          </button>
        </div>
      </div>
    </div>
  );
};
