/**
 * introVideo.ts
 * The clip, and the run of stills after it, that fill the screen before the
 * dashboard is handed to the room.
 *
 * The files live in `public/`, which Vite serves from the site root - so
 * `public/1.mp4` is `/1.mp4`. Swapping the intro is a one-line edit here; no
 * component needs to know which files they are.
 *
 * Worth knowing about how this is staged (see IntroVideoOverlay.tsx): the
 * dashboard mounts BEHIND all of this rather than after it. The map's WebGL
 * context, its tiles and the first SolarEdge round all happen during the ~20
 * seconds the audience is watching, so the overlay lifts onto a warm dashboard
 * instead of onto a grey map still fetching tiles.
 */

export interface IntroVideoConfig {
  /** Master switch. Off means the dashboard comes straight up, no intro. */
  enabled: boolean;
  /** Path under the site root, e.g. `/1.mp4` for `public/1.mp4`. */
  src: string;
  /**
   * Attempt sound.
   *
   * A browser refuses an unmuted autoplay unless it has a reason to trust the
   * page, so this is a request rather than a guarantee: the overlay tries with
   * sound, and on refusal restarts muted and offers an unmute button (one tap
   * is the gesture the browser was holding out for). A venue machine launched
   * with `--autoplay-policy=no-user-gesture-required` gets sound unattended.
   *
   * Set false for a screen that must stay silent - a lobby panel next to a
   * speaker's podium, say.
   */
  withSound: boolean;
  /** 1 is the file's own speed. Same knob as SITE_MEDIA_SPEED in siteMedia.ts. */
  playbackRate: number;
  /**
   * Photographs shown after the clip, in order, one every `stillDurationMs`.
   *
   * Paths under the site root, same as `src` - `public/2.jpg` is `/2.jpg`.
   * Reorder or drop a line to re-cut the montage; an empty list hands the
   * clip straight to the dashboard.
   *
   * These are also the reason the whole overlay frames with `object-contain`:
   * they are photographs of named people at the installations, and a montage
   * that crops a head or a pair of feet off the bottom of a 72" screen at a
   * ceremony is not a trade worth making for a full-bleed frame.
   */
  stills: string[];
  /**
   * Airtime per still.
   *
   * Hard cuts, no cross-fade: at half a second even a 150ms dissolve spends a
   * third of every slide mid-blend, which turns a montage into a smear. The
   * only fade is the last one, out to the dashboard.
   */
  stillDurationMs: number;
  /**
   * Play only on the first load of a browser session (survives reloads in the
   * same tab; a freshly opened window counts as new).
   *
   * Left off because the ask was an intro on entering the dashboard, and a
   * reload during setup that silently skips it reads as a broken intro. Turn
   * it on for a screen that will sit unattended for a long stretch:
   * useLongRunGuard reloads the page under heap pressure once nobody has
   * touched it for 10 minutes, and during a ceremony that idle window is
   * entirely plausible - this is what stops a 17-second clip from opening up
   * over someone speaking.
   */
  showOncePerSession: boolean;
  /**
   * Give up on the clip and move on to the stills if not a single frame has
   * played by then.
   *
   * A missing or undecodable file must cost a few seconds, never the event: a
   * black rectangle stuck over a live dashboard is the one failure mode here
   * that an operator cannot talk their way out of. Falling through to the
   * stills rather than straight to the dashboard means a bad video file
   * degrades the intro instead of erasing it.
   */
  startTimeoutMs: number;
  /** Cross-fade from the last still (or the last video frame) to the dashboard. */
  fadeOutMs: number;
}

export const INTRO_VIDEO: IntroVideoConfig = {
  enabled: true,
  src: '/1.mp4',
  withSound: true,
  playbackRate: 1,
  stills: ['/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg', '/6.jpg', '/7.jpg', '/8.jpg'],
  stillDurationMs: 500,
  showOncePerSession: false,
  startTimeoutMs: 6000,
  fadeOutMs: 700,
};
