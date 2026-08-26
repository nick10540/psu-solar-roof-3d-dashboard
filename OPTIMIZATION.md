# Dashboard Stability & Performance — 72" TV Kiosk

เอกสารสรุปการวิเคราะห์และการแก้ไข สำหรับการเปิดหน้า Dashboard ทิ้งไว้ตลอดวันในงานพิธีเปิด

---

## 1. สาเหตุของปัญหา (Root Cause)

### 1.1 ต้นเหตุหลัก — แผนที่ถูกสร้างใหม่ทุก 15 วินาที

อาการทั้งสองข้อที่รายงานมา (request หลายร้อยครั้ง + แผนที่รีเซ็ตกลับ state เริ่มต้น)
มาจากจุดเดียวกัน คือ dependency array ของ effect ที่สร้าง MapLibre instance

```tsx
// เดิม — App.tsx : สร้างใหม่ทุก render
const handleSelectBuilding = (building: BuildingInfo | null) => {
  setSelectedBuilding(building);
};

// เดิม — Solar3DViewer.tsx : ผูก lifecycle ของแผนที่ไว้กับ callback ตัวนั้น
useEffect(() => {
  const map = new maplibregl.Map({ /* ... */ });
  return () => { map.remove(); };
}, [onSelectBuilding]);   // <-- identity เปลี่ยนทุก render ของ App
```

ลำดับเหตุการณ์:

| ขั้น | สิ่งที่เกิดขึ้น |
|---|---|
| 1 | `setInterval` ของ live simulation ยิงทุก 15 วินาที → `setOverview` / `setBuildings` |
| 2 | `App` re-render → `handleSelectBuilding` เป็น function object ตัวใหม่ |
| 3 | `Solar3DViewer` ได้ prop ใหม่ → dependency เปลี่ยน |
| 4 | React เรียก cleanup → **`map.remove()`** แล้วสร้าง **`new maplibregl.Map()`** |

ผลที่ตามมา:

- **Request หลายร้อยครั้ง** — tile cache ของ MapLibre อยู่ใน instance เมื่อ instance ถูกทำลาย
  แคชหายไปด้วย แผนที่ใหม่ต้องโหลด tile ทั้งหมดใหม่ ทุก 15 วินาที
  เปิดทิ้งไว้ 1 ชั่วโมง = สร้างแผนที่ใหม่ 240 ครั้ง × ~30–60 tiles ≈ **หมื่นกว่า request**
- **แผนที่รีเซ็ตกลับ state เริ่มต้น** — แผนที่ใหม่ถูกสร้างด้วยค่า
  `center: REGIONAL_CENTER, zoom: DEFAULT_ZOOM, pitch: 60, bearing: -18` เสมอ
  มุมกล้องที่ผู้ใช้เพิ่งหมุน/แพนจึงถูกทิ้ง — นี่คืออาการ "รีเซ็ตตัวเอง" ที่เห็น
- **ค้าง / freeze** — ทุกครั้งที่สร้างแผนที่ใหม่คือ WebGL context ใหม่
  เบราว์เซอร์จำกัดจำนวน context พร้อมกันไว้ราว 16 ตัว เมื่อชนเพดาน
  context เก่าจะถูกบังคับปิด (`webglcontextlost`) แผนที่จะดำหรือค้าง

### 1.2 ปัจจัยเสริม

| # | ปัญหา | ผลกระทบ |
|---|---|---|
| 2 | `refreshExpiredTiles` เปิดอยู่ (ค่า default) | MapLibre ยิง request ซ้ำเมื่อ HTTP cache ของ tile หมดอายุ — ต้นเหตุของ request ที่ไหลเรื่อย ๆ ทั้งที่ไม่มีใครแตะจอ |
| 3 | ไม่จำกัดขอบเขตกล้อง | แพนออกนอกภาคใต้ได้ไม่จำกัด → โหลด tile ของพื้นที่ที่ไม่เคยใช้ |
| 4 | `maxPitch: 85` | เกิน 71.6° เส้นขอบฟ้าเข้าเฟรม ระยะพื้นวิ่งไปไม่สิ้นสุด — ทั้งตัวคูณจำนวน tile ที่ใหญ่ที่สุด และต้นเหตุของขอบดำ |
| 5 | `setStyle()` ตอนสลับ layer | เปลี่ยนชั้นแผนที่ = โหลด tile ใหม่ทั้งหมด |
| 6 | `map.on('rotate')` → `setState` ทุกเฟรม | ขณะลากหมุน component re-render 60 ครั้ง/วินาที — สาเหตุที่รู้สึกว่าหมุนแล้วสะดุด |
| 7 | Marker ถูก `remove()` + สร้างใหม่ด้วย `innerHTML` ทุก data tick | 5 markers × 4 ครั้ง/นาที × 8 ชั่วโมง ≈ 9,600 ครั้งของการ parse HTML |
| 8 | Auto-orbit ใช้ `setInterval(..., 50)` | ไม่ sync กับ compositor และยังทำงานตอนแท็บถูกซ่อน |
| 9 | `backdrop-filter: blur()` บนการ์ด 5 ใบเหนือ WebGL canvas | บังคับ compositor rasterise ภาพเบลอใหม่ทุกเฟรมที่แผนที่ขยับ — ต้นทุนหลักบนจอ 4K |
| 10 | `animate-ping` (transform + opacity) วนไม่หยุดบน 5 markers | งาน compositor ต่อเนื่องตลอดวัน |

### 1.3 ปัญหาที่พบเพิ่มระหว่างตรวจสอบ

