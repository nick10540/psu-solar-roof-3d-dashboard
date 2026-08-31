/**
 * siteMedia.ts
 * Hero photo or looping clip shown at the top of each site's map card.
 *
 * Files live in `public/site/` and Vite serves them from `/site/<filename>`.
 * To give a site its visual: drop the file into that folder, then add one line
 * to SITE_MEDIA_FILES below keyed by the site's `code` (BuildingInfo.code).
 *
 * `code` is the key rather than `id` because ids are reassigned when a pin is
 * deleted and re-added, while the code stays with the physical site.
 *
 * A site with no entry here renders its card without a banner. That is a
 * supported state, not a broken one - the card simply starts at its header.
 */

/** Mounted as <video>; anything else in the table is mounted as <img>. */
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|mov|m4v)$/i;

/** Site `code` -> file name inside `public/site/`. */
const SITE_MEDIA_FILES: Record<string, string> = {
  'MEA-SRT-01': 'vid-suraj.mp4', // วิทยาเขตสุราษฎร์ธานี
  'MEA-TRG-03': 'vid-trang.mp4', // วิทยาเขตตรัง
  'MEA-HDY-04': 'vid-hatyai.mp4', // วิทยาเขตหาดใหญ่
  'MEA-PTN-05': 'vid-pattani.mp4', // วิทยาเขตปัตตานี
  'MEA-PKT-02': 'vid-puket.mp4', // วิทยาเขตภูเก็ต
};

export interface SiteMedia {
  /** Path under the site origin, e.g. `/site/vid-trang.mp4`. */
  url: string;
  kind: 'video' | 'image';
}

/** The banner for a site, or `null` when no file has been supplied for it. */
export function resolveSiteMedia(code: string): SiteMedia | null {
  const file = SITE_MEDIA_FILES[code];
  if (!file) return null;
  return {
    url: `/site/${encodeURIComponent(file)}`,
    kind: VIDEO_EXTENSIONS.test(file) ? 'video' : 'image',
  };
}
