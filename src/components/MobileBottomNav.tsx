/**
 * MobileBottomNav.tsx
 * Bottom Navigation Bar and Slide-Up Sheet Container for Mobile Viewports (< md)
 * Provides seamless access to Map, Overview, Building List, and Generation Charts
 */

import React from 'react';
import { 
  Map, 
  Zap, 
  Building2, 
  BarChart3, 
  X,
  ChevronDown
} from 'lucide-react';
import { BuildingInfo, BuildingSiteBinding, CampusWeather, SolarEdgeConfig, SolarEdgeSiteOverview, SolarEdgeTransformedOverview, TimeRange, TimeSeriesDataPoint } from '../types';
import { SolarOverviewCard } from './SolarOverviewCard';
import { PerformanceDonutCard } from './PerformanceDonutCard';
import { EnvironmentalCard } from './EnvironmentalCard';
import { BuildingListSidebar } from './BuildingListSidebar';
import { PowerChartCard } from './PowerChartCard';

export type MobileTab = 'map' | 'overview' | 'buildings' | 'chart';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onChangeTab: (tab: MobileTab) => void;
  buildings: BuildingInfo[];
  selectedBuildingId: number | null;
  overview: SolarEdgeSiteOverview;
  bindings: Record<number, BuildingSiteBinding>;
  overviews: Record<number, SolarEdgeTransformedOverview>;
  isLiveSimulation: boolean;
  
  // Chart props
  dayData: TimeSeriesDataPoint[];
  weekData: TimeSeriesDataPoint[];
  monthData: TimeSeriesDataPoint[];
  yearData: TimeSeriesDataPoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  selectedTimeHour: number;
  onTimeSelect: (hour: number) => void;

  // Handlers
  onSelectBuilding: (building: BuildingInfo | null) => void;
  onOpenBindingModal?: (building: BuildingInfo) => void;
  onOpenAddModal?: () => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  onResetToDefaults?: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onChangeTab,
  buildings,
  selectedBuildingId,
  overview,
  bindings,
  overviews,
  isLiveSimulation,
  dayData,
  weekData,
  monthData,
  yearData,
  timeRange,
  onTimeRangeChange,
  selectedTimeHour,
  onTimeSelect,
  onSelectBuilding,
  onOpenBindingModal,
  onOpenAddModal,
  onOpenDeleteDialog,
  onResetToDefaults,
}) => {
  const isSheetOpen = activeTab !== 'map';

  const handleSelectBuildingAndClose = (bld: BuildingInfo | null) => {
    onSelectBuilding(bld);
    onChangeTab('map');
  };

  return (
    <>
      {/* 1. Slide-Up Bottom Sheet Modal for active tab (Overview, Buildings, Chart) */}
      {isSheetOpen && (
        <div 
          id="mobile-bottom-sheet-backdrop"
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-md flex flex-col justify-end md:hidden animate-fadeIn"
          onClick={() => onChangeTab('map')}
        >
          <div
            id="mobile-bottom-sheet-content"
            className="w-full max-h-[82vh] glass-panel-glow bg-slate-950/98 rounded-t-3xl border-t border-sky-400/40 shadow-2xl flex flex-col animate-slideUp overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grab handle & Sheet Header */}
            <div className="pt-2 pb-2 px-4 border-b border-sky-500/20 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300">
                  {activeTab === 'overview' && <Zap className="w-4 h-4 text-emerald-400" />}
                  {activeTab === 'buildings' && <Building2 className="w-4 h-4 text-sky-400" />}
                  {activeTab === 'chart' && <BarChart3 className="w-4 h-4 text-purple-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {activeTab === 'overview' && 'ภาพรวมการผลิตไฟฟ้า ม.อ.'}
                    {activeTab === 'buildings' && `ผังอาคารโซลาร์รูฟ (${buildings.length})`}
                    {activeTab === 'chart' && 'กราฟกำลังการผลิต (kW / kWh)'}
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {activeTab === 'overview' && 'ข้อมูลสถิติ ประสิทธิภาพ และสิ่งแวดล้อม'}
                    {activeTab === 'buildings' && 'แตะที่อาคารเพื่อเลื่อนแผนที่ไปยังตำแหน่งจริง'}
                    {activeTab === 'chart' && 'แสดงผลรายวัน สัปดาห์ เดือน และปี'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => onChangeTab('map')}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-xs"
              >
                <ChevronDown className="w-4 h-4" />
                <span>ปิด</span>
              </button>
            </div>

            {/* Scrollable Body Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
              {activeTab === 'overview' && (
                <div className="space-y-3 pb-4">
                  <SolarOverviewCard overview={overview} isLiveUpdating={isLiveSimulation} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PerformanceDonutCard overview={overview} />
                    <EnvironmentalCard overview={overview} />
                  </div>
                </div>
              )}

              {activeTab === 'buildings' && (
                <div className="pb-4">
                  <BuildingListSidebar
                    buildings={buildings}
                    selectedBuildingId={selectedBuildingId}
                    bindings={bindings}
                    overviews={overviews}
                    onSelectBuilding={handleSelectBuildingAndClose}
                    onOpenBindingModal={onOpenBindingModal}
                    onOpenAddModal={onOpenAddModal}
                    onOpenDeleteDialog={onOpenDeleteDialog}
                    onResetToDefaults={onResetToDefaults}
                    isMobileView={true}
                  />
                </div>
              )}

              {activeTab === 'chart' && (
                <div className="pb-4">
                  <PowerChartCard
                    dayData={dayData}
                    weekData={weekData}
                    monthData={monthData}
                    yearData={yearData}
                    timeRange={timeRange}
                    onTimeRangeChange={onTimeRangeChange}
                    selectedTimeHour={selectedTimeHour}
                    onTimeSelect={onTimeSelect}
                    isLiveActive={isLiveSimulation}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Floating Bottom Navigation Bar (Docked at bottom of viewport for Mobile) */}
      <nav
        id="mobile-bottom-navigation-bar"
        aria-label="เมนูหลักสำหรับมือถือ"
        className="fixed bottom-2 left-2 right-2 z-30 md:hidden glass-panel-glow p-1 rounded-2xl border border-sky-400/30 shadow-2xl flex items-center justify-around backdrop-blur-xl"
      >
        {/* Tab 1: Map / 3D */}
        <button
          id="btn-mobile-nav-map"
          onClick={() => onChangeTab('map')}
          className={`flex-1 py-1.5 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-all cursor-pointer ${
            activeTab === 'map'
              ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Map className="w-4 h-4" />
          <span>แผนที่</span>
        </button>

        {/* Tab 2: Overview */}
        <button
          id="btn-mobile-nav-overview"
          onClick={() => onChangeTab('overview')}
          className={`flex-1 py-1.5 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-all cursor-pointer relative ${
            activeTab === 'overview'
              ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>ภาพรวม</span>
          {isLiveSimulation && activeTab !== 'overview' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1.5 right-3 animate-ping" />
          )}
        </button>

        {/* Tab 3: Buildings List */}
        <button
          id="btn-mobile-nav-buildings"
          onClick={() => onChangeTab('buildings')}
          className={`flex-1 py-1.5 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-all cursor-pointer relative ${
            activeTab === 'buildings'
              ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>ผังอาคาร</span>
          <span className={`text-[8px] font-mono px-1 rounded-full ${
            activeTab === 'buildings' ? 'bg-slate-950/30 text-slate-950' : 'bg-sky-500/20 text-sky-300'
          }`}>
            {buildings.length}
          </span>
        </button>

        {/* Tab 4: Generation Charts */}
        <button
          id="btn-mobile-nav-chart"
          onClick={() => onChangeTab('chart')}
          className={`flex-1 py-1.5 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-all cursor-pointer ${
            activeTab === 'chart'
              ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>กราฟผลิต</span>
        </button>
      </nav>
    </>
  );
};
