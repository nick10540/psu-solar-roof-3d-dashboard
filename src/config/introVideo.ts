/**
 * introVideo.ts
 * The clip that fills the screen before the dashboard is handed to the room,
 * and the short sound that plays as it is.
 *
 * The files live in `public/`, which Vite serves from the site root - so
 * `public/1.mp4` is `/1.mp4`. Swapping the intro is a one-line edit here; no
 * component needs to know which files they are.
 *
 * Worth knowing about how this is staged (see IntroVideoOverlay.tsx): the
 * dashboard mounts BEHIND all of this rather than after it. The map's WebGL
 * context, its tiles and the first SolarEdge round all happen during the
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
   * A short sound played ONCE as the dashboard takes over, or `null` for none.
   *
   * Starts with the fade rather than after it, so the sting lands over the
   * dashboard appearing instead of a beat late. It outlives the overlay - see
   * the module-scope handle in IntroVideoOverlay.tsx - so it may be longer than
   * `fadeOutMs` without being cut off.
   *
   * Never loops. This is a punctuation mark on the intro, and a venue screen
   * that repeats a sting behind a speaker is worse than one that stays quiet.
   *
   * Subject to the same autoplay policy as the clip: a browser that refused the
   * video its sound will refuse this too, and it is skipped silently rather
   * than retried. Pressing the skip button IS a gesture, so a manual skip
   * always gets it.
   */
  outroSoundSrc: string | null;
  /** 0..1, for a file mastered louder than the room needs. */
  outroSoundVolume: number;
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
   * Give up on the clip and hand over to the dashboard if not a single frame
   * has played by then.
   *
   * A missing or undecodable file must cost a few seconds, never the event: a
   * black rectangle stuck over a live dashboard is the one failure mode here
   * that an operator cannot talk their way out of.
   */
  startTimeoutMs: number;
  /** Cross-fade from the last video frame to the dashboard. */
  fadeOutMs: number;
}

export const INTRO_VIDEO: IntroVideoConfig = {
  enabled: true,
  src: '/1.mp4',
  withSound: true,
  playbackRate: 1,
  outroSoundSrc: '/2.mp3',
  outroSoundVolume: 1,
  showOncePerSession: false,
  startTimeoutMs: 6000,
  fadeOutMs: 700,
};