- **`fetchSolarEdgeApi` เผา quota เป็น 2 เท่า** — เดิมถ้า proxy ตอบ non-2xx
  โค้ดจะ fall through ไปยิง direct URL ต่อ ทำให้ 1 logical request = 2 API call จริง
- **Production build ไม่มี proxy** — `/api/solaredge` จะถูกตอบด้วย `index.html` (HTTP 200)
  แล้วไปพังตอน `res.json()`
- **ค่า CO2 / เดือน / ปี ไม่เคยอัปเดตจาก API** — `App.tsx` เขียน property ชื่อ
  `monthlyEnergyKwh`, `yearlyEnergyMwh`, `co2SavedKg` ซึ่ง **ไม่มีอยู่ใน**
  `SolarEdgeSiteOverview` (ของจริงคือ `monthEnergyKwh`, `yearEnergyKwh`, `co2ReducedTons`)
  ค่าทั้งสามจึงถูกทิ้งเงียบ ๆ และการ์ดแสดงค่า mock ค้างไว้ตลอด
- **`@import` ของ maplibre CSS อยู่กลางไฟล์** `index.css` — ผิดสเปก CSS
  (`@import` ต้องอยู่ก่อนทุก rule) bundler มีสิทธิ์ตัดทิ้ง
- **`.claude/launch.json` ระบุ port 5173** แต่ `npm run dev` ใช้ `--port=3000`
- **เลข 6,000 kWp ที่ไม่มีอยู่จริง → แก้แล้ว** (ยืนยันจากผู้ใช้ว่า **1,600 kWp ถูก**)
  คอมเมนต์หัวไฟล์เขียนว่ารวม 6,000 kWp แต่ `capacityKwp` จริงคือ
  320 / 450 / 250 / 380 / 200 = **1,600 kWp** และ `generateDayPowerData`
  ก็เขียนกำกับไว้ชัดว่า *"1600 kWp total system capacity"* อยู่แล้ว

  เลข 6,000 ไม่ได้อยู่แค่ในคอมเมนต์ — มันถูกใช้คำนวณจริง 2 จุด ทำให้ค่าเพี้ยน ~3.75 เท่า:

  | จุด | ผลกระทบ |
  |---|---|
  | `SiteDetailSubpage.tsx` `site.capacityKwp / 6000.0` | กราฟรายไซต์ทุกใบ **ต่ำกว่าความจริง 3.75 เท่า** — ยอดกราฟ 73 kW ทั้งที่ไซต์นั้นผลิตอยู่ 182 kW |
  | `App.tsx` `(b.capacityKwp / 6000.0) * (solarFactor * 4200)` | ค่าที่ปรับตามเวลาของแต่ละหมุดคลาดเคลื่อน และ aggregate ไม่ตรงกับผลรวมของหมุด |

  แก้โดยเลิกใช้ค่าคงที่ของกองไซต์ทั้งหมด เปลี่ยนเป็นคิดต่อ kWp:

  ```ts
  // mockSolarData.ts — แทนเลขวิเศษ 4200 กับ 6000
  export const PEAK_AC_KW_PER_KWP = 0.67;

  // ต่อหมุด — ไม่ต้องรู้ขนาดกองรวม จึงถูกต้องเสมอแม้เพิ่ม/ลบไซต์
  currentPowerKw: b.capacityKwp * solarFactor * PEAK_AC_KW_PER_KWP
  ```

  ส่วนกราฟรายไซต์เปลี่ยนไปหารด้วยผลรวมจริงจาก `allSites`
  (`totalInstalledKwp()`) จึงปรับตามอัตโนมัติเมื่อจำนวนหมุดเปลี่ยน

---

## 2. แผนการปรับปรุง (Step-by-step)

### ขั้นที่ 1 — หยุดการสร้างแผนที่ซ้ำ *(สำคัญที่สุด)*
1. ห่อ callback ทุกตัวใน `App.tsx` ด้วย `useCallback`
2. ใน `Solar3DViewer` เก็บ callback ไว้ใน `handlersRef` และตั้ง dependency ของ init effect เป็น `[]`
3. ห่อ `Solar3DViewer` ด้วย `React.memo`

### ขั้นที่ 2 — ลดจำนวน Request ของแผนที่
4. `refreshExpiredTiles: false` + `maxTileCacheSize: 1500`
5. `maxBounds` (ล็อกกล้องไว้ในภูมิภาค) + `maxZoom: 17` → จำกัดกรอบกล้อง
6. `MAX_PITCH: 65` → เส้นขอบฟ้าไม่เข้าเฟรม จำนวน tile ต่อเฟรมจึงมีเพดาน
7. รวมทุก layer ไว้ใน style เดียว สลับด้วย `visibility` แทน `setStyle()`

> ตอนแรกขั้นนี้มีข้อ "ใส่ `bounds` ระดับ source" ด้วย แต่ถูกถอดออกภายหลัง
> เพราะทำให้เกิดขอบดำเวลาหมุน — เหตุผลเต็มอยู่ในหัวข้อ 3.2

### ขั้นที่ 3 — Cache ถาวรและ Lazy loading แบบแบ่งพื้นที่
8. Service Worker (`public/sw-tiles.js`) แคช tile แบบ cache-first ไม่ revalidate
9. Pre-warm 2 ชั้นตอนเปิดแอป ผ่าน `requestIdleCallback`
   - รอบนอกหยาบ z2–6 (กันขอบดำที่ระยะไกล)
   - ภาคใต้ละเอียด z6–9 (มุมมองหลักที่ผู้ชมเห็น)

