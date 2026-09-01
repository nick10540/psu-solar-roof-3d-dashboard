/**
 * MEA Solar Roof Mock Data & Regional Sites Manifest (5 Sites)
 * 1. สุราษฎร์ธานี (Surat Thani) - 320 kWp
 * 2. ภูเก็ต (Phuket) - 450 kWp
 * 3. ตรัง (Trang) - 250 kWp
 * 4. หาดใหญ่ (Hatyai) - 380 kWp
 * 5. ปัตตานี (Pattani) - 200 kWp
 */

import { BuildingInfo, CampusWeather, SolarEdgeConfig, SolarEdgeSiteOverview, TimeSeriesDataPoint } from '../types';

export const INITIAL_WEATHER: CampusWeather = {
  temperatureC: 32,
  condition: 'แดดจัด ท้องฟ้าโปร่ง',
  conditionEn: 'Sunny & Clear',
  icon: 'sun',
  humidity: 62,
  uvIndex: 9.6,
  irradianceWm2: 915,
  windSpeedKmh: 14.5,
  sunAltitudeDeg: 68,
};

/**
 * Simulated AC output at solar noon, in kW per kWp installed.
 *
 * Replaces the old pair of magic numbers (`solarFactor * 4200` for the fleet,
 * then `capacityKwp / 6000` for each site). Those were calibrated to a
 * 6,000 kWp fleet that does not exist - the five sites total 1,600 kWp - so
 * every derived figure came out roughly 3.75x off.
 *
 * Expressing it per-kWp means the simulation stays correct no matter how many
 * site pins are added or removed.
 */
export const PEAK_AC_KW_PER_KWP = 0.67;

/** Sum of installed capacity across a set of sites, in kWp. */
export function totalInstalledKwp(sites: Array<{ capacityKwp: number }>): number {
  return sites.reduce((sum, s) => sum + (s.capacityKwp || 0), 0);
}

export const INITIAL_SOLAREDGE_CONFIG: SolarEdgeConfig = {
  isConnected: false,
  siteId: 'MEA-SOLAR-2026',
  useMock: true,
  lastSyncTime: '21 ส.ค. 2569 10:30:00',
  pollIntervalSec: 15,
  showSiteEditTools: false,
  extraSiteIds: [],
};

export const SITE_OVERVIEW_DEFAULT: SolarEdgeSiteOverview = {
  currentPowerKw: 994.5,
  todayEnergyKwh: 6441.9,
  monthEnergyKwh: 184500.0,
  yearEnergyKwh: 1120000.0,
  lifetimeEnergyKwh: 1810900.0,
  performanceRatio: 98.8,
  co2ReducedTons: 905.4,
  treesPlanted: 50300,
  oilSavedLiters: 362000,
  totalPanels: 3200,
  totalCapacityKwp: 1600.0,
  totalAreaM2: 14400,
  activeInverters: 16,
  totalInverters: 16,
  systemStatus: 'normal',
};

