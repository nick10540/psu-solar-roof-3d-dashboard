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
 */

/** Mounted as <video>; anything else in the table is mounted as <img>. */
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|mov|m4v)$/i;

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

function toSiteMedia(file: string): SiteMedia {
  return {
    url: `/site/${encodeURIComponent(file)}`,
    kind: VIDEO_EXTENSIONS.test(file) ? 'video' : 'image',
  };
}

/**
 * Every banner file for a site, in play order. Empty when no file has been
 * supplied for it, which is the caller's cue to render the card bannerless.
 *
 * A one-entry result is the common case and callers should keep letting the
 * element loop itself; only a longer list needs the advance-on-`ended` wiring.
 */
export function resolveSiteMediaPlaylist(code: string): SiteMedia[] {
  const entry = SITE_MEDIA_FILES[code];
  if (!entry) return [];

  const files = Array.isArray(entry) ? entry : [entry];
  const playlist = files.map(toSiteMedia);

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
 */
export function resolveSiteMediaSpeed(code: string): number {
  return SITE_MEDIA_SPEED[code] ?? 1;
}