### ขั้นที่ 4 — SolarEdge Auto-polling ทุก 5 นาที
10. ใช้ bulk endpoint `/sites/{id1,id2,...}/overview` → 1 call ต่อรอบ
11. Poll แบบ silent + `startTransition` + `AbortController` + กันการยิงซ้อน
12. หยุด poll เมื่อ `document.hidden` และ catch-up เมื่อกลับมา

### ขั้นที่ 5 — Memory & Long-run
13. cleanup ครบทุก interval / rAF / listener / marker / map
14. Marker สร้างครั้งเดียว แล้ว patch เฉพาะ textContent
15. Auto-orbit เปลี่ยนเป็น rAF แบบ delta-time
16. ตัด `backdrop-filter` และ animation ระหว่างแผนที่ขยับ (`.map-interacting`)
17. WebGL context-loss recovery แบบอัตโนมัติ
18. `useLongRunGuard` เฝ้าดู JS heap

---

## 3. โค้ดสำคัญที่แก้

### 3.1 Map lifecycle — สร้างครั้งเดียว

`src/components/Solar3DViewer.tsx`

```tsx
// callback ถูกอ่านผ่าน ref → dependency ของ init effect ว่างเปล่า
const handlersRef = useRef({ onSelectBuilding, onNavigateToSubpage });
useEffect(() => {
  handlersRef.current = { onSelectBuilding, onNavigateToSubpage };
}, [onSelectBuilding, onNavigateToSubpage]);

useEffect(() => {
  const map = new maplibregl.Map({
    container,
    style: buildUnifiedMapStyle(),

    // ล็อกกล้องไว้ในภูมิภาค (ไม่ใช่ clip ภาพ — ดูหัวข้อ 3.2)
    maxBounds: MAP_MAX_BOUNDS,
    minZoom: 6.5, maxZoom: 17, maxPitch: 65,
    renderWorldCopies: false,

    // ลดจำนวน request
    refreshExpiredTiles: false,   // ไม่ยิงซ้ำเมื่อ tile หมดอายุ
    maxTileCacheSize: 1500,       // เก็บ tile ใน RAM ให้มากขึ้น
    maxTileCacheZoomLevels: 12,
    fadeDuration: 0,
    collectResourceTiming: false,
  } as maplibregl.MapOptions);

  return () => {
    /* ... off ทุก listener, cancel rAF, remove marker ... */
    map.remove();
  };
}, [remountKey]);   // <-- ไม่มี callback ใน dependency
```

### 3.2 ขอบเขตแผนที่ — ทำไมถึงต้องเลิกใช้ `bounds`

> **แก้ไขรอบสอง** — รอบแรกผมใส่ `bounds: [96.8, 4.8, 103.0, 12.0]` ที่ source
> ตามโจทย์ "โหลดเฉพาะภาคใต้" แต่ทำให้เกิด **ขอบดำเวลาหมุนแผนที่เต็มจอ**

สาเหตุคือกรอบนั้นเล็กกว่าสิ่งที่กล้องมองเห็นมาก วัดจาก `map.getBounds()`
โดยกวาด bearing ทุกทิศที่ pitch สูงสุด:

| | ที่มองเห็นจริง | กรอบเดิมที่ใส่ไว้ |
|---|---|---|
| Longitude | 89.6 → 111.3 | 96.8 → 103.0 |
| Latitude | −3.5 → 20.6 | 4.8 → 12.0 |

**ประมาณ 2 ใน 3 ของเฟรมไม่มี tile** ส่วนที่ขาดถูกวาดเป็นสีพื้น = ขอบดำ

และการขยายกรอบให้ใหญ่ขึ้นก็แก้ไม่ได้ เพราะ MapLibre ฉายลงบนระนาบ Mercator แบน
เส้นขอบฟ้าจะโผล่เมื่อ `pitch + fov/2 ≥ 90°` ซึ่งที่ fov 36.9° คือ **pitch 71.6°**
ที่ pitch 70 ขอบบนของจอจึงมองต่ำกว่าเส้นขอบฟ้าแค่ ~1.6° — ระยะพื้นวิ่งไปเป็นหมื่นกิโลเมตร
ไม่มีกรอบไหนครอบได้

**ทางแก้ 3 ชั้น:**

```ts
// 1. เอา bounds ออกจาก source ทั้งหมด + ลด minzoom ถึง 0
'esri-satellite': {
  type: 'raster',
  tiles: [ESRI_IMAGERY_TILE_URL],
  minzoom: 0,    // z0 = ทั้งโลก 1 tile -> พื้นระยะไกลมี tile เสมอ
  maxzoom: 17,
}

// 2. ลด MAX_PITCH เหลือ 65 -> เส้นขอบฟ้าไม่เข้าเฟรมเลย
export const MAX_PITCH = 65;

// 3. ใส่ sky + background ไว้รองพื้น
sky: {
  'sky-color': '#050b18',
  'horizon-color': '#1e4a6d',   // แสงเรืองที่ขอบฟ้าแบบ Google Earth
  'sky-horizon-blend': 0.55,
},
layers: [
  { id: 'base-background', type: 'background',
    paint: { 'background-color': '#071018' } },   // สีทะเลลึก ไม่ใช่สีดำ
  ...
]
```

การเอา `bounds` ออก **ไม่ได้ทำให้ request เพิ่ม** — `bounds` มีหน้าที่ *ระงับ* request
เท่านั้น ไม่เคยเป็นตัวสร้าง จำนวน tile ที่ดึงจริงกำหนดโดย viewport
สิ่งที่คุมปริมาณจริง ๆ คือ `maxBounds` (ล็อกกล้อง), `MAX_ZOOM`,
`refreshExpiredTiles: false` และตัวแคช

