/**
 * SolarEdgeSettingsModal.tsx
 * SolarEdge connection & multi-site manager.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO API KEY FIELD HERE ANY MORE.
 *
 * SolarEdge moved to a consent-based OAuth app, so the credential is a
 * CLIENT_ID / CLIENT_SECRET pair that lives in worker/ and must never be typed
 * into — or stored by — a browser. What used to be an input is a STATUS panel
 * plus a "connect" button that opens SolarEdge Connect.
 *
 * A grant covers ONE site, so the panel is a per-site checklist: three sites
 * means three trips through the consent screen, and the operator has to be
 * able to see which one is still missing.
 * ---------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import {
  SolarEdgeConfig,
  SolarEdgeRawSite,
  SolarEdgeTransformedOverview,
  SolarEdgeQuotaInfo,
  SolarEdgeBackendStatus,
  BuildingSiteBinding,
  BuildingInfo
} from '../types';
import {
  X,
  Key,
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Database,
  Layers,
  Activity,
  Zap,
  Clock,
  Unlink,
  ExternalLink,
  Sparkles,
  Lock,
  PlugZap
} from 'lucide-react';
import { fetchConnectUrl } from '../services/solarEdgeService';

interface SolarEdgeSettingsModalProps {
  config: SolarEdgeConfig;
  sites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  quotaInfo: SolarEdgeQuotaInfo;
  bindings: Record<number, BuildingSiteBinding>;
  buildings: BuildingInfo[];
  isLoading: boolean;
  /** Null until the backend has answered once, and in mock mode. */
  backendStatus: SolarEdgeBackendStatus | null;
  lastError: string | null;
  onSaveConfig: (config: SolarEdgeConfig) => void;
  onForceRefresh: () => Promise<void>;
  onCheckBackend: () => Promise<void>;
  onUnbindBuilding: (buildingId: number) => void;
  onClose: () => void;
}

