/**
 * map3DService.ts
 * Geodetic transformation & 3D Google Earth / Geospatial Map generator for MEA Solar Roof (5 Regional Sites)
 * Regional Center: Southern Thailand (Lat: 7.95°, Lng: 99.85°)
 * Sites: สุราษฎร์ธานี, ภูเก็ต, ตรัง, หาดใหญ่, ปัตตานี
 */

import * as THREE from 'three';

// Regional Anchor (Center of Southern Thailand Peninsula)
export const REGIONAL_GPS_CENTER = {
  lat: 7.95,
  lng: 99.85,
};

// Earth Geodetic Constants for Southern Thailand (8°N Latitude)
export const KM_PER_DEG_LAT = 110.574;
export const KM_PER_DEG_LNG = 110.488 * Math.cos((7.95 * Math.PI) / 180); // ~109.4 km/deg

// 3D Regional Scale: 1 Three.js World Unit = 5.0 km in regional 3D view
export const REGIONAL_WORLD_SCALE = 0.2; // 1 unit = 5 km

/**
 * Converts GPS (lat, lng) to 3D World (X, Z) in Regional Google Earth space
 * +X is East, -X is West
 * -Z is North, +Z is South
 */
export function gpsToRegional3D(lat: number, lng: number): [number, number] {
  const dLat = lat - REGIONAL_GPS_CENTER.lat;
  const dLng = lng - REGIONAL_GPS_CENTER.lng;

  const worldX = dLng * KM_PER_DEG_LNG * REGIONAL_WORLD_SCALE;
  const worldZ = -dLat * KM_PER_DEG_LAT * REGIONAL_WORLD_SCALE;

  return [worldX, worldZ];
}

/**
 * Converts 3D World (X, Z) back to GPS (lat, lng)
 */
export function regional3DToGps(x: number, z: number): { lat: number; lng: number } {
  const dLng = x / (KM_PER_DEG_LNG * REGIONAL_WORLD_SCALE);
  const dLat = -z / (KM_PER_DEG_LAT * REGIONAL_WORLD_SCALE);

  return {
    lat: Number((REGIONAL_GPS_CENTER.lat + dLat).toFixed(5)),
    lng: Number((REGIONAL_GPS_CENTER.lng + dLng).toFixed(5)),
  };
}

/**
 * Calculates real Sun position in 3D space for Thailand
 */
export function calculateSunPositionSongkhla(hour: number, distance: number = 180): {
  position: THREE.Vector3;
  intensity: number;
  color: number;
  skyColor: number;
  isDay: boolean;
  altitudeDeg: number;
  azimuthDeg: number;
} {
  const isDay = hour >= 5.8 && hour <= 18.7;
  const dayProgress = Math.max(0, Math.min(1, (hour - 6.0) / 12.5));
  const sunAngle = dayProgress * Math.PI;

  const solarElevation = Math.sin(sunAngle);
  const altitudeDeg = Math.round(solarElevation * 86);
  const azimuthDeg = Math.round(90 + dayProgress * 180);

  const x = Math.cos(Math.PI - sunAngle) * distance;
  const y = Math.max(5, Math.sin(sunAngle) * distance * 0.95);
  const z = Math.cos(sunAngle * 1.1) * 45 + 20;

  const position = new THREE.Vector3(x, y, z);

  let intensity = 0.15;
  let color = 0xfffaed;
  let skyColor = 0x050c1e;

  if (isDay) {
    const noonCloseness = Math.sin(sunAngle);
    intensity = 0.5 + noonCloseness * 1.6;

    if (noonCloseness < 0.25) {
      color = 0xffa34d;
      skyColor = 0x1f1638;
    } else if (noonCloseness < 0.6) {
      color = 0xffdfa9;
      skyColor = 0x0a2245;
    } else {
      color = 0xffffff;
      skyColor = 0x071e3d;
    }
  }

  return {
    position,
    intensity,
    color,
    skyColor,
    isDay,
    altitudeDeg,
    azimuthDeg,
  };
}

/**
 * Creates high-resolution Google Earth 3D Satellite Terrain Texture for Southern Thailand
 * Draws realistic landmass contours, mountain ranges, Gulf of Thailand, Andaman Sea, and Songkhla Lake
 */
export function createRegionalEarthSatelliteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallback = document.createElement('canvas');
    fallback.width = 64;
    fallback.height = 64;
    return new THREE.CanvasTexture(fallback);
  }

  const w = canvas.width;
  const h = canvas.height;

  // 1. Deep Ocean Background (Andaman Sea & Gulf of Thailand)
  const oceanGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 100, w * 0.5, h * 0.5, w * 0.8);
  oceanGrad.addColorStop(0, '#0a2342');
  oceanGrad.addColorStop(0.5, '#051933');
  oceanGrad.addColorStop(1, '#020d1c');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, w, h);

  // Ocean Bathymetry Waves & Shelf lines
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 30; i++) {
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, 150 + i * 40, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Southern Thailand Peninsula Landmass (Realistic geographic shape)
  ctx.save();
  
  // Land Gradient (Tropical Forest Green, Mountain Ridges & Coastal Sand)
  const landGrad = ctx.createLinearGradient(w * 0.2, h * 0.1, w * 0.8, h * 0.9);
  landGrad.addColorStop(0, '#1c4522'); // Surat Thani lush canopy
  landGrad.addColorStop(0.3, '#26592e'); // Central mountain spine
  landGrad.addColorStop(0.5, '#2e6b37'); // Nakhon / Trang
  landGrad.addColorStop(0.8, '#1e4b27'); // Songkhla / Hatyai
  landGrad.addColorStop(1, '#183c1f'); // Pattani / South

  ctx.fillStyle = landGrad;
  ctx.shadowColor = 'rgba(2, 6, 23, 0.8)';
  ctx.shadowBlur = 30;

  // Main Peninsula Polygon
  ctx.beginPath();
  // North (Chumphon / Surat Thani border)
  ctx.moveTo(w * 0.45, h * 0.05);
  ctx.bezierCurveTo(w * 0.55, h * 0.08, w * 0.65, h * 0.12, w * 0.72, h * 0.20); // Surat Thani / Gulf coast
  // Samui & Phangan archipelago
  ctx.bezierCurveTo(w * 0.76, h * 0.25, w * 0.70, h * 0.35, w * 0.68, h * 0.45); // Nakhon Si Thammarat coast
  // Songkhla Lake & Gulf coast
  ctx.bezierCurveTo(w * 0.65, h * 0.55, w * 0.66, h * 0.68, w * 0.64, h * 0.78); // Songkhla / Hatyai
  // Pattani / Narathiwat coast
  ctx.bezierCurveTo(w * 0.62, h * 0.85, w * 0.60, h * 0.92, w * 0.52, h * 0.96); // Southern border
  // West Coast (Malaysia border to Satun)
  ctx.bezierCurveTo(w * 0.45, h * 0.94, w * 0.40, h * 0.88, w * 0.38, h * 0.80); // Satun
  // Trang & Krabi
  ctx.bezierCurveTo(w * 0.35, h * 0.70, w * 0.32, h * 0.58, w * 0.30, h * 0.48); // Trang / Krabi
  // Phang Nga & Ranong
  ctx.bezierCurveTo(w * 0.28, h * 0.38, w * 0.30, h * 0.22, w * 0.36, h * 0.12); // Ranong / North Andaman
  ctx.closePath();
  ctx.fill();

  // Coastal Shallow Water Glow (Lagoon Turquoise)
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.stroke();

  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
  ctx.stroke();

  // 3. Islands (Phuket Island & Koh Samui)
  // Phuket Island (West Coast)
  ctx.fillStyle = '#22542a';
  ctx.beginPath();
  ctx.ellipse(w * 0.24, h * 0.52, 28, 55, Math.PI * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.stroke();

  // Koh Samui & Koh Phangan (East Gulf Coast)
  ctx.beginPath();
  ctx.ellipse(w * 0.76, h * 0.22, 26, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(w * 0.78, h * 0.17, 18, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4. Songkhla Lake (Inner Inland Lagoon)
  ctx.fillStyle = '#0d3258';
  ctx.beginPath();
  ctx.ellipse(w * 0.58, h * 0.65, 34, 75, -Math.PI * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.stroke();

  // 5. Mountain Ridges (Khao Luang & Tenasserim range texture)
  ctx.fillStyle = 'rgba(18, 48, 22, 0.65)';
  for (let i = 0; i < 40; i++) {
    const mx = w * 0.42 + (Math.sin(i * 0.8) * 60);
    const my = h * 0.15 + i * 20;
    ctx.beginPath();
    ctx.arc(mx, my, 25 + Math.sin(i) * 12, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Subtle High-Tech Energy Grid Coordinates Overlay
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Creates 3D Google Earth Style Pin Pinhead with vertical stem
 */
export function createGoogleEarthPinObject(
  siteName: string,
  powerKw: number,
  capacityKwp: number,
  pinColor: string = '#0284c7'
): THREE.Group {
  const group = new THREE.Group();

  // 1. Ground Glow Ring (Pulsing marker base)
  const ringGeo = new THREE.RingGeometry(1.2, 2.0, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.1;
  group.add(ringMesh);

  // Outer pulse ring
  const outerRingGeo = new THREE.RingGeometry(2.4, 3.0, 32);
  outerRingGeo.rotateX(-Math.PI / 2);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x0284c7,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
  });
  const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRingMesh.position.y = 0.1;
  group.add(outerRingMesh);

  // 2. Vertical 3D Stem (rising from terrain like Google Earth)
  const stemHeight = 12.0;
  const stemGeo = new THREE.CylinderGeometry(0.18, 0.18, stemHeight, 16);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0x0284c7,
    emissiveIntensity: 0.4,
  });
  const stemMesh = new THREE.Mesh(stemGeo, stemMat);
  stemMesh.position.y = stemHeight / 2;
  group.add(stemMesh);

  // 3. Google Earth Blue Spherical Pin Head
  const headGeo = new THREE.SphereGeometry(1.8, 32, 32);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    metalness: 0.3,
    roughness: 0.2,
    emissive: 0x0369a1,
    emissiveIntensity: 0.6,
  });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.position.y = stemHeight;
  group.add(headMesh);

  // Inner bright yellow solar core
  const coreGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.y = stemHeight;
  group.add(coreMesh);

  return group;
}
