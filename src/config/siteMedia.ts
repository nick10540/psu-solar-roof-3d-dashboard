/**
 * siteMedia.ts
 * Hero photo or looping clip shown at the top of each site's map card.
 *
 * Files live in `public/site/` and Vite serves them from `/site/<filename>`.
 * To give a site its visual: drop the file into that folder, then add one line
 * to SITE_MEDIA_FILES below keyed by the site's `code` (BuildingInfo.code).
 * Give that line a list instead of a single file and the clips play in order,
 * the last one handing back to the first.
 *
 * Footage that runs too slow gets a line in SITE_MEDIA_SPEED rather than an
 * ffmpeg re-encode, so the number stays one edit away and swapping in new
 * footage needs no re-encode to keep the pace.
 *
 * `code` is the key rather than `id` because ids are reassigned when a pin is
 * deleted and re-added, while the code stays with the physical site.
 *
 * A site with no entry here renders its card without a banner. That is a
 * supported state, not a broken one - the card simply starts at its header.
 *
 * TWO BANNER SETS, ONE SWITCH
 * ---------------------------
 * SITE_PICTURE_FILES below is the same table again in stills. Which of the two
 * a card draws from is not a per-site decision but a board-wide mode - see
 * `SiteMediaMode` and hooks/useSiteMediaMode.ts - because the reason to reach
 * for stills is never about one site: a venue machine that will not decode
 * five clips at once, a projector that smears motion, or a ceremony where
 * moving footage pulls the eye off the numbers. All of those want every card
 * to go still together, from the floor, without a rebuild.
 */

/** Mounted as <video>; anything else in the table is mounted as <img>. */
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|mov|m4v)$/i;

/**
 * Which banner set every card draws from.
 *
 * 'video' is the default, so a profile that has never touched the switch
 * renders exactly as the board did before the mode existed.
 */
export type SiteMediaMode = 'video' | 'picture';

export const SITE_MEDIA_MODE_DEFAULT: SiteMediaMode = 'video';

/**
 * Site `code` -> file name inside `public/site/`, or a list to play in order.
 *
 * A list has to be all clips. Cycling advances when the current clip fires
 * `ended`, and a still image never does, so an image in a list would hold the
 * slot forever; `resolveSiteMediaPlaylist` says so in dev if that slips in.
 */
const SITE_MEDIA_FILES: Record<string, string | string[]> = {
  'MEA-SRT-01': 'vid-suraj.mp4', // วิทยาเขตสุราษฎร์ธานี
  'MEA-TRG-03': 'vid-trang.mp4', // วิทยาเขตตรัง
  // หาดใหญ่: 3 คลิปเล่นวนต่อกัน 1 -> 2 -> 3 -> 1 (เร่ง 1.75x ดู SITE_MEDIA_SPEED)
  'MEA-HDY-04': ['vid-hatyai.mp4', 'vid-hatyai2.mp4', 'vid-hatyai3.mp4'],
  'MEA-PTN-05': 'vid-pattani.mp4', // วิทยาเขตปัตตานี
  'MEA-PKT-02': 'vid-puket.mp4', // วิทยาเขตภูเก็ต
};

/**
 * Site `code` -> file name inside `public/site/picture/`, for picture mode.
 *
 * One still per site, never a list: a still never fires `ended`, so there is
 * nothing to advance a slideshow on, and a card that swapped photos on a timer
 * would be motion again - the very thing this mode exists to remove.
 *
 * A site missing from this table renders bannerless in picture mode rather
 * than quietly falling back to its clip. Falling back would defeat the mode on
 * exactly the machine it was switched on for.
 */
const SITE_PICTURE_FILES: Record<string, string> = {
  'MEA-SRT-01': 'suraj.jpg', // วิทยาเขตสุราษฎร์ธานี
  'MEA-PKT-02': 'phuket.jpg', // วิทยาเขตภูเก็ต
  'MEA-TRG-03': 'trang.jpg', // วิทยาเขตตรัง
  'MEA-HDY-04': 'hatyai.png', // วิทยาเขตหาดใหญ่
  'MEA-PTN-05': 'pattani.jpg', // วิทยาเขตปัตตานี
};

/**
 * Site `code` -> how fast to run that site's clips, where 1 is the file's own
 * speed. A site listed here speeds up every clip in its list, not just the
 * first, so a playlist keeps one consistent pace.
 *
 * This is deliberately not baked into the files with ffmpeg: the files stay at
 * full quality, the number is one edit away, and new footage dropped in under
 * the same name picks up the speed without a re-encode.
 *
 * Values much past ~2 read as broken rather than brisk, and the element rejects
 * a rate it cannot resample, so keep these modest.
 */
