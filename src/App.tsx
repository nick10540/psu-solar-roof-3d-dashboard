/**
 * MEA SOLAR ROOF Smart Energy Monitoring Dashboard (5 Regional Sites)
 * Sites:
 * 1. สุราษฎร์ธานี (Surat Thani) - 320 kWp
 * 2. ภูเก็ต (Phuket) - 450 kWp
 * 3. ตรัง (Trang) - 250 kWp
 * 4. หาดใหญ่ (Hatyai) - 380 kWp
 * 5. ปัตตานี (Pattani) - 200 kWp
 * Total Installed Capacity: 1,600 kWp (แหล่งจริงคือ capacityKwp ใน mockSolarData.ts)
 *
 * Features:
 * - Google Earth 3D Mode & 2D Clean Regional Satellite Map
 * - Only 5 MEA site pins displayed with current power (kW), total lifetime energy (kWh), installed capacity (kWp)
 * - Navigation to 5 dedicated site sub-pages (หน้าย่อย)
 * - SolarEdge API integration & live simulation
 * - Demo Watermark: "PRECISE DIGITAL ECONOMY 2026 FOR DEMO ONLY" (removable in Watermark.tsx)
 *
 * ---------------------------------------------------------------------------
 * LONG-RUNNING KIOSK NOTES (72" TV, opening ceremony)
 *
 * Every callback handed to <Solar3DViewer> MUST be wrapped in useCallback with
 * a stable dependency list. The viewer keeps a live MapLibre instance whose
 * lifecycle is tied to those props; an inline arrow function here re-creates
 * the entire map — WebGL context, workers and tile cache included — on every
 * single render of this component. That was the original cause of both the
 * runaway tile requests and the camera snapping back to its default position.
 * ---------------------------------------------------------------------------
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import {
  BuildingInfo,
  CampusWeather,
  SolarEdgeConfig,
  SolarEdgeSiteOverview,
  TimeRange,
  TimeSeriesDataPoint,
  SolarEdgeRawSite,
  SolarEdgeTransformedOverview,
  SolarEdgeQuotaInfo,
  BuildingSiteBinding,
  bindingSiteIds,
  SolarEdgeBackendStatus,
  AppNavigationMode
} from './types';
import {
  PSU_ALL_BUILDINGS,
  INITIAL_WEATHER,
  SITE_OVERVIEW_DEFAULT,
  generateDayPowerData,
  generateWeekPowerData,
  generateMonthPowerData,
  generateYearPowerData,
  PEAK_AC_KW_PER_KWP
} from './data/mockSolarData';
import {
  fetchSolarEdgeAccountData,
  loadBuildingSiteBindings,
  saveBuildingSiteBinding,
  getDailyQuotaInfo,
  MOCK_SOLAREDGE_SITES,
  fetchBackendHealth,
  loadSolarEdgeConfig,
  saveSolarEdgeConfig
} from './services/solarEdgeService';
import {
  saveBuildingCoords,
  resetBuildingCoords,
} from './services/buildingCoordsService';
import {
  loadActiveBuildings,
  createNewBuilding,
  deleteBuildingById,
  resetAllBuildingsToDefaults,
  NewBuildingPayload
} from './services/buildingStorageService';
import { useLongRunGuard } from './hooks/useLongRunGuard';
import {
  dataSourceModeFromConfig,
  resolveAllSiteMetrics,
  aggregateSiteMetrics,
  emptySiteMetrics,
  ResolvedSiteMetrics,
} from './services/siteMetricsService';
import {
  co2TonsFromKg,
  co2TonsFromKwh,
  treesFromCo2Kg,
  treesFromKwh,
} from './utils/energyEquivalents';

import { Solar3DViewer } from './components/Solar3DViewer';
import { SiteDetailSubpage } from './components/SiteDetailSubpage';
import { HeaderBar } from './components/HeaderBar';
import { CeremonyHero } from './components/CeremonyHero';
import { BuildingDetailModal } from './components/BuildingDetailModal';
import { SolarEdgeSettingsModal } from './components/SolarEdgeSettingsModal';
import { BuildingBindingModal } from './components/BuildingBindingModal';
import { AddBuildingModal } from './components/AddBuildingModal';
import { DeleteBuildingDialog } from './components/DeleteBuildingDialog';
import { Watermark } from './components/Watermark';

/** SolarEdge auto-poll cadence. One bulk API call per tick. */
const SOLAREDGE_POLL_MS = 5 * 60 * 1000;

