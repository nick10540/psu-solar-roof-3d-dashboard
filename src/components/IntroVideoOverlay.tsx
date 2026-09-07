/**
 * IntroVideoOverlay.tsx
 * Full-screen clip played once over the dashboard on entry, then a fade into
 * the live board with a short sound over it.
 *
 * ---------------------------------------------------------------------------
 * WHY AN OVERLAY AND NOT A GATE
 *
 * The dashboard is mounted underneath from the first paint; this only covers
 * it. Gating the mount on the intro would spend the clip showing the audience
 * a video and then drop them onto a cold map: MapLibre would still be creating
 * its WebGL context, pulling tiles and waiting on the first SolarEdge round.
 * Staged this way all of that happens behind the intro, and the fade lands on a
 * dashboard already drawing real numbers.
 * ---------------------------------------------------------------------------
 * "FULL SCREEN" HERE MEANS THE VIEWPORT
 *
 * Not the Fullscreen API - `requestFullscreen()` needs a user gesture and
 * there is none on page load. The overlay fills the viewport instead, so a
 * kiosk already in fullscreen (HeaderBar's button, or F11 at the venue) shows
 * the intro edge to edge, and a windowed browser fills its window.
 *
 * `object-contain` on black, never `object-cover`: the clip is 960x522
 * (~1.84:1), and covering would crop it to whatever the venue panel happens to
 * be. Letterboxing is the cheaper mistake at a ceremony.
 * ---------------------------------------------------------------------------
 * STAGES
 *
 *   video -> fade -> gone
 *
 * A run of stills used to sit between the clip and the fade. It was removed at
 * the operator's request - the clip now hands straight to the dashboard - and
 * with it went the decode warm-up, the per-slide timer and the split progress
 * bar those seven photographs needed.
 *
 * Every exit runs through `dismiss()`: the clip ends, the operator skips, or
 * the clip fails to start. There is no state in which this can keep the
 * dashboard covered; the worst a broken file can do is shorten the intro to
 * nothing.
 * ---------------------------------------------------------------------------
 * NOTES
 *  - Skip is a visible button AND Esc / Enter / Space, because the venue
 *    machine is as likely to be driven by a presenter remote as by a mouse.
 *  - `z-[100]` sits clear of the app's ceiling, which is the header bar at
 *    z-50.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SkipForward, Volume2, VolumeX } from 'lucide-react';
import { INTRO_VIDEO } from '../config/introVideo';
import { notifyIntroFinished } from '../services/introHandoff';

type Phase = 'video' | 'fading' | 'done';

const SESSION_KEY = 'mea:intro-video-played';

/**
 * The outro sting, held at module scope on purpose.
 *
 * It starts as the fade STARTS, and this component unmounts `fadeOutMs` later -
 * so an element owned by the component (a ref, or a rendered <audio>) would be
 * torn down mid-sound for any file longer than 700ms. A detached element that
 * is playing keeps playing, provided something still references it; this is
 * that reference.
 *
 * Also the guard against a double sting: a skip landing in the same frame as
 * `onEnded` would otherwise start it twice, a beat apart.
 */
let outroAudio: HTMLAudioElement | null = null;

/**
 * Play the outro sound once, or do nothing at all.
 *
 * Silent about failure by design. Autoplay may be refused (see
 * `outroSoundSrc`), the file may be missing on a machine set up in a hurry -
 * neither is worth a console error during a ceremony, and neither may stop the
 * handover to the dashboard.
 */
function playOutroSound(): void {
  const src = INTRO_VIDEO.outroSoundSrc;
  if (!src || outroAudio) return;

  try {
    const audio = new Audio(src);
    audio.volume = Math.min(Math.max(INTRO_VIDEO.outroSoundVolume, 0), 1);
    // No loop, ever. One sting, then the room is quiet again.
    audio.loop = false;
    outroAudio = audio;
    void audio.play().catch(() => {});
  } catch {
    // `new Audio` itself failing means there is no audio on this machine.
  }
}

