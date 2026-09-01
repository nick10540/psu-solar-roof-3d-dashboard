/**
 * Interactive Regional Satellite Map for MEA Solar Roof (5 Regional Sites)
 * Center: Southern Thailand (7.95°N, 99.85°E)
 * Sites: สุราษฎร์ธานี, ภูเก็ต, ตรัง, หาดใหญ่, ปัตตานี
 * - Clean satellite map with all irrelevant POI/place names hidden
 * - Displays ONLY the 5 MEA site pins with Google Earth blue style pins
 * - Each pin displays a live telemetry card:
 *   1. กำลังผลิตปัจจุบัน (kW)
 *   2. พลังงานที่ผลิตได้ทั้งหมด (kWh)
 *   3. กำลังติดตั้งจริง (kWp)
 * - Click pin / card to drill down to the site sub-page (หน้าย่อย)
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  BuildingInfo, 
  BuildingSiteBinding, 
  SolarEdgeTransformedOverview 
} from '../types';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Satellite, 
  Moon, 
  Map as MapIcon, 
  Zap, 
  ChevronRight,
  ExternalLink,
  MapPin,
  Check,
  Globe,
  Sliders
} from 'lucide-react';

interface InteractiveCampusMapProps {
  buildings: BuildingInfo[];
  selectedBuildingId: number | null;
  bindings: Record<number, BuildingSiteBinding>;
  overviews: Record<number, SolarEdgeTransformedOverview>;
  onSelectBuilding: (building: BuildingInfo | null) => void;
  onOpenDetailModal: (building: BuildingInfo) => void;
  onOpenBindingModal: (building: BuildingInfo) => void;
  onNavigateToSubpage?: (building: BuildingInfo) => void;
  onOpenAddModal?: () => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  onUpdateBuildingCoords?: (buildingId: number, lat: number, lng: number) => void;
  onResetBuildingCoords?: (buildingId: number) => void;
}

type MapLayerType = 'satellite' | 'dark' | 'streets';

// Southern Thailand Regional Center (Center between Surat Thani, Phuket, Trang, Hatyai, Pattani)
const REGIONAL_CENTER: [number, number] = [7.95, 99.85];
const DEFAULT_REGIONAL_ZOOM = 7.8;

export const InteractiveCampusMap: React.FC<InteractiveCampusMapProps> = ({
  buildings,
  selectedBuildingId,
  bindings,
  overviews,
  onSelectBuilding,
  onOpenDetailModal,
  onOpenBindingModal,
  onNavigateToSubpage,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // States
  const [activeLayer, setActiveLayer] = useState<MapLayerType>('satellite');
  const [showCardsOnPins, setShowCardsOnPins] = useState<boolean>(true);

  // Active building reference
  const activeBuilding = buildings.find((b) => b.id === selectedBuildingId) || null;
  const activeBinding = activeBuilding ? bindings[activeBuilding.id] : undefined;
  const activeSiteOverview = activeBinding?.siteId ? overviews[activeBinding.siteId] : null;

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create Leaflet Map Instance
    const map = L.map(mapContainerRef.current, {
      center: REGIONAL_CENTER,
      zoom: DEFAULT_REGIONAL_ZOOM,
      minZoom: 6.5,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false,
    });

    // Custom attribution
    L.control.attribution({ position: 'bottomright', prefix: 'MEA Solar Roof 5 Sites' })
      .addAttribution('&copy; Esri World Imagery, SolarEdge Monitoring API')
      .addTo(map);

    // Initial Satellite Tile Layer (Clean Esri World Imagery - NO standard clutter labels)
    const baseTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 18,
        subdomains: ['server', 'services'],
      }
    ).addTo(map);
    tileLayerRef.current = baseTile;

    // Markers Layer Group
    const markersGroup = L.layerGroup().addTo(map);
    markersLayerGroupRef.current = markersGroup;

    // Map click on empty area deselects building
    map.on('click', () => {
      onSelectBuilding(null);
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [onSelectBuilding]);

  // Handle Layer Switching (Clean Satellite vs Dark Carto vs Street)
  const handleLayerChange = (layerType: MapLayerType) => {
    if (!mapInstanceRef.current) return;
    setActiveLayer(layerType);

    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }

    let url = '';
    let attribution = '';

    if (layerType === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = '&copy; Esri World Imagery';
    } else if (layerType === 'dark') {
      url = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
      attribution = '&copy; CARTO dark';
    } else {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap';
    }

    const newTile = L.tileLayer(url, {
      maxZoom: 18,
      attribution,
      subdomains: layerType === 'satellite' ? ['server', 'services'] : ['a', 'b', 'c', 'd'],
    }).addTo(mapInstanceRef.current);

    tileLayerRef.current = newTile;
  };

  // Fly to Regional Bounds
  const handleResetRegionalView = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo(REGIONAL_CENTER, DEFAULT_REGIONAL_ZOOM, {
      duration: 1.2,
      easeLinearity: 0.25,
    });
    onSelectBuilding(null);
  };

  // Fly to specific site
  const handleFlyToSite = (site: BuildingInfo) => {
    if (!mapInstanceRef.current) return;
    onSelectBuilding(site);
    mapInstanceRef.current.flyTo([site.lat, site.lng], 13.5, {
      duration: 1.0,
      easeLinearity: 0.25,
    });
  };

  // Render Regional 5-Site Markers with Telemetry Cards
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerGroupRef.current) return;

    markersLayerGroupRef.current.clearLayers();

    buildings.forEach((site) => {
      const isSelected = selectedBuildingId === site.id;
      const binding = bindings[site.id];
      const overview = binding?.siteId ? overviews[binding.siteId] : null;

      // Extract telemetry values
      const currentPowerKw = overview ? overview.currentPowerKw : site.currentPowerKw;
      const lifetimeEnergyKwh = overview ? overview.lifetimeEnergyKwh : site.lifetimeEnergyKwh;
      const capacityKwp = site.capacityKwp;
      // kWh dashboard-wide: no MWh switch, so this cell never changes scale.
      const lifetimeFormatted = `${Math.round(lifetimeEnergyKwh).toLocaleString()} kWh`;

      // Custom Google Earth 3D Blue Pin & Telemetry Card HTML
      const pinHtml = `
        <div class="relative group cursor-pointer select-none transition-transform duration-300 ${isSelected ? 'scale-105 z-50' : 'hover:scale-105 z-20'}" id="map-pin-site-${site.id}">
          <!-- 1. Google Earth Blue Pin Head & Pulsing Base -->
          <div class="flex flex-col items-center">
            <!-- Telemetry Card attached to pin -->
            <div class="mb-1.5 transition-all duration-300 ${showCardsOnPins ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}">
              <div class="glass-panel px-3 py-2 rounded-xl shadow-2xl border ${isSelected ? 'border-amber-400/90 bg-slate-900/95 ring-2 ring-amber-400/40' : 'border-sky-400/50 bg-slate-950/90 hover:border-sky-300'} text-white min-w-[210px] backdrop-blur-md">
                <!-- Header: Site Name & Code -->
                <div class="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-slate-700/60">
                  <div class="flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-amber-400' : 'bg-emerald-400'} animate-ping"></span>
                    <span class="font-bold text-xs tracking-wide text-amber-300 font-['Prompt',sans-serif]">${site.name}</span>
                  </div>
                  <span class="text-[9px] font-mono text-sky-300 bg-sky-950/80 px-1 py-0.2 rounded border border-sky-600/40">${site.code}</span>
                </div>

                <!-- 3 Required Metrics Grid: กำลังผลิตปัจจุบัน (kW), พลังงานผลิตทั้งหมด (kWh), กำลังติดตั้งจริง (kWp) -->
                <div class="grid grid-cols-3 gap-1.5 text-center text-slate-200 py-0.5">
                  <!-- Metric 1: กำลังผลิตปัจจุบัน (kW) -->
                  <div class="bg-slate-900/80 p-1 rounded-lg border border-sky-500/20">
                    <div class="text-[8px] text-slate-400 leading-tight">กำลังผลิต</div>
                    <div class="font-bold font-mono text-[11px] text-amber-300 flex items-center justify-center gap-0.5 mt-0.5">
                      <span class="text-[9px]">⚡</span>
                      <span>${currentPowerKw.toFixed(1)}</span>
                    </div>
                    <div class="text-[8px] text-slate-400 font-mono">kW</div>
                  </div>

                  <!-- Metric 2: พลังงานทั้งหมด (kWh) -->
                  <div class="bg-slate-900/80 p-1 rounded-lg border border-sky-500/20">
                    <div class="text-[8px] text-slate-400 leading-tight">พลังงานรวม</div>
                    <div class="font-bold font-mono text-[11px] text-emerald-300 mt-0.5">
                      ${lifetimeFormatted}
                    </div>
                    <div class="text-[8px] text-slate-400 font-mono">ทั้งหมด</div>
                  </div>

                  <!-- Metric 3: กำลังติดตั้งจริง (kWp) -->
                  <div class="bg-slate-900/80 p-1 rounded-lg border border-sky-500/20">
                    <div class="text-[8px] text-slate-400 leading-tight">กำลังติดตั้ง</div>
                    <div class="font-bold font-mono text-[11px] text-sky-300 mt-0.5">
                      ${capacityKwp.toFixed(0)}
                    </div>
                    <div class="text-[8px] text-slate-400 font-mono">kWp</div>
                  </div>
                </div>

                <!-- Footer / Action link to Sub-page -->
                <div class="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9px] text-slate-300">
                  <span class="text-sky-300 flex items-center gap-1 font-mono">
                    <span class="w-1.5 h-1.5 rounded-full ${overview ? 'bg-emerald-400' : 'bg-sky-400'}"></span>
                    ${overview ? 'SolarEdge Live' : 'SolarEdge Ready'}
                  </span>
                  <span class="text-amber-300 font-bold flex items-center gap-0.5 hover:underline">
                    ดูหน้าย่อยไซต์ ➔
                  </span>
                </div>
              </div>
            </div>

            <!-- Google Earth Style 3D Blue Pin Icon -->
            <div class="relative flex flex-col items-center">
              <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-700 via-blue-500 to-cyan-300 border-2 border-white shadow-[0_0_15px_rgba(14,165,233,0.8)] flex items-center justify-center text-white text-xs font-bold font-mono">
                <span>${site.id}</span>
              </div>
              <!-- Pin Stem -->
              <div class="w-1 h-3.5 bg-gradient-to-b from-blue-400 to-sky-600 rounded-b"></div>
              <!-- Ground Ripple Base -->
              <div class="w-3.5 h-1.5 rounded-full bg-sky-400/80 blur-[1px] animate-pulse"></div>
            </div>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: pinHtml,
        className: 'leaflet-mea-pin',
        iconSize: [220, 150],
        iconAnchor: [110, 140],
      });

      const marker = L.marker([site.lat, site.lng], { icon: customIcon });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectBuilding(site);
        if (onNavigateToSubpage) {
          onNavigateToSubpage(site);
        }
      });

      markersLayerGroupRef.current?.addLayer(marker);
    });
  }, [buildings, selectedBuildingId, bindings, overviews, showCardsOnPins, onSelectBuilding, onNavigateToSubpage]);

  return (
    <div className="relative w-full h-full min-h-[380px] bg-slate-950 overflow-hidden font-['Prompt',sans-serif]">
      {/* 1. Leaflet Map Container */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* 2. Top-Left Map Controls & Layer Selector */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 pointer-events-auto">
        {/* Layer Switcher Pill */}
        <div className="glass-panel p-1 rounded-xl flex items-center gap-1 shadow-2xl border border-sky-500/30 text-xs backdrop-blur-md">
          <button
            onClick={() => handleLayerChange('satellite')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeLayer === 'satellite'
                ? 'bg-sky-500/40 text-white font-bold border border-sky-400 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="ภาพถ่ายดาวเทียมความละเอียดสูง (Clean Satellite)"
          >
            <Satellite className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px]">ดาวเทียม (Clean)</span>
          </button>

          <button
            onClick={() => handleLayerChange('dark')}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              activeLayer === 'dark'
                ? 'bg-sky-500/40 text-white font-bold border border-sky-400 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
            title="แผนที่ Dark Cyber Mode"
          >
            <Moon className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[11px]">Dark Mode</span>
          </button>
        </div>

        {/* Pin Telemetry Cards Toggle */}
        <button
          onClick={() => setShowCardsOnPins(!showCardsOnPins)}
          className={`glass-panel px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 border transition-all cursor-pointer shadow-lg backdrop-blur-md ${
            showCardsOnPins
              ? 'bg-sky-950/70 border-sky-400/50 text-sky-200'
              : 'bg-slate-900/80 border-slate-700 text-slate-400'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-medium">
            {showCardsOnPins ? 'แสดงการ์ดบนหมุด (เปิด)' : 'ซ่อนการ์ดบนหมุด'}
          </span>
        </button>
      </div>

      {/* 3. Top-Right 5-Site Quick Jump & Reset View Toolbar */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 pointer-events-auto">
        <button
          onClick={handleResetRegionalView}
          className="glass-panel px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 border border-sky-500/30 hover:bg-sky-900/50 text-sky-200 transition-all cursor-pointer shadow-xl backdrop-blur-md"
          title="รีเซ็ตมุมมองแผนที่ภูมิภาคภาคใต้ 5 ไซต์"
        >
          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-medium hidden sm:inline">ภาพรวม 5 ไซต์</span>
        </button>

        {/* Zoom Controls */}
        <div className="glass-panel p-1 rounded-xl flex items-center gap-1 border border-sky-500/30 shadow-xl backdrop-blur-md">
          <button
            onClick={() => mapInstanceRef.current?.zoomIn()}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
            title="ขยายแผนที่ (Zoom In)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => mapInstanceRef.current?.zoomOut()}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
            title="ย่อแผนที่ (Zoom Out)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4. Bottom Information Strip: Clean Map Notice & 5-Site Status */}
      <div className="absolute bottom-3 left-3 z-20 pointer-events-auto hidden md:flex items-center gap-2">
        <div className="glass-panel px-3 py-1.5 rounded-xl text-[11px] text-slate-300 border border-sky-500/20 shadow-xl flex items-center gap-2 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
          <span>แผนที่ดาวเทียมแสดงเฉพาะ <strong>5 ไซต์ MEA Solar Roof</strong> (ปิดชื่อสถานที่อื่นทั้งหมด)</span>
        </div>
      </div>
    </div>
  );
};