interface LoadOptions {
  forceRefresh?: boolean;
  /** Background refresh: no spinner, no layout change, non-urgent React update. */
  silent?: boolean;
  /**
   * Supersede a request that is still in the air instead of backing off.
   *
   * Used by the mount / config-change effect, whose run represents a NEW intent
   * rather than an extra tick. The interval poll leaves this off so a slow
   * request can never have a queue stack up behind it.
   */
  takeover?: boolean;
}

export default function App() {
  // Navigation Mode: 'main-map' (5-site regional overview) vs 'site-detail' (sub-page)
  const [navigationMode, setNavigationMode] = useState<AppNavigationMode>('main-map');

  // Application State - 5 Regional Sites
  const [buildings, setBuildings] = useState<BuildingInfo[]>(() => loadActiveBuildings());
  const [overview, setOverview] = useState<SolarEdgeSiteOverview>(SITE_OVERVIEW_DEFAULT);
  const [weather] = useState<CampusWeather>(INITIAL_WEATHER);
  // Restored from localStorage (falling back to INITIAL_SOLAREDGE_CONFIG the
  // first time this browser ever runs the dashboard) so the data-source mode
  // and poll cadence survive a reload. A kiosk that reloads unattended would
  // otherwise come back up in Mock mode with nobody there to switch it back.
  const [config, setConfig] = useState<SolarEdgeConfig>(loadSolarEdgeConfig);

  // SolarEdge Monitoring API State.
  // Seeded with the mock catalogue only when the RESTORED config starts in
  // mock mode - starting Live with a pre-populated site list would imply a
  // connection that does not exist yet.
  const [solarEdgeSites, setSolarEdgeSites] = useState<SolarEdgeRawSite[]>(() =>
    loadSolarEdgeConfig().useMock ? MOCK_SOLAREDGE_SITES : []
  );
  const [solarEdgeOverviews, setSolarEdgeOverviews] = useState<Record<number, SolarEdgeTransformedOverview>>({});
  const [quotaInfo, setQuotaInfo] = useState<SolarEdgeQuotaInfo>(getDailyQuotaInfo);
  const [bindings, setBindings] = useState<Record<number, BuildingSiteBinding>>(loadBuildingSiteBindings);
  const [isSolarEdgeLoading, setIsSolarEdgeLoading] = useState<boolean>(false);

  // Backend diagnostics. With the API key server-side there is nothing
  // for the operator to type any more, so the settings modal shows the state of
  // the connection instead of a key field.
  const [backendStatus, setBackendStatus] = useState<SolarEdgeBackendStatus | null>(null);
  const [solarEdgeError, setSolarEdgeError] = useState<string | null>(null);

  // Time & Chart States
  const [timeRange] = useState<TimeRange>('day');
  const [timeOfDayHour, setTimeOfDayHour] = useState<number>(10.5); // 10:30 AM
  const [isLiveSimulation, setIsLiveSimulation] = useState<boolean>(true);

  // Dataset states (aggregated across all sites; generateDayPowerData is calibrated to 1,600 kWp)
  const [dayData, setDayData] = useState<TimeSeriesDataPoint[]>(() => generateDayPowerData(10.5));
  const [weekData] = useState<TimeSeriesDataPoint[]>(() => generateWeekPowerData());
  const [monthData] = useState<TimeSeriesDataPoint[]>(() => generateMonthPowerData());
  const [yearData] = useState<TimeSeriesDataPoint[]>(() => generateYearPowerData());

  // Interaction / Modal States
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingInfo | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState<boolean>(false);
  const [bindingModalBuilding, setBindingModalBuilding] = useState<BuildingInfo | null>(null);
  const [isAddBuildingModalOpen, setIsAddBuildingModalOpen] = useState<boolean>(false);
  const [deleteCandidateBuilding, setDeleteCandidateBuilding] = useState<BuildingInfo | null>(null);

  /** Header bar kept open by the grab handle, for pointers that cannot hover. */
  const [isHeaderPinned, setIsHeaderPinned] = useState<boolean>(false);

  // --- Polling bookkeeping (refs: never trigger a render) ---
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);
  const lastSyncAtRef = useRef<number>(0);
  /**
   * Latest bindings, mirrored into a ref.
   *
   * The poll callback needs the bound site IDs but must NOT list `bindings`
   * as a dependency: re-creating it on every save would tear down and
   * restart the 5-minute interval, and a burst of edits would each trigger
   * their own upstream round.
   */
  const bindingsRef = useRef(bindings);
  /** Latest config, mirrored for the same reason as bindingsRef. */
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Cancel any request still in the air so its .then never touches a
      // component that no longer exists.
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 1. SolarEdge fetching — cancellable, non-overlapping, background-friendly
  // ---------------------------------------------------------------------------
  const loadSolarEdgeData = useCallback(
    async ({ forceRefresh = false, silent = false, takeover = false }: LoadOptions = {}) => {
      // A slow request must never let a second one stack behind it. Over a
      // 10-hour session, overlapping polls are how a fetch queue turns into a leak.
      //
      // A `takeover` caller is the exception. React StrictMode mounts, unmounts
      // and remounts in dev: the unmount aborts the first mount's request, and
      // the remount's run then found this latch still set and backed off — so
      // NOTHING was ever committed and the dashboard sat empty. That stayed
      // hidden while the app always booted into mock mode (which resolves
      // without a round trip and wins the race); restoring a saved "Live" mode
      // on start-up is what surfaced it. The same applies in production
      // whenever the effect re-runs on a config change mid-request.
      if (inFlightRef.current) {
        if (!takeover) return;
        abortRef.current?.abort();
      }
      inFlightRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) setIsSolarEdgeLoading(true);

      try {
        // No credential argument: the SolarEdge API key lives in worker/ and
        // never reaches the browser. This call goes to /api/solaredge.
        //
        // Every site ID the dashboard needs: what the pins are bound to, plus
        // anything registered by hand in the settings modal. The manual entries
        // matter most on first use — an ID nothing is bound to yet has to be
        // fetched once before it can appear in the list to bind to.
        const boundIds = Array.from(
          new Set([
            ...Object.values(bindingsRef.current).flatMap((b) => bindingSiteIds(b)),
            ...(configRef.current.extraSiteIds ?? []),
          ])
        );

        const res = await fetchSolarEdgeAccountData({
          siteIds: boundIds,
          forceRefresh,
          useMock: config.useMock,
          signal: controller.signal,
        });

        if (!mountedRef.current || controller.signal.aborted) return;

        // Aggregate all 5 sites into the regional overview
        let aggregated: Partial<SolarEdgeSiteOverview> | null = null;
        const overviewValues = Object.values(res.overviews);

        if (overviewValues.length > 0) {
          let totalPowerKw = 0;
          let totalTodayKwh = 0;
          let totalMonthlyKwh = 0;
          let totalYearlyKwh = 0;
          let totalLifetimeKwh = 0;
          // SolarEdge's own CO2, summed. Null-safe: a site whose
          // environmental-benefits call failed simply does not contribute.
          let totalCo2Kg = 0;
          let anyCo2 = false;

          overviewValues.forEach((ov) => {
            totalPowerKw += ov.currentPowerKw;
            totalTodayKwh += ov.dailyEnergyKwh;
            totalMonthlyKwh += ov.monthlyEnergyKwh;
            totalYearlyKwh += ov.yearlyEnergyKwh;
            totalLifetimeKwh += ov.lifetimeEnergyKwh;
            if (typeof ov.co2Kg === 'number' && Number.isFinite(ov.co2Kg)) {
              totalCo2Kg += ov.co2Kg;
              anyCo2 = true;
            }
          });

          if (totalPowerKw > 0) {
            // NOTE: the previous version wrote `monthlyEnergyKwh`,
            // `yearlyEnergyMwh` and `co2SavedKg` — none of which exist on
            // SolarEdgeSiteOverview. Those three values were silently dropped,
            // so the month / year / CO2 tiles kept showing the hard-coded mock
            // defaults even with a live API key. Mapped to the real fields here.
            aggregated = {
              currentPowerKw: Math.round(totalPowerKw * 10) / 10,
              todayEnergyKwh: Math.round(totalTodayKwh * 10) / 10,
              monthEnergyKwh: Math.round(totalMonthlyKwh * 10) / 10,
              yearEnergyKwh: Math.round(totalYearlyKwh * 10) / 10,
              lifetimeEnergyKwh: totalLifetimeKwh,
              // CO2 and trees now trace back to SolarEdge instead of to local
              // factors. Measured across all four sites, the portal uses exactly
              // 0.392 kg/kWh, so the old 0.56 read ~43% high; trees at
              // 0.08/kWh read ~7.3x high. The local derivation is kept only for
              // when no site reported an environmental figure at all.
              co2ReducedTons: anyCo2
                ? Math.round(co2TonsFromKg(totalCo2Kg) * 10) / 10
                : Math.round(co2TonsFromKwh(totalLifetimeKwh) * 10) / 10,
              treesPlanted: anyCo2
                ? treesFromCo2Kg(totalCo2Kg)
                : treesFromKwh(totalLifetimeKwh),
            };
          }
        }

        // A background refresh is not urgent. startTransition lets React keep
        // the map, an in-flight drag and any animation at higher priority, so
        // the 5-minute tick is invisible on screen.
        const commit = () => {
          setSolarEdgeSites(res.sites);
          setSolarEdgeOverviews(res.overviews);
          setQuotaInfo(res.quota);
          // Null in mock mode and on a cache hit — keep the last known backend
          // state rather than blanking the settings panel on every cached tick.
          if (res.backend) setBackendStatus(res.backend);
          setSolarEdgeError(res.error ?? null);
          if (aggregated) setOverview((prev) => ({ ...prev, ...aggregated }));
        };

        if (silent) startTransition(commit);
        else commit();

        lastSyncAtRef.current = Date.now();
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === 'AbortError') return; // expected on unmount / config change
        console.error('Failed to load SolarEdge data:', err);
      } finally {
        // Only the request that is still the current one may clear the latch.
        // A superseded request finishing late would otherwise unlatch the newer
        // one that replaced it, re-opening the overlapping-poll hole above.
        if (abortRef.current === controller) {
          abortRef.current = null;
          inFlightRef.current = false;
        }
        if (!silent && mountedRef.current) setIsSolarEdgeLoading(false);
      }
    },
    [config.useMock]
  );

  // Load SolarEdge Data on Mount & Config change.
  // `pendingForceRefreshRef` lets "Save settings" bypass the cache on the NEXT
  // run of this effect — i.e. with the new API key already in the closure,
  // rather than firing a call against the key the user just replaced.
  const pendingForceRefreshRef = useRef<boolean>(false);

  useEffect(() => {
    const force = pendingForceRefreshRef.current;
    pendingForceRefreshRef.current = false;
    loadSolarEdgeData({ forceRefresh: force, takeover: true });
  }, [loadSolarEdgeData]);

  /**
   * Probe the backend for its own diagnostics (token TTL, configured sites).
   *
   * Called from the authorization callback below, when the settings modal
   * opens, and from its "ตรวจสอบ backend" button — never on the 5-minute poll:
   * the poll needs data, not diagnostics.
   */
  const handleCheckBackend = useCallback(async () => {
    const status = await fetchBackendHealth();
    if (mountedRef.current) setBackendStatus(status);
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Auto-polling every 5 minutes (background, no UI disruption)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const tick = () => {
      // A blanked or backgrounded screen has nobody watching — don't spend
      // API quota on it. The visibility handler catches up on return.
      if (document.hidden) return;
      loadSolarEdgeData({ silent: true });
    };

    const intervalId = window.setInterval(tick, SOLAREDGE_POLL_MS);

    const handleVisibility = () => {
      if (document.hidden) return;
      if (Date.now() - lastSyncAtRef.current >= SOLAREDGE_POLL_MS) tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadSolarEdgeData]);

  // ---------------------------------------------------------------------------
  // 3. Long-running safety net — reloads only while the screen sits idle
  // ---------------------------------------------------------------------------
  // Heap-pressure watch only. The scheduled-uptime reload stays OFF: during a
  // ceremony a timer-driven refresh is a bigger risk than the leak it guards
  // against. Set reloadOnUptime: true for a screen left running for days.
  useLongRunGuard({
    enabled: true,
    reloadOnUptime: false,
    requiredIdleMs: 10 * 60 * 1000,
  });

  // Sync day data when time of day changes
  const handleTimeOfDayChange = useCallback((newHour: number) => {
    setTimeOfDayHour(newHour);
    setDayData(generateDayPowerData(newHour));

    let solarFactor = 0;
    if (newHour >= 6.0 && newHour <= 18.5) {
      const normalized = (newHour - 6.0) / (18.5 - 6.0);
      solarFactor = Math.pow(Math.sin(normalized * Math.PI), 1.25);
    }
    // Per-kWp, so the result no longer depends on a hard-coded fleet size and
    // stays correct as site pins are added or removed.
    setBuildings((prev) =>
      prev.map((b) => ({
        ...b,
        currentPowerKw: Math.round(b.capacityKwp * solarFactor * PEAK_AC_KW_PER_KWP * 10) / 10,
      }))
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Derived view model. Everything on screen reads from here, so "no data" is
  // decided once instead of by each component inventing its own fallback.
  // ---------------------------------------------------------------------------
  const dataSourceMode = dataSourceModeFromConfig(config.useMock);

  const siteMetrics = useMemo(
    () => resolveAllSiteMetrics(buildings, bindings, solarEdgeOverviews, dataSourceMode),
    [buildings, bindings, solarEdgeOverviews, dataSourceMode]
  );

  const regionalTotals = useMemo(
    () => aggregateSiteMetrics(siteMetrics, dataSourceMode),
    [siteMetrics, dataSourceMode]
  );

  // Real-time live data simulation interval.
  // Mock mode only: fabricating movement while the dashboard claims to be on
  // the live API is exactly the behaviour this rework removes.
  useEffect(() => {
    if (!isLiveSimulation || dataSourceMode !== 'mock') return;

    const periodSec = config.pollIntervalSec || 15;

    const interval = window.setInterval(() => {
      // Skip the churn entirely while nobody can see the screen.
      if (document.hidden) return;

      // `buildings` is the single source of truth for simulated figures: the
      // pins and the regional totals both derive from it via
      // resolveAllSiteMetrics. Advancing energy here (not on a separate
      // aggregate) keeps every number on screen consistent with every other.
      setBuildings((prev) =>
        prev.map((bld) => {
          const nextPower = Math.max(
            0,
            Math.round((bld.currentPowerKw + (Math.random() - 0.5) * 1.5) * 10) / 10
          );
          const energyIncrement = (nextPower / 3600) * periodSec;
          return {
            ...bld,
            currentPowerKw: nextPower,
            todayEnergyKwh: Math.round((bld.todayEnergyKwh + energyIncrement) * 10) / 10,
            lifetimeEnergyKwh: bld.lifetimeEnergyKwh + energyIncrement,
          };
        })
      );
    }, periodSec * 1000);

    return () => window.clearInterval(interval);
  }, [isLiveSimulation, dataSourceMode, config.pollIntervalSec]);

  // ---------------------------------------------------------------------------
  // Handlers — all memoised. See the kiosk note at the top of this file.
  // ---------------------------------------------------------------------------

  // Navigate to Subpage for a site
  const handleNavigateToSubpage = useCallback((site: BuildingInfo) => {
    setSelectedBuilding(site);
    setNavigationMode('site-detail');
  }, []);

  // Back to Main 5-Site Map
  const handleBackToMainMap = useCallback(() => {
    setNavigationMode('main-map');
  }, []);

  // Handle building selection
  const handleSelectBuilding = useCallback((building: BuildingInfo | null) => {
    setSelectedBuilding(building);
  }, []);

  // Open Detail Modal
  const handleOpenDetailModal = useCallback((building: BuildingInfo) => {
    setSelectedBuilding(building);
    setIsDetailModalOpen(true);
  }, []);

  // Open Binding Modal
  const handleOpenBindingModal = useCallback((building: BuildingInfo) => {
    setBindingModalBuilding(building);
  }, []);

  // Save Binding handler
  const handleSaveBinding = useCallback((binding: BuildingSiteBinding) => {
    setBindings(saveBuildingSiteBinding(binding));
  }, []);

  // Unbind Building handler
  const handleUnbindBuilding = useCallback((buildingId: number) => {
    setBindings(
      saveBuildingSiteBinding({
        buildingId,
        siteId: null,
        siteIds: [],
        primaryMetric: 'currentPower',
        isBound: false,
      })
    );
  }, []);

  // Update and Save Building Coordinates (Lat/Lng)
  const handleUpdateBuildingCoords = useCallback((buildingId: number, lat: number, lng: number) => {
    saveBuildingCoords(buildingId, lat, lng);
    setBuildings((prev) =>
      prev.map((bld) => (bld.id === buildingId ? { ...bld, lat, lng } : bld))
    );
  }, []);

  // Reset Building Coordinates to default
  const handleResetBuildingCoords = useCallback((buildingId: number) => {
    resetBuildingCoords(buildingId);
    const defaultBld = PSU_ALL_BUILDINGS.find((b) => b.id === buildingId);
    if (!defaultBld) return;
    setBuildings((prev) =>
      prev.map((bld) =>
        bld.id === buildingId ? { ...bld, lat: defaultBld.lat, lng: defaultBld.lng } : bld
      )
    );
  }, []);

  // Custom Building CRUD Handlers (Add, Delete, Reset)
  const handleAddBuilding = useCallback(
    (payload: NewBuildingPayload, bindSiteId?: number | null) => {
      const newBuilding = createNewBuilding(payload, buildings);
      setBuildings(loadActiveBuildings());
      setSelectedBuilding(newBuilding);

      if (bindSiteId) {
        const site = solarEdgeSites.find((s) => s.id === bindSiteId);
        handleSaveBinding({
          buildingId: newBuilding.id,
          siteId: bindSiteId,
          siteIds: [bindSiteId],
          siteName: site?.name || `Site #${bindSiteId}`,
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
        });
      }
    },
    [buildings, solarEdgeSites, handleSaveBinding]
  );

  const handleDeleteBuilding = useCallback(
    (buildingId: number) => {
      deleteBuildingById(buildingId);
      setBuildings(loadActiveBuildings());
      setSelectedBuilding((prev) => (prev?.id === buildingId ? null : prev));
      handleUnbindBuilding(buildingId);
    },
    [handleUnbindBuilding]
  );

  const handleResetAllBuildings = useCallback(() => {
    resetAllBuildingsToDefaults();
    setBuildings(loadActiveBuildings());
    setSelectedBuilding(null);
  }, []);

  // Stable props for the map — an inline arrow here rebuilds the whole map.
  const handleOpenAddModal = useCallback(() => setIsAddBuildingModalOpen(true), []);
  const handleOpenDeleteDialog = useCallback((bld: BuildingInfo) => setDeleteCandidateBuilding(bld), []);
  const handleToggleLiveSimulation = useCallback(() => setIsLiveSimulation((v) => !v), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
    if (!config.useMock) void handleCheckBackend();
  }, [config.useMock, handleCheckBackend]);

  const handleManualRefresh = useCallback(() => {
    handleTimeOfDayChange(timeOfDayHour);
    loadSolarEdgeData({ forceRefresh: true });
  }, [handleTimeOfDayChange, timeOfDayHour, loadSolarEdgeData]);

  const handleSaveConfig = useCallback(
    (newCfg: SolarEdgeConfig) => {
      // Live-vs-mock is now the only setting that changes where data comes
      // from; the API key it used to share this check with moved to worker/.
      const sourceChanged = config.useMock !== newCfg.useMock;
      setConfig(newCfg);
      // Mirror into the ref in the SAME tick. The refresh below reads
      // configRef, and the effect that normally syncs it has not run yet — so
      // without this a site ID added just now would be missing from the very
      // request meant to go and fetch it.
      configRef.current = newCfg;
      saveSolarEdgeConfig(newCfg);

      if (sourceChanged) {
        // loadSolarEdgeData is about to be re-created for the new mode; let its
        // effect do the fetch so the request runs against the mode just saved.
        pendingForceRefreshRef.current = true;
      } else {
        // Same data source (e.g. only the interval changed) — the effect will
        // not re-run, so refresh explicitly.
        loadSolarEdgeData({ forceRefresh: true });
      }
    },
    [config.useMock, loadSolarEdgeData]
  );

  const activeBinding = selectedBuilding ? bindings[selectedBuilding.id] : undefined;
  // Mirrors the resolver’s own rule: a siteId counts only while the
  // binding is actually active, so a deactivated binding cannot leak an
  // overview past the resolver and into a component.
  const activeOverview =
    activeBinding?.isBound && activeBinding.siteId
      ? solarEdgeOverviews[activeBinding.siteId] ?? null
      : null;

  /**
   * The selected site's entry from the same resolution the map pins use, so the
   * sub-page and its pin can never disagree about whether a site is reporting.
   * The fallback is defensive only - a selection left over from a deleted pin.
   */
  const activeMetrics: ResolvedSiteMetrics | null = selectedBuilding
    ? siteMetrics.find((m) => m.buildingId === selectedBuilding.id) ??
      emptySiteMetrics(selectedBuilding.id)
    : null;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col p-2 sm:p-2.5 gap-2 font-['Prompt',sans-serif] select-none">
      {/* 1. Top Header Bar — parked off-screen so the ceremony masthead owns the
          top of the display. It slides back down while the pointer rests on the
          top edge, which keeps settings / refresh / brightness / fullscreen
          reachable without a visible chrome bar during the event.

          The wrapper is absolute (not part of the flex column) so the map below
          gets the full height, and pointer-events are off everywhere except the
          reveal strip and the bar itself — a transparent overlay across the top
          of a MapLibre canvas would otherwise eat drags. */}
      <div className="group pointer-events-none absolute inset-x-0 top-0 z-50 px-2 sm:px-2.5 pt-2">
        {/* Reveal strip: 10px at the very top, clear of the map controls at top-3. */}
        <div
          className="pointer-events-auto absolute inset-x-0 top-0 h-2.5"
          aria-hidden="true"
        />

        {/* Grab handle. Hover alone would strand a touchscreen — there is no
            hover on a panel someone taps — so the bar is also click-toggled. */}
        <button
          type="button"
          id="btn-toggle-header-bar"
          onClick={() => setIsHeaderPinned((v) => !v)}
          aria-expanded={isHeaderPinned}
          title={isHeaderPinned ? 'ซ่อนแถบเครื่องมือ' : 'แสดงแถบเครื่องมือ'}
          className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 h-2.5 w-16 rounded-b-md bg-slate-100/25 hover:bg-sky-300/70 transition-colors cursor-pointer"
        />

        <div
          className={`pointer-events-auto transition-transform duration-300 ease-out group-hover:translate-y-0 group-focus-within:translate-y-0 ${
            isHeaderPinned ? 'translate-y-0' : '-translate-y-[140%]'
          }`}
        >
          <HeaderBar
            weather={weather}
            config={config}
            onOpenSettings={handleOpenSettings}
            isLiveSimulation={isLiveSimulation}
            onToggleLiveSimulation={handleToggleLiveSimulation}
            onManualRefresh={handleManualRefresh}
          />
        </div>
      </div>

      {/* 2. Main Content Canvas */}
      <div className="relative flex-1 w-full h-full min-h-0 overflow-hidden rounded-2xl border border-sky-500/20 shadow-2xl">
        {/* Branch: Site Detail Subpage (หน้าย่อย) vs Main Map (Google Earth 3D / Satellite) */}
        {navigationMode === 'site-detail' && selectedBuilding && activeMetrics ? (
          <SiteDetailSubpage
            site={selectedBuilding}
            allSites={buildings}
            overview={activeOverview}
            metrics={activeMetrics}
            mode={dataSourceMode}
            weather={weather}
            dayData={dayData}
            weekData={weekData}
            monthData={monthData}
            yearData={yearData}
            onBackToMainMap={handleBackToMainMap}
            onSelectSite={handleNavigateToSubpage}
            onOpenBindingModal={handleOpenBindingModal}
            onOpenDetailInspectionModal={handleOpenDetailModal}
          />
        ) : (
          <Solar3DViewer
            buildings={buildings}
            selectedBuildingId={selectedBuilding?.id || null}
            siteMetrics={siteMetrics}
            totals={regionalTotals}
            onSelectBuilding={handleSelectBuilding}
            onOpenDetailModal={handleOpenDetailModal}
            onOpenBindingModal={handleOpenBindingModal}
            onNavigateToSubpage={handleNavigateToSubpage}
            onOpenAddModal={handleOpenAddModal}
            onOpenDeleteDialog={handleOpenDeleteDialog}
            showSiteEditTools={config.showSiteEditTools}
            timeOfDayHour={timeOfDayHour}
            onTimeOfDayChange={handleTimeOfDayChange}
          />
        )}

        {/* Ceremony masthead — main map only; the site sub-page has its own header. */}
        {navigationMode === 'main-map' && <CeremonyHero />}
      </div>

      {/* 5. Modals */}
      {/* Add New Site Pin Modal */}
      {isAddBuildingModalOpen && (
        <AddBuildingModal
          existingBuildings={buildings}
          availableSites={solarEdgeSites}
          overviews={solarEdgeOverviews}
          onAddBuilding={handleAddBuilding}
          onClose={() => setIsAddBuildingModalOpen(false)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteCandidateBuilding && (
        <DeleteBuildingDialog
          building={deleteCandidateBuilding}
          onConfirmDelete={handleDeleteBuilding}
          onClose={() => setDeleteCandidateBuilding(null)}
        />
      )}

      {/* Inverter & String Inspection Modal */}
      {isDetailModalOpen && selectedBuilding && (
        <BuildingDetailModal
          building={selectedBuilding}
          metrics={activeMetrics}
          mode={dataSourceMode}
          overview={activeOverview}
          onOpenBindingModal={(bld) => {
            setIsDetailModalOpen(false);
            setBindingModalBuilding(bld);
          }}
          onEditLocation={(bld) => {
            setIsDetailModalOpen(false);
            setSelectedBuilding(bld);
            setNavigationMode('main-map');
          }}
          onOpenDeleteDialog={(bld) => {
            setIsDetailModalOpen(false);
            setDeleteCandidateBuilding(bld);
          }}
          onClose={() => {
            setIsDetailModalOpen(false);
          }}
        />
      )}

      {/* SolarEdge Site Binding Modal */}
      {bindingModalBuilding && (
        <BuildingBindingModal
          building={bindingModalBuilding}
          availableSites={solarEdgeSites}
          overviews={solarEdgeOverviews}
          currentBinding={bindings[bindingModalBuilding.id]}
          onSaveBinding={handleSaveBinding}
          onClose={() => setBindingModalBuilding(null)}
        />
      )}

      {/* SolarEdge API Configuration Modal */}
      {isSettingsOpen && (
        <SolarEdgeSettingsModal
          config={config}
          sites={solarEdgeSites}
          overviews={solarEdgeOverviews}
          quotaInfo={quotaInfo}
          bindings={bindings}
          buildings={buildings}
          isLoading={isSolarEdgeLoading}
          backendStatus={backendStatus}
          lastError={solarEdgeError}
          onSaveConfig={handleSaveConfig}
          onForceRefresh={() => loadSolarEdgeData({ forceRefresh: true })}
          onCheckBackend={handleCheckBackend}
          onUnbindBuilding={handleUnbindBuilding}
          onClose={handleCloseSettings}
        />
      )}

      {/* 6. Demo Watermark (Removable in /src/components/Watermark.tsx via ENABLE_DEMO_WATERMARK = false) */}
      <Watermark />
    </main>
  );
}
