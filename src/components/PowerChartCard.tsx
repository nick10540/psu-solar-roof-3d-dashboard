/**
 * Bottom-Center Card: พลังงานผลิตรายวัน (kWh) / Solar Power Generation Chart
 * Transparent Glassmorphic Design
 */

import React, { useState, useMemo } from 'react';
import { TimeSeriesDataPoint, TimeRange } from '../types';
import { BarChart3, TrendingUp } from 'lucide-react';

interface PowerChartCardProps {
  dayData: TimeSeriesDataPoint[];
  weekData: TimeSeriesDataPoint[];
  monthData: TimeSeriesDataPoint[];
  yearData: TimeSeriesDataPoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  selectedTimeHour?: number;
  onTimeSelect?: (hour: number) => void;
  isLiveActive?: boolean;
}

export const PowerChartCard: React.FC<PowerChartCardProps> = ({
  dayData,
  weekData,
  monthData,
  yearData,
  timeRange,
  onTimeRangeChange,
  selectedTimeHour = 10.5,
  onTimeSelect,
  isLiveActive = true,
}) => {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [hoveredPoint, setHoveredPoint] = useState<TimeSeriesDataPoint | null>(null);

  // Active dataset based on selected tab
  const currentDataset = useMemo(() => {
    switch (timeRange) {
      case 'week':
        return weekData;
      case 'month':
        return monthData;
      case 'year':
        return yearData;
      case 'realtime':
      case 'day':
      default:
        return dayData;
    }
  }, [timeRange, dayData, weekData, monthData, yearData]);

  // Max scale calculation for Y-axis
  const maxY = useMemo(() => {
    if (timeRange === 'year') return 450000; // kWh
    if (timeRange === 'month' || timeRange === 'week') return 16000; // kWh
    return 2000; // kW
  }, [timeRange]);

  // SVG Chart Geometry
  const chartWidth = 580;
  const chartHeight = 140;
  const padding = { top: 10, right: 15, bottom: 24, left: 42 };
  const graphWidth = chartWidth - padding.left - padding.right;
  const graphHeight = chartHeight - padding.top - padding.bottom;

  // Path building for SVG Line/Area & Bars
  const { pathD, areaD, clearSkyPathD, points } = useMemo(() => {
    if (!currentDataset || currentDataset.length === 0) {
      return { pathD: '', areaD: '', clearSkyPathD: '', points: [] };
    }

    const n = currentDataset.length;
    const pts = currentDataset.map((d, i) => {
      const x = padding.left + (i / Math.max(1, n - 1)) * graphWidth;
      const val = timeRange === 'day' || timeRange === 'realtime' ? d.powerKw : d.energyKwh;
      const y = padding.top + graphHeight - (Math.min(val, maxY) / maxY) * graphHeight;

      // Clear sky curve for day view
      const csVal = d.clearSkyPotentialKw || 0;
      const csY = padding.top + graphHeight - (Math.min(csVal, maxY) / maxY) * graphHeight;

      return { x, y, csY, val, data: d };
    });

    let dStr = '';
    let csStr = '';

    pts.forEach((pt, idx) => {
      if (idx === 0) {
        dStr += `M ${pt.x} ${pt.y}`;
        csStr += `M ${pt.x} ${pt.csY}`;
      } else {
        const prev = pts[idx - 1];
        const cpX1 = prev.x + (pt.x - prev.x) / 2;
        const cpX2 = prev.x + (pt.x - prev.x) / 2;
        dStr += ` C ${cpX1} ${prev.y}, ${cpX2} ${pt.y}, ${pt.x} ${pt.y}`;
        csStr += ` C ${cpX1} ${prev.csY}, ${cpX2} ${pt.csY}, ${pt.x} ${pt.csY}`;
      }
    });

    const baselineY = padding.top + graphHeight;
    const areaStr = `${dStr} L ${pts[pts.length - 1].x} ${baselineY} L ${pts[0].x} ${baselineY} Z`;

    return { pathD: dStr, areaD: areaStr, clearSkyPathD: csStr, points: pts };
  }, [currentDataset, graphWidth, graphHeight, padding.left, padding.top, maxY, timeRange]);

  // Y-axis tick values
  const yTicks = useMemo(() => {
    if (timeRange === 'year') return [400000, 200000, 0];
    if (timeRange === 'month' || timeRange === 'week') return [15000, 7500, 0];
    return [2000, 1000, 0];
  }, [timeRange]);

  const formatYLabel = (val: number) => {
    if (timeRange === 'year' || timeRange === 'month' || timeRange === 'week') return `${Math.round(val / 1000)}k`;
    return val.toLocaleString();
  };

  const peakVal = useMemo(() => {
    if (!currentDataset || currentDataset.length === 0) return 0;
    return Math.max(...currentDataset.map((d) => (timeRange === 'day' || timeRange === 'realtime' ? d.powerKw : d.energyKwh)));
  }, [currentDataset, timeRange]);

  return (
    <div
      id="card-solar-power-chart"
      className="glass-panel p-3 rounded-3xl w-full flex-1 min-w-[320px] max-w-[660px] shadow-2xl transition-all duration-300 border border-sky-500/28 backdrop-blur-xl relative overflow-hidden"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 pb-1 border-b border-sky-500/20">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
            <span>พลังงานผลิต ({timeRange === 'day' || timeRange === 'realtime' ? 'kW' : 'kWh'})</span>
          </h2>
          <span className="text-[9px] text-emerald-300 bg-emerald-500/25 px-2 py-0.5 rounded-full border border-emerald-400/40 font-mono hidden sm:inline-flex items-center gap-1 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            พีค {peakVal.toLocaleString()} {timeRange === 'day' || timeRange === 'realtime' ? 'kW' : 'kWh'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Chart Mode Toggle (Area vs Bar) */}
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-sky-500/30 text-[10px]">
            <button
              id="btn-chart-type-area"
              onClick={() => setChartType('area')}
              title="กราฟพื้นที่ / เส้น (Area Line Chart)"
              className={`px-2 py-0.5 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer ${
                chartType === 'area'
                  ? 'bg-sky-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              <span className="hidden md:inline">เส้น</span>
            </button>

            <button
              id="btn-chart-type-bar"
              onClick={() => setChartType('bar')}
              title="กราฟแท่ง (Bar Chart)"
              className={`px-2 py-0.5 rounded-lg flex items-center gap-1 font-semibold transition-all cursor-pointer ${
                chartType === 'bar'
                  ? 'bg-emerald-400 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              <span className="hidden md:inline">แท่ง</span>
            </button>
          </div>

          {/* Time Period Tabs */}
          <div className="flex items-center gap-0.5 bg-slate-950/80 p-0.5 rounded-xl border border-sky-500/30 text-[10px]">
            <button
              id="tab-range-realtime"
              onClick={() => onTimeRangeChange('realtime')}
              className={`px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                timeRange === 'realtime'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              เรียลไทม์
            </button>
            <button
              id="tab-range-day"
              onClick={() => onTimeRangeChange('day')}
              className={`px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                timeRange === 'day'
                  ? 'bg-sky-500 text-white font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              วันนี้
            </button>
            <button
              id="tab-range-week"
              onClick={() => onTimeRangeChange('week')}
              className={`px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                timeRange === 'week'
                  ? 'bg-sky-500 text-white font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              7 วัน
            </button>
            <button
              id="tab-range-month"
              onClick={() => onTimeRangeChange('month')}
              className={`px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                timeRange === 'month'
                  ? 'bg-sky-500 text-white font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              เดือน
            </button>
            <button
              id="tab-range-year"
              onClick={() => onTimeRangeChange('year')}
              className={`px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                timeRange === 'year'
                  ? 'bg-sky-500 text-white font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              ปี
            </button>
          </div>
        </div>
      </div>

      {/* SVG Solar Graph */}
      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            {/* Area gradient */}
            <linearGradient id="solarAreaGradient2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
              <stop offset="70%" stopColor="#059669" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#047857" stopOpacity="0.0" />
            </linearGradient>

            {/* Bar gradient */}
            <linearGradient id="solarBarGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <linearGradient id="solarBarHoverGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>

          {/* Grid Horizontal Lines & Y-Axis Labels */}
          {yTicks.map((val, idx) => {
            const y = padding.top + graphHeight - (val / maxY) * graphHeight;
            return (
              <g key={`ytick-${idx}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke="#334155"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <text
                  x={padding.left - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-slate-300 text-[9px] font-mono font-semibold"
                >
                  {formatYLabel(val)}
                </text>
              </g>
            );
          })}

          {/* MODE 1: AREA / CURVE LINE CHART */}
          {chartType === 'area' && (
            <>
              {/* Clear Sky Theoretical Reference Curve (Only in Day mode) */}
              {(timeRange === 'day' || timeRange === 'realtime') && clearSkyPathD && (
                <path
                  d={clearSkyPathD}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity="0.4"
                />
              )}

              {/* Filled Area Under Curve */}
              <path d={areaD} fill="url(#solarAreaGradient2)" />

              {/* Glowing Main Solar Production Stroke */}
              <path
                d={pathD}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="drop-shadow-[0_0_8px_rgba(16,185,129,0.9)]"
              />

              {/* Interactive Data Points & Hover Targets */}
              {points.map((pt, idx) => {
                const isHovered = hoveredPoint?.timestamp === pt.data.timestamp;

                return (
                  <g
                    key={`pt-${idx}`}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredPoint(pt.data)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => {
                      if (onTimeSelect && (timeRange === 'day' || timeRange === 'realtime')) {
                        const [h, m] = pt.data.timeLabel.split(':').map(Number);
                        onTimeSelect(h + (m || 0) / 60);
                      }
                    }}
                  >
                    <circle cx={pt.x} cy={pt.y} r="8" fill="transparent" />

                    {isHovered && (
                      <>
                        <circle cx={pt.x} cy={pt.y} r="6" fill="#10b981" opacity="0.4" className="animate-ping" />
                        <circle cx={pt.x} cy={pt.y} r="3.5" fill="#34d399" stroke="#ffffff" strokeWidth="1.5" />
                        <line
                          x1={pt.x}
                          y1={padding.top}
                          x2={pt.x}
                          y2={padding.top + graphHeight}
                          stroke="#38bdf8"
                          strokeWidth="1.2"
                          strokeDasharray="2 2"
                          opacity="0.75"
                        />
                      </>
                    )}
                  </g>
                );
              })}
            </>
          )}

          {/* MODE 2: BAR CHART (กราฟแท่ง) */}
          {chartType === 'bar' && (
            <g className="solar-bar-chart-group">
              {points.map((pt, idx) => {
                const isHovered = hoveredPoint?.timestamp === pt.data.timestamp;
                const totalPoints = points.length;
                // Calculate responsive bar width
                const barWidth = Math.max(4, Math.min(22, (graphWidth / totalPoints) * 0.72));
                const barHeight = Math.max(0, padding.top + graphHeight - pt.y);
                const barX = pt.x - barWidth / 2;
                const baselineY = padding.top + graphHeight;

                return (
                  <g
                    key={`bar-${idx}`}
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredPoint(pt.data)}
                    onMouseLeave={() => setHoveredPoint(null)}
                    onClick={() => {
                      if (onTimeSelect && (timeRange === 'day' || timeRange === 'realtime')) {
                        const [h, m] = pt.data.timeLabel.split(':').map(Number);
                        onTimeSelect(h + (m || 0) / 60);
                      }
                    }}
                  >
                    {/* Background hover highlight lane */}
                    {isHovered && (
                      <rect
                        x={barX - 4}
                        y={padding.top}
                        width={barWidth + 8}
                        height={graphHeight}
                        fill="rgba(56, 189, 248, 0.08)"
                        rx="4"
                      />
                    )}

                    {/* Bar Rectangle */}
                    {barHeight > 0 && (
                      <rect
                        x={barX}
                        y={pt.y}
                        width={barWidth}
                        height={barHeight}
                        rx={Math.min(3, barWidth / 2)}
                        fill={isHovered ? 'url(#solarBarHoverGradient)' : 'url(#solarBarGradient)'}
                        stroke={isHovered ? '#38bdf8' : '#059669'}
                        strokeWidth="0.8"
                        className="transition-all duration-150 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
                      />
                    )}

                    {/* Peak value dot indicator on hover */}
                    {isHovered && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="3.5"
                        fill="#38bdf8"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        className="animate-pulse"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* X-Axis Labels */}
          {timeRange === 'day' || timeRange === 'realtime' ? (
            ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'].map((timeLabel, idx) => {
              const fraction = idx / 6;
              const x = padding.left + fraction * graphWidth;
              return (
                <text
                  key={`xtick-${timeLabel}`}
                  x={x}
                  y={chartHeight - 4}
                  textAnchor="middle"
                  className="fill-slate-300 text-[8.5px] font-mono font-semibold"
                >
                  {timeLabel}
                </text>
              );
            })
          ) : (
            points
              .filter((_, idx) => idx % (timeRange === 'month' ? 5 : 1) === 0)
              .map((pt, idx) => (
                <text
                  key={`x-label-${idx}`}
                  x={pt.x}
                  y={chartHeight - 4}
                  textAnchor="middle"
                  className="fill-slate-300 text-[8.5px] font-mono font-semibold"
                >
                  {pt.data.timeLabel}
                </text>
              ))
          )}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && (
          <div className="absolute top-0 right-1 glass-panel px-2.5 py-1 rounded-xl text-xs z-30 shadow-xl border border-sky-400/50 pointer-events-none bg-slate-950/95">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sky-300 font-bold text-[11px]">{hoveredPoint.timeLabel}</span>
              <span className="font-mono text-emerald-300 font-bold text-[11px]">
                {timeRange === 'day' || timeRange === 'realtime'
                  ? `${hoveredPoint.powerKw.toLocaleString()} kW`
                  : `${hoveredPoint.energyKwh.toLocaleString()} kWh`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

