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
 *  - Rendered inside <HudFrame>, a box that is ALWAYS 1904px wide (App.tsx),
 *    which is why every size below is now a single frozen number rather than
 *    a `100vw`-driven calc() or a breakpoint. Both used to react to the REAL
 *    browser viewport; HudFrame's own `transform: scale()` is what does that
 *    job now, for this component and everything else inside the frame - see
 *    HudFrame.tsx. Sizing off `100vw` a second time, inside a box HudFrame is
 *    already scaling as a whole, would double-apply the viewport response.
 *  - TOP POSITION, frozen. Placement is driven by the masthead, which is
 *    centred and ~1240px wide: below 1680px (of REAL viewport, historically)
 *    the gutter beside it was too narrow for a clock this size, so the clock
 *    dropped underneath the masthead instead of overlapping the MEA mark. The
 *    reference frame is 1904px, always past that threshold, so the clock is
 *    frozen at the "beside the masthead" position (top: 10px) - the
 *    underneath position is dead code once nested in the frame, and is not
 *    reproduced here.
 *  - TYPE SIZE, frozen. It used to scale off the masthead's gutter -
 *    `(100vw - 1240px) / 2` is the room to its left - so the digits grew with
 *    the display instead of jumping at breakpoints, clamped so they stayed
 *    readable at 1680px and stopped growing past a 4K wall. TIME_SIZE_PX and
 *    DATE_SIZE_PX below are exactly that formula evaluated once, at the
 *    reference viewport's 1904px (664px of gutter): unclamped at that width,
 *    so the numbers are the formula's own output, not the clamp's floor or
 *    ceiling.
 */

import React, { useEffect, useState } from 'react';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_DAYS = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];

// (1904 - 1240) * 0.09 and * 0.022 - see the file header for where these
// factors and the 1240px masthead width come from.
const TIME_SIZE_PX = 59.76;
const DATE_SIZE_PX = 14.61;

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
    <div id="ceremony-clock" className="pointer-events-none absolute left-4 top-2.5">
      <div className="rounded-2xl bg-slate-950/55 px-4 py-2 text-center backdrop-blur-[2px]">
        <div
          className="flex items-baseline justify-center gap-1.5 font-mono leading-none tabular-nums"
          style={{ fontSize: TIME_SIZE_PX }}
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
          style={{ fontSize: DATE_SIZE_PX }}
        >
          {dateStr}
        </div>
      </div>
    </div>
  );
};
