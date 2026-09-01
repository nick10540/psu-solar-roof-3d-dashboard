/**
 * BuildingBindingModal.tsx
 * Maps a site pin to a SolarEdge Site ID. Persists in LocalStorage and the map
 * balloon updates from it.
 *
 * The "Primary Metric" chooser was removed: the balloon shows three fixed
 * values (current power / lifetime energy / installed capacity), so the choice
 * changed nothing. This modal now does one job - pick which SolarEdge site
 * feeds this pin.
 */

import React, { useState } from 'react';
import { 
  BuildingInfo, 
  SolarEdgeRawSite, 
  SolarEdgeTransformedOverview, 
  BindingDisplayMetric, 
  BuildingSiteBinding,
  bindingSiteIds,
  MAX_SITE_IDS_PER_BUILDING,
} from '../types';
import {
  X,
  Link2,
  Unlink,
  CheckCircle2,
  Clock,
  Sparkles,
  Building2
} from 'lucide-react';

interface BuildingBindingModalProps {
  building: BuildingInfo;
  availableSites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  currentBinding?: BuildingSiteBinding;
  onSaveBinding: (binding: BuildingSiteBinding) => void;
  onClose: () => void;
}

export const BuildingBindingModal: React.FC<BuildingBindingModalProps> = ({
  building,
  availableSites,
  overviews,
  currentBinding,
  onSaveBinding,
  onClose,
}) => {
  /**
   * One text field per allowed ID, held as strings.
   *
   * Strings rather than numbers so a half-typed value does not momentarily
   * resolve to a different site — "4956" is not site 4956 on the way to
   * 4956359, and coercing on every keystroke would fire a fetch for it.
   */
  const [idFields, setIdFields] = useState<string[]>(() => {
    const existing = bindingSiteIds(currentBinding).map(String);
    return Array.from(
      { length: MAX_SITE_IDS_PER_BUILDING },
      (_, i) => existing[i] ?? ''
    );
  });

  /** Valid, de-duplicated IDs in field order. */
  const enteredIds: number[] = [];
  for (const raw of idFields) {
    const n = Number(raw.trim());
    if (!raw.trim() || !Number.isInteger(n) || n <= 0) continue;
    if (!enteredIds.includes(n)) enteredIds.push(n);
  }

  const setField = (index: number, value: string) => {
    // Digits only: the field feeds a numeric site ID, and stripping here means
    // a pasted "#4956359" or "4956359 " does not silently become unbound.
    const cleaned = value.replace(/[^0-9]/g, '').slice(0, 12);
    setIdFields((prev) => prev.map((v, i) => (i === index ? cleaned : v)));
  };

  /** Drop an account site into the first free field, ignoring duplicates. */
  const addFromAccount = (siteId: number) => {
    if (enteredIds.includes(siteId)) return;
    setIdFields((prev) => {
      const next = [...prev];
      const free = next.findIndex((v) => !v.trim());
      if (free === -1) return prev;
      next[free] = String(siteId);
      return next;
    });
  };

  /**
   * The map balloon shows fixed values (power / lifetime energy / installed
   * capacity / CO2), so there is nothing for the operator to choose here any
   * more. `primaryMetric` is kept on the persisted binding purely so existing
   * saved records stay readable; it no longer affects rendering.
   */
  const primaryMetric: BindingDisplayMetric = currentBinding?.primaryMetric || 'currentPower';

  /**
   * What the pin will show: the SUM across every entered ID.
   *
   * Computed here as well as in siteMetricsService so the operator can see the
   * combined figure before saving. Only IDs the backend has actually returned
   * contribute; one unknown ID among three does not blank the preview.
   */
  const previewRows = enteredIds.map((id) => ({
    id,
    site: availableSites.find((s) => s.id === id) || null,
    overview: overviews[id] || null,
  }));
  const known = previewRows.filter((r) => r.overview);
  const sum = {
    powerKw: known.reduce((a, r) => a + (r.overview!.currentPowerKw || 0), 0),
    lifetimeKwh: known.reduce((a, r) => a + (r.overview!.lifetimeEnergyKwh || 0), 0),
    capacityKwp: previewRows.reduce((a, r) => a + (r.site?.peakPower || 0), 0),
    co2Kg: known.reduce((a, r) => a + (r.overview!.co2Kg || 0), 0),
  };

  const handleSave = () => {
    const isBound = enteredIds.length > 0;
    const names = previewRows.map((r) => r.site?.name).filter(Boolean);
    onSaveBinding({
      buildingId: building.id,
      siteId: enteredIds[0] ?? null,
      siteIds: enteredIds,
      siteName:
        names.length > 0
          ? names.join(' + ')
          : isBound
            ? `Site #${enteredIds.join(' + #')}`
            : undefined,
      primaryMetric,
      customCapacityKwp: sum.capacityKwp || building.capacityKwp,
      isBound,
      boundAt: isBound ? new Date().toISOString() : undefined,
    });
    onClose();
  };

  const handleUnbind = () => {
    onSaveBinding({
      buildingId: building.id,
      siteId: null,
      siteIds: [],
      primaryMetric: 'currentPower',
      isBound: false,
    });
    onClose();
  };


  return (
    <div
      id="modal-building-binding-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="modal-building-binding-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-xl shadow-2xl border border-sky-400/40 text-slate-100 max-h-[90vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-sky-500/20 pb-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500 text-slate-950 flex items-center justify-center font-mono font-black text-lg shadow-[0_0_12px_rgba(56,189,248,0.6)] shrink-0">
              {building.id}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">{building.name}</h3>
                <span className="text-[10px] bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full border border-sky-400/30 font-mono">
                  {building.code}
                </span>
              </div>
              <p className="text-xs text-slate-400">เชื่อมโยงข้อมูล SolarEdge Monitoring API เข้ากับอาคารนี้</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 1. Site IDs: typed in directly, up to MAX_SITE_IDS_PER_BUILDING */}
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-sky-400" />
              <span>
                SolarEdge Site ID ของหมุดนี้ (ใส่ได้ถึง {MAX_SITE_IDS_PER_BUILDING} ID)
              </span>
            </label>
            <p className="text-[10px] text-slate-500 mb-2 leading-snug">
              ค่าจากทุก ID จะถูก <span className="text-slate-300 font-semibold">รวมกัน</span> แล้วแสดงเป็นค่าเดียวบนหมุด
              ใช้เมื่อวิทยาเขตหนึ่งถูกลงทะเบียนแยกหลายไซต์ใน SolarEdge · เว้นว่างไว้ถ้าไม่ใช้
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {idFields.map((value, i) => {
                const n = Number(value.trim());
                const dup =
                  value.trim() !== '' &&
                  idFields.findIndex((v) => v.trim() === value.trim()) !== i;
                const site = availableSites.find((s) => s.id === n) || null;
                return (
                  <div key={i}>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[9.5px] text-slate-500 font-mono">ID {i + 1}</span>
                      {i === 0 && <span className="text-[9px] text-sky-400/80">(หลัก)</span>}
                    </div>
                    <input
                      id={`input-site-id-${i}`}
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => setField(i, e.target.value)}
                      placeholder="เช่น 4956359"
                      className={`w-full bg-slate-900/90 border rounded-xl px-2.5 py-2 text-slate-100 font-mono focus:outline-none text-xs shadow-inner ${
                        dup
                          ? 'border-amber-500/60 focus:border-amber-400'
                          : 'border-sky-500/30 focus:border-sky-400'
                      }`}
                    />
                    <div className="mt-1 min-h-[13px] text-[9.5px] leading-none">
                      {dup ? (
                        <span className="text-amber-400">ซ้ำกับช่องอื่น — จะนับครั้งเดียว</span>
                      ) : site ? (
                        <span className="text-emerald-400 truncate block">✓ {site.name}</span>
                      ) : value.trim() ? (
                        <span className="text-slate-500">ยังไม่พบใน API — จะลองดึงเมื่อบันทึก</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick-add from the sites the backend already knows about */}
          {availableSites.length > 0 && (
            <div>
              <span className="text-[10px] text-slate-400 block mb-1.5">
                หรือเลือกจากไซต์ที่พบในบัญชี:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {availableSites.map((site) => {
                  const already = enteredIds.includes(site.id);
                  const full = enteredIds.length >= MAX_SITE_IDS_PER_BUILDING;
                  return (
                    <button
                      key={site.id}
                      type="button"
                      disabled={already || full}
                      onClick={() => addFromAccount(site.id)}
                      className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-colors ${
                        already
                          ? 'bg-emerald-950/50 border-emerald-600/40 text-emerald-400 cursor-default'
                          : full
                            ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed'
                            : 'bg-slate-900/80 border-sky-500/30 text-sky-300 hover:border-sky-400 cursor-pointer'
                      }`}
                    >
                      {already ? '✓ ' : '+ '}#{site.id} {site.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-ID contributions, so a wrong ID is obvious before saving */}
          {enteredIds.length > 0 ? (
            <div className="p-3.5 rounded-2xl bg-sky-950/40 border border-sky-400/30 space-y-2">
              <span className="font-bold text-sky-300 flex items-center gap-1.5 text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  รวมจาก {enteredIds.length} ID
                  {known.length < enteredIds.length ? ` (มีข้อมูล ${known.length} ID)` : ''}
                </span>
              </span>

              <div className="space-y-1">
                {previewRows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-[10px] font-mono bg-slate-900/70 rounded-lg px-2 py-1.5 border border-slate-800"
                  >
                    <span className="text-sky-300 shrink-0">#{r.id}</span>
                    <span className="text-slate-400 truncate flex-1 text-left">
                      {r.site ? r.site.name : 'ไม่พบชื่อไซต์'}
                    </span>
                    {r.overview ? (
                      <span className="text-emerald-300 shrink-0">
                        {r.overview.currentPowerKw.toFixed(1)} kW ·{' '}
                        {Math.round(r.overview.lifetimeEnergyKwh).toLocaleString()} kWh
                      </span>
                    ) : (
                      <span className="text-slate-500 shrink-0">ไม่มีข้อมูล</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center pt-1">
                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">กำลังผลิตรวม</span>
                  <span className="text-sm font-bold font-mono text-emerald-300">
                    {sum.powerKw.toFixed(1)} kW
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">พลังงานรวม</span>
                  <span className="text-sm font-bold font-mono text-amber-300">
                    {Math.round(sum.lifetimeKwh).toLocaleString()} kWh
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">กำลังติดตั้งรวม</span>
                  <span className="text-sm font-bold font-mono text-sky-300">
                    {sum.capacityKwp.toFixed(0)} kWp
                  </span>
                </div>
                <div className="p-2 rounded-xl bg-slate-900/70 border border-sky-500/20">
                  <span className="text-[10px] text-slate-400 block">ลดการปล่อย CO₂</span>
                  <span className="text-sm font-bold font-mono text-teal-300">
                    {(sum.co2Kg / 1000).toFixed(2)} tonCO₂
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pt-1 border-t border-sky-500/15">
                <Clock className="w-3 h-3 text-slate-500" />
                <span>
                  อัปเดตล่าสุด:{' '}
                  {known.length > 0 && known[0].overview
                    ? known[0].overview.lastUpdateTime
                    : 'ยังไม่มีข้อมูล'}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-2xl bg-slate-900/50 border border-slate-800 text-slate-400 text-[11px] flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
              <span>
                ยังไม่ได้ใส่ Site ID — หมุดนี้จะขึ้นว่าไม่มีข้อมูลในโหมด Live และใช้ค่าจำลองในโหมด Mock
              </span>
            </div>
          )}

          {/*
            Balloon preview.

            Mirrors the four fixed values the map card shows, fed by the SUM
            above rather than by one chosen site. The map's own design is
            untouched by the multi-ID change - it just receives one total.
          */}
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-sky-500/20">
            <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">
              ตัวอย่าง Balloon ที่จะแสดงบนแผนที่:
            </span>

            <div className="glass-panel p-2.5 rounded-xl border border-sky-400/40 text-xs">
              <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-700/60">
                <div className="w-7 h-7 rounded-lg bg-sky-500 text-slate-950 font-bold font-mono flex items-center justify-center text-xs shrink-0">
                  {building.id}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-white text-xs truncate">{building.name}</div>
                  <div className="text-[10px] text-sky-300 font-mono truncate">
                    {enteredIds.length > 0
                      ? `Site #${enteredIds.join(' + #')}`
                      : 'ยังไม่ได้ผูก SolarEdge Site'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">กำลังผลิต</div>
                  <div className="font-bold font-mono text-[11px] text-amber-300">
                    {known.length > 0 ? sum.powerKw.toFixed(1) : '—'}
                    <span className="text-[8px] text-amber-400/80 font-normal ml-0.5">kW</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">พลังงานรวม</div>
                  <div className="font-bold font-mono text-[11px] text-emerald-300">
                    {known.length > 0 ? Math.round(sum.lifetimeKwh).toLocaleString() : '—'}
                    <span className="text-[8px] text-emerald-400/80 font-normal ml-0.5">kWh</span>
                  </div>
                </div>

                <div className="bg-slate-900/90 py-1.5 px-1 rounded-lg border border-sky-500/20">
                  <div className="text-[8.5px] text-slate-400 leading-none mb-1">กำลังติดตั้ง</div>
                  <div className="font-bold font-mono text-[11px] text-sky-300">
                    {sum.capacityKwp > 0 ? sum.capacityKwp.toFixed(0) : '—'}
                    <span className="text-[8px] text-sky-400/80 font-normal ml-0.5">kWp</span>
                  </div>
                </div>
              </div>

              <div className="mt-1.5 bg-slate-900/90 py-1.5 px-2 rounded-lg border border-teal-500/25 flex items-center justify-center gap-2">
                <div className="text-[8.5px] text-slate-400 leading-none">ลดการปล่อย CO₂</div>
                <div className="font-bold font-mono text-[11px] text-teal-300">
                  {known.length > 0 ? (sum.co2Kg / 1000).toFixed(2) : '—'}
                  <span className="text-[8px] text-teal-400/80 font-normal ml-0.5">tonCO₂</span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 mt-2 leading-snug">
              ในโหมด Live API ค่าทั้งหมดจะขึ้นเป็น <span className="font-mono text-slate-400">—</span> จนกว่าจะใส่ Site ID
              และ SolarEdge ส่งค่ากลับมา · ในโหมด Mock จะใช้ค่าจำลองของหมุดนี้
            </p>
          </div>
          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-sky-500/20">
            {currentBinding?.isBound ? (
              <button
                type="button"
                id="btn-unbind-building"
                onClick={handleUnbind}
                className="px-3 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>ยกเลิกการผูก (กลับสู่โหมดจำลอง)</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer text-xs"
              >
                ยกเลิก
              </button>

              <button
                type="button"
                id="btn-save-building-binding"
                onClick={handleSave}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold shadow-lg transition-colors cursor-pointer text-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกการผูกข้อมูล</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
