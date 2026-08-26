/**
 * DeleteBuildingDialog.tsx
 * Confirmation dialog for removing a building / site pin from the map and dashboard.
 */

import React from 'react';
import { Trash2, AlertTriangle, X, Check } from 'lucide-react';
import { BuildingInfo } from '../types';

interface DeleteBuildingDialogProps {
  building: BuildingInfo | null;
  onConfirmDelete: (buildingId: number) => void;
  onClose: () => void;
}

export const DeleteBuildingDialog: React.FC<DeleteBuildingDialogProps> = ({
  building,
  onConfirmDelete,
  onClose,
}) => {
  if (!building) return null;

  return (
    <div
      id="dialog-delete-building-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="dialog-delete-building-card"
        className="glass-panel-glow p-5 sm:p-6 rounded-3xl w-full max-w-md shadow-2xl border border-rose-500/50 bg-slate-950/95 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rose-500/20 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center shadow">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">ยืนยันการลบหมุดไซต์</h3>
              <p className="text-xs text-rose-300">ลบหมุดอาคาร #{building.id} ออกจากระบบ</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Building Details Box */}
        <div className="p-3.5 rounded-2xl bg-rose-950/30 border border-rose-500/30 mb-4 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-xl bg-rose-500 text-white font-mono font-bold flex items-center justify-center text-xs">
              {building.id}
            </span>
            <div>
              <div className="font-bold text-white text-sm">{building.name}</div>
              <div className="text-[11px] text-slate-400 font-mono">{building.code} • {building.category}</div>
            </div>
          </div>

          <div className="pt-2 border-t border-rose-500/20 grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div>
              <span className="text-slate-400 block text-[10px]">กำลังติดตั้ง:</span>
              <span className="text-amber-300 font-bold">{building.capacityKwp} kWp</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">พิกัด GPS:</span>
              <span className="text-sky-300 font-bold">{building.lat.toFixed(5)}, {building.lng.toFixed(5)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200 mb-5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>การลบนี้จะนำหมุดออกจากแผนที่ 2D, โมเดล 3D และรายการสถิติทั้งหมด (สามารถคืนค่าเริ่มต้น 37 อาคารได้ตลอดเวลา)</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all cursor-pointer"
          >
            ยกเลิก
          </button>

          <button
            type="button"
            id="btn-confirm-delete-building"
            onClick={() => {
              onConfirmDelete(building.id);
              onClose();
            }}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(244,63,94,0.6)] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>ยืนยันการลบ</span>
          </button>
        </div>
      </div>
    </div>
  );
};