// 5 MEA Solar Roof Regional Sites in Southern Thailand
export const PSU_ALL_BUILDINGS: BuildingInfo[] = [
  {
    id: 1,
    code: 'MEA-SRT-01',
    name: 'วิทยาเขตสุราษฎร์ธานี',
    shortName: 'สุราษฎร์ธานี',
    enName: 'MEA Solar Roof - Surat Thani Site',
    province: 'สุราษฎร์ธานี',
    category: 'Solar Rooftop',
    pinColor: 'blue',
    lat: 9.1382,
    lng: 99.3215,
    mapX: 62.0,
    mapY: 18.0,
    position: [0, 0, -22],
    size: [12, 5, 10],
    panelCount: 640,
    capacityKwp: 320.0, // กำลังติดตั้งจริง 320 kWp
    areaM2: 2880,
    currentPowerKw: 182.4, // กำลังผลิตปัจจุบัน 182.4 kW
    todayEnergyKwh: 1240.5,
    lifetimeEnergyKwh: 348200, // พลังงานผลิตทั้งหมด 348,200 kWh
    inverterCount: 3,
    status: 'normal',
    efficiencyRatio: 98.9,
    inverters: [
      {
        id: 'INV-SRT-01',
        model: 'SolarEdge SE100K',
        powerKw: 68.4,
        maxPowerKw: 100.0,
        efficiency: 98.8,
        temperatureC: 46.2,
        status: 'normal',
        strings: [
          { stringId: 'STR-1', voltageV: 745, currentA: 11.2, powerW: 8344 },
          { stringId: 'STR-2', voltageV: 742, currentA: 11.0, powerW: 8162 },
          { stringId: 'STR-3', voltageV: 748, currentA: 11.4, powerW: 8527 },
          { stringId: 'STR-4', voltageV: 740, currentA: 11.1, powerW: 8214 },
        ],
      },
      {
        id: 'INV-SRT-02',
        model: 'SolarEdge SE100K',
        powerKw: 66.8,
        maxPowerKw: 100.0,
        efficiency: 98.6,
        temperatureC: 47.0,
        status: 'normal',
        strings: [
          { stringId: 'STR-5', voltageV: 738, currentA: 10.9, powerW: 8044 },
          { stringId: 'STR-6', voltageV: 741, currentA: 11.0, powerW: 8151 },
          { stringId: 'STR-7', voltageV: 739, currentA: 10.8, powerW: 7981 },
          { stringId: 'STR-8', voltageV: 744, currentA: 11.1, powerW: 8258 },
        ],
      },
      {
        id: 'INV-SRT-03',
        model: 'SolarEdge SE100K',
        powerKw: 47.2,
        maxPowerKw: 100.0,
        efficiency: 98.4,
        temperatureC: 45.1,
        status: 'normal',
        strings: [
          { stringId: 'STR-9', voltageV: 735, currentA: 10.2, powerW: 7497 },
          { stringId: 'STR-10', voltageV: 738, currentA: 10.3, powerW: 7601 },
          { stringId: 'STR-11', voltageV: 736, currentA: 10.1, powerW: 7433 },
        ],
      },
    ],
  },
  {
    id: 2,
    code: 'MEA-PKT-02',
    name: 'วิทยาเขตภูเก็ต',
    shortName: 'ภูเก็ต',
    enName: 'MEA Solar Roof - Phuket Site',
    province: 'ภูเก็ต',
    category: 'Solar Rooftop',
    pinColor: 'blue',
    lat: 7.8804,
    lng: 98.3923,
    mapX: 25.0,
    mapY: 28.0,
    position: [-24, 0, -8],
    size: [14, 6, 12],
    panelCount: 900,
    capacityKwp: 450.0, // กำลังติดตั้งจริง 450 kWp
    areaM2: 4050,
    currentPowerKw: 284.6, // กำลังผลิตปัจจุบัน 284.6 kW
    todayEnergyKwh: 1890.0,
    lifetimeEnergyKwh: 512600, // พลังงานผลิตทั้งหมด 512,600 kWh
    inverterCount: 4,
    status: 'normal',
    efficiencyRatio: 99.1,
    inverters: [
      {
        id: 'INV-PKT-01',
        model: 'SolarEdge SE100K',
        powerKw: 75.2,
        maxPowerKw: 100.0,
        efficiency: 99.0,
        temperatureC: 45.8,
        status: 'normal',
        strings: [
          { stringId: 'STR-1', voltageV: 750, currentA: 12.0, powerW: 9000 },
          { stringId: 'STR-2', voltageV: 748, currentA: 11.9, powerW: 8901 },
          { stringId: 'STR-3', voltageV: 752, currentA: 12.1, powerW: 9099 },
          { stringId: 'STR-4', voltageV: 749, currentA: 12.0, powerW: 8988 },
        ],
      },
      {
        id: 'INV-PKT-02',
        model: 'SolarEdge SE100K',
        powerKw: 74.0,
        maxPowerKw: 100.0,
        efficiency: 98.9,
        temperatureC: 46.5,
        status: 'normal',
        strings: [
          { stringId: 'STR-5', voltageV: 746, currentA: 11.8, powerW: 8802 },
          { stringId: 'STR-6', voltageV: 748, currentA: 11.9, powerW: 8901 },
          { stringId: 'STR-7', voltageV: 745, currentA: 11.7, powerW: 8716 },
          { stringId: 'STR-8', voltageV: 749, currentA: 11.9, powerW: 8913 },
        ],
      },
      {
        id: 'INV-PKT-03',
        model: 'SolarEdge SE100K',
        powerKw: 72.8,
        maxPowerKw: 100.0,
        efficiency: 98.7,
        temperatureC: 47.1,
        status: 'normal',
        strings: [
          { stringId: 'STR-9', voltageV: 742, currentA: 11.5, powerW: 8533 },
          { stringId: 'STR-10', voltageV: 745, currentA: 11.7, powerW: 8716 },
          { stringId: 'STR-11', voltageV: 741, currentA: 11.6, powerW: 8595 },
          { stringId: 'STR-12', voltageV: 744, currentA: 11.6, powerW: 8630 },
        ],
      },
      {
        id: 'INV-PKT-04',
        model: 'SolarEdge SE50K',
        powerKw: 62.6,
        maxPowerKw: 100.0,
        efficiency: 98.5,
        temperatureC: 44.9,
        status: 'normal',
        strings: [
          { stringId: 'STR-13', voltageV: 740, currentA: 11.0, powerW: 8140 },
          { stringId: 'STR-14', voltageV: 742, currentA: 11.1, powerW: 8236 },
        ],
      },
    ],
  },
  {
    id: 3,
    code: 'MEA-TRG-03',
    name: 'วิทยาเขตตรัง',
    shortName: 'ตรัง',
    enName: 'MEA Solar Roof - Trang Site',
    province: 'ตรัง',
    category: 'Solar Rooftop',
    pinColor: 'blue',
    lat: 7.5563,
    lng: 99.6114,
    mapX: 38.0,
    mapY: 42.0,
    position: [-10, 0, 0],
    size: [10, 4, 8],
    panelCount: 500,
    capacityKwp: 250.0, // กำลังติดตั้งจริง 250 kWp
    areaM2: 2250,
    currentPowerKw: 156.8, // กำลังผลิตปัจจุบัน 156.8 kW
    todayEnergyKwh: 980.2,
    lifetimeEnergyKwh: 289400, // พลังงานผลิตทั้งหมด 289,400 kWh
    inverterCount: 3,
    status: 'normal',
    efficiencyRatio: 98.7,
    inverters: [
      {
        id: 'INV-TRG-01',
        model: 'SolarEdge SE100K',
        powerKw: 64.2,
        maxPowerKw: 100.0,
        efficiency: 98.7,
        temperatureC: 45.4,
        status: 'normal',
        strings: [
          { stringId: 'STR-1', voltageV: 742, currentA: 11.0, powerW: 8162 },
          { stringId: 'STR-2', voltageV: 740, currentA: 10.9, powerW: 8066 },
          { stringId: 'STR-3', voltageV: 745, currentA: 11.1, powerW: 8269 },
          { stringId: 'STR-4', voltageV: 739, currentA: 10.8, powerW: 7981 },
        ],
      },
      {
        id: 'INV-TRG-02',
        model: 'SolarEdge SE100K',
        powerKw: 63.5,
        maxPowerKw: 100.0,
        efficiency: 98.6,
        temperatureC: 46.1,
        status: 'normal',
        strings: [
          { stringId: 'STR-5', voltageV: 738, currentA: 10.7, powerW: 7896 },
          { stringId: 'STR-6', voltageV: 741, currentA: 10.8, powerW: 8002 },
          { stringId: 'STR-7', voltageV: 740, currentA: 10.6, powerW: 7844 },
          { stringId: 'STR-8', voltageV: 742, currentA: 10.8, powerW: 8013 },
        ],
      },
      {
        id: 'INV-TRG-03',
        model: 'SolarEdge SE50K',
        powerKw: 29.1,
        maxPowerKw: 50.0,
        efficiency: 98.3,
        temperatureC: 43.8,
        status: 'normal',
        strings: [
          { stringId: 'STR-9', voltageV: 735, currentA: 9.8, powerW: 7203 },
          { stringId: 'STR-10', voltageV: 736, currentA: 9.7, powerW: 7139 },
        ],
      },
    ],
  },
  {
    id: 4,
    code: 'MEA-HDY-04',
    name: 'วิทยาเขตหาดใหญ่',
    shortName: 'หาดใหญ่',
    enName: 'MEA Solar Roof - Hatyai Site',
    province: 'สงขลา',
    category: 'Solar Rooftop',
    pinColor: 'blue',
    lat: 7.0089,
    lng: 100.4767,
    mapX: 43.0,
    mapY: 65.0,
    position: [6, 0, 16],
    size: [12, 5, 10],
    panelCount: 760,
    capacityKwp: 380.0, // กำลังติดตั้งจริง 380 kWp
    areaM2: 3420,
    currentPowerKw: 242.5, // กำลังผลิตปัจจุบัน 242.5 kW
    todayEnergyKwh: 1520.8,
    lifetimeEnergyKwh: 435800, // พลังงานผลิตทั้งหมด 435,800 kWh
    inverterCount: 4,
    status: 'normal',
    efficiencyRatio: 98.8,
    inverters: [
      {
        id: 'INV-HDY-01',
        model: 'SolarEdge SE100K',
        powerKw: 68.5,
        maxPowerKw: 100.0,
        efficiency: 98.8,
        temperatureC: 45.9,
        status: 'normal',
        strings: [
          { stringId: 'STR-1', voltageV: 746, currentA: 11.3, powerW: 8429 },
          { stringId: 'STR-2', voltageV: 744, currentA: 11.2, powerW: 8332 },
          { stringId: 'STR-3', voltageV: 748, currentA: 11.4, powerW: 8527 },
          { stringId: 'STR-4', voltageV: 743, currentA: 11.1, powerW: 8247 },
        ],
      },
      {
        id: 'INV-HDY-02',
        model: 'SolarEdge SE100K',
        powerKw: 67.2,
        maxPowerKw: 100.0,
        efficiency: 98.7,
        temperatureC: 46.4,
        status: 'normal',
        strings: [
          { stringId: 'STR-5', voltageV: 740, currentA: 11.0, powerW: 8140 },
          { stringId: 'STR-6', voltageV: 742, currentA: 11.1, powerW: 8236 },
          { stringId: 'STR-7', voltageV: 739, currentA: 10.9, powerW: 8055 },
          { stringId: 'STR-8', voltageV: 744, currentA: 11.2, powerW: 8332 },
        ],
      },
      {
        id: 'INV-HDY-03',
        model: 'SolarEdge SE100K',
        powerKw: 66.8,
        maxPowerKw: 100.0,
        efficiency: 98.6,
        temperatureC: 46.8,
        status: 'normal',
        strings: [
          { stringId: 'STR-9', voltageV: 738, currentA: 10.9, powerW: 8044 },
          { stringId: 'STR-10', voltageV: 741, currentA: 11.0, powerW: 8151 },
          { stringId: 'STR-11', voltageV: 737, currentA: 10.8, powerW: 7959 },
          { stringId: 'STR-12', voltageV: 740, currentA: 10.9, powerW: 8066 },
        ],
      },
      {
        id: 'INV-HDY-04',
        model: 'SolarEdge SE50K',
        powerKw: 40.0,
        maxPowerKw: 50.0,
        efficiency: 98.4,
        temperatureC: 44.5,
        status: 'normal',
        strings: [
          { stringId: 'STR-13', voltageV: 735, currentA: 10.2, powerW: 7497 },
          { stringId: 'STR-14', voltageV: 736, currentA: 10.1, powerW: 7433 },
        ],
      },
    ],
  },
  {
    id: 5,
    code: 'MEA-PTN-05',
    name: 'วิทยาเขตปัตตานี',
    shortName: 'ปัตตานี',
    enName: 'MEA Solar Roof - Pattani Site',
    province: 'ปัตตานี',
    category: 'Solar Rooftop',
    pinColor: 'blue',
    lat: 6.8672,
    lng: 101.2501,
    mapX: 52.0,
    mapY: 82.0,
    position: [18, 0, 26],
    size: [10, 4, 8],
    panelCount: 400,
    capacityKwp: 200.0, // กำลังติดตั้งจริง 200 kWp
    areaM2: 1800,
    currentPowerKw: 128.2, // กำลังผลิตปัจจุบัน 128.2 kW
    todayEnergyKwh: 810.4,
    lifetimeEnergyKwh: 224900, // พลังงานผลิตทั้งหมด 224,900 kWh
    inverterCount: 2,
    status: 'normal',
    efficiencyRatio: 98.7,
    inverters: [
      {
        id: 'INV-PTN-01',
        model: 'SolarEdge SE100K',
        powerKw: 65.1,
        maxPowerKw: 100.0,
        efficiency: 98.8,
        temperatureC: 45.6,
        status: 'normal',
        strings: [
          { stringId: 'STR-1', voltageV: 745, currentA: 11.2, powerW: 8344 },
          { stringId: 'STR-2', voltageV: 742, currentA: 11.0, powerW: 8162 },
          { stringId: 'STR-3', voltageV: 746, currentA: 11.3, powerW: 8429 },
          { stringId: 'STR-4', voltageV: 740, currentA: 10.9, powerW: 8066 },
        ],
      },
      {
        id: 'INV-PTN-02',
        model: 'SolarEdge SE100K',
        powerKw: 63.1,
        maxPowerKw: 100.0,
        efficiency: 98.6,
        temperatureC: 46.2,
        status: 'normal',
        strings: [
          { stringId: 'STR-5', voltageV: 738, currentA: 10.8, powerW: 7970 },
          { stringId: 'STR-6', voltageV: 741, currentA: 10.9, powerW: 8076 },
          { stringId: 'STR-7', voltageV: 739, currentA: 10.7, powerW: 7907 },
          { stringId: 'STR-8', voltageV: 742, currentA: 10.9, powerW: 8087 },
        ],
      },
    ],
  },
];

