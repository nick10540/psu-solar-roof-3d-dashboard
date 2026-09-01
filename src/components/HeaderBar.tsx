/**
 * Top Header Bar for MEA SOLAR ROOF Smart Energy Dashboard
 * Supports:
 * - System Title
 * - Live weather & clock widgets
 * - Manual refresh, SolarEdge settings, and fullscreen controls
 */

import React, { useState, useEffect } from 'react';
import { CampusWeather, SolarEdgeConfig } from '../types';
import {
  Calendar,
  Settings,
  Maximize2,
  Minimize2,
  RefreshCw
} from 'lucide-react';
import { BrightnessControl } from './BrightnessControl';

interface HeaderBarProps {
  weather: CampusWeather;
  config: SolarEdgeConfig;
  onOpenSettings: () => void;
  isLiveSimulation: boolean;
  onToggleLiveSimulation: () => void;
  onManualRefresh?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  config,
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
      className="w-full glass-panel px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl grid grid-cols-[1fr_auto_1fr] items-center gap-2 shadow-2xl border border-sky-500/20 z-40 backdrop-blur-md max-w-full overflow-hidden"
    >
      {/* Empty left column - balances the right column so the center group lands in the middle */}
      <div aria-hidden="true" />

      {/* Centered: Left Logo + System Title + Right Logo, flanking as one unit */}
      <div className="hidden xl:flex items-center gap-3 justify-self-center min-w-0">
        <img
          src="/logos/left-logo.png"
          alt="โลโก้หน่วยงาน"
          className="h-12 w-12 object-contain shrink-0"
        />

        <div className="flex items-center bg-slate-950/70 px-3 py-1.5 rounded-xl border border-sky-500/20 shrink min-w-0">
          <span className="text-lg sm:text-xl font-black text-slate-100 tracking-wide whitespace-nowrap font-['Prompt',sans-serif]">
            ระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์ มหาวิทยาลัยสงขลานครินทร์
          </span>
        </div>

        <img
          src="/logos/right-logo.png"
          alt="ตราสัญลักษณ์มหาวิทยาลัยสงขลานครินทร์"
          className="h-12 w-auto object-contain shrink-0"
        />
      </div>

      {/* Right: Date & Time, Settings - pinned to the right corner */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 justify-self-end">
        {/* Date & Time */}
        <div
          id="widget-live-clock"
          className="hidden xl:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-slate-900/60 border border-sky-500/20 text-xs shadow-inner shrink-0"
        >
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          <div className="text-left font-mono leading-tight">
            <div className="font-medium text-slate-200 text-[10px]">{currentDateTimeStr.split(' ')[0]} {currentDateTimeStr.split(' ')[1]} {currentDateTimeStr.split(' ')[2]}</div>
            <div className="text-[9px] text-sky-300 font-bold">{currentDateTimeStr.split(' ')[3]} น.</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Screen brightness for the venue display */}
          <div className="hidden lg:flex">
            <BrightnessControl />
          </div>

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
            className="p-1.5 sm:p-1.5 rounded-xl bg-sky-950/70 hover:bg-sky-900/70 border border-sky-500/40 transition-all cursor-pointer shadow shrink-0"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
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