/**
 * Decided once, before the first paint, so the overlay is either up from the
 * start or never appears - a video that flashes in a frame late reads as a
 * glitch on a 72" panel.
 */
function shouldPlayIntro(): boolean {
  if (!INTRO_VIDEO.enabled) return false;
  if (!INTRO_VIDEO.showOncePerSession) return true;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) !== '1';
  } catch {
    // Storage blocked (private window, locked-down kiosk profile). Playing the
    // intro is the intended behaviour; the flag is only ever a suppressor.
    return true;
  }
}

export const IntroVideoOverlay: React.FC = () => {
  const [phase, setPhase] = useState<Phase>(() => (shouldPlayIntro() ? 'video' : 'done'));
  /** Mirrors the element, which may have been forced muted to get autoplay. */
  const [isMuted, setIsMuted] = useState<boolean>(!INTRO_VIDEO.withSound);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  /** Guards the several independent exits from each starting their own fade. */
  const dismissedRef = useRef<boolean>(false);
  const fadeTimerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    // Stop decoding at once. On a skip this is also what cuts the clip's audio:
    // the fade is a fade of a still frame, not of sound the operator just asked
    // to be rid of - and it clears the way for the sting below.
    videoRef.current?.pause();

    setPhase('fading');
    fadeTimerRef.current = window.setTimeout(() => setPhase('done'), INTRO_VIDEO.fadeOutMs);

    // With the fade, not after it: the sound belongs to the dashboard arriving.
    playOutroSound();

    // As the fade STARTS, not when the overlay is finally gone: the dashboard
    // is visible through it, so the map's link line draws on into the last
    // frame dissolving away rather than after a beat of dead air.
    notifyIntroFinished();
  }, []);

  // --- Playback ------------------------------------------------------------
  // `autoPlay` is deliberately not on the element: the sound-then-muted
  // fallback needs to know whether the play() promise was rejected, and the
  // attribute gives no such handle.
  useEffect(() => {
    if (phase !== 'video') return;
    const el = videoRef.current;
    if (!el) return;

    if (INTRO_VIDEO.showOncePerSession) {
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        // Nothing to do: with no storage every load simply plays the intro.
      }
    }

    // Both, and before play(): a media element resets `playbackRate` to
    // `defaultPlaybackRate` whenever it reruns its load algorithm.
    el.defaultPlaybackRate = INTRO_VIDEO.playbackRate;
    el.playbackRate = INTRO_VIDEO.playbackRate;

    let cancelled = false;

    const start = async () => {
      el.muted = !INTRO_VIDEO.withSound;
      try {
        await el.play();
      } catch {
        // Unmuted autoplay refused. The rejection comes before any frame is
        // shown, so restarting muted loses nothing but the sound.
        if (cancelled) return;
        el.muted = true;
        try {
          await el.play();
        } catch {
          // Muted autoplay refused too, which means playback is not going to
          // happen at all. Hand over rather than hold a black screen for the
          // length of the clip.
          if (!cancelled) dismiss();
          return;
        }
      }
      if (!cancelled) setIsMuted(el.muted);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [phase, dismiss]);

  // --- Safety net ----------------------------------------------------------
  // `onError` covers a file the browser rejects outright. This covers the rest:
  // a stalled decode, an empty response, a `play()` promise that never settles.
  useEffect(() => {
    if (phase !== 'video') return;

    const timer = window.setTimeout(() => {
      const el = videoRef.current;
      if (!el || el.paused || el.currentTime === 0) dismiss();
    }, INTRO_VIDEO.startTimeoutMs);

    return () => window.clearTimeout(timer);
  }, [phase, dismiss]);

  // --- Skip by key ---------------------------------------------------------
  // On window rather than on the overlay: nothing here holds focus, and taking
  // it would leave the dashboard underneath to claw it back on the fade.
  useEffect(() => {
    if (phase === 'done') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dismiss();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, dismiss]);

  // Unmount mid-fade (a reload landing on this tick) must not leave a timer
  // holding a setState on a component that is gone.
  useEffect(
    () => () => {
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    },
    []
  );

  // No intro to play - disabled, or already shown this session. The dashboard
  // is on screen from the first paint, so the handover has effectively already
  // happened and whatever waits on it must not be left waiting forever.
  //
  // No sting here: nothing played, so there is nothing to punctuate.
  useEffect(() => {
    if (phase === 'done' && !dismissedRef.current) notifyIntroFinished();
    // Mount-time decision only; a phase that reaches 'done' by fading has
    // already announced itself from dismiss().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One tap: turns the sound on, and is itself the gesture autoplay wanted. */
  const handleToggleSound = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
    if (!el.muted) void el.play().catch(() => {});
  }, []);

  /**
   * Progress through the clip, written straight to the node's transform.
   *
   * `timeupdate` fires about four times a second and this is the one number on
   * screen; routing it through state would re-render the overlay - and with it
   * the <video> - throughout the clip, on the same machine that is bringing a
   * WebGL map up behind it.
   *
   * The clip now owns the whole bar. It used to own only its share of it,
   * against the montage's wall-clock length.
   */
  const handleTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    const bar = progressRef.current;
    if (!bar || !Number.isFinite(el.duration) || el.duration <= 0) return;

    bar.style.transform = `scaleX(${Math.min(el.currentTime / el.duration, 1)})`;
  }, []);

  if (phase === 'done') return null;

  const isFading = phase === 'fading';

  return (
    <div
      id="intro-video-overlay"
      // `pointer-events-none` the moment the fade starts, so the dashboard is
      // live under a still-visible overlay instead of only after it.
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity ease-out ${
        isFading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${INTRO_VIDEO.fadeOutMs}ms` }}
    >
      {/* Left mounted through the fade: it is the frame being faded out. */}
      <video
        ref={videoRef}
        src={INTRO_VIDEO.src}
        className="h-full w-full object-contain"
        // The whole 4 MB is wanted up front: this plays once, immediately,
        // off the same origin, and a re-buffer mid-clip is in front of an
        // audience.
        preload="auto"
        playsInline
        onEnded={dismiss}
        onError={dismiss}
        onTimeUpdate={handleTimeUpdate}
      />

      {/* Controls. Sized for a fingertip on the venue touch panel, and held
          well in from the corners of a 72" screen where a bezel eats them. */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 sm:p-7">
        {INTRO_VIDEO.withSound && !isFading ? (
          <button
            type="button"
            id="btn-intro-toggle-sound"
            onClick={handleToggleSound}
            aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
            title={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 py-2.5 text-sm font-medium text-slate-200 backdrop-blur-sm transition-colors hover:border-sky-300/50 hover:text-white cursor-pointer"
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span>{isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}</span>
          </button>
        ) : (
          // Keeps the skip button pinned right once the sound button goes.
          <span aria-hidden="true" />
        )}

        <button
          type="button"
          id="btn-intro-skip"
          onClick={dismiss}
          title="ข้ามวิดีโอเปิดตัว เข้าสู่แดชบอร์ด"
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-5 py-2.5 text-sm font-semibold text-slate-200 backdrop-blur-sm transition-colors hover:border-sky-300/50 hover:text-white cursor-pointer"
        >
          <span>ข้ามการเปิดตัว</span>
          <SkipForward className="h-4 w-4" />
        </button>
      </div>

      {/* How much is left, for whoever is waiting to start speaking. Scaled
          from the left rather than resized, so it never triggers layout. The
          transition is 0ms so the clip's per-frame writes land instantly. */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
        <div
          ref={progressRef}
          className="h-full origin-left bg-sky-400/80"
          style={{
            transform: 'scaleX(0)',
            transitionProperty: 'transform',
            transitionTimingFunction: 'linear',
            transitionDuration: '0ms',
          }}
        />
      </div>
    </div>
  );
};