// Time series generation functions
export function generateDayPowerData(currentHour = 10.5): TimeSeriesDataPoint[] {
  const points: TimeSeriesDataPoint[] = [];
  const hours = [
    '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
    '06:00', '07:00', '08:00', '09:00', '10:00', '10:30',
    '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
    '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
  ];

  let cumulativeEnergy = 0;

  hours.forEach((timeLabel) => {
    const [hStr, mStr] = timeLabel.split(':');
    const h = parseInt(hStr, 10) + (parseInt(mStr, 10) || 0) / 60;

    let theoreticalFraction = 0;
    if (h >= 6.0 && h <= 18.5) {
      const normalized = (h - 6.0) / (18.5 - 6.0);
      theoreticalFraction = Math.pow(Math.sin(normalized * Math.PI), 1.25);
    }

    // 1600 kWp total system capacity
    const clearSkyKw = Math.round(theoreticalFraction * 1450 * 10) / 10;

    let powerKw = 0;
    if (h <= currentHour) {
      const noise = (Math.sin(h * 3.5) * 0.04) + (Math.cos(h * 7.1) * 0.03);
      const actualFraction = Math.max(0, theoreticalFraction * (0.94 + noise));
      powerKw = Math.round(actualFraction * 1450 * 10) / 10;
      cumulativeEnergy += (powerKw * 1.0);
    }

    const irradiance = Math.round(theoreticalFraction * 1020);
    const ambientTemp = Math.round(27 + theoreticalFraction * 7.5);
    const moduleTemp = Math.round(ambientTemp + theoreticalFraction * 18);

    points.push({
      timestamp: `2026-08-21T${timeLabel}:00`,
      timeLabel,
      powerKw,
      clearSkyPotentialKw: clearSkyKw,
      energyKwh: Math.round(cumulativeEnergy * 10) / 10,
      irradianceWm2: irradiance,
      ambientTempC: ambientTemp,
      moduleTempC: moduleTemp,
    });
  });

  return points;
}

