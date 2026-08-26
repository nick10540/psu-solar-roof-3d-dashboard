/**
 * AddBuildingModal.tsx
 * Modal for creating and adding a new Solar Roof site/building pin on the map.
 * Supports custom GPS coordinates, Solar capacity, inverters, and instant SolarEdge binding.
 */

import React, { useState } from 'react';
import { 
  X, 
  Plus, 
  MapPin, 
  Zap, 
  Building2, 
  Layers, 
  Cpu, 
  Sparkles, 
  Check, 
  Compass,
  AlertCircle
} from 'lucide-react';
import { BuildingInfo, SolarEdgeRawSite, SolarEdgeTransformedOverview } from '../types';
import { NewBuildingPayload } from '../services/buildingStorageService';

interface AddBuildingModalProps {
  existingBuildings: BuildingInfo[];
  availableSites?: SolarEdgeRawSite[];
  overviews?: Record<number, SolarEdgeTransformedOverview>;
  onAddBuilding: (payload: NewBuildingPayload, bindSiteId?: number) => void;
  onClose: () => void;
}

const CATEGORY_PRESETS = [
  'วิทยาศาสตร์สุขภาพ',
  'วิศวกรรมศาสตร์',
  'วิทยาศาสตร์และเทคโนโลยี',
  'มนุษยศาสตร์และสังคมศาสตร์',
  'หอพักและสวัสดิการ',
  'อาคารบริการและอาหาร',
  'ศูนย์กีฬาและนันทนาการ',
  'โซลาร์ลอยน้ำ (Floating Solar)',
  'อาคารบริหารและวิจัย',
];

const GPS_PRESETS = [
  { name: '🏛️ ศูนย์กลาง ม.อ.', lat: 7.008926, lng: 100.499009 },
  { name: '🏥 วิทย์สุขภาพ', lat: 7.011500, lng: 100.495500 },
  { name: '⚙️ วิศวะ-วิทยาศาสตร์', lat: 7.008000, lng: 100.501500 },
  { name: '🏢 หอพักนักศึกษา', lat: 7.005500, lng: 100.494500 },
  { name: '🌊 สระน้ำ ม.อ.', lat: 7.002800, lng: 100.498500 },
  { name: '🎪 ศูนย์ประชุม 60 ปี', lat: 7.006800, lng: 100.511500 },
];

