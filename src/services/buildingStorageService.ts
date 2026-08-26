/**
 * buildingStorageService.ts
 * Manages full building lifecycle: Adding, Editing, Deleting, Coordinate Tweaks, and Defaults Restoration.
 * Persisted in LocalStorage ('psu_solar_buildings_data_v2' and 'psu_solar_deleted_ids_v2')
 */

import { BuildingInfo, InverterInfo } from '../types';
import { PSU_ALL_BUILDINGS } from '../data/mockSolarData';
import { loadCustomBuildingCoords, CustomCoordsMap } from './buildingCoordsService';

const STORAGE_KEY_CUSTOM_BUILDINGS = 'mea_solar_custom_buildings_v4';
const STORAGE_KEY_DELETED_BUILDINGS = 'mea_solar_deleted_ids_v4';

export interface NewBuildingPayload {
  name: string;
  enName?: string;
  code?: string;
  category: string;
  pinColor: 'blue' | 'red';
  lat: number;
  lng: number;
  capacityKwp: number;
  panelCount?: number;
  areaM2?: number;
  inverterCount?: number;
}

/**
 * Load all active buildings (Default PSU Buildings + Custom Added Buildings - Deleted Buildings + Custom Coordinates)
 */
export function loadActiveBuildings(): BuildingInfo[] {
  try {
    const deletedIdsRaw = localStorage.getItem(STORAGE_KEY_DELETED_BUILDINGS);
    const deletedIds: number[] = deletedIdsRaw ? JSON.parse(deletedIdsRaw) : [];

    const customBldsRaw = localStorage.getItem(STORAGE_KEY_CUSTOM_BUILDINGS);
    const customBuildings: BuildingInfo[] = customBldsRaw ? JSON.parse(customBldsRaw) : [];

    // Filter defaults
    const filteredDefaults = PSU_ALL_BUILDINGS.filter((b) => !deletedIds.includes(b.id));

    // Combine defaults and custom additions (excluding deleted ones)
    const combined = [...filteredDefaults, ...customBuildings.filter((b) => !deletedIds.includes(b.id))];

    // Apply coordinate overrides
    const coordOverrides = loadCustomBuildingCoords();
    return combined.map((bld) => {
      const custom = coordOverrides[bld.id];
      if (custom && typeof custom.lat === 'number' && typeof custom.lng === 'number') {
        return {
          ...bld,
          lat: custom.lat,
          lng: custom.lng,
        };
      }
      return bld;
    });
  } catch (err) {
    console.error('Failed to load active buildings:', err);
    return PSU_ALL_BUILDINGS;
  }
}

/**
 * Create and add a new building/site pin
 */
export function createNewBuilding(payload: NewBuildingPayload, existingBuildings: BuildingInfo[]): BuildingInfo {
  // Find highest ID to assign next number
  const existingIds = existingBuildings.map((b) => b.id);
  const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  const capacityKwp = Number(payload.capacityKwp) || 100;
  const panelCount = payload.panelCount || Math.round(capacityKwp * 2);
  const areaM2 = payload.areaM2 || Math.round(capacityKwp * 9);
  const inverterCount = payload.inverterCount || Math.max(1, Math.ceil(capacityKwp / 60));

  // Generate simulated inverters
  const inverters: InverterInfo[] = Array.from({ length: inverterCount }).map((_, i) => ({
    id: `INV-${nextId.toString().padStart(2, '0')}-${String.fromCharCode(65 + i)}`,
    model: capacityKwp > 100 ? 'SolarEdge SE100K' : 'SolarEdge SE66.6K',
    powerKw: Number((capacityKwp / inverterCount * 0.42).toFixed(1)),
    maxPowerKw: Number((capacityKwp / inverterCount * 1.1).toFixed(1)),
    efficiency: 98.4,
    temperatureC: 45.0 + Math.random() * 3,
    status: 'normal',
    strings: [
      { stringId: `STR-${i * 2 + 1}`, voltageV: 740, currentA: 10.4, powerW: 7696 },
      { stringId: `STR-${i * 2 + 2}`, voltageV: 742, currentA: 10.5, powerW: 7791 },
    ],
  }));

  const currentPowerKw = Number((capacityKwp * 0.42).toFixed(1));
  const todayEnergyKwh = Number((capacityKwp * 2.8).toFixed(1));
  const lifetimeEnergyKwh = Number((capacityKwp * 740).toFixed(0));

  const newBuilding: BuildingInfo = {
    id: nextId,
    code: payload.code || `BLD-${nextId.toString().padStart(2, '0')}`,
    name: payload.name.trim(),
    enName: payload.enName?.trim() || `PSU Building ${nextId}`,
    category: payload.category || 'อาคารวิชาการ',
    pinColor: payload.pinColor || 'blue',
    lat: Number(payload.lat.toFixed(7)),
    lng: Number(payload.lng.toFixed(7)),
    mapX: 50.0,
    mapY: 50.0,
    position: [0, 0, 0],
    size: [10, 5, 10],
    panelCount,
    capacityKwp,
    areaM2,
    currentPowerKw,
    todayEnergyKwh,
    lifetimeEnergyKwh,
    inverterCount,
    inverters,
    status: 'normal',
    efficiencyRatio: 98.6,
  };

  try {
    const customBldsRaw = localStorage.getItem(STORAGE_KEY_CUSTOM_BUILDINGS);
    const customBuildings: BuildingInfo[] = customBldsRaw ? JSON.parse(customBldsRaw) : [];
    customBuildings.push(newBuilding);
    localStorage.setItem(STORAGE_KEY_CUSTOM_BUILDINGS, JSON.stringify(customBuildings));
  } catch (err) {
    console.error('Failed to save new custom building:', err);
  }

  return newBuilding;
}

/**
 * Delete a building by ID (works for both default buildings and custom added buildings)
 */
export function deleteBuildingById(buildingId: number): void {
  try {
    // 1. If in custom buildings list, remove from there
    const customBldsRaw = localStorage.getItem(STORAGE_KEY_CUSTOM_BUILDINGS);
    if (customBldsRaw) {
      const customBuildings: BuildingInfo[] = JSON.parse(customBldsRaw);
      const updatedCustom = customBuildings.filter((b) => b.id !== buildingId);
      localStorage.setItem(STORAGE_KEY_CUSTOM_BUILDINGS, JSON.stringify(updatedCustom));
    }

    // 2. Add to deleted IDs list
    const deletedIdsRaw = localStorage.getItem(STORAGE_KEY_DELETED_BUILDINGS);
    const deletedIds: number[] = deletedIdsRaw ? JSON.parse(deletedIdsRaw) : [];
    if (!deletedIds.includes(buildingId)) {
      deletedIds.push(buildingId);
      localStorage.setItem(STORAGE_KEY_DELETED_BUILDINGS, JSON.stringify(deletedIds));
    }
  } catch (err) {
    console.error('Failed to delete building:', err);
  }
}

/**
 * Reset all buildings back to default pristine 37 PSU Campus Buildings
 */
export function resetAllBuildingsToDefaults(): BuildingInfo[] {
  try {
    localStorage.removeItem(STORAGE_KEY_CUSTOM_BUILDINGS);
    localStorage.removeItem(STORAGE_KEY_DELETED_BUILDINGS);
  } catch (err) {
    console.error('Failed to reset buildings to defaults:', err);
  }
  return PSU_ALL_BUILDINGS;
}
