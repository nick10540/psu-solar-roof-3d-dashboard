/**
 * Top Header Bar for MEA SOLAR ROOF Smart Energy Dashboard
 * Supports:
 * - MEA Solar Roof Branding
 * - View Switcher: 2D Regional Satellite Map vs 3D Google Earth Mode
 * - 5-Site Navigation (สุราษฎร์ธานี, ภูเก็ต, ตรัง, หาดใหญ่, ปัตตานี) & Subpage Breadcrumb
 */

import React, { useState, useEffect } from 'react';
import { CampusWeather, SolarEdgeConfig, BuildingInfo, AppNavigationMode } from '../types';
import { 
  Sun, 
  Calendar, 
  Settings, 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  Eye, 
  EyeOff,
  Zap,
  ChevronRight,
  Home,
  Layers
} from 'lucide-react';
import { BrightnessControl } from './BrightnessControl';

interface HeaderBarProps {
  weather: CampusWeather;
  config: SolarEdgeConfig;
  navigationMode: AppNavigationMode;
  onNavigateToMainMap: () => void;
  selectedBuilding: BuildingInfo | null;
  buildings: BuildingInfo[];
  onSelectSite: (site: BuildingInfo) => void;
  isZenMode: boolean;
  onToggleZenMode: () => void;
  onOpenSettings: () => void;
  isLiveSimulation: boolean;
  onToggleLiveSimulation: () => void;
  onManualRefresh?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  weather,
  config,
  navigationMode,
  onNavigateToMainMap,
  selectedBuilding,
  buildings,
  onSelectSite,
  isZenMode,
  onToggleZenMode,
  onOpenSettings,
  onManualRefresh,
}) => {
  const [currentDateTimeStr, setCurrentDateTimeStr] = useState('21 ส.ค. 2569 10:30:00');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Live Clock (Thai Buddhist Year Format)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const thaiMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ];
      const day = now.getDate();
      const month = thaiMonths[now.getMonth()];
      const year = now.getFullYear() + 543;
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');

      setCurrentDateTimeStr(`${day} ${month} ${year} ${hours}:${minutes}:${seconds}`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleRefreshClick = () => {
    setIsRefreshing(true);
    if (onManualRefresh) onManualRefresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  return (
    <header
      id="app-header-bar"
      className="w-full glass-panel px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl flex items-center justify-between gap-1.5 sm:gap-2 shadow-2xl border border-sky-500/20 z-40 backdrop-blur-md max-w-full overflow-hidden"
    >
      {/* Left: MEA Solar Roof Branding & Navigation Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
        {/* MEA Iconic Energy Emblem */}
        <button
          onClick={onNavigateToMainMap}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-amber-500 via-orange-600 to-sky-700 border border-amber-400/50 flex items-center justify-center shadow-lg relative overflow-hidden shrink-0 group cursor-pointer"
          title="กลับสู่หน้าแผนที่หลัก 5 ไซต์"
        >
          <div className="flex flex-col items-center justify-center leading-none">
            <span className="text-white font-black text-[10px] sm:text-xs tracking-tighter">MEA</span>
            <Zap className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-200 fill-amber-300 mt-0.5" />
          </div>
          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 
              onClick={onNavigateToMainMap}
              className="text-xs sm:text-base font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-amber-100 to-amber-400 tracking-wide font-['Prompt',sans-serif] cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              MEA SOLAR ROOF
            </h1>
            <span className="text-[9px] bg-gradient-to-r from-sky-500/20 to-blue-600/30 text-sky-300 font-mono px-1.5 py-0.2 rounded-md border border-sky-400/40 font-bold hidden xl:inline-flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              5 SITES
            </span>
          </div>

          {/* Subtitle & Navigation Breadcrumbs */}
          <div className="text-[10px] sm:text-[11px] text-slate-300 font-light flex items-center gap-1 mt-0.5 truncate">
            {navigationMode === 'site-detail' && selectedBuilding ? (
              <div className="flex items-center gap-1 text-sky-300 truncate">
                <button 
                  onClick={onNavigateToMainMap}
                  className="hover:text-white flex items-center gap-0.5 text-slate-300 underline font-medium cursor-pointer shrink-0"
                >
                  <Home className="w-3 h-3" />
                  <span>แผนที่หลัก</span>
                </button>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="text-amber-300 font-bold bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30 truncate">
                  {selectedBuilding.name} ({selectedBuilding.capacityKwp} kWp)
                </span>
              </div>
            ) : (
              <span className="hidden 2xl:inline truncate">ระบบติดตามการผลิตไฟฟ้าพลังงานแสงอาทิตย์ 5 ไซต์</span>
            )}
          </div>
        </div>
      </div>

      {/* Middle: 5-Site Quick Jump Selector Pills */}
      <div className="hidden xl:flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-sky-500/20 text-xs shrink min-w-0">
        <button
          onClick={onNavigateToMainMap}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap shrink-0 ${
            navigationMode === 'main-map'
              ? 'bg-sky-500/30 text-white font-bold border border-sky-400 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3 h-3 text-sky-400" />
          <span>ภาพรวม 5 ไซต์</span>
        </button>

        <div className="w-px h-4 bg-slate-700 mx-0.5 shrink-0" />

        {buildings.map((site) => {
          const isCurrentSite = navigationMode === 'site-detail' && selectedBuilding?.id === site.id;
          return (
            <button
              key={site.id}
              onClick={() => onSelectSite(site)}
              className={`px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                isCurrentSite
                  ? 'bg-amber-500/30 text-amber-200 font-bold border border-amber-400/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>{site.shortName || site.name}</span>
            </button>
          );
        })}
      </div>

      {/* Right: Weather, System Status, Settings */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Weather Widget */}
        <div
          id="widget-weather"
          className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-900/60 border border-amber-500/20 text-xs shadow-inner shrink-0"
        >
          <Sun className="w-3.5 h-3.5 text-amber-400 animate-spin-slow" />
          <div className="text-left leading-tight">
            <div className="font-bold text-white font-mono text-xs">{weather.temperatureC}°C</div>
            <div className="text-[9px] text-amber-300/90 font-medium">{weather.conditionEn}</div>
          </div>
        </div>

        {/* Date & Time */}
        <div
          id="widget-live-clock"
          className="hidden 2xl:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-900/60 border border-sky-500/20 text-xs shadow-inner shrink-0"
        >
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          <div className="text-left font-mono leading-tight">
            <div className="font-medium text-slate-200 text-[10px]">{currentDateTimeStr.split(' ')[0]} {currentDateTimeStr.split(' ')[1]} {currentDateTimeStr.split(' ')[2]}</div>
            <div className="text-[9px] text-sky-300 font-bold">{currentDateTimeStr.split(' ')[3]} น.</div>
          </div>
        </div>

        {/* System Status Badge */}
        <div
          id="badge-system-status"
          className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-medium shrink-0"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-emerald-200 text-xs whitespace-nowrap">ระบบปกติ</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Screen brightness for the venue display */}
          <div className="hidden lg:flex">
            <BrightnessControl />
          </div>

          {/* Zen / Focus Mode Toggle */}
          <button
            id="btn-toggle-zen-mode"
            onClick={onToggleZenMode}
            title={isZenMode ? "แสดงแผงควบคุม UI ทั้งหมด" : "เน้นแผนที่เต็มจอ (ซ่อนแผงข้าง)"}
            className={`p-1.5 sm:px-2 sm:py-1.5 rounded-xl border text-xs items-center gap-1 transition-all cursor-pointer hidden md:flex shrink-0 ${
              isZenMode
                ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                : 'bg-slate-900/60 border-sky-500/20 text-slate-300 hover:text-sky-300'
            }`}
          >
            {isZenMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-medium hidden 2xl:inline whitespace-nowrap">
              {isZenMode ? 'เปิด UI' : 'เน้นแผนที่'}
            </span>
          </button>

          <button
            id="btn-refresh-data"
            onClick={handleRefreshClick}
            title="รีเฟรชข้อมูลล่าสุด"
            className="p-1.5 sm:p-1.5 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-sky-500/20 text-slate-300 hover:text-sky-300 transition-all cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-400' : ''}`} />
          </button>

          <button
            id="btn-open-solaredge-settings"
            onClick={onOpenSettings}
            title="ตั้งค่าเชื่อมต่อ SolarEdge API"
            className="flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 rounded-xl bg-sky-950/70 hover:bg-sky-900/70 border border-sky-500/40 text-sky-200 text-xs transition-all cursor-pointer shadow shrink-0"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden xl:inline font-mono text-[11px] whitespace-nowrap">SolarEdge API</span>
          </button>

          <button
            id="btn-toggle-fullscreen"
            onClick={handleFullscreenToggle}
            title="เต็มจอ (Fullscreen)"
            className="p-1.5 sm:p-1.5 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-sky-500/20 text-slate-300 hover:text-white transition-all cursor-pointer hidden sm:block shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </header>
  );
};