export const AddBuildingModal: React.FC<AddBuildingModalProps> = ({
  existingBuildings,
  availableSites = [],
  onAddBuilding,
  onClose,
}) => {
  const nextId = existingBuildings.length > 0 ? Math.max(...existingBuildings.map((b) => b.id)) + 1 : 1;

  // Form States
  const [name, setName] = useState('');
  const [enName, setEnName] = useState('');
  const [code, setCode] = useState(`BLD-${nextId.toString().padStart(2, '0')}`);
  const [category, setCategory] = useState(CATEGORY_PRESETS[0]);
  const [pinColor, setPinColor] = useState<'blue' | 'red'>('blue');
  const [lat, setLat] = useState<number>(7.008926);
  const [lng, setLng] = useState<number>(100.499009);
  const [capacityKwp, setCapacityKwp] = useState<number>(120.0);
  const [panelCount, setPanelCount] = useState<number>(240);
  const [areaM2, setAreaM2] = useState<number>(1080);
  const [inverterCount, setInverterCount] = useState<number>(2);
  const [bindSiteId, setBindSiteId] = useState<number | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto update panels & area when capacity changes
  const handleCapacityChange = (val: number) => {
    setCapacityKwp(val);
    setPanelCount(Math.round(val * 2));
    setAreaM2(Math.round(val * 9));
    setInverterCount(Math.max(1, Math.ceil(val / 60)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('กรุณากรอกชื่ออาคาร');
      return;
    }
    if (isNaN(lat) || isNaN(lng) || lat < 6.9 || lat > 7.1 || lng < 100.4 || lng > 100.6) {
      setErrorMsg('กรุณาระบุพิกัด GPS (ละติจูด/ลองจิจูด) ในเขตวิทยาเขต ม.อ. หาดใหญ่');
      return;
    }
    if (capacityKwp <= 0) {
      setErrorMsg('กรุณาระบุกำลังติดตั้ง (kWp) มากกว่า 0');
      return;
    }

    onAddBuilding(
      {
        name: name.trim(),
        enName: enName.trim() || undefined,
        code: code.trim() || undefined,
        category,
        pinColor,
        lat,
        lng,
        capacityKwp,
        panelCount,
        areaM2,
        inverterCount,
      },
      bindSiteId
    );

    onClose();
  };

  return (
    <div
      id="modal-add-building-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="modal-add-building-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl border border-sky-400/40 custom-scrollbar text-slate-100 bg-slate-950/95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sky-500/20 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-sky-500 text-slate-950 font-mono font-black flex items-center justify-center text-sm shadow-[0_0_15px_rgba(56,189,248,0.6)]">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>เพิ่มหมุดอาคาร / ไซต์ใหม่</span>
                <span className="text-xs bg-sky-500/20 text-sky-300 font-mono px-2 py-0.5 rounded-full border border-sky-400/30">
                  #{nextId}
                </span>
              </h3>
              <p className="text-xs text-slate-400">สร้างหมุดโซล่าร์รูฟใหม่พร้อมพิกัดดาวเทียมจริง</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Section 1: ข้อมูลอาคาร */}
          <div className="space-y-3 p-3.5 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <div className="flex items-center gap-1.5 text-sky-300 font-bold">
              <Building2 className="w-3.5 h-3.5" />
              <span>1. ข้อมูลอาคารและหมวดหมู่</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  ชื่ออาคาร (ภาษาไทย) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น อาคารเรียนรวม 8"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  ชื่อภาษาอังกฤษ
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lecture Hall 8"
                  value={enName}
                  onChange={(e) => setEnName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  รหัสอาคาร
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  กลุ่มอาคาร
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-white focus:outline-none focus:border-sky-400 cursor-pointer"
                >
                  {CATEGORY_PRESETS.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  สีหมุดบนแผนที่
                </label>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setPinColor('blue')}
                    className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 font-medium transition-all cursor-pointer border ${
                      pinColor === 'blue'
                        ? 'bg-sky-500/30 text-sky-200 border-sky-400 shadow'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                    <span>ฟ้า</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPinColor('red')}
                    className={`py-1.5 px-2 rounded-xl flex items-center justify-center gap-1.5 font-medium transition-all cursor-pointer border ${
                      pinColor === 'red'
                        ? 'bg-rose-500/30 text-rose-200 border-rose-400 shadow'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
                    <span>ส้ม/แดง</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: พิกัด GPS จริง */}
          <div className="space-y-3 p-3.5 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-amber-300 font-bold">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>2. พิกัดภูมิศาสตร์ GPS บนวิทยาเขต</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">PSU Hatyai Center: 7.0089, 100.4990</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  Latitude (ละติจูด N)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={lat}
                  onChange={(e) => setLat(parseFloat(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-amber-300 font-mono focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-300 font-medium block mb-1">
                  Longitude (ลองจิจูด E)
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  value={lng}
                  onChange={(e) => setLng(parseFloat(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sky-300 font-mono focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            {/* Quick GPS Presets */}
            <div>
              <span className="text-[10px] text-slate-400 block mb-1.5">เลือกพิกัดโซนด่วนใน ม.อ. :</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {GPS_PRESETS.map((pst) => (
                  <button
                    key={pst.name}
                    type="button"
                    onClick={() => {
                      setLat(pst.lat);
                      setLng(pst.lng);
                    }}
                    className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 hover:text-white transition-all text-left flex items-center gap-1 cursor-pointer"
                  >
                    <span>{pst.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 3: สเปกระบบ Solar PV */}
          <div className="space-y-3 p-3.5 rounded-2xl bg-slate-900/60 border border-sky-500/20">
            <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>3. สเปกระบบ Solar PV & Inverter</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="text-[10px] text-slate-300 font-medium block mb-1">
                  กำลังติดตั้ง (kWp)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  value={capacityKwp}
                  onChange={(e) => handleCapacityChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-emerald-300 font-bold font-mono focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-300 font-medium block mb-1">
                  จำนวนแผง (Panels)
                </label>
                <input
                  type="number"
                  min="1"
                  value={panelCount}
                  onChange={(e) => setPanelCount(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-300 font-medium block mb-1">
                  พื้นที่หลังคา (m²)
                </label>
                <input
                  type="number"
                  min="1"
                  value={areaM2}
                  onChange={(e) => setAreaM2(parseInt(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-300 font-medium block mb-1">
                  จำนวน Inverter
                </label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={inverterCount}
                  onChange={(e) => setInverterCount(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>
          </div>

          {/* Section 4: ผูกกับ SolarEdge Site (ถ้ามี) */}
          {availableSites.length > 0 && (
            <div className="space-y-2 p-3.5 rounded-2xl bg-slate-900/60 border border-sky-500/20">
              <div className="flex items-center gap-1.5 text-sky-300 font-bold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>4. ผูกกับ SolarEdge Monitoring Site (ตัวเลือก)</span>
              </div>
              <select
                value={bindSiteId || ''}
                onChange={(e) => setBindSiteId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-400 cursor-pointer"
              >
                <option value="">-- ยังไม่ผูก (ใช้ระบบคำนวณจำลอง) --</option>
                {availableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    Site #{site.id}: {site.name} ({site.peakPower} kWp)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="pt-3 border-t border-sky-500/20 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-all cursor-pointer"
            >
              ยกเลิก
            </button>

            <button
              type="submit"
              id="btn-confirm-add-building"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.5)] transition-all cursor-pointer flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>บันทึกและเพิ่มหมุด #{nextId}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
