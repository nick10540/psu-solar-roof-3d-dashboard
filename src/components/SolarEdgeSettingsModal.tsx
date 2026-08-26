/**
 * SolarEdgeSettingsModal.tsx
 * Advanced SolarEdge Monitoring API Management Modal
 * Compliant with SolarEdge Monitoring API Specification:
 * - Single Account Fetching (/sites/list?size=5)
 * - 300 Calls/Day Rate Limit Quota Tracker with 15-Minute SWR Cache
 * - Real-time Transformed Metric Summary
 * - Building-Site Binding Overview
 */

import React, { useState } from 'react';
import { 
  SolarEdgeConfig, 
  SolarEdgeRawSite, 
  SolarEdgeTransformedOverview, 
  SolarEdgeQuotaInfo, 
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
  Sparkles
} from 'lucide-react';

interface SolarEdgeSettingsModalProps {
  config: SolarEdgeConfig;
  sites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  quotaInfo: SolarEdgeQuotaInfo;
  bindings: Record<number, BuildingSiteBinding>;
  buildings: BuildingInfo[];
  isLoading: boolean;
  onSaveConfig: (config: SolarEdgeConfig) => void;
  onForceRefresh: () => Promise<void>;
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
  onSaveConfig,
  onForceRefresh,
  onUnbindBuilding,
  onClose,
}) => {
  const [formData, setFormData] = useState<SolarEdgeConfig>({ ...config });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setFeedbackMsg(null);
    try {
      await onForceRefresh();
      setFeedbackMsg('ดึงข้อมูลล่าสุดจาก SolarEdge API ทั้ง 5 ไซต์สำเร็จเรียบร้อย');
    } catch (e) {
      setFeedbackMsg('เกิดข้อผิดพลาดในการดึงข้อมูลล่าสุด');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      ...formData,
      isConnected: !formData.useMock && !!formData.apiKey.trim(),
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
              <h3 className="text-base font-bold text-white">SolarEdge Monitoring API & Multi-Site Manager</h3>
              <p className="text-xs text-slate-400">
                ดึงข้อมูล 5 ไซต์ภายใต้บัญชีเดียวกัน พร้อมระบบประหยัดโควตา 300 Requests/วัน
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
                สถานะโควตา API Rate Limit (300 Calls / วัน)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-sky-300">
                ใช้ไป {quotaInfo.callsMadeToday} / {quotaInfo.dailyQuotaLimit} ครั้ง
              </span>
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
                  ? 'กำลังใช้งานข้อมูลจาก Caching (SWR 15 นาที เพื่อประหยัดโควตา)'
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
                  ดึงข้อมูลจริงจาก SolarEdge Monitoring API (/sites/list)
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

          {/* 3. API Key Input */}
          {!formData.useMock && (
            <div className="space-y-2">
              <label className="block text-slate-300 font-semibold">
                SolarEdge API Key (สำหรับดึง 5 ไซต์ในบัญชีเดียวกัน)
              </label>
              <div className="relative">
                <input
                  id="input-solaredge-api-key"
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="กรอก SolarEdge API Key เช่น 32 ตัวอักษร"
                  className="w-full bg-slate-900/90 border border-sky-500/30 rounded-xl px-3 py-2.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-400"
                />
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                ระบบจะเรียก Endpoint: <code className="text-sky-300 font-mono">/sites/list?size=5&api_key=...</code> เพื่อดึง 5 ไซต์แรกในบัญชีทันที และเก็บแคชไว้ 15 นาทีตามรอบเซิร์ฟเวอร์ SolarEdge
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
                ไม่ได้ดึงจากบัญชี SolarEdge จริง — สลับไปโหมด SolarEdge Live API แล้วกรอก API Key
                เพื่อดึงรายชื่อไซต์จริงในบัญชี
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
              ������ คลิกเลือกอาคารใดก็ได้บนแผนที่เพื่อผูก SolarEdge Site ได้โดยตรง
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
