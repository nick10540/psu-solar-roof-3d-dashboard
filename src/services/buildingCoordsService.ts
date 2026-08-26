/**
 * buildingCoordsService.ts
 * Manages custom GPS coordinates (lat, lng) and Balloon positions for PSU Campus Buildings
 * Persisted in LocalStorage ('psu_solar_building_coords_v1')
 */

import { BuildingInfo } from '../types';

const STORAGE_KEY_BUILDING_COORDS = 'psu_solar_building_coords_v1';

export type CustomCoordsMap = Record<number, { lat: number; lng: number; lastModified?: string }>;

/**
 * Load custom coordinate overrides from LocalStorage
 */
export function loadCustomBuildingCoords(): CustomCoordsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BUILDING_COORDS);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load custom building coords:', err);
    return {};
  }
}

/**
 * Save coordinates for a specific building
 */
export function saveBuildingCoords(buildingId: number, lat: number, lng: number): CustomCoordsMap {
  try {
    const current = loadCustomBuildingCoords();
    current[buildingId] = {
      lat: Number(lat.toFixed(7)),
      lng: Number(lng.toFixed(7)),
      lastModified: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_BUILDING_COORDS, JSON.stringify(current));
    return current;
  } catch (err) {
    console.error('Failed to save building coords:', err);
    return loadCustomBuildingCoords();
  }
}

/**
 * Reset coordinates of a single building back to default
 */
export function resetBuildingCoords(buildingId: number): CustomCoordsMap {
  try {
    const current = loadCustomBuildingCoords();
    delete current[buildingId];
    localStorage.setItem(STORAGE_KEY_BUILDING_COORDS, JSON.stringify(current));
    return current;
  } catch (err) {
    console.error('Failed to reset building coords:', err);
    return loadCustomBuildingCoords();
  }
}

/**
 * Reset all building coordinates to defaults
 */
export function resetAllBuildingCoords(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_BUILDING_COORDS);
  } catch (err) {
    console.error('Failed to clear building coords:', err);
  }
}

/**
 * Merge default building list with saved custom coordinate overrides
 */
export function applyCustomCoordsToBuildings(
  defaultBuildings: BuildingInfo[],
  customCoords: CustomCoordsMap
): BuildingInfo[] {
  return defaultBuildings.map((bld) => {
    const custom = customCoords[bld.id];
    if (custom && typeof custom.lat === 'number' && typeof custom.lng === 'number') {
      return {
        ...bld,
        lat: custom.lat,
        lng: custom.lng,
      };
    }
    return bld;
  });
}
