/**
 * Solar3DViewer.tsx
 * Real Satellite Google Earth 3D Mode for MEA Solar Roof (5 Regional Sites)
 *
 * Rewritten for unattended all-day operation on a 72" TV.
 *
 * Stability contract - read before editing:
 *   1. The MapLibre instance is created EXACTLY ONCE per mount. The init effect
 *      must never depend on a prop that changes identity between renders;
 *      callbacks are reached through `handlersRef` instead. A single unstable
 *      dependency here destroys and rebuilds the whole map (and its WebGL
 *      context and tile cache) on every parent render.
 *   2. Basemap switching toggles layer visibility. setStyle() is never called,
 *      so already-downloaded tiles survive a switch.
 *   3. Markers are created once per building id and then PATCHED in place.
 *      They are never torn down and re-created on a data tick.
 *   4. Every timer, rAF, DOM listener and map listener registered here is
 *      released in the matching cleanup.
 *
 * Sites:
 * 1. สุราษฎร์ธานี (Surat Thani) - 320 kWp
 * 2. ภูเก็ต (Phuket) - 450 kWp
 * 3. ตรัง (Trang) - 250 kWp
 * 4. หาดใหญ่ (Hatyai) - 380 kWp
 * 5. ปัตตานี (Pattani) - 200 kWp
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BuildingInfo } from '../types';
import { RegionalTotalsPanel } from './RegionalTotalsPanel';
import { ResolvedSiteMetrics, RegionalTotals, emptySiteMetrics } from '../services/siteMetricsService';
import { NO_DATA } from './metricDisplay';
import { animateNumberText } from '../utils/animateNumber';
import {
  buildUnifiedMapStyle,
  LAYER_VISIBILITY,
  SatelliteLayerStyle,
  REGIONAL_CENTER,
  MAP_MAX_BOUNDS,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_PITCH,
  MAX_PITCH,
  DEFAULT_BEARING,
  ORBIT_DEG_PER_SEC,
  CAMERA_BADGE_THROTTLE_MS,
  CAMERA_SAVE_DEBOUNCE_MS,
  CAMERA_SAVE_MAX_WAIT_MS,
  SITE_LINK_SPEC,
} from '../config/mapConfig';
import {
  buildSiteLinkFeature,
  easeOutCubic,
  siteLinkFlowGradient,
  siteLinkGradient,
} from '../services/siteLinkService';
import { hasIntroFinished, subscribeIntroFinished } from '../services/introHandoff';
import {
  MapCameraState,
  loadMapCamera,
  normaliseCamera,
  saveMapCamera,
} from '../services/mapCameraService';
import {
  MARKER_FONT_SIZES,
  MARKER_CARD,
  markerScaleFor,
  markerCardOffsetFor,
  markerMediaHeightFor,
} from '../config/markerTypography';
import { resolveSiteMediaPlaylist, resolveSiteMediaSpeed } from '../config/siteMedia';
import {
  RotateCcw,
  Satellite,
  Layers,
  Sliders,
  ZoomIn,
  ZoomOut,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  MapPinPlus,
  Trash2,
} from 'lucide-react';

interface Solar3DViewerProps {
  buildings: BuildingInfo[];
  selectedBuildingId: number | null;
  /** Per-pin resolved figures. Already encodes what each site may display. */
  siteMetrics: ResolvedSiteMetrics[];
  /** Aggregated totals, shown in the bottom-right summary panel. */
  totals: RegionalTotals;
  onSelectBuilding: (building: BuildingInfo | null) => void;
  onOpenDetailModal?: (building: BuildingInfo) => void;
  onOpenBindingModal?: (building: BuildingInfo) => void;
  onNavigateToSubpage?: (building: BuildingInfo) => void;
  onOpenAddModal?: () => void;
  onOpenDeleteDialog?: (building: BuildingInfo) => void;
  /** Show the add/delete site tools. Off during a ceremony so no stray tap can delete a pin. */
  showSiteEditTools?: boolean;
  timeOfDayHour?: number;
  onTimeOfDayChange?: (hour: number) => void;
}

/** Live handles into a marker's DOM so values can be patched without re-rendering it. */
interface MarkerHandle {
  marker: maplibregl.Marker;
  root: HTMLDivElement;
  inner: HTMLElement;
  cardWrap: HTMLElement;
  card: HTMLElement;
  headerDot: HTMLElement;
  nameEl: HTMLElement;
  codeEl: HTMLElement;
  powerEl: HTMLElement;
  energyValEl: HTMLElement;
  energyUnitEl: HTMLElement;
  capacityEl: HTMLElement;
  co2ValEl: HTMLElement;
  co2UnitEl: HTMLElement;
  statusDot: HTMLElement;
  statusText: HTMLElement;
  pinIdEl: HTMLElement;
  /**
   * The site's clip, when it has one - whichever is currently up for a site
   * with a playlist. Play/pause is governed by the visibility effect below.
   */
  videoEl: HTMLVideoElement | null;
  lng: number;
  lat: number;
  onClick: (e: MouseEvent) => void;
}

/**
 * `overflow-hidden` + no padding: the media banner is full-bleed to the card's
 * rounded corners, so the padding moved inward onto the content wrapper.
 */
const CARD_BASE =
  'glass-panel-static w-full rounded-xl shadow-2xl border text-white cursor-pointer transition-colors duration-200 overflow-hidden';
const CARD_SELECTED = 'border-amber-400/90 bg-slate-900/95 ring-2 ring-amber-400/50';
const CARD_IDLE = 'border-sky-400/60 bg-slate-950/90 hover:border-sky-300';

/**
 * CO2 for the per-site card.
 *
 * tonCO₂e everywhere, including for the small sites where SolarEdge itself
 * still prints kilograms. One unit across every surface was the explicit
 * ask: a card reading kg beside one reading ton invites the two to be
 * compared as if they were the same scale.
 */
function formatCo2(kg: number): { value: string; unit: string } {
  return { value: (kg / 1000).toFixed(2), unit: 'tonCO₂e' };
}

/** Accumulated energy. kWh everywhere - the dashboard never switches to MWh. */
function formatLifetime(kwh: number): { value: string; unit: string } {
  return { value: Math.round(kwh).toLocaleString(), unit: 'kWh' };
}

/**
 * Builds the marker DOM once. `data-mea` attributes mark the nodes that later
 * get patched, so the expensive innerHTML parse happens a single time per site.
 */