`maxBounds` ก็ถูกขยายด้วย ของเดิม (5.4° กว้าง) **เล็กกว่า viewport ที่ 14°**
MapLibre จึงล็อกการแพนและดีดกล้องกลับ ซึ่งผู้ใช้จะรู้สึกว่าแผนที่ "ฝืน"

สลับ layer โดยไม่โหลดใหม่:

```ts
const applyLayerVisibility = useCallback((layer: SatelliteLayerStyle) => {
  const map = mapRef.current;
  if (!map || !map.isStyleLoaded()) return;
  Object.entries(LAYER_VISIBILITY[layer]).forEach(([layerId, value]) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', value);
  });
}, []);
```

### 3.3 Service Worker cache

`public/sw-tiles.js` — cache-first และ **ไม่ revalidate**

```js
const hit = await cache.match(request, { ignoreVary: true });
if (hit && isFresh(hit)) return hit;   // จบตรงนี้ ไม่แตะ network

try {
  const network = await fetch(request);
  if (network.ok || network.type === 'opaque') {
    await cache.put(request, await stamp(network.clone()));
  }
  return network;
} catch (err) {
  if (hit) return hit;   // เน็ตล่ม -> ใช้ tile เก่าดีกว่าจอเทา
  throw err;
}
```

### 3.4 Auto-polling 5 นาที แบบไม่รบกวน UI

`src/App.tsx`

```tsx
const SOLAREDGE_POLL_MS = 5 * 60 * 1000;

const loadSolarEdgeData = useCallback(async ({ forceRefresh = false, silent = false } = {}) => {
  if (inFlightRef.current) return;          // กัน request ซ้อน
  inFlightRef.current = true;

  const controller = new AbortController();
  abortRef.current = controller;
  if (!silent) setIsSolarEdgeLoading(true); // background = ไม่ขึ้น spinner

  try {
    const res = await fetchSolarEdgeAccountData(config.apiKey, {
      forceRefresh, useMock: config.useMock, signal: controller.signal,
    });
    if (!mountedRef.current || controller.signal.aborted) return;

    // background update = งานไม่เร่งด่วน ปล่อยให้ map/gesture มาก่อน
    if (silent) startTransition(commit);
    else commit();

    lastSyncAtRef.current = Date.now();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('Failed to load SolarEdge data:', err);
  } finally {
    inFlightRef.current = false;
    if (abortRef.current === controller) abortRef.current = null;
    if (!silent && mountedRef.current) setIsSolarEdgeLoading(false);
  }
}, [config.apiKey, config.useMock]);

useEffect(() => {
  const tick = () => { if (!document.hidden) loadSolarEdgeData({ silent: true }); };
  const id = window.setInterval(tick, SOLAREDGE_POLL_MS);

  const onVisible = () => {
    if (!document.hidden && Date.now() - lastSyncAtRef.current >= SOLAREDGE_POLL_MS) tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}, [loadSolarEdgeData]);
```

### 3.5 Quota — ทำไมต้องใช้ bulk endpoint

SolarEdge จำกัด **300 calls/day** การ poll ทุก 5 นาทีแบบยิงทีละไซต์จะเกินโควตาตั้งแต่ก่อนเที่ยง

| วิธี | Call ต่อรอบ | 12 ชม. (144 รอบ) | ผลลัพธ์ |
|---|---|---|---|
| ยิงทีละไซต์ (เดิม) | 5 | **720** | เกินโควตา 300 |
| Bulk endpoint (ใหม่) | 1 | **144** | อยู่ในโควตา |

```ts
// /sites/{siteId1,siteId2,...}/overview  -> ได้ทุกไซต์ใน 1 request
const idList = sites.map((s) => s.id).join(',');
const query = `/sites/${idList}/overview?api_key=${encodeURIComponent(apiKey)}`;
```

พร้อม fallback กลับไปยิงทีละไซต์อัตโนมัติถ้า account ไม่รองรับ
และมี `QUOTA_RESERVE = 20` กันโควตาหมดกลางงาน (จะเสิร์ฟข้อมูลจากแคชแทน)

### 3.6 Marker — สร้างครั้งเดียว แล้ว patch

```tsx
// สร้าง DOM ครั้งเดียวต่อ 1 site id เท่านั้น
if (!handle) {
  const { el, refs } = createMarkerElement(site);
  el.addEventListener('click', onClick);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([site.lng, site.lat]).addTo(map);
  handle = { marker, root: el, onClick, lng: site.lng, lat: site.lat, ...refs };
  store.set(site.id, handle);
}

// ทุก data tick แตะแค่ textContent — ไม่ parse HTML ใหม่
const nextPower = powerKw.toFixed(1);
if (handle.powerEl.textContent !== nextPower) handle.powerEl.textContent = nextPower;
```

### 3.7 Auto-orbit — rAF แทน setInterval

```tsx
useEffect(() => {
  if (!isAutoOrbit) return;
  let last = performance.now();

  const step = (now: number) => {
    const map = mapRef.current;
    if (!map) { orbitRafRef.current = null; return; }
    const dt = Math.min(now - last, 100);   // clamp หลังกลับจาก background
    last = now;
    if (!document.hidden && !isMovingRef.current) {   // ไม่แย่งการลากของผู้ใช้
      map.setBearing((map.getBearing() + ORBIT_DEG_PER_SEC * dt / 1000) % 360);
    }
    orbitRafRef.current = requestAnimationFrame(step);
  };

  orbitRafRef.current = requestAnimationFrame(step);
  return () => {
    if (orbitRafRef.current !== null) cancelAnimationFrame(orbitRafRef.current);
    orbitRafRef.current = null;
  };
}, [isAutoOrbit]);
```

