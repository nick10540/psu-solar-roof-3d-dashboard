/**
 * CeremonyClock.tsx
 * Digital clock over the 3D map, left-hand side. Built for a venue display
 * read from across a room: large tabular digits in MEA orange (#E67100),
 * Thai date in Buddhist years underneath.
 *
 * Notes:
 *  - `pointer-events-none`. This sits on top of a live MapLibre canvas;
 *    anything that swallows a drag here breaks panning the map.
 *  - The tick runs at 250ms but state holds the *formatted strings*, so React
 *    bails out on the three ticks that render identically. A plain 1s interval
 *    drifts and visibly skips a second on a display left running for hours.
 *  - Placement is driven by the masthead, which is centred and ~1240px wide:
 *    below 1680px the gutter beside it is too narrow for a clock this size, so
 *    the clock drops underneath the masthead instead of overlapping the MEA
 *    mark. One breakpoint, not a ladder: Tailwind orders an arbitrary `min-[]`
 *    variant ahead of the named `2xl`, so a `2xl:top-*` step would have
 *    outranked the 1680px override at every width above 1536px.
 *  - Type scales off the same gutter — `(100vw - 1240px) / 2` is the room to
 *    the left of the masthead — so the digits grow with the display instead of
 *    jumping at breakpoints. Clamped so they stay readable at 1680px and stop
 *    growing past a 4K wall.
 */

import React, { useEffect, useState } from 'react';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_DAYS = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];

/** Width of the masthead this clock has to sit clear of. */
const MASTHEAD_W = '1240px';
const TIME_SIZE = `clamp(2rem, calc((100vw - ${MASTHEAD_W}) * 0.09), 4rem)`;
const DATE_SIZE = `clamp(0.75rem, calc((100vw - ${MASTHEAD_W}) * 0.022), 1rem)`;

const pad = (n: number) => String(n).padStart(2, '0');

const formatClock = (now: Date) => ({
  hhmm: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  ss: pad(now.getSeconds()),
  date: `วัน${THAI_DAYS[now.getDay()]}ที่ ${now.getDate()} ${THAI_MONTHS[now.getMonth()]} ${now.getFullYear() + 543}`,
});

export const CeremonyClock: React.FC = () => {
  const initial = formatClock(new Date());
  const [hhmm, setHhmm] = useState(initial.hhmm);
  const [ss, setSs] = useState(initial.ss);
  const [dateStr, setDateStr] = useState(initial.date);

  useEffect(() => {
    const tick = () => {
      const next = formatClock(new Date());
      setHhmm(next.hhmm);
      setSs(next.ss);
      setDateStr(next.date);
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      id="ceremony-clock"
      className="pointer-events-none absolute left-4 z-30 hidden md:block top-[10.5rem] min-[1680px]:top-2.5"
    >
      <div className="rounded-2xl bg-slate-950/55 px-4 py-2 text-center backdrop-blur-[2px]">
        <div
          className="flex items-baseline justify-center gap-1.5 font-mono leading-none tabular-nums"
          style={{ fontSize: TIME_SIZE }}
        >
          <span className="font-black tracking-tight text-[#E67100] drop-shadow-[0_0_18px_rgba(230,113,0,0.55)]">
            {hhmm}
          </span>
          <span className="text-[0.45em] font-bold text-[#E67100]/80 drop-shadow-[0_0_10px_rgba(230,113,0,0.45)]">
            {ss}
          </span>
        </div>

        <div
          className="mt-1.5 whitespace-nowrap font-['Prompt',sans-serif] font-semibold tracking-wide text-slate-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
          style={{ fontSize: DATE_SIZE }}
        >
          {dateStr}
        </div>
      </div>
    </div>
  );
};