function createMarkerElement(site: BuildingInfo): {
  el: HTMLDivElement;
  refs: Omit<MarkerHandle, 'marker' | 'lng' | 'lat' | 'onClick' | 'root'>;
} {
  const el = document.createElement('div');
  el.className = 'maplibre-mea-marker select-none';
  // One campus is drawn larger than the rest; every other card is pinned to
  // the same width so they read as a uniform set. Scaling the fonts as well
  // as the box is what makes the featured card actually look bigger rather
  // than just roomier.
  const scale = markerScaleFor(site.code);
  const s = (px: number): number => Math.round(px * scale);

  // Nudge applied to the card only; the pin itself stays on its true
  // coordinate, so the map never lies about where a site is.
  const offset = markerCardOffsetFor(site.code);
  const cardShift =
    offset.dx === 0 && offset.dy === 0
      ? ''
      : `transform:translate(${offset.dx}px,${offset.dy}px);`;

  // The tail below the card is its pointer at the pin, and it sits inside the
  // wrapper being nudged - so ปัตตานี's dx of 96 carried it 96px right of the
  // pin it belongs to, leaving it aimed at open sea. Undoing the x nudge puts
  // it back on the pin's axis while it stays butted to the card's bottom edge.
  //
  // dy is deliberately left alone: the tail has to stay against the card, and a
  // lifted card's tail still points straight down its pin's axis - just from
  // higher up. Cancelling dy too would strand the tail in the gap between them.
  const tailShift = offset.dx === 0 ? '' : `transform:translateX(${-offset.dx}px);`;

  el.style.width = `${s(MARKER_CARD.widthPx)}px`;
  el.style.transform = 'translate(-50%, -100%)';
  el.id = `maplibre-marker-site-${site.id}`;

  // Banner is omitted entirely when the site has no file, rather than left as
  // an empty box. Nothing here interpolates site-supplied text - names reach
  // the DOM through textContent in patchMarker - so this stays injection-safe.
  //
  // A site with several clips starts on the first and is stepped through the
  // rest below; a single clip keeps the cheaper native `loop`.
  const playlist = resolveSiteMediaPlaylist(site.code);
  const first = playlist[0] ?? null;
  const loopAttr = playlist.length > 1 ? '' : ' loop';
  const mediaHtml = first
    ? `<div data-mea="mediaWrap" class="relative w-full bg-slate-900 overflow-hidden border-b border-sky-500/25" style="height:${s(markerMediaHeightFor(site.code))}px">
         ${
           first.kind === 'video'
             ? `<video data-mea="mediaEl" class="w-full h-full object-cover" src="${first.url}" autoplay${loopAttr} muted playsinline preload="metadata"></video>`
             : `<img data-mea="mediaEl" class="w-full h-full object-cover" src="${first.url}" alt="" draggable="false" />`
         }
         <!-- Keeps the header below readable against a bright frame. -->
         <div class="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-950/90 to-transparent pointer-events-none"></div>
       </div>`
    : '';

  el.innerHTML = `
    <div data-mea="inner" class="relative flex flex-col items-center group">
      <!-- 1. Floating 3D Telemetry HUD Card -->
      <div data-mea="cardWrap" class="mb-1 w-full" style="pointer-events:auto;${cardShift}">
        <div data-mea="card" class="${CARD_BASE} ${CARD_IDLE}">
          <!-- Site photo / looping clip -->
          ${mediaHtml}

          <div class="px-3 py-2.5">
            <!-- Header: Site Name & Code -->
            <div class="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-slate-700/60">
              <div class="flex items-center gap-1.5">
                <span data-mea="headerDot" class="w-2 h-2 rounded-full bg-sky-400 mea-live-dot"></span>
                <span data-mea="name" class="font-bold tracking-wide text-amber-300 font-['Prompt',sans-serif]" style="font-size:${s(MARKER_FONT_SIZES.title)}px"></span>
              </div>
              <span data-mea="code" class="hidden font-mono text-sky-300 bg-sky-950/90 px-1.5 py-0.5 rounded border border-sky-600/40 font-bold" style="font-size:${s(MARKER_FONT_SIZES.code)}px"></span>
            </div>

            <!-- 3 Metrics Grid -->
            <div class="grid grid-cols-3 gap-1.5 text-center text-slate-200 py-1">
              <div class="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20 flex flex-col items-center justify-center">
                <div class="text-slate-400 leading-none mb-1 font-medium" style="font-size:${s(MARKER_FONT_SIZES.metricLabel)}px">กำลังผลิต</div>
                <div class="font-bold font-mono text-amber-300 flex items-baseline justify-center gap-0.5 whitespace-nowrap" style="font-size:${s(MARKER_FONT_SIZES.metricValue)}px">
                  <span data-mea="power">0.0</span>
                  <span class="text-amber-400/80 font-normal" style="font-size:${s(MARKER_FONT_SIZES.metricUnit)}px">kW</span>
                </div>
              </div>

              <div class="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20 flex flex-col items-center justify-center">
                <div class="text-slate-400 leading-none mb-1 font-medium" style="font-size:${s(MARKER_FONT_SIZES.metricLabel)}px">พลังงานรวม</div>
                <div class="font-bold font-mono text-emerald-300 flex items-baseline justify-center gap-0.5 whitespace-nowrap" style="font-size:${s(MARKER_FONT_SIZES.metricValue)}px">
                  <span data-mea="energyVal">0</span>
                  <span data-mea="energyUnit" class="text-emerald-400/80 font-normal" style="font-size:${s(MARKER_FONT_SIZES.metricUnit)}px">kWh</span>
                </div>
              </div>

              <div class="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20 flex flex-col items-center justify-center">
                <div class="text-slate-400 leading-none mb-1 font-medium" style="font-size:${s(MARKER_FONT_SIZES.metricLabel)}px">กำลังติดตั้ง</div>
                <div class="font-bold font-mono text-sky-300 flex items-baseline justify-center gap-0.5 whitespace-nowrap" style="font-size:${s(MARKER_FONT_SIZES.metricValue)}px">
                  <span data-mea="capacity">0</span>
                  <span class="text-sky-400/80 font-normal" style="font-size:${s(MARKER_FONT_SIZES.metricUnit)}px">kWp</span>
                </div>
              </div>

              <!--
                Real CO2 from SolarEdge, spanning the full row.
                A fourth column would squeeze the three cells the 72" panel was
                signed off on (see MARKER_CARD.widthPx) and clip their numbers,
                so this takes its own row instead.
              -->
              <div class="col-span-3 bg-slate-900/90 py-1.5 px-2 rounded-lg border border-teal-500/25 flex items-center justify-center gap-2">
                <div class="text-slate-400 leading-none font-medium" style="font-size:${s(MARKER_FONT_SIZES.metricLabel)}px">ลดการปล่อย CO₂</div>
                <div class="font-bold font-mono text-teal-300 flex items-baseline justify-center gap-0.5 whitespace-nowrap" style="font-size:${s(MARKER_FONT_SIZES.metricValue)}px">
                  <span data-mea="co2Val">0.0</span>
                  <span data-mea="co2Unit" class="text-teal-400/80 font-normal" style="font-size:${s(MARKER_FONT_SIZES.metricUnit)}px">tonCO₂e</span>
                </div>
              </div>
            </div>

            <!-- Action Link to Sub-page -->
            <div class="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-slate-300" style="font-size:${s(MARKER_FONT_SIZES.statusRow)}px">
              <span class="text-sky-300 flex items-center gap-1 font-mono" style="font-size:${s(MARKER_FONT_SIZES.statusText)}px">
                <span data-mea="statusDot" class="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                <span data-mea="statusText">เชื่อมต่อระบบแล้ว</span>
              </span>
              <span class="text-amber-300 font-bold flex items-center gap-0.5 hover:underline" style="font-size:${s(MARKER_FONT_SIZES.actionLink)}px">
                ดูหน้าย่อยไซต์ ➔
              </span>
            </div>
          </div>
        </div>
        <div data-mea="tail" class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-sky-400/80 mx-auto -mt-[1px]" style="${tailShift}"></div>
      </div>

      <!-- 2. Google Earth Style 3D Blue Pin -->
      <div class="relative flex flex-col items-center cursor-pointer">
        <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-700 via-blue-500 to-cyan-300 border-2 border-white shadow-[0_0_15px_rgba(14,165,233,0.9)] flex items-center justify-center text-white font-bold font-mono" style="font-size:${s(MARKER_FONT_SIZES.pinNumber)}px">
          <span data-mea="pinId"></span>
        </div>
        <div class="w-1 h-4 bg-gradient-to-b from-blue-300 via-sky-500 to-sky-700 shadow-sm"></div>
        <div class="w-4 h-2 rounded-full bg-sky-400/80 mea-ground-ring"></div>
      </div>
    </div>
  `;

  const pick = (key: string): HTMLElement =>
    el.querySelector<HTMLElement>(`[data-mea="${key}"]`) as HTMLElement;

  const mediaEl = el.querySelector<HTMLElement>('[data-mea="mediaEl"]');
  const videoEl = mediaEl instanceof HTMLVideoElement ? mediaEl : null;
  // Browsers only grant autoplay to muted video, and the `muted` attribute is
  // unreliable on a node parsed out of innerHTML - set the property as well.
  if (videoEl) videoEl.muted = true;

  // Per-site playback speed. `defaultPlaybackRate` is the one that carries:
  // `advance` below hands over by assigning `src`, which reruns the load
  // algorithm and resets `playbackRate` to it - set only `playbackRate` and
  // clip one runs fast while the rest of the list drops back to 1x.
  if (videoEl) {
    const speed = resolveSiteMediaSpeed(site.code);
    videoEl.defaultPlaybackRate = speed;
    videoEl.playbackRate = speed;
  }

  const dropBanner = () => el.querySelector('[data-mea="mediaWrap"]')?.remove();

  if (videoEl && playlist.length > 1) {
    // Each clip hands over to the next as it ends, and the last hands back to
    // the first. Both listeners sit on a node that is discarded along with the
    // marker, so there is nothing to unregister in the teardown.
    let index = 0;
    let failuresInARow = 0;

    const advance = () => {
      index = (index + 1) % playlist.length;
      // Assigning `src` is the whole handover - it restarts the element's load
      // algorithm on the new file. No `load()` call here: that queues a second
      // run of the algorithm, which lands after this `play()` and pauses the
      // element again, leaving the next clip loaded but frozen on frame one.
      videoEl.src = playlist[index].url;
      // The element spent its autoplay permission on the first clip, so every
      // clip after it has to be started by hand. Rejected when the browser
      // withholds playback; the governor below picks the clip up again once the
      // cards are back on screen.
      void videoEl.play().catch(() => {});
    };

    videoEl.addEventListener('ended', () => {
      failuresInARow = 0;
      advance();
    });

    // One undecodable file steps aside for the next instead of taking the whole
    // banner down with it. The banner only goes when nothing in the list plays.
    videoEl.addEventListener('error', () => {
      failuresInARow += 1;
      if (failuresInARow >= playlist.length) dropBanner();
      else advance();
    });
  } else if (mediaEl) {
    // A missing or undecodable file drops the whole banner rather than leaving
    // a black rectangle above the numbers. `once` + a node that is discarded
    // with the marker means there is nothing to unregister in the teardown.
    mediaEl.addEventListener('error', dropBanner, { once: true });
  }

  return {
    el,
    refs: {
      inner: pick('inner'),
      cardWrap: pick('cardWrap'),
      card: pick('card'),
      headerDot: pick('headerDot'),
      nameEl: pick('name'),
      codeEl: pick('code'),
      powerEl: pick('power'),
      energyValEl: pick('energyVal'),
      energyUnitEl: pick('energyUnit'),
      capacityEl: pick('capacity'),
      co2ValEl: pick('co2Val'),
      co2UnitEl: pick('co2Unit'),
      statusDot: pick('statusDot'),
      statusText: pick('statusText'),
      pinIdEl: pick('pinId'),
      videoEl,
    },
  };
}