export const SolarEdgeSettingsModal: React.FC<SolarEdgeSettingsModalProps> = ({
  config,
  sites,
  overviews,
  quotaInfo,
  bindings,
  buildings,
  isLoading,
  backendStatus,
  lastError,
  onSaveConfig,
  onForceRefresh,
  onCheckBackend,
  onUnbindBuilding,
  onClose,
}) => {
  const [formData, setFormData] = useState<SolarEdgeConfig>({ ...config });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setFeedbackMsg(null);
    try {
      await onForceRefresh();
      setFeedbackMsg('สั่งดึงข้อมูลล่าสุดผ่าน backend เรียบร้อย');
    } catch (e) {
      setFeedbackMsg('เกิดข้อผิดพลาดในการดึงข้อมูลล่าสุด');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCheckBackend = async () => {
    setIsChecking(true);
    setFeedbackMsg(null);
    try {
      await onCheckBackend();
    } finally {
      setIsChecking(false);
    }
  };

  /**
   * Start the SolarEdge Connect consent trip.
   *
   * Opened in a NEW TAB rather than navigating this one: the kiosk holds a live
   * MapLibre instance with a warmed tile cache, and tearing it down to visit an
   * external login costs a full WebGL rebuild on return. SolarEdge sends the
   * operator back to this same origin, where App.tsx picks up ?code&site_id.
   */
  const handleConnect = async () => {
    setIsConnecting(true);
    setFeedbackMsg(null);
    try {
      const { url, message } = await fetchConnectUrl();
      if (!url) {
        setFeedbackMsg(message || 'ขอ URL สำหรับเชื่อมต่อไม่สำเร็จ');
        return;
      }
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        // Popup blocked — give them the link rather than failing silently.
        setFeedbackMsg(`เบราว์เซอร์บล็อกหน้าต่างใหม่ — เปิดลิงก์นี้เอง: ${url}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      ...formData,
      // "Connected" now means the backend answered, not that someone typed a
      // key. A key in a text box never proved a connection existed anyway.
      isConnected: !formData.useMock && backendStatus?.reachable === true,
    });
    onClose();
  };

  const boundCount = Object.keys(bindings).length;

  /**
   * Is this site list simulated?
   *
   * Derived from the data rather than from the mode toggle, so the badge cannot
   * drift out of sync with what is on screen: mock mode always yields mock
   * overviews, and a genuine API response is never flagged `isMockData`.
   */
  const isMockSiteList =
    sites.length > 0 &&
    (config.useMock || sites.every((s) => overviews[s.id]?.isMockData === true));
  const quotaPercentage = Math.min(100, Math.round((quotaInfo.callsMadeToday / quotaInfo.dailyQuotaLimit) * 100));

  // "Healthy" now means every configured site is authorized — with per-site
  // grants, a reachable backend with one missing site is not a working system.
  const isBackendHealthy =
    backendStatus?.reachable === true &&
    backendStatus.totalSites > 0 &&
    backendStatus.authorizedCount === backendStatus.totalSites;

  return (
    <div
      id="modal-solaredge-settings-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="modal-solaredge-settings-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-2xl shadow-2xl border border-sky-400/40 text-slate-100 max-h-[90vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sky-500/20 pb-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center border border-sky-400/30">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">SolarEdge OAuth Backend & Multi-Site Manager</h3>
              <p className="text-xs text-slate-400">
                ดึงข้อมูลผ่าน backend (OAuth2) — หาดใหญ่ / ตรัง / ปัตตานี พร้อมระบบแคชประหยัดโควตา
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. Rate Limit & Daily Quota Status Banner (300 calls/day budget) */}
        <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-sky-500/30 mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-200">
                จำนวนครั้งที่ดึงข้อมูลวันนี้ (นับฝั่ง dashboard)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-sky-300">
                ใช้ไป {quotaInfo.callsMadeToday} / {quotaInfo.dailyQuotaLimit} ครั้ง
              </span>
              {/* The browser counts its own calls to /api/solaredge; the backend
                  reports what it actually spent upstream. They are different
                  numbers and conflating them hid the real usage. */}
              {quotaInfo.upstreamCallsToday != null && (
                <span className="text-[10px] bg-sky-500/20 text-sky-200 px-2 py-0.5 rounded-full border border-sky-400/30 font-mono">
                  upstream {quotaInfo.upstreamCallsToday}
                </span>
              )}
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-400/30 font-mono">
                เหลือ {quotaInfo.remainingCalls} ครั้ง
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-500 ${
                quotaPercentage > 80 ? 'bg-rose-500' : quotaPercentage > 50 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.max(5, quotaPercentage)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${quotaInfo.isCacheActive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>
                {quotaInfo.isCacheActive
                  ? 'กำลังใช้งานข้อมูลจากแคช (SWR 4.5 นาที — ทั้ง backend และเบราว์เซอร์)'
                  : 'พร้อมเรียกข้อมูลรอบถัดไป'}
              </span>
            </div>

            <button
              type="button"
              id="btn-force-refresh-api"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="text-sky-300 hover:text-white flex items-center gap-1 font-semibold hover:underline cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-sky-400' : ''}`} />
              <span>{isRefreshing ? 'กำลังดึง...' : 'บังคับรีเฟรช API'}</span>
            </button>
          </div>

          {feedbackMsg && (
            <div className="text-[11px] text-emerald-300 bg-emerald-950/40 p-1.5 rounded-lg border border-emerald-500/30">
              {feedbackMsg}
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* 2. Mode Selector: Live API vs Mock Simulator */}
          <div className="p-3 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <label className="text-slate-300 font-semibold mb-2 block">โหมดแหล่งข้อมูล (Data Source Mode)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="btn-mode-live-api"
                onClick={() => setFormData({ ...formData, useMock: false })}
                className={`p-3 rounded-2xl text-left border transition-all cursor-pointer ${
                  !formData.useMock
                    ? 'bg-emerald-950/40 border-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>🌐 SolarEdge Live API</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  ดึงข้อมูลจริงอัตโนมัติผ่าน backend — หาดใหญ่ / ตรัง / ปัตตานี
                </div>
              </button>

              <button
                type="button"
                id="btn-mode-mock-simulator"
                onClick={() => setFormData({ ...formData, useMock: true })}
                className={`p-3 rounded-2xl text-left border transition-all cursor-pointer ${
                  formData.useMock
                    ? 'bg-sky-950/40 border-sky-400 text-white shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-sky-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>⚡ Mock Simulator (5 Sites ม.อ.)</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  ใช้ข้อมูลจำลอง 5 ไซต์เสมือนจริงของวิทยาเขตหาดใหญ่
                </div>
              </button>
            </div>
          </div>

          {/* 3. Backend / OAuth connection status (replaces the old API key field) */}
          {!formData.useMock && (
            <div className="space-y-2">
              <label className="block text-slate-300 font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>การเชื่อมต่อ SolarEdge (OAuth2 — ไม่ต้องกรอกอะไร)</span>
              </label>

              <div
                className={`p-3 rounded-2xl border space-y-2 ${
                  isBackendHealthy
                    ? 'bg-emerald-950/30 border-emerald-500/40'
                    : backendStatus
                      ? 'bg-rose-950/30 border-rose-500/40'
                      : 'bg-slate-900/70 border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <PlugZap
                      className={`w-4 h-4 ${isBackendHealthy ? 'text-emerald-400' : 'text-rose-400'}`}
                    />
                    <span className="font-bold text-white">
                      {!backendStatus
                        ? 'ยังไม่ได้ตรวจสอบ backend'
                        : !backendStatus.reachable
                          ? 'ติดต่อ backend ไม่ได้'
                          : isBackendHealthy
                            ? `เชื่อมต่อครบทุกไซต์ (${backendStatus.authorizedCount}/${backendStatus.totalSites})`
                            : `เชื่อมต่อแล้ว ${backendStatus.authorizedCount}/${backendStatus.totalSites} ไซต์`}
                    </span>
                  </div>

                  <button
                    type="button"
                    id="btn-check-backend"
                    onClick={handleCheckBackend}
                    disabled={isChecking}
                    className="text-sky-300 hover:text-white flex items-center gap-1 font-semibold hover:underline cursor-pointer text-[11px]"
                  >
                    <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin text-sky-400' : ''}`} />
                    <span>{isChecking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสถานะ'}</span>
                  </button>
                </div>

                {/* Per-site authorization.
                    A SolarEdge grant covers ONE site, so this is a checklist,
                    not a single connected/disconnected flag — and the operator
                    needs to see exactly which site is still missing. */}
                {backendStatus?.sites.length ? (
                  <div className="space-y-1">
                    {backendStatus.sites.map((s) => (
                      <div
                        key={s.siteId}
                        className="flex items-center justify-between gap-2 bg-slate-950/60 rounded-lg px-2 py-1.5 border border-slate-800"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {s.authorized ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className="text-[11px] text-slate-200 truncate">{s.name}</span>
                          <span className="text-[9px] font-mono text-slate-500 shrink-0">{s.siteId}</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {s.authorized ? (
                            <span className="text-[9px] font-mono text-emerald-300">
                              {s.accessTokenTtlSec != null
                                ? `token ${Math.floor(s.accessTokenTtlSec / 60)} นาที`
                                : 'พร้อมใช้'}
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-amber-300">ยังไม่ได้อนุญาต</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* The consent trip. Opened in a new tab so the kiosk keeps its
                    map, WebGL context and tile cache instead of tearing the
                    whole viewer down and rebuilding it on return. */}
                {backendStatus?.reachable && !isBackendHealthy && (
                  <button
                    type="button"
                    id="btn-connect-solaredge"
                    onClick={handleConnect}
                    disabled={isConnecting}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold transition-colors cursor-pointer text-xs"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>
                      {isConnecting ? 'กำลังเปิดหน้า SolarEdge...' : 'เชื่อมต่อ SolarEdge (อนุญาตสิทธิ์)'}
                    </span>
                  </button>
                )}

                {backendStatus?.reachable && !isBackendHealthy && (
                  <>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      SolarEdge ให้สิทธิ์ <strong>ทีละ 1 ไซต์</strong> — กดปุ่มนี้ ล็อกอิน แล้วเลือกไซต์ที่ยังไม่ได้เชื่อมต่อ
                      ทำซ้ำจนครบ {backendStatus.totalSites} ไซต์ ระบบจะพากลับมาที่หน้านี้เองอัตโนมัติ
                    </p>

                    {/* The failure mode that actually blocks this deployment.
                        It looks like a bug in our app but is a hard limit on
                        SolarEdge's side, and the way out is a different
                        credential entirely — worth saying before someone spends
                        an hour retrying the same button. */}
                    <p className="text-[10px] text-amber-300/90 bg-amber-950/30 border border-amber-700/40 rounded-lg px-2 py-1.5 leading-snug">
                      ถ้า SolarEdge ขึ้นว่า <em>“associated to multiple SolarEdge sites”</em> — บัญชีนั้นมีหลายไซต์
                      ซึ่ง Connect <strong>ยังไม่รองรับ</strong> ทางออกคือใช้ <strong>Fleet API Key</strong> แทน:
                      สร้างใน Developer Platform แล้วใส่ที่ <code className="font-mono text-sky-300">SOLAREDGE_API_KEY</code> ใน
                      <code className="font-mono text-sky-300"> worker/.dev.vars</code> — ครอบคลุมทุกไซต์ ไม่ต้องกด consent เลย
                    </p>
                  </>
                )}

                {/* Per-site upstream failures. Two working pins and one silent
                    gap is exactly the state that needs naming out loud. */}
                {backendStatus?.siteErrors.length ? (
                  <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-600/40 rounded-lg px-2 py-1.5 space-y-0.5">
                    {backendStatus.siteErrors.map((e) => (
                      <div key={e.siteId}>
                        <span className="font-mono font-bold">Site {e.siteId}</span>: {e.message}
                      </div>
                    ))}
                  </div>
                ) : null}

                {backendStatus?.message && (
                  <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-600/40 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{backendStatus.message}</span>
                  </div>
                )}

                {lastError && !backendStatus?.message && (
                  <div className="text-[10px] text-amber-300 bg-amber-950/40 border border-amber-600/40 rounded-lg px-2 py-1.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{lastError}</span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                CLIENT_ID / CLIENT_SECRET เก็บอยู่ที่ <code className="text-sky-300 font-mono">worker/.dev.vars</code> ฝั่งเซิร์ฟเวอร์เท่านั้น
                เบราว์เซอร์เรียกแค่ <code className="text-sky-300 font-mono">/api/solaredge/overview</code> แล้ว backend
                จะแลก Access Token (อายุ 2 ชม.) และแนบ <code className="text-sky-300 font-mono">Authorization: Bearer</code> ให้เอง
                — ถ้าเชื่อมต่อไม่ได้ ให้ตรวจว่ารัน <code className="text-sky-300 font-mono">npm run worker</code> อยู่หรือไม่
              </p>
            </div>
          )}

          {/* 4. List of 5 Fetched SolarEdge Sites */}
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1.5 flex-wrap">
                <Database className="w-3.5 h-3.5 text-sky-400" />
                <span>รายชื่อ SolarEdge Sites ({sites.length} ไซต์ในบัญชี)</span>
                {/* Driven by the data itself, not hard-coded: the label can never
                    disagree with what is actually being shown. */}
                {isMockSiteList && (
                  <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-950/60 border border-amber-600/40 px-1.5 py-0.5 rounded">
                    (mock site data)
                  </span>
                )}
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                ผูกกับอาคารบนแผนที่แล้ว {boundCount} อาคาร
              </span>
            </div>

            {isMockSiteList && (
              <p className="text-[10px] text-amber-300/80 bg-amber-950/30 border border-amber-700/30 rounded-lg px-2 py-1.5 mb-2 leading-snug">
                ไซต์ทั้ง {sites.length} รายการนี้เป็น<strong> ข้อมูลจำลอง </strong>
                ไม่ได้ดึงจากบัญชี SolarEdge จริง — สลับไปโหมด SolarEdge Live API
                เพื่อให้ backend ดึงข้อมูลจริงของ 3 ไซต์ (หาดใหญ่ / ตรัง / ปัตตานี) อัตโนมัติ
              </p>
            )}

            <div className="space-y-2">
              {sites.map((site) => {
                const ov = overviews[site.id];
                return (
                  <div
                    key={site.id}
                    className="p-3 rounded-2xl bg-slate-900/70 border border-sky-500/20 hover:border-sky-400/40 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{site.name}</span>
                        <span className="text-[10px] bg-slate-800 text-sky-300 px-1.5 py-0.5 rounded font-mono">
                          ID: {site.id}
                        </span>
                        <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/30">
                          {site.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-2 font-mono">
                        <span>Peak: {site.peakPower} kWp</span>
                        <span>•</span>
                        <span>{site.type}</span>
                        <span>•</span>
                        <span className="text-slate-500">{site.location?.city || 'PSU Hat Yai'}</span>
                      </div>
                    </div>

                    {/* Transformed Values Preview */}
                    {ov && (
                      <div className="flex items-center gap-3 text-right bg-slate-950/60 px-3 py-1.5 rounded-xl border border-slate-800/80">
                        <div>
                          <span className="text-[9px] text-slate-500 block">กำลังผลิตขณะนี้</span>
                          <span className="text-xs font-bold font-mono text-emerald-300">
                            {ov.currentPowerKw} kW
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">พลังงานวันนี้</span>
                          <span className="text-xs font-bold font-mono text-sky-300">
                            {ov.dailyEnergyKwh} kWh
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-500 block">เดือนนี้</span>
                          <span className="text-xs font-bold font-mono text-indigo-300">
                            {ov.monthlyEnergyMwh} MWh
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5. Currently Bound Buildings */}
          {boundCount > 0 && (
            <div className="p-3 rounded-2xl bg-slate-900/50 border border-sky-500/20">
              <label className="text-slate-300 font-semibold mb-2 block flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>ตารางการผูกข้อมูล (Building ↔ SolarEdge Site Mappings)</span>
              </label>

              <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                {(Object.values(bindings) as BuildingSiteBinding[]).map((bind) => {
                  const bld = buildings.find((b) => b.id === bind.buildingId);
                  return (
                    <div
                      key={bind.buildingId}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold flex items-center justify-center text-[10px]">
                          {bind.buildingId}
                        </span>
                        <span className="font-medium text-slate-200">{bld?.name || `อาคาร #${bind.buildingId}`}</span>
                        <span className="text-slate-500">➔</span>
                        <span className="text-sky-300 font-mono">Site #{bind.siteId}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-slate-800 text-emerald-300 px-2 py-0.5 rounded font-mono">
                          {bind.primaryMetric === 'currentPower' && 'กำลังผลิต (kW)'}
                          {bind.primaryMetric === 'dailyEnergy' && 'วันนี้ (kWh)'}
                          {bind.primaryMetric === 'monthlyEnergy' && 'เดือนนี้ (MWh)'}
                          {bind.primaryMetric === 'lifetimeEnergy' && 'สะสม (MWh)'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUnbindBuilding(bind.buildingId)}
                          title="ยกเลิกการผูก"
                          className="p-1 rounded bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Unlink className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-sky-500/20">
            <div className="text-[10px] text-slate-400">
              💡 คลิกเลือกอาคารใดก็ได้บนแผนที่เพื่อผูก SolarEdge Site ได้โดยตรง
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-xs"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                id="btn-save-solaredge-config"
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold shadow-lg transition-colors cursor-pointer text-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกการตั้งค่า</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