### 3.8 ลดภาระ compositor ระหว่างแผนที่ขยับ

`src/index.css`

```css
/* การ์ดทึบ 94% อยู่แล้ว การเบลอแทบไม่เห็นผล แต่แพงมากบนจอ 4K */
.glass-panel-static {
  background: rgba(11, 18, 33, 0.94);
  border: 1px solid rgba(56, 189, 248, 0.28);
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.75);
}

/* ปิด effect ทั้งหมดขณะกล้องเคลื่อน (toggle จาก movestart/moveend) */
.map-interacting .maplibre-mea-marker * {
  animation: none !important;
  transition: none !important;
}
```

### 3.9 WebGL context-loss recovery

```tsx
const handleContextLost = (event: Event) => {
  event.preventDefault();          // จำเป็น ไม่งั้นเบราว์เซอร์ไม่พยายาม restore
  setGlLost(true);
  restoreTimer = window.setTimeout(() => setRemountKey((k) => k + 1), 6000);
};
canvas.addEventListener('webglcontextlost', handleContextLost, false);
canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
```

---

## 3.10 แผงผลผลิตรวม 5 ไซต์ (มุมขวาล่าง)

`src/components/RegionalTotalsPanel.tsx` — 3 บรรทัดตามที่ขอ

| บรรทัด | ตัวเลข | ที่มา |
|---|---|---|
| 1 | **กำลังติดตั้งรวม** (MWp) | Σ `capacityKwp` ของทุกไซต์ ÷ 1000 |
| 2 | Production Today (kWh) · Production Accumulated (kWh) | `overview.todayEnergyKwh` · `overview.lifetimeEnergyKwh` |
| 3 | Reduce CO2 (ton) · Tree | **คำนวณจาก Accumulated** ในบรรทัดที่ 2 |

```ts
// src/utils/energyEquivalents.ts — ค่าคงที่อยู่ที่เดียว
export const CO2_KG_PER_KWH = 0.56;
export const TREES_PER_KWH  = 0.08;   // ตรงกับที่ SiteDetailSubpage ใช้อยู่เดิม
```

**ทำไม CO₂ กับ Tree ต้อง derive จากตัวเลขที่แสดงอยู่ข้างบน**
บนจอ 72 นิ้วคนดูกดเครื่องคิดเลขตามได้ ถ้าเก็บเป็นค่าแยกกันเมื่อไหร่ก็มีโอกาสหลุด
(เป็นบั๊กแบบเดียวกับ `co2SavedKg` ที่เจอในหัวข้อ 1.3)

**ตำแหน่ง** วางไว้ `bottom-3 right-3` ไม่ได้ต่อท้ายปุ่มควบคุมกล้อง เพราะคอลัมน์ปุ่มสูง ~150px
บวกแผงอีก ~275px จะล้นขอบแผนที่บนจอเตี้ย — ทดสอบที่ความสูง 600/900/1300/2000px
แล้วห่างจากปุ่ม 158–1558px และอยู่ในกรอบแผนที่ทุกกรณี

**ใช้ `glass-panel-static` (ไม่มี backdrop-blur)** ด้วยเหตุผลเดียวกับการ์ดบนหมุด —
แผงเบลอขนาดใหญ่ทับ WebGL canvas ที่กำลังขยับ คือต้นทุน compositor ก้อนใหญ่บนจอ 4K

---

## 3.11 ปรับความสว่างหน้าจอ + ลบการ์ด Google Earth 3D

**ลบออก** การ์ด `Google Earth 3D (ภาพถ่ายดาวเทียมจริง) [Real 3D]` ที่มุมซ้ายบนของแผนที่
พร้อมกับ import ของไอคอน `Globe` ที่ไม่ได้ใช้แล้ว ปุ่มเลือกชั้นแผนที่ยังอยู่ครบ

**เพิ่มใหม่** ปุ่มปรับความสว่าง `☀ − 100% +` ใน HeaderBar
(วางไว้ที่ header ไม่ใช่บนแผนที่ เพราะเป็นค่าระดับทั้งหน้า ต้องใช้ได้ทั้งหน้าแผนที่และหน้าย่อยไซต์)

- ช่วง **60% – 160%** ก้าวละ 10% · คลิกที่ตัวเลข = คืนค่า 100%
- จำค่าไว้ใน localStorage → เปิดเครื่องใหม่ก็ยังได้ความสว่างเดิม

```css
/* src/index.css */
html.brightness-adjusted {
  filter: brightness(var(--app-brightness, 1));
}
```

**ทำไมต้องใส่ที่ `<html>`** — element ที่มี `filter` จะกลายเป็น containing block
ของลูกที่เป็น `position: fixed` และ modal ทุกตัวในโปรเจกต์นี้เป็น `fixed inset-0`
ถ้าใส่ที่ wrapper ชั้นในจะทำให้ modal เพี้ยน ใส่ที่ root แล้ว modal ยังอ้างอิง viewport เหมือนเดิม
(ทดสอบเปิด SolarEdge modal ขณะ filter ทำงาน → กรอบตรงกับ viewport เป๊ะ)

**ทำไมที่ 100% ต้องถอด class ทิ้ง ไม่ใช่ตั้ง `brightness(1)`**
`filter` บังคับให้ทั้งหน้าผ่าน compositing pass เพิ่มอีกรอบทุกเฟรมที่แผนที่ขยับ
ที่ค่าเริ่มต้นจึงตั้งใจให้ `filter: none` → ไม่มีต้นทุนเพิ่มเลย