/**
 * Writes current values into an existing marker. Text nodes only - no re-parse,
 * no layout storm.
 *
 * `metrics` already encodes what this pin is permitted to show; a `null` field
 * means "no data" and is rendered as an em-dash. The marker never reaches for a
 * fallback of its own - that habit is what let seeded demo numbers appear while
 * the dashboard was claiming to be on the live API.
 */
function patchMarker(
  handle: MarkerHandle,
  site: BuildingInfo,
  isSelected: boolean,
  showCards: boolean,
  metrics: ResolvedSiteMetrics
): void {
  const hasData = metrics.hasData;
  const lifetime =
    metrics.lifetimeEnergyKwh === null
      ? { value: NO_DATA, unit: '' }
      : formatLifetime(metrics.lifetimeEnergyKwh);

  const nextName = site.name;
  if (handle.nameEl.textContent !== nextName) handle.nameEl.textContent = nextName;
  if (handle.codeEl.textContent !== site.code) handle.codeEl.textContent = site.code;

  const pinId = String(site.id);
  if (handle.pinIdEl.textContent !== pinId) handle.pinIdEl.textContent = pinId;

  // Figures glide to their new reading instead of snapping. These nodes are
  // plain DOM (the card is built once with innerHTML), so the same easing the
  // React cards get arrives through animateNumberText rather than <CountUp>.
  // Units are set outright: 'kWh' has nothing to travel between.
  animateNumberText(handle.powerEl, metrics.currentPowerKw, {
    decimals: 1,
    placeholder: NO_DATA,
  });

  animateNumberText(handle.energyValEl, metrics.lifetimeEnergyKwh, {
    decimals: 0,
    placeholder: NO_DATA,
  });
  if (handle.energyUnitEl.textContent !== lifetime.unit) handle.energyUnitEl.textContent = lifetime.unit;

  animateNumberText(handle.capacityEl, metrics.capacityKwp, {
    decimals: 0,
    placeholder: NO_DATA,
  });

  const co2 =
    metrics.co2Kg === null ? { value: NO_DATA, unit: '' } : formatCo2(metrics.co2Kg);
  // Card prints tonCO₂e while the metric carries kg - convert before easing, or
  // the tween runs across a thousand-fold gap on the way to the same figure.
  animateNumberText(handle.co2ValEl, metrics.co2Kg === null ? null : metrics.co2Kg / 1000, {
    decimals: 2,
    placeholder: NO_DATA,
  });
  if (handle.co2UnitEl.textContent !== co2.unit) handle.co2UnitEl.textContent = co2.unit;


  // The no-data modifier has to be part of this string: the card's className is
  // assigned wholesale below, so anything added via classList would be wiped.
  const nextCard = [
    CARD_BASE,
    isSelected ? CARD_SELECTED : CARD_IDLE,
    hasData ? '' : 'mea-marker-nodata',
  ]
    .filter(Boolean)
    .join(' ');
  if (handle.card.className !== nextCard) handle.card.className = nextCard;

  const nextInner = `relative flex flex-col items-center group transition-transform duration-300 ${
    isSelected ? 'scale-105 z-50' : 'hover:scale-105 z-20'
  }`;
  if (handle.inner.className !== nextInner) handle.inner.className = nextInner;

  // w-full belongs in this string: the className is assigned wholesale just
  // below, so a width class set only in the initial markup is wiped on the
  // first patch and every card silently shrinks back to its own content.
  const nextWrap = `mb-1 w-full transition-opacity duration-300 ${
    showCards ? 'opacity-100' : 'opacity-0 pointer-events-none'
  }`;
  if (handle.cardWrap.className !== nextWrap) handle.cardWrap.className = nextWrap;

  const nextHeaderDot = `w-2 h-2 rounded-full mea-live-dot ${isSelected ? 'bg-amber-400' : 'bg-sky-400'}`;
  if (handle.headerDot.className !== nextHeaderDot) handle.headerDot.className = nextHeaderDot;

  // Status line states exactly where the numbers came from.
  const statusTone =
    metrics.source === 'live'
      ? 'bg-emerald-400'
      : metrics.source === 'mock'
        ? 'bg-amber-400'
        : 'bg-slate-600';
  const nextStatusDot = `w-1.5 h-1.5 rounded-full ${statusTone}`;
  if (handle.statusDot.className !== nextStatusDot) handle.statusDot.className = nextStatusDot;

  const nextStatusText =
    metrics.source === 'live'
      ? 'เชื่อมต่อระบบแล้ว'
      : metrics.source === 'mock'
        ? 'Mock Simulator'
        : metrics.isBound
          ? 'ไม่มีข้อมูลจาก API'
          : 'ยังไม่ได้ผูก API';
  if (handle.statusText.textContent !== nextStatusText) handle.statusText.textContent = nextStatusText;

  if (handle.lng !== site.lng || handle.lat !== site.lat) {
    handle.marker.setLngLat([site.lng, site.lat]);
    handle.lng = site.lng;
    handle.lat = site.lat;
  }
}