export function generateWeekPowerData(): TimeSeriesDataPoint[] {
  const days = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
  const dailyProduction = [6120, 6480, 5890, 6720, 6340, 6590, 6441];

  return days.map((day, idx) => ({
    timestamp: `2026-08-${15 + idx}`,
    timeLabel: day,
    powerKw: Math.round((dailyProduction[idx] / 6.5) * 10) / 10,
    clearSkyPotentialKw: 1450,
    energyKwh: dailyProduction[idx],
    irradianceWm2: 880 + Math.round(Math.random() * 100),
    ambientTempC: 32,
    moduleTempC: 48,
  }));
}

export function generateMonthPowerData(): TimeSeriesDataPoint[] {
  const points: TimeSeriesDataPoint[] = [];
  for (let i = 1; i <= 31; i++) {
    const val = 5800 + Math.sin(i * 0.4) * 800 + Math.random() * 300;
    points.push({
      timestamp: `2026-08-${String(i).padStart(2, '0')}`,
      timeLabel: `${i} ส.ค.`,
      powerKw: Math.round((val / 6.5) * 10) / 10,
      clearSkyPotentialKw: 1450,
      energyKwh: Math.round(val),
      irradianceWm2: 860,
      ambientTempC: 33,
      moduleTempC: 49,
    });
  }
  return points;
}

export function generateYearPowerData(): TimeSeriesDataPoint[] {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthlyValues = [
    165000, 178000, 195000, 210000, 184500, 158000,
    155000, 152000, 145000, 149000, 156000, 162000
  ];

  return months.map((m, idx) => ({
    timestamp: `2026-${String(idx + 1).padStart(2, '0')}`,
    timeLabel: m,
    powerKw: 994,
    clearSkyPotentialKw: 1450,
    energyKwh: monthlyValues[idx],
    irradianceWm2: 840,
    ambientTempC: 32,
    moduleTempC: 47,
  }));
}