> ปุ่มนี้ซ่อนบนจอแคบกว่า 1024px (`hidden lg:flex`) เพราะ header แน่นแล้ว
> บนจอ 72 นิ้วแสดงตลอด ถ้าอยากให้เห็นบนจอเล็กด้วยบอกได้ครับ

---

## 3.12 แยกโหมด Mock / Live API ให้จริงจัง + โครงสร้างเพิ่ม-ลบไซต์

### ปัญหาเดิม: Live mode โชว์ข้อมูลปลอมโดยไม่บอกใคร

โค้ดเดิมมี fallback ไปหา mock อยู่ **4 จุด** ทำให้สลับเป็น Live API แล้วยังเห็นตัวเลขสวยงามครบ
ทั้งที่ยังไม่ได้ต่อ API เลย บนจอ 72 นิ้วแยกไม่ออกว่าอันไหนจริงอันไหนปลอม

| จุด | เดิม | ใหม่ |
|---|---|---|
| `useMock \|\| !apiKey.trim()` | Live + ยังไม่กรอก key → คืน mock ทั้งชุด | แยกเป็น 2 เงื่อนไข Live ไม่มี key → คืนว่าง |
| `catch` ตอน fetch พัง | คืน `MOCK_SOLAREDGE_SITES` | คืน `{ sites: [], overviews: {} }` + error |
| bulk endpoint ไม่คืนบางไซต์ | เติม `generateMockSolarEdgeOverview` | ปล่อยว่าง + `console.warn` |
| ยิงทีละไซต์แล้วพัง | เติม mock | คืน `null` แล้วกรองทิ้ง |

### ตัวตัดสินใจกลาง — `src/services/siteMetricsService.ts`

เดิมแต่ละที่มี fallback เป็นของตัวเอง:

```ts
const power = overview ? overview.currentPowerKw : site.currentPowerKw;  // ← ต้นเหตุ
```

ย้ายมาไว้ที่เดียว กติกาชัดเจน:

```
mock mode → ใช้ค่าจำลองได้ ตามเจตนา
live mode → เฉพาะค่าจริงจาก SolarEdge ของไซต์ที่ "ผูกหมุดไว้แล้ว" เท่านั้น
            นอกนั้นเป็น null → แสดง "—" ทุกที่
```

`null` ไม่ใช่ `0` โดยตั้งใจ — **ตอนกลางคืน 0 kW คือค่าจริง** ต้องแยกออกจาก "ไม่ได้ต่อ"

```ts
export type MetricValue = number | null;

export function resolveSiteMetrics(building, binding, overviews, mode) {
  const overview = siteId !== null ? overviews[siteId] ?? null : null;

  if (mode === 'live') {
    // ไม่ผูก / ไม่มีค่า / เป็น payload จำลอง → ไม่แสดงอะไรเลย
    if (!overview || overview.isMockData) return emptyMetrics(...);
    return { hasData: true, source: 'live', currentPowerKw: overview.currentPowerKw, ... };
  }
  ...
}
```

`overview.isMockData` เป็นตัวกันชั้นสุดท้าย — payload จำลองห้ามหลุดขึ้นจอตอนอ้างว่าเป็น live

### สิ่งที่เห็นบนจอเมื่ออยู่โหมด Live แล้วยังไม่ผูก API

- หมุดทั้ง 5: กำลังผลิต / พลังงานรวม / กำลังติดตั้ง = **`—`** ทั้งหมด
- การ์ดหมุดจางลง (`.mea-marker-nodata` — opacity 0.72 + desaturate)
- สถานะบนหมุด: `ยังไม่ได้ผูก API` หรือ `ไม่มีข้อมูลจาก API`
- แผงผลผลิตรวม: `ผลผลิตรวม 0/5 ไซต์` · ป้าย `LIVE API` · ทุกค่าเป็น `—`
  พร้อมข้อความ *"ยังไม่มีข้อมูลจาก SolarEdge — เลือกไซต์จาก API มาผูกกับหมุดก่อน"*
- **Live simulation หยุดทำงาน** ในโหมด live (เดิมยังปั่นตัวเลขอยู่)

แผงยังบอก `sitesWithData/siteCount` เสมอ ถ้าผูกได้แค่บางไซต์จะขึ้น
*"แสดงเฉพาะ N ไซต์ที่ผูก API แล้ว"* ไม่ทำเป็นเหมือนข้อมูลครบ

### เพิ่ม-ลบหมุดไซต์

ตัว logic มีอยู่แล้วใน `buildingStorageService` (localStorage + soft-delete ผ่าน deleted-ids)
แต่ **ไม่มีทางเข้าถึงจากหน้าแผนที่** — เพิ่มปุ่มที่คอลัมน์ซ้ายบน

| ปุ่ม | เงื่อนไข |
|---|---|
| `เพิ่มไซต์` | เปิด `AddBuildingModal` — ตั้งชื่อ/พิกัด/kWp แล้วเลือกผูก SolarEdge site ได้เลย |
| `ลบไซต์` | ต้องเลือกหมุดก่อน (disabled ถ้ายังไม่เลือก) → `DeleteBuildingDialog` |

หมุดใหม่ได้ id ถัดไปอัตโนมัติ และ marker reconciliation เดิมรองรับอยู่แล้ว
(สร้าง DOM เฉพาะ id ใหม่ ลบเฉพาะ id ที่หายไป — ไม่รื้อทั้งชุด)

