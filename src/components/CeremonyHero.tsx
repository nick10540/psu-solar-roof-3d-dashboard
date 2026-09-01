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
 */

import React from 'react';

export const CeremonyHero: React.FC = () => {
  return (
    <div
      id="ceremony-hero"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-2.5"
    >
      <div className="flex items-center gap-3 sm:gap-4 rounded-2xl bg-slate-950/55 px-4 py-1.5 backdrop-blur-[2px]">
        {/*
          MEA on the left, PSU on the right, both larger than before.

          The wordmark version of the MEA mark is wider than it is tall, so it
          gets `w-auto` off a taller height cap rather than a square box.
        */}
        <img
          src="/logos/mea-logo.png"
          alt="ตราสัญลักษณ์การไฟฟ้านครหลวง"
          className="h-12 sm:h-16 xl:h-20 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
        />

        <h1 className="text-base sm:text-xl xl:text-3xl font-black tracking-wide whitespace-nowrap text-white drop-shadow-[0_3px_12px_rgba(0,0,0,0.95)] font-['Prompt',sans-serif]">
          ระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์ มหาวิทยาลัยสงขลานครินทร์
        </h1>

        <img
          src="/logos/right-logo.png"
          alt="ตราสัญลักษณ์มหาวิทยาลัยสงขลานครินทร์"
          className="h-12 sm:h-16 xl:h-20 w-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
        />
      </div>
    </div>
  );
};