const Solar3DViewerImpl: React.FC<Solar3DViewerProps> = ({
  buildings,
  selectedBuildingId,
  siteMetrics,
  totals,
  onSelectBuilding,
  onNavigateToSubpage,
  onOpenAddModal,
  onOpenDeleteDialog,
  showSiteEditTools = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<number, MarkerHandle>>(new Map());

  const orbitRafRef = useRef<number | null>(null);
  const cameraRafRef = useRef<number | null>(null);
  const lastBadgeSyncRef = useRef<number>(0);
  const isMovingRef = useRef<boolean>(false);
  const errorLogCountRef = useRef<number>(0);

  // --- Camera persistence bookkeeping (see mapCameraService) ---
  /** Pending debounced write, so teardown can flush instead of dropping it. */
  const cameraSaveTimerRef = useRef<number | null>(null);
  /**
   * Last camera actually written. A fresh reading equal to this one is not
   * written again, which is what keeps an idle orbiting board - `moveend`
   * every frame, nothing meaningful changing - from touching storage at all.
   */
  const lastSavedCameraRef = useRef<MapCameraState | null>(null);
  /**
   * Auto-orbit state, mirrored for the init effect, whose dependency list has
   * to stay `[remountKey]` (see the handlers box above for why).
   */
  const isAutoOrbitRef = useRef<boolean>(false);

  /**
   * Latest-callback box. Prop identities change on every parent render; reading
   * them through a ref keeps the init effect's dependency list empty.
   */
  const handlersRef = useRef({ onSelectBuilding, onNavigateToSubpage, onOpenAddModal, onOpenDeleteDialog });
  useEffect(() => {
    handlersRef.current = { onSelectBuilding, onNavigateToSubpage, onOpenAddModal, onOpenDeleteDialog };
  }, [onSelectBuilding, onNavigateToSubpage, onOpenAddModal, onOpenDeleteDialog]);

  // States
  const [activeLayer, setActiveLayer] = useState<SatelliteLayerStyle>('esri-satellite');
  const [showPinCards, setShowPinCards] = useState<boolean>(true);

  /** Control drawer held open by its grab handle, for pointers that cannot hover. */
  const [isControlsPinned, setIsControlsPinned] = useState<boolean>(false);
  const [isAutoOrbit, setIsAutoOrbit] = useState<boolean>(false);
  /**
   * Seeded from the saved camera, not from the defaults: the badges are
   * rendered before the map's first `moveend` has a chance to sync them, and a
   * restored board that reads "60° / 17°" over a view that is nothing of the
   * kind is worse than no badge at all.
   */
  const [camera, setCamera] = useState<{ pitch: number; bearing: number }>(() => {
    const saved = loadMapCamera();
    return {
      pitch: saved?.pitch ?? DEFAULT_PITCH,
      bearing: saved?.bearing ?? DEFAULT_BEARING,
    };
  });
  /** True as soon as the Map object exists. Markers only need this. */
  const [isMapCreated, setIsMapCreated] = useState<boolean>(false);
  /** True after the style has loaded. Only layer operations need this. */
  const [isStyleReady, setIsStyleReady] = useState<boolean>(false);
  const [glLost, setGlLost] = useState<boolean>(false);
  /** Bumping this rebuilds the map - the recovery path after an unrecoverable WebGL loss. */
  const [remountKey, setRemountKey] = useState<number>(0);

  // -------------------------------------------------------------------------
  // Map lifecycle - runs once per remountKey and NEVER on a data tick
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    /**
     * Where the board was last left pointing, or null for a first run.
     *
     * Read here rather than from a value captured at mount, so the rebuild
     * after a WebGL context loss comes back to the framing the old map was
     * destroyed on - the teardown below flushes it on the way out.
     */
    const restored = loadMapCamera();
    lastSavedCameraRef.current = restored;

    const map = new maplibregl.Map({
      container,
      style: buildUnifiedMapStyle(),
      // Constructor options, deliberately not a `jumpTo` after load: the map
      // requests the right tiles from the start, and the audience never sees
      // it open on the wide shot and then snap somewhere else.
      center: restored?.center ?? REGIONAL_CENTER,
      zoom: restored?.zoom ?? DEFAULT_ZOOM,
      pitch: restored?.pitch ?? DEFAULT_PITCH,
      bearing: restored?.bearing ?? DEFAULT_BEARING,

      // --- Tile-request envelope: Southern Thailand only ---
      maxBounds: MAP_MAX_BOUNDS,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      minPitch: 0,
      maxPitch: MAX_PITCH,
      renderWorldCopies: false,

      // --- Request-volume controls (the "hundreds of requests" fix) ---
      // Do not re-download tiles when their HTTP cache entry expires. Satellite
      // imagery is static for the length of an event; revalidation is pure noise.
      refreshExpiredTiles: false,
      // Hold far more tiles in memory than the default so pan/zoom/rotate
      // revisits are served from RAM instead of the network.
      maxTileCacheSize: 1500,
      maxTileCacheZoomLevels: 12,
      // Cross-fading forces continuous repaints while tiles settle.
      fadeDuration: 0,
      collectResourceTiming: false,

      attributionControl: false,
      dragRotate: true,
      touchPitch: true,
      pitchWithRotate: true,
    } as maplibregl.MapOptions);

    mapRef.current = map;

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'MEA Solar Roof 5 Sites • Esri World Imagery 3D Real Satellite',
      }),
      'bottom-right'
    );

    // --- Camera badge sync: rAF-coalesced AND time-throttled ---------------
    // The raw rotate/pitch events fire once per frame. Feeding those straight
    // into setState re-rendered this component 60x/sec during every drag,
    // which is what made panning feel like it was seizing up.
    const syncCameraBadges = () => {
      if (cameraRafRef.current !== null) return;
      cameraRafRef.current = requestAnimationFrame(() => {
        cameraRafRef.current = null;
        const m = mapRef.current;
        if (!m) return;

        const now = performance.now();
        if (now - lastBadgeSyncRef.current < CAMERA_BADGE_THROTTLE_MS) return;
        lastBadgeSyncRef.current = now;

        const bearing = Math.round(m.getBearing());
        const pitch = Math.round(m.getPitch());
        setCamera((prev) =>
          prev.bearing === bearing && prev.pitch === pitch ? prev : { bearing, pitch }
        );
      });
    };

    // --- Camera persistence -----------------------------------------------
    /**
     * Write the camera, but only if it is not what was written last.
     *
     * The bearing is left out of that comparison while auto-orbit is running.
     * Orbit rewrites it every frame, so counting it would have an untouched
     * board writing to storage several times a second all day - and a bearing
     * nobody chose is not state worth persisting. A pan or a zoom during an
     * orbit still checkpoints, carrying whatever bearing the orbit is on.
     */
    const checkpointCamera = () => {
      const c = map.getCenter();
      const next = normaliseCamera({
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
      const prev = lastSavedCameraRef.current;

      const moved =
        !prev ||
        prev.center[0] !== next.center[0] ||
        prev.center[1] !== next.center[1] ||
        prev.zoom !== next.zoom ||
        prev.pitch !== next.pitch ||
        (!isAutoOrbitRef.current && prev.bearing !== next.bearing);

      if (!moved) return;
      lastSavedCameraRef.current = next;
      saveMapCamera(next);
    };

    /** How long a write has been waiting, for the max-wait ceiling below. */
    let checkpointPendingSince = 0;

    const runCheckpoint = () => {
      if (cameraSaveTimerRef.current !== null) {
        window.clearTimeout(cameraSaveTimerRef.current);
        cameraSaveTimerRef.current = null;
      }
      checkpointPendingSince = 0;
      checkpointCamera();
    };

    const scheduleCheckpoint = () => {
      const now = performance.now();
      if (checkpointPendingSince === 0) {
        checkpointPendingSince = now;
      } else if (now - checkpointPendingSince >= CAMERA_SAVE_MAX_WAIT_MS) {
        // Movement has not stopped coming for long enough that waiting for
        // quiet is no longer a plan. See CAMERA_SAVE_MAX_WAIT_MS.
        runCheckpoint();
        return;
      }

      if (cameraSaveTimerRef.current !== null) {
        window.clearTimeout(cameraSaveTimerRef.current);
      }
      cameraSaveTimerRef.current = window.setTimeout(runCheckpoint, CAMERA_SAVE_DEBOUNCE_MS);
    };

    // --- Interaction class: drop blur + animations while the camera moves ---
    const handleMoveStart = () => {
      isMovingRef.current = true;
      container.classList.add('map-interacting');
    };
    const handleMoveEnd = () => {
      isMovingRef.current = false;
      container.classList.remove('map-interacting');
      lastBadgeSyncRef.current = 0; // force one final accurate sync
      syncCameraBadges();
      scheduleCheckpoint();
    };

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const target = e.originalEvent?.target as HTMLElement | null;
      if (target && target.closest('.maplibre-mea-marker')) return;
      handlersRef.current.onSelectBuilding(null);
    };

    // Tile 404s at the edge of the bounds are expected; cap the log so a
    // 10-hour session cannot fill the console (which itself retains memory).
    const handleError = (e: maplibregl.ErrorEvent) => {
      if (errorLogCountRef.current >= 20) return;
      errorLogCountRef.current += 1;
      console.warn('[map] ' + (e.error?.message ?? 'unknown map error'));
      if (errorLogCountRef.current === 20) {
        console.warn('[map] Further map errors suppressed for this session.');
      }
    };

    const handleLoad = () => setIsStyleReady(true);

    map.on('rotate', syncCameraBadges);
    map.on('pitch', syncCameraBadges);
    map.on('movestart', handleMoveStart);
    map.on('moveend', handleMoveEnd);
    map.on('click', handleClick);
    map.on('error', handleError);
    map.on('load', handleLoad);

    // --- WebGL context loss: the classic long-uptime kiosk failure ---------
    const canvas = map.getCanvas();
    let restoreTimer: number | null = null;

    const handleContextLost = (event: Event) => {
      event.preventDefault(); // required, or the browser will not try to restore
      setGlLost(true);
      console.warn('[map] WebGL context lost - waiting for restore.');
      restoreTimer = window.setTimeout(() => {
        console.warn('[map] WebGL context did not return - rebuilding the map.');
        setRemountKey((k) => k + 1);
      }, 6000);
    };

    const handleContextRestored = () => {
      if (restoreTimer !== null) {
        window.clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      setGlLost(false);
      mapRef.current?.triggerRepaint();
      console.info('[map] WebGL context restored.');
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    // Markers are plain DOM overlays — they do not need the style, or even a
    // rendered frame. Gating them on 'load' meant that anything delaying the
    // first paint (a hidden window, a slow tile server, a stalled GPU) also
    // hid all five site pins. Signal readiness as soon as the Map exists.
    setIsMapCreated(true);
    if (map.isStyleLoaded()) setIsStyleReady(true);

    // Dev-only console handle. Useful when checking the real 72" screen:
    //   __meaMap.getPitch()  /  __meaMap.getBearing()  /  __meaMap.getStyle().sky
    if (import.meta.env.DEV) {
      (window as unknown as { __meaMap?: maplibregl.Map }).__meaMap = map;
    }

    // --- Teardown: everything above must be released -----------------------
    return () => {
      // Flush first, while the map is still readable. This is what carries the
      // framing across a WebGL rebuild, and what stops a reload landing inside
      // the debounce window from losing the operator's last move.
      runCheckpoint();

      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      if (cameraRafRef.current !== null) {
        cancelAnimationFrame(cameraRafRef.current);
        cameraRafRef.current = null;
      }
      if (orbitRafRef.current !== null) {
        cancelAnimationFrame(orbitRafRef.current);
        orbitRafRef.current = null;
      }

      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);

      map.off('rotate', syncCameraBadges);
      map.off('pitch', syncCameraBadges);
      map.off('movestart', handleMoveStart);
      map.off('moveend', handleMoveEnd);
      map.off('click', handleClick);
      map.off('error', handleError);
      map.off('load', handleLoad);

      markersRef.current.forEach((handle) => {
        handle.root.removeEventListener('click', handle.onClick);
        handle.marker.remove();
      });
      markersRef.current.clear();

      map.remove(); // releases the WebGL context, workers and tile cache
      mapRef.current = null;
      setIsMapCreated(false);
      setIsStyleReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remountKey]);

  // -------------------------------------------------------------------------
  // Basemap switching - visibility toggle, no setStyle(), no tile refetch
  // -------------------------------------------------------------------------
  const applyLayerVisibility = useCallback((layer: SatelliteLayerStyle) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const visibility = LAYER_VISIBILITY[layer];
    Object.entries(visibility).forEach(([layerId, value]) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', value);
      }
    });
  }, []);

  const handleLayerChange = useCallback(
    (layer: SatelliteLayerStyle) => {
      setActiveLayer(layer);
      applyLayerVisibility(layer);
    },
    [applyLayerVisibility]
  );

  // Re-apply once the style finishes loading (covers a click made during startup).
  useEffect(() => {
    if (!isStyleReady) return;
    applyLayerVisibility(activeLayer);
  }, [isStyleReady, activeLayer, applyLayerVisibility]);

  // -------------------------------------------------------------------------
  // Site link line
  //
  // One arc through all five pins, drawn on once as the intro hands the screen
  // over, then left standing for the rest of the event. The geometry and the
  // reveal gradient live in siteLinkService; this owns the source, the layers
  // and the single animation frame loop.
  // -------------------------------------------------------------------------
  /** Set by the intro overlay; already true when there was no intro to play. */
  const [introFinished, setIntroFinished] = useState<boolean>(hasIntroFinished);
  useEffect(() => subscribeIntroFinished(() => setIntroFinished(true)), []);

  /**
   * Which pins the line runs through, as a string.
   *
   * `buildings` is NOT stable across ticks - the live simulator advances every
   * site's power and energy with `setBuildings(prev => prev.map(...))`, so the
   * array gets a fresh identity several times a minute. Memoising the geometry
   * on that identity re-uploaded a 113-point line on every tick, and - far
   * worse - re-ran the reveal effect below, which restarted the draw from zero
   * before it could ever finish. Only a pin being added, removed or moved is
   * a change this line cares about.
   */
  const siteLinkKey = buildings.map((b) => `${b.id}:${b.lng},${b.lat}`).join('|');

  const siteLinkFeature = useMemo(
    () => buildSiteLinkFeature(buildings.map((b) => ({ lng: b.lng, lat: b.lat }))),
    // `buildings` is read here but deliberately not a dependency; `siteLinkKey`
    // is the part of it this geometry depends on. See above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteLinkKey]
  );

  const linkDrawRafRef = useRef<number | null>(null);
  /** The held state. Once drawn, the line is never redrawn from zero. */
  const linkDrawnRef = useRef<boolean>(false);
  /**
   * True once the source and both layers exist.
   *
   * The reveal waits on this rather than on the geometry itself, so that a
   * later change to the pins updates the line without restarting its draw.
   */
  const [isLinkReady, setIsLinkReady] = useState<boolean>(false);

  // --- Source + layers ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady) return;

    const source = map.getSource(SITE_LINK_SPEC.sourceId) as maplibregl.GeoJSONSource | undefined;

    if (!siteLinkFeature) {
      // Fewer than two pins - nothing to link. Emptied rather than torn down,
      // so adding a pin back just refills the line it already has.
      source?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    if (source) {
      source.setData(siteLinkFeature);
      return;
    }

    map.addSource(SITE_LINK_SPEC.sourceId, {
      type: 'geojson',
      data: siteLinkFeature,
      // Required for `line-progress`. Without it the reveal gradient is a
      // silent no-op and the whole line simply appears at once.
      lineMetrics: true,
    });

    // Drawn twice: a wide blurred pass so the line still reads over a bright
    // rooftop, then the crisp stroke over it. Both open fully hidden - or
    // fully drawn, if a WebGL rebuild is re-adding them after the fact.
    const openingProgress = linkDrawnRef.current ? 1 : 0;

    map.addLayer({
      id: SITE_LINK_SPEC.glowLayerId,
      type: 'line',
      source: SITE_LINK_SPEC.sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 10,
        'line-blur': 8,
        'line-gradient': siteLinkGradient(openingProgress, SITE_LINK_SPEC.glowColor),
      },
    } as maplibregl.LayerSpecification);

    map.addLayer({
      id: SITE_LINK_SPEC.lineLayerId,
      type: 'line',
      source: SITE_LINK_SPEC.sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 2.4,
        'line-gradient': siteLinkGradient(openingProgress),
      },
    } as maplibregl.LayerSpecification);

    setIsLinkReady(true);
  }, [isStyleReady, siteLinkFeature]);

  // --- The reveal, then the flow ---
  // Deps are three booleans that each flip once. In particular the geometry is
  // NOT one of them: the pins carry live figures that change on every tick, and
  // keying the draw on those restarted it forever.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleReady || !introFinished || !isLinkReady) return;
    if (!map.getLayer(SITE_LINK_SPEC.lineLayerId)) return;

    /** Both passes get the same ramp, in their own colour. */
    const paint = (
      build: (progress: number, bodyColor?: string) => ReturnType<typeof siteLinkGradient>,
      value: number
    ) => {
      // The layers can go mid-flight: a WebGL loss rebuilds the whole style.
      if (!map.getLayer(SITE_LINK_SPEC.lineLayerId)) return;
      map.setPaintProperty(SITE_LINK_SPEC.lineLayerId, 'line-gradient', build(value));
      map.setPaintProperty(
        SITE_LINK_SPEC.glowLayerId,
        'line-gradient',
        build(value, SITE_LINK_SPEC.glowColor)
      );
    };

    const setDrawProgress = (progress: number) => paint(siteLinkGradient, progress);
    const setFlowPhase = (phase: number) => paint(siteLinkFlowGradient, phase);

    // A venue machine asking for reduced motion gets the finished line and
    // nothing moving - index.css already treats that setting as a kill switch
    // for this dashboard's animations.
    const prefersReducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (prefersReducedMotion) {
      setDrawProgress(1);
      linkDrawnRef.current = true;
      return;
    }

    // Wall-clock, not an accumulated per-frame delta: rAF stops entirely while
    // the page is hidden, and coming back to a line frozen half-drawn would be
    // worse than coming back to a finished one.
    const startedAt = performance.now();
    /** Already drawn - a rebuild re-added the layers - so go straight to flow. */
    const skipDraw = linkDrawnRef.current;
    let lastFlowFrame = 0;

    const step = (now: number) => {
      const drawT = (now - startedAt) / SITE_LINK_SPEC.drawMs;

      if (!skipDraw && drawT < 1) {
        setDrawProgress(easeOutCubic(drawT));
        linkDrawRafRef.current = requestAnimationFrame(step);
        return;
      }

      // --- Drawn. From here the line is permanent; only the pulses move. ---
      if (!linkDrawnRef.current) {
        linkDrawnRef.current = true;
        setDrawProgress(1);
      }

      if (!SITE_LINK_SPEC.flow) {
        // Held, and free: a flat colour ramp MapLibre uploads once. Stopping
        // the loop here is also what lets the map go back to repainting only
        // when the camera moves.
        linkDrawRafRef.current = null;
        return;
      }

      // Throttled to `flowFrameMs`. Still driven by rAF rather than an
      // interval, so the pulses stop dead while the page is hidden instead of
      // queueing up frames nobody is watching.
      if (now - lastFlowFrame >= SITE_LINK_SPEC.flowFrameMs) {
        lastFlowFrame = now;
        // Phase off the clock, not accumulated: a dropped frame shifts nothing.
        setFlowPhase((now % SITE_LINK_SPEC.flowMs) / SITE_LINK_SPEC.flowMs);
      }

      linkDrawRafRef.current = requestAnimationFrame(step);
    };

    linkDrawRafRef.current = requestAnimationFrame(step);

    return () => {
      if (linkDrawRafRef.current !== null) {
        cancelAnimationFrame(linkDrawRafRef.current);
        linkDrawRafRef.current = null;
      }
    };
  }, [isStyleReady, introFinished, isLinkReady]);

  // -------------------------------------------------------------------------
  // Camera controls
  // -------------------------------------------------------------------------
  const handleSetPitchPreset = useCallback((pitchVal: number) => {
    mapRef.current?.easeTo({ pitch: Math.min(pitchVal, MAX_PITCH), duration: 800 });
  }, []);

  const handleTilt = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const nextPitch = Math.max(0, Math.min(MAX_PITCH, map.getPitch() + delta));
    map.easeTo({ pitch: nextPitch, duration: 400 });
  }, []);

  /**
   * Return the camera to the framing the dashboard opens on — the same values
   * the map is built with, so "reset" cannot drift away from "initial".
   */
  const handleResetCamera = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: REGIONAL_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 900,
    });
  }, []);

  // -------------------------------------------------------------------------
  // Auto orbit - requestAnimationFrame, not setInterval(50)
  // A 50 ms interval kept firing while the tab was hidden and drifted out of
  // phase with the compositor. rAF is frame-locked, pauses automatically when
  // the page is hidden, and the delta-time step keeps the speed constant.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isAutoOrbit) return;

    let last = performance.now();

    const step = (now: number) => {
      const map = mapRef.current;
      if (!map) {
        orbitRafRef.current = null;
        return;
      }
      const dt = Math.min(now - last, 100); // clamp after a background stall
      last = now;

      // Yield to the operator: never fight a drag that is in progress.
      if (!document.hidden && !isMovingRef.current) {
        const next = (map.getBearing() + (ORBIT_DEG_PER_SEC * dt) / 1000) % 360;
        map.setBearing(next);
      }
      orbitRafRef.current = requestAnimationFrame(step);
    };

    orbitRafRef.current = requestAnimationFrame(step);

    return () => {
      if (orbitRafRef.current !== null) {
        cancelAnimationFrame(orbitRafRef.current);
        orbitRafRef.current = null;
      }
    };
  }, [isAutoOrbit]);

  // Mirrored for checkpointCamera, which has to know whether a bearing change
  // was the orbit's doing or the operator's.
  useEffect(() => {
    isAutoOrbitRef.current = isAutoOrbit;
  }, [isAutoOrbit]);

  const handleToggleAutoOrbit = useCallback(() => setIsAutoOrbit((prev) => !prev), []);

  // -------------------------------------------------------------------------
  // Markers: reconcile by id, then patch values in place
  // -------------------------------------------------------------------------
  /** Fast id -> metrics lookup for the marker patch loop. */
  const metricsById = useMemo(() => {
    const m = new Map<number, ResolvedSiteMetrics>();
    siteMetrics.forEach((entry) => m.set(entry.buildingId, entry));
    return m;
  }, [siteMetrics]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapCreated) return;

    const store = markersRef.current;
    const liveIds = new Set<number>();

    buildings.forEach((site) => {
      liveIds.add(site.id);
      let handle = store.get(site.id);

      // --- Create only when this id has no marker yet ---
      if (!handle) {
        const { el, refs } = createMarkerElement(site);

        const onClick = (e: MouseEvent) => {
          e.stopPropagation();
          handlersRef.current.onSelectBuilding(site);
          handlersRef.current.onNavigateToSubpage?.(site);
        };
        el.addEventListener('click', onClick);

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([site.lng, site.lat])
          .addTo(map);

        handle = {
          marker,
          root: el,
          onClick,
          lng: site.lng,
          lat: site.lat,
          ...refs,
        };
        store.set(site.id, handle);
      }

      // --- Patch: text nodes and class strings only ---
      const metrics = metricsById.get(site.id) ?? emptySiteMetrics(site.id);
      patchMarker(handle, site, selectedBuildingId === site.id, showPinCards, metrics);
    });

    // --- Remove markers for buildings that no longer exist ---
    store.forEach((handle, id) => {
      if (liveIds.has(id)) return;
      handle.root.removeEventListener('click', handle.onClick);
      handle.marker.remove();
      store.delete(id);
    });
    // This effect re-runs on every data tick, and that is fine: reconciliation
    // is a 5-element loop and the work it does is textContent assignment.
    // The expensive part - innerHTML parsing and Marker construction - happens
    // once per site id, not once per tick.
  }, [isMapCreated, buildings, metricsById, selectedBuildingId, showPinCards]);

  // -------------------------------------------------------------------------
  // Site clip playback governor
  //
  // Hiding the pin cards only sets `opacity-0` - the markers stay in the DOM,
  // so without this every clip would keep decoding behind an invisible card.
  // Four video decoders running unwatched for ten hours is exactly the kind of
  // cost this screen cannot afford, so playback is tied to whether the cards
  // are actually on screen and the page is actually in the foreground.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isMapCreated) return;

    const applyPlaybackState = () => {
      const shouldPlay = showPinCards && !document.hidden;
      markersRef.current.forEach(({ videoEl }) => {
        if (!videoEl) return;
        if (shouldPlay) {
          // Rejected when the browser withholds autoplay; the poster frame
          // stays up and there is nothing useful to do about it.
          void videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
      });
    };

    applyPlaybackState();
    document.addEventListener('visibilitychange', applyPlaybackState);
    return () => document.removeEventListener('visibilitychange', applyPlaybackState);
    // `buildings` is here so clips on newly-created markers get governed too.
  }, [isMapCreated, showPinCards, buildings]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative w-full h-full min-h-[380px] bg-slate-950 overflow-hidden font-['Prompt',sans-serif] select-none">
      {/* 1. MapLibre GL 3D Map Container */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* WebGL recovery notice */}
      {glLost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-panel px-5 py-4 rounded-2xl border border-amber-500/40 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <span className="text-slate-200">
              กำลังกู้คืนการแสดงผลแผนที่ 3D… (WebGL context restore)
            </span>
          </div>
        </div>
      )}

      {/* 2. Right-edge control drawer.

          Every map control used to live in two clusters pinned over the top
          corners of the imagery. On a ceremony screen that is chrome sitting on
          top of the thing people came to look at, so they are now one vertical
          menu that stays off-screen until someone reaches for it — the same
          hover-or-handle pattern as the header bar, mirrored to the right edge.

          pointer-events are off on the container and back on only for the handle
          and the panel: a transparent full-height overlay across a live MapLibre
          canvas would otherwise swallow every drag. */}
      <div className="group pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center justify-end">
        {/* Grab handle. Hover alone would strand a touchscreen, so it toggles on click too. */}
        <button
          type="button"
          id="btn-toggle-map-controls"
          onClick={() => setIsControlsPinned((v) => !v)}
          aria-expanded={isControlsPinned}
          title={isControlsPinned ? 'ซ่อนเมนูควบคุมแผนที่' : 'แสดงเมนูควบคุมแผนที่'}
          className="pointer-events-auto absolute right-0 top-1/2 -translate-y-1/2 h-20 w-2.5 rounded-l-md bg-slate-100/25 hover:bg-sky-300/70 transition-colors cursor-pointer"
        />

        <div
          className={`pointer-events-auto mr-4 max-h-full overflow-y-auto custom-scrollbar transition-transform duration-300 ease-out group-hover:translate-x-0 group-focus-within:translate-x-0 ${
            isControlsPinned ? 'translate-x-0' : 'translate-x-[calc(100%+2rem)]'
          }`}
        >
          <div className="glass-panel w-52 rounded-2xl border border-sky-500/30 shadow-2xl backdrop-blur-md p-2 flex flex-col gap-2.5 text-xs">
            {/* --- Basemap --- */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-mono text-slate-400 px-1">แผนที่ฐาน</span>

              <button
                onClick={() => handleLayerChange('esri-satellite')}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  activeLayer === 'esri-satellite'
                    ? 'bg-sky-500/40 text-white font-bold border border-sky-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent'
                }`}
                title="ภาพถ่ายดาวเทียมจริงความละเอียดสูง (Esri World Imagery Real Satellite)"
              >
                <Satellite className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-[11px]">ดาวเทียมจริง</span>
              </button>

              <button
                onClick={() => handleLayerChange('hybrid')}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  activeLayer === 'hybrid'
                    ? 'bg-sky-500/40 text-white font-bold border border-sky-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent'
                }`}
                title="ดาวเทียมจริง + เส้นขอบเขตภูมิประเทศ (Hybrid)"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px]">Hybrid</span>
              </button>

              <button
                onClick={() => handleLayerChange('dark')}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  activeLayer === 'dark'
                    ? 'bg-sky-500/40 text-white font-bold border border-sky-400'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent'
                }`}
                title="แผนที่ Dark Cyber 3D"
              >
                <span className="text-xs w-3.5 text-center shrink-0">🌑</span>
                <span className="text-[11px]">Dark 3D</span>
              </button>
            </div>

            {/* --- Pin telemetry cards --- */}
            <div className="border-t border-slate-700/60 pt-2">
              <button
                onClick={() => setShowPinCards((v) => !v)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  showPinCards
                    ? 'bg-sky-950/70 border-sky-400/50 text-sky-200'
                    : 'bg-slate-900/80 border-slate-700 text-slate-400'
                }`}
                title="เปิด/ปิดการ์ดข้อมูลที่ลอยอยู่เหนือหมุดแต่ละไซต์"
              >
                <Sliders className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="text-[11px] font-medium">
                  {showPinCards ? 'การ์ดบนหมุด: เปิด' : 'การ์ดบนหมุด: ปิด'}
                </span>
              </button>
            </div>

            {/* --- Pitch presets --- */}
            <div className="border-t border-slate-700/60 pt-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-slate-400 px-1">มุมเอียง</span>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => handleSetPitchPreset(60)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    Math.abs(camera.pitch - 60) <= 3
                      ? 'bg-sky-500/40 text-white border border-sky-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800 border border-transparent'
                  }`}
                  title="มุมมองเฉียง 60 องศา (Google Earth Perspective)"
                >
                  60° เฉียง
                </button>

                <button
                  onClick={() => handleSetPitchPreset(MAX_PITCH)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    Math.abs(camera.pitch - MAX_PITCH) <= 3
                      ? 'bg-sky-500/40 text-white border border-sky-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800 border border-transparent'
                  }`}
                  title="มุมมองเฉียงสูงสุด 65 องศา (จำกัดไว้ไม่ให้เส้นขอบฟ้าเข้าเฟรม จอจึงไม่มีขอบดำ)"
                >
                  {MAX_PITCH}° สูง
                </button>

                <button
                  onClick={() => handleSetPitchPreset(45)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    Math.abs(camera.pitch - 45) <= 3
                      ? 'bg-sky-500/40 text-white border border-sky-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800 border border-transparent'
                  }`}
                  title="มุมมองเฉียง 45 องศา (Isometric 3D)"
                >
                  45°
                </button>

                <button
                  onClick={() => handleSetPitchPreset(0)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    camera.pitch <= 5
                      ? 'bg-sky-500/40 text-white border border-sky-400'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800 border border-transparent'
                  }`}
                  title="มุมมองแนวระนาบ 2D จากด้านบน"
                >
                  0° ราบ
                </button>
              </div>
            </div>

            {/* --- Camera nudges --- */}
            <div className="border-t border-slate-700/60 pt-2 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-slate-400 px-1">ควบคุมกล้อง</span>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => handleTilt(10)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-sky-300 transition-colors cursor-pointer"
                  title="เพิ่มมุมเฉียง 3D (Tilt Up)"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => handleTilt(-10)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-sky-300 transition-colors cursor-pointer"
                  title="ลดมุมเฉียง 3D (Tilt Down)"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => mapRef.current?.zoomIn()}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
                  title="ขยายแผนที่ (Zoom In)"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => mapRef.current?.zoomOut()}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-white transition-colors cursor-pointer"
                  title="ย่อแผนที่ (Zoom Out)"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Back to the opening framing. After someone has panned and tilted
                  the map during a talk, returning to the shot the ceremony opens
                  on otherwise means nudging four separate controls. */}
              <button
                id="btn-reset-camera"
                onClick={handleResetCamera}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-500/50 transition-colors cursor-pointer"
                title="กลับสู่มุมมองเริ่มต้น (ภาพรวมทั้ง 5 ไซต์)"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] font-medium">กลับมุมมองเริ่มต้น</span>
              </button>
            </div>

            {/* --- Auto orbit --- */}
            <div className="border-t border-slate-700/60 pt-2">
              <button
                onClick={handleToggleAutoOrbit}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all cursor-pointer ${
                  isAutoOrbit
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-sky-300'
                }`}
                title="หมุนมุมมองรอบแผนที่ 3D อัตโนมัติ"
              >
                <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${isAutoOrbit ? 'animate-spin' : ''}`} />
                <span className="text-[11px] font-medium">
                  {isAutoOrbit ? 'กำลังหมุน 3D' : 'หมุน 3D อัตโนมัติ'}
                </span>
              </button>
            </div>

            {/* --- Site pin management ---
                Hidden unless the operator turns on edit tools in the settings
                modal: "ลบไซต์" is one tap from removing a site pin, which is not
                something a ceremony screen should offer a passer-by. */}
            {showSiteEditTools && (
              <div className="border-t border-slate-700/60 pt-2 flex flex-col gap-1">
                <span className="text-[10px] font-mono text-slate-400 px-1">แก้ไขไซต์</span>

                <button
                  id="btn-add-site-pin"
                  onClick={() => handlersRef.current.onOpenAddModal?.()}
                  title="เพิ่มหมุดไซต์ใหม่บนแผนที่"
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-emerald-200 bg-slate-900/80 border border-slate-700 hover:bg-emerald-900/40 transition-colors cursor-pointer"
                >
                  <MapPinPlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>เพิ่มไซต์</span>
                </button>

                <button
                  id="btn-delete-site-pin"
                  onClick={() => {
                    const target = buildings.find((b) => b.id === selectedBuildingId);
                    if (target) handlersRef.current.onOpenDeleteDialog?.(target);
                  }}
                  disabled={selectedBuildingId === null}
                  title={
                    selectedBuildingId === null
                      ? 'เลือกหมุดบนแผนที่ก่อน จึงจะลบได้'
                      : 'ลบหมุดไซต์ที่เลือกอยู่'
                  }
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-rose-200 bg-slate-900/80 border border-slate-700 hover:bg-rose-900/40 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-slate-900/80"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>ลบไซต์</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        4. Combined production across all 5 regional sites.

        It has been the bottom-right corner, then the top-right corner; it is
        now a landscape band over the open water right of centre, which is the
        one part of the frame no card or logo wants. Placement is measured, not
        taste, at the reference framing (1904px viewport, default camera):

          masthead ends            y 74    -> the band can start at 219
          หาดใหญ่ card starts      y 452   -> its 217px ends at 435, 17px clear
          ปัตตานี card starts      x 1433  -> stay above it, not beside it
          drawer handle            right edge, y 460-540 -> panel sits above

        Inset from the right rather than pinned to it: the corner is where the
        masthead's PSU crest lands on anything narrower than ~1990px, and the
        band reads as sitting on the sea instead of clinging to the bezel.
        Below 1600px there is no room for that inset, so it returns to the edge.
      */}
      <div className="absolute right-3 min-[1600px]:right-[14rem] top-52 z-20 pointer-events-auto">
        <RegionalTotalsPanel totals={totals} />
      </div>

    </div>
  );
};

/**
 * Memoised: with every callback prop wrapped in useCallback over in App.tsx,
 * opening a modal or ticking the header clock no longer re-renders the map
 * subtree at all.
 */
export const Solar3DViewer = React.memo(Solar3DViewerImpl);
Solar3DViewer.displayName = 'Solar3DViewer';