> **ข้อควรรู้** binding เริ่มต้นในเดโมชี้ไปที่ site id ของ mock (2849101–2849105)
> พอสลับเป็น Live บัญชีจริงจะมี site id คนละชุด หมุดจึงขึ้น "ไม่มีข้อมูลจาก API"
> จนกว่าจะเข้าไปผูกใหม่ผ่านปุ่มผูก SolarEdge ของแต่ละหมุด ซึ่งเป็น flow ที่ตั้งใจไว้

---

## 4. ผลการทดสอบ

ทดสอบบน dev server จริง (`npm run dev`, http://localhost:3000)

| การทดสอบ | ผลลัพธ์ |
|---|---|
| `tsc --noEmit` | ✅ ผ่าน 0 error |
| `vite build` | ✅ สำเร็จ (`sw-tiles.js` ถูก copy ไป `dist/`) |
| แผนที่คงอยู่ 55 วินาที (3–4 data ticks) | ✅ `sameCanvasElement: true`, `canvasCount: 1` — **ไม่ถูกสร้างใหม่** |
| Marker ระหว่าง 55 วินาที | ✅ `sameMarkerElements: true`, `markerCount: 5` — ถูก patch ไม่ใช่สร้างใหม่ |
| ข้อมูลยังอัปเดต | ✅ `183.3 → 184.2`, `285.0 → 283.4` kW |
| Pre-warm 2 ชั้น | ✅ `305 tiles` (~4 MB) — z2–6 รอบนอก + z6–9 ภาคใต้ |
| เปิดครั้งที่ 2 | ✅ `already cached - skipping warm-up` (0 request) |
| เสิร์ฟ tile จากแคช | ✅ `deliveryType: "cache-storage"`, `transferSize: 0`, 4 ms |
| ขอบเขตที่มองเห็นที่ pitch 65 ทุก bearing | ✅ จำกัดที่ lng 89.6–111.3, lat −3.5–20.6 — อยู่ในกรอบ pre-warm ทั้งหมด |
| `sky` + `background` ถูก apply | ✅ ตรวจจาก `__meaMap.getStyle()` บนแผนที่จริง |
| **Mock mode** | ✅ `5/5 ไซต์` · ป้าย `MOCK` · ค่าครบ · สถานะ `Mock Simulator` |
| **สลับเป็น Live (ยังไม่กรอก key)** | ✅ `0/5 ไซต์` · ป้าย `LIVE API` · ทุกค่าเป็น `—` · หมุดจาง 5/5 |
| **สลับกลับ Mock** | ✅ ค่ากลับมาครบทันที ไม่ต้องรีเฟรช |
| เพิ่มหมุด | ✅ 5 → 6 หมุด ชื่อใหม่ขึ้นถูกต้อง |
| ลบหมุด | ✅ 6 → 5 หมุด · totals อัปเดตตาม · แผนที่ไม่ถูกสร้างใหม่ (`canvasCount: 1`) |
| ป้าย `(mock site data)` ในหน้าตั้งค่า | ✅ ขึ้นเมื่อรายชื่อไซต์เป็นข้อมูลจำลอง (คิดจาก `isMockData` ไม่ได้ hardcode) |
| ตัวเลือก Primary Metric | ✅ ถูกลบออก · preview เปลี่ยนเป็น 3 ค่าตรงกับ balloon จริง |
| กราฟรายไซต์หลังแก้ตัวหาร 6000 | ✅ ยอดกราฟ 273 kW สำหรับไซต์ 320 kWp (เดิม ~73 kW ซึ่งต่ำกว่าค่าที่ไซต์ผลิตอยู่จริง) |
| Mock ยังเดินสด | ✅ Today 6,441.9 → 6,446.1 · Accum. +4 kWh · หมุดขยับตาม |

> **หมายเหตุเรื่องขอบเขตการทดสอบ**
> Browser pane ที่ใช้ทดสอบไม่ได้ composite เฟรม (`requestAnimationFrame` ไม่ทำงาน)
> จึงยืนยันได้เฉพาะพฤติกรรมฝั่ง lifecycle / network / DOM
> **ยังไม่ได้วัดความลื่นไหลของภาพ (FPS) และการ pan/rotate จริงบนจอ**
> ต้องทดสอบด้วยตาบนเครื่องจริงก่อนงาน — ดูเช็คลิสต์ข้อ 5

---

## 5. เช็คลิสต์ก่อนงานจริง

1. รันบนเครื่องที่จะใช้จริง ต่อจอ 72" แล้วเปิดทิ้งไว้ **อย่างน้อย 2 ชั่วโมง**
2. เปิด DevTools → Network filter `arcgisonline` → หลัง warm-up ควรนิ่งใกล้ 0
3. DevTools → Performance monitor → ดู **JS heap size** ต้องไม่ไต่ขึ้นเรื่อย ๆ
4. ลองแพน/หมุน/เอียงต่อเนื่อง 2–3 นาที ต้องไม่ค้างและ **มุมกล้องต้องไม่รีเซ็ตเอง**
4b. **หมุนเต็มจอที่มุมเอียง 65° ครบ 360°** — ต้องไม่มีขอบดำ ขอบบนควรเห็นเป็นแสงเรืองสีน้ำเงินเข้ม (sky)
    ถ้ายังเห็นขอบดำ ให้เปิด console แล้วรัน `__meaMap.getBounds().toArray()` (dev เท่านั้น)
    แล้วเทียบกับ `SURROUND_PREWARM_BOUNDS` ว่าครอบคลุมหรือไม่
5. ทดสอบสลับ layer (ดาวเทียมจริง / Hybrid / Dark) — ต้องสลับทันที ไม่โหลดใหม่
6. ถ้าใช้ API key จริง ให้ตรวจ quota ใน Settings modal หลังเปิดทิ้งไว้ 1 ชั่วโมง (ควรใช้ ~12 call)
7. เปิดเป็น **kiosk mode** และปิด screensaver / sleep ของ OS

### ถ้าจะ deploy เป็น production build
`/api/solaredge` proxy มีเฉพาะใน Vite dev server เท่านั้น
ถ้ารัน `vite build` + serve static จะไม่มี proxy และจะโดน CORS
เลือกทางใดทางหนึ่ง:
- รัน `npm run dev` บนเครื่องหน้างาน (ง่ายสุด และ proxy ใช้ได้)
- หรือทำ proxy ด้วย `express` (มี dependency อยู่แล้วใน `package.json`)

### ค่าที่ปรับได้
| ค่า | ไฟล์ | ค่าปัจจุบัน |
|---|---|---|
| ช่วง poll SolarEdge | `src/App.tsx` → `SOLAREDGE_POLL_MS` | 5 นาที |
| พื้นที่ pre-warm ละเอียด | `mapConfig.ts` → `SOUTH_TH_PREWARM_BOUNDS` | 96.8–103.0 E, 4.8–12.0 N (z6–9) |
| พื้นที่ pre-warm รอบนอก | `mapConfig.ts` → `SURROUND_PREWARM_BOUNDS` | 84–117 E, −9–26 N (z2–6) |
| ล็อกกล้อง | `mapConfig.ts` → `MAP_MAX_BOUNDS` | 70–135 E, −20–38 N |
| มุมเอียงสูงสุด | `mapConfig.ts` → `MAX_PITCH` | **65°** (เกิน 71.6° เส้นขอบฟ้าจะเข้าเฟรม) |
| zoom ต่ำสุด/สูงสุด | `mapConfig.ts` → `MIN_ZOOM` / `MAX_ZOOM` | 6.5 / 17 |
| ความเร็ว auto-orbit | `mapConfig.ts` → `ORBIT_DEG_PER_SEC` | 4.5°/วินาที |
| สีท้องฟ้า / ขอบฟ้า | `mapConfig.ts` → `SKY_SPEC` | `#050b18` / `#1e4a6d` |

> **อย่าตั้ง `MAX_PITCH` เกิน 70** เส้นขอบฟ้าจะเข้าเฟรมและขอบดำจะกลับมา
> ถ้าอยากได้มุมเฉียงจัดกว่านี้ ให้ซูมเข้าแทนการเพิ่ม pitch

> เพิ่ม `PREWARM_MAX_ZOOM` เป็น 10 ได้ถ้าต้องการซูมเข้าลื่นกว่านี้
> (≈ +480 tiles, ~15 MB, warm-up นานขึ้นไม่กี่วินาที)

---

## 6. ไฟล์ที่เปลี่ยน

| ไฟล์ | สถานะ |
|---|---|
| `src/config/mapConfig.ts` | **ใหม่** — ค่าคงที่แผนที่ + unified style + sky |
| `src/components/RegionalTotalsPanel.tsx` | **ใหม่** — แผงผลผลิตรวม 5 ไซต์ (มุมขวาล่าง) |
| `src/utils/energyEquivalents.ts` | **ใหม่** — ค่าคงที่ CO₂ / ต้นไม้ ที่ใช้ร่วมกัน |
| `src/services/siteMetricsService.ts` | **ใหม่** — ตัวตัดสิน mock/live + no-data ที่เดียว |
| `src/hooks/useScreenBrightness.ts` | **ใหม่** — ปรับความสว่างหน้าจอ |
| `src/components/BrightnessControl.tsx` | **ใหม่** — ปุ่ม −/%/+ ใน HeaderBar |
| `src/components/HeaderBar.tsx` | แก้ — เพิ่มปุ่มความสว่าง |
| `public/sw-tiles.js` | **ใหม่** — Service Worker แคช tile |
| `src/services/tileCacheService.ts` | **ใหม่** — ลงทะเบียน SW + pre-warm ภาคใต้ |
| `src/hooks/useLongRunGuard.ts` | **ใหม่** — เฝ้า JS heap |
| `src/components/Solar3DViewer.tsx` | **เขียนใหม่** — lifecycle, marker patching, rAF orbit |
| `src/App.tsx` | แก้ — `useCallback` ทุกตัว, poll 5 นาที, แก้ field mapping |
| `src/services/solarEdgeService.ts` | แก้ — bulk endpoint, AbortSignal, quota, แก้ double-call |
| `src/main.tsx` | แก้ — bootstrap tile cache |
| `src/vite-env.d.ts` | **ใหม่** — Vite client types (สำหรับ `import.meta.env`) |
| `src/index.css` | แก้ — `.glass-panel-static`, `.map-interacting`, ย้าย `@import` |
| `.claude/launch.json` | แก้ — port 5173 → 3000 |
| `Solar3DViewer.pre-optimization.tsx.bak` | สำรองไฟล์เดิม (repo ไม่มี git) |

### Dead code ที่พบ (ยังไม่ลบ)
ไม่มีไฟล์ไหน import สามไฟล์นี้ — ถูก tree-shake ออกจาก bundle อยู่แล้ว
(ยืนยันว่า `three` ไม่อยู่ใน bundle) จึงไม่กระทบ performance แต่ลบได้ถ้าต้องการความสะอาด

- `src/components/InteractiveCampusMap.tsx`
- `src/components/MobileBottomNav.tsx` (พร้อม subtree: `BuildingListSidebar`,
  `EnvironmentalCard`, `PerformanceDonutCard`, `PowerChartCard`, `SolarOverviewCard`)
- `src/services/map3DService.ts` (import `three`)