const SITE_MEDIA_SPEED: Record<string, number> = {
  'MEA-HDY-04': 1.75, // หาดใหญ่: ทั้ง 3 คลิป
};

export interface SiteMedia {
  /** Path under the site origin, e.g. `/site/vid-trang.mp4`. */
  url: string;
  kind: 'video' | 'image';
}

/**
 * `dir` is '' for the clips sitting at the root of `public/site/` and
 * 'picture/' for the stills - required rather than defaulted, so a stray
 * `files.map(toSiteMedia)` fails to compile instead of quietly handing the
 * array index in as `dir` (see the comment at its one multi-file call site
 * below).
 *
 * `kind` comes from the extension alone, not from which table the file came
 * out of - this function has no opinion on whether a video belongs under
 * SITE_PICTURE_FILES. `resolveSiteMediaPlaylist` is what turns that opinion
 * into a rule and rejects one before it ever reaches here.
 */
function toSiteMedia(file: string, dir: string): SiteMedia {
  return {
    // Built off BASE_URL rather than a literal leading slash, for the same
    // reason main.tsx:26-33 builds the MapLibre worker's URL that way: an
    // absolute "/site/..." resolves to the domain root and misses the file
    // once this dashboard is served from a sub-path. BASE_URL always carries
    // its own trailing slash, so this is a plain concatenation, and at the
    // default BASE_URL of "/" it is exactly the string this was before.
    url: `${import.meta.env.BASE_URL}site/${dir}${encodeURIComponent(file)}`,
    kind: VIDEO_EXTENSIONS.test(file) ? 'video' : 'image',
  };
}

/**
 * Every banner file for a site, in play order. Empty when no file has been
 * supplied for it, which is the caller's cue to render the card bannerless.
 *
 * A one-entry result is the common case and callers should keep letting the
 * element loop itself; only a longer list needs the advance-on-`ended` wiring.
 * Picture mode is therefore always one entry, and callers need no separate
 * branch for it - it arrives here as an ordinary single-item playlist.
 */
export function resolveSiteMediaPlaylist(
  code: string,
  mode: SiteMediaMode = SITE_MEDIA_MODE_DEFAULT
): SiteMedia[] {
  if (mode === 'picture') {
    const picture = SITE_PICTURE_FILES[code];

    if (import.meta.env.DEV && !picture && SITE_MEDIA_FILES[code]) {
      console.warn(
        `[siteMedia] ${code}: has a clip but no still in SITE_PICTURE_FILES - its card is bannerless in picture mode.`
      );
    }

    if (!picture) return [];

    // A clip filed under SITE_PICTURE_FILES by mistake must not autoplay as a
    // <video> just because toSiteMedia derives `kind` from the extension -
    // that would defeat picture mode on exactly the machine it was switched
    // on to spare. Rejected here, before toSiteMedia ever sees it, rather
    // than quietly falling back to motion: the card goes bannerless instead,
    // the same as a site missing from this table entirely.
    if (VIDEO_EXTENSIONS.test(picture)) {
      if (import.meta.env.DEV) {
        console.warn(
          `[siteMedia] ${code}: SITE_PICTURE_FILES entry "${picture}" is a video file - ignored in picture mode instead of played as a clip.`
        );
      }
      return [];
    }

    return [toSiteMedia(picture, 'picture/')];
  }

  const entry = SITE_MEDIA_FILES[code];
  if (!entry) return [];

  const files = Array.isArray(entry) ? entry : [entry];
  const playlist = files.map((file) => toSiteMedia(file, ''));

  if (import.meta.env.DEV && playlist.length > 1 && playlist.some((m) => m.kind !== 'video')) {
    console.warn(
      `[siteMedia] ${code}: a multi-file entry must be all clips - a still image stops the cycle.`
    );
  }

  return playlist;
}

/**
 * How fast to run this site's clips - 1, the file's own speed, unless the site
 * is listed in SITE_MEDIA_SPEED.
 *
 * Callers must put this on the element's `defaultPlaybackRate`, not only on
 * `playbackRate`. Assigning `src` to hand over to the next clip reruns the
 * media load algorithm, and that resets `playbackRate` back to
 * `defaultPlaybackRate` - set only the latter and every clip after the first
 * quietly drops to 1x.
 *
 * Irrelevant in picture mode, where there is no element to set it on; callers
 * may read it unconditionally and simply never use the result.
 */
export function resolveSiteMediaSpeed(code: string): number {
  return SITE_MEDIA_SPEED[code] ?? 1;
}
