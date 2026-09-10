/**
 * CeremonyHero.tsx
 * Masthead shown over the 3D map: the two partner logos flanking the system
 * name, on a single line.
 *
 * Deliberately kept to one line. An earlier version carried the full ceremony
 * wording over three lines and swallowed the top third of the map, hiding the
 * northern site pins behind it.
 *
 * Notes:
 *  - `pointer-events-none` throughout. This sits on top of a live MapLibre
 *    canvas; anything that swallows a drag here breaks panning the map.
 *  - The logo order matches the printed event backdrop: PSU left, MEA right.
 *    (The files are named for their old header positions, so `right-logo` is
 *    the PSU crest and `left-logo` is the MEA seal — deliberately crossed.)
 *  - The title carries its own shadow and a soft plate behind it: the
 *    background is satellite imagery that swings from dark sea to bright
 *    rooftop as the camera orbits.
 *  - The plate is deliberately tight — px-3 and a 8/12px gap — so the two
 *    marks sit in from the screen corners instead of reaching for them. Width
 *    is the scarce resource up here: title + logos already run past 1200px,
 *    and the totals panel owns the top-right 352px, so the panel drops below
 *    the masthead under ~1990px rather than being covered (Solar3DViewer).
 *  - Rendered inside <HudFrame>, a box that is ALWAYS 1904px wide (App.tsx) -
 *    so every size below is written as the ONE value it used to resolve to at
 *    that width, not as a breakpoint ladder. A `sm:`/`xl:`/`2xl:` variant
 *    reacts to the REAL browser viewport, which is exactly the wrong thing
 *    once this markup sits inside a box HudFrame scales as a whole to fit that
 *    viewport: at a real width below the ladder's top breakpoint the variant
 *    would silently stop applying even though, at reference size, it always
 *    should. See HudFrame.tsx for the reasoning in full.
 */

import React from 'react';

export const CeremonyHero: React.FC = () => {
  return (
    <div
      id="ceremony-hero"
      className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-2.5"
    >
      <div className="flex items-center gap-3 rounded-2xl bg-slate-950/55 px-3 py-1.5 backdrop-blur-[2px]">
        {/*
          MEA on the left, PSU on the right, both larger than before.

          The wordmark version of the MEA mark is wider than it is tall, so it
          gets `w-auto` off a taller height cap rather than a square box.

          The PSU file carries its crest in the middle 46% of the canvas —
          measured, 27.5% transparent left and 26.7% right — so at h-32 its
          box claims 193px to show an 88px crest and shoves the mark out
          towards the screen corner. The negative margins reclaim that dead
          space (~2px short of the ink on each side, so nothing clips) and
          buy the plate back ~96px. Values are per logo height: 0.271 x the
          rendered box width, which is 1.506 x the height.
        */}
        <img
          src="/logos/mea-logo.png"
          alt="ตราสัญลักษณ์การไฟฟ้านครหลวง"
          className="h-32 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
        />

        {/* Sizes are written out in px because the ask was literally "+2px"
            at every step: 16→18, 20→22, 30→32 - frozen here at the top of that
            ladder, 32px, since the reference frame is always wide enough for it. */}
        <h1 className="text-[32px] font-black tracking-wide whitespace-nowrap text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.95)] font-['Prompt',sans-serif]">
          ระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์ มหาวิทยาลัยสงขลานครินทร์
        </h1>

        <img
          src="/logos/right-logo.png"
          alt="ตราสัญลักษณ์มหาวิทยาลัยสงขลานครินทร์"
          className="h-32 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] -mx-12"
        />
      </div>
    </div>
  );
};
