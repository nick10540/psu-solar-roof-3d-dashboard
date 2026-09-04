/**
 * IntroVideoOverlay.tsx
 * Full-screen intro played once over the dashboard on entry: the clip, then a
 * rapid montage of stills, then a fade into the live board.
 *
 * ---------------------------------------------------------------------------
 * WHY AN OVERLAY AND NOT A GATE
 *
 * The dashboard is mounted underneath from the first paint; this only covers
 * it. Gating the mount on the intro would spend ~20 seconds showing the
 * audience a video and then drop them onto a cold map: MapLibre would still be
 * creating its WebGL context, pulling tiles and waiting on the first SolarEdge
 * round. Staged this way all of that happens behind the intro, and the fade
 * lands on a dashboard already drawing real numbers.
 * ---------------------------------------------------------------------------
 * "FULL SCREEN" HERE MEANS THE VIEWPORT
 *
 * Not the Fullscreen API - `requestFullscreen()` needs a user gesture and
 * there is none on page load. The overlay fills the viewport instead, so a
 * kiosk already in fullscreen (HeaderBar's button, or F11 at the venue) shows
 * the intro edge to edge, and a windowed browser fills its window.
 *
 * `object-contain` on black throughout, never `object-cover`. The clip is
 * 960x522 (~1.84:1) and the stills are a mix of 3:2 and 16:9, so covering
 * would crop every one of them differently - and the stills are photographs
 * of named people at the installations. Letterboxing is the cheaper mistake
 * than a montage that trims someone's head at a ceremony.
 * ---------------------------------------------------------------------------
 * STAGES
 *
 *   video -> stills -> fade -> gone
 *
 * The fade needs to know which stage it is fading out - a skip during the clip
 * must not flash the first photograph on its way out - so the two fading
 * states are distinct rather than one flag.
 *
 * Every exit runs through `dismiss()`: the montage finishes, the operator
 * skips, or the clip fails and the stills that follow finish. There is no
 * state in which this can keep the dashboard covered; the worst a broken file
 * can do is shorten the intro.
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

/**
 * 'fading-video' and 'fading-stills' are the same fade; they differ only in
 * what is left on screen underneath it.
 */
type Phase = 'video' | 'stills' | 'fading-video' | 'fading-stills' | 'done';

const SESSION_KEY = 'mea:intro-video-played';

const STILLS = INTRO_VIDEO.stills;
const STILLS_TOTAL_MS = STILLS.length * INTRO_VIDEO.stillDurationMs;

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
  /** Runs one past the last still; that overrun is what ends the montage. */
  const [stillIndex, setStillIndex] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  /** The mounted still elements, for the decode warm-up below. */
  const stillElsRef = useRef<Array<HTMLImageElement | null>>([]);
  /** Guards the several independent exits from each starting their own fade. */
  const dismissedRef = useRef<boolean>(false);
  const fadeTimerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    // Stop decoding at once. On a skip during the clip this is also what cuts
    // the audio: the fade is a fade of a still frame, not of sound the
    // operator just asked to be rid of.
    videoRef.current?.pause();

    // Updater form, so the fade keeps whatever was on screen: reading `phase`
    // from this callback's closure would fade the wrong stage.
    setPhase((p) => (p === 'stills' ? 'fading-stills' : 'fading-video'));
    fadeTimerRef.current = window.setTimeout(() => setPhase('done'), INTRO_VIDEO.fadeOutMs);

    // As the fade STARTS, not when the overlay is finally gone: the dashboard
    // is visible through it, so the map's link line draws on into the last
    // photograph dissolving away rather than after a beat of dead air.
    notifyIntroFinished();
  }, []);

  /** Clip over (ended, failed, or never started): hand over to the montage. */
  const advanceToStills = useCallback(() => {
    if (dismissedRef.current) return;
    if (STILLS.length === 0) {
      dismiss();
      return;
    }
    videoRef.current?.pause();
    // Only from 'video': a late `onError` must not drag a fade back to stills.
    setPhase((p) => (p === 'video' ? 'stills' : p));
  }, [dismiss]);

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
          // happen at all. Move on to the stills rather than hold a black
          // screen for the length of the clip.
          if (!cancelled) advanceToStills();
          return;
        }
      }
      if (!cancelled) setIsMuted(el.muted);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [phase, advanceToStills]);

  // --- Still preload -------------------------------------------------------
  // Half a second of airtime leaves no room to fetch and decode a 700 KB JPEG
  // on the slide's own turn: one slow decode on the venue machine and the
  // montage shows a black gap. Mounting all seven elements from the start is
  // what gets them fetched, during the clip; this warms their decode alongside,
  // so every cut is a compositor swap of a bitmap already in memory.
  //
  // Deliberately `decode()` on the MOUNTED elements rather than on a set of
  // `new Image()` preloaders: those turned out to issue their own seven
  // requests rather than dedupe against the elements', downloading the montage
  // twice for nothing.
  useEffect(() => {
    if (phase !== 'video') return;

    stillElsRef.current.forEach((img) => {
      // Not supported everywhere, and a decode that fails here just means the
      // element decodes it the ordinary way when its turn comes.
      void img?.decode?.().catch(() => {});
    });
  }, [phase]);

  // --- Montage -------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'stills') return;

    const timer = window.setInterval(
      () => setStillIndex((i) => i + 1),
      INTRO_VIDEO.stillDurationMs
    );
    return () => window.clearInterval(timer);
  }, [phase]);

  // The index running one past the last slide is what ends the intro, so the
  // last photograph gets its full airtime instead of being cut short by the
  // fade. `visibleStill` clamps it, keeping that frame on screen while the
  // overlay fades away over it.
  useEffect(() => {
    if (phase === 'stills' && stillIndex >= STILLS.length) dismiss();
  }, [phase, stillIndex, dismiss]);

  // --- Safety net ----------------------------------------------------------
  // `onError` covers a file the browser rejects outright. This covers the rest:
  // a stalled decode, an empty response, a `play()` promise that never settles.
  useEffect(() => {
    if (phase !== 'video') return;

    const timer = window.setTimeout(() => {
      const el = videoRef.current;
      if (!el || el.paused || el.currentTime === 0) advanceToStills();
    }, INTRO_VIDEO.startTimeoutMs);

    return () => window.clearTimeout(timer);
  }, [phase, advanceToStills]);

  // --- Skip by key ---------------------------------------------------------
  // On window rather than on the overlay: nothing here holds focus, and taking
  // it would leave the dashboard underneath to claw it back on the fade.
  // Skipping leaves the whole intro, mid-clip or mid-montage.
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
   * Progress across the whole intro, written straight to the node's transform.
   *
   * `timeupdate` fires about four times a second and this is the one number on
   * screen; routing it through state would re-render the overlay - and with it
   * the <video> and all seven <img> elements - throughout the clip, on the
   * same machine that is bringing a WebGL map up behind it.
   *
   * The clip only owns its share of the bar (its wall-clock length against the
   * montage's), so the bar does not fill up and then sit at 100% for three and
   * a half seconds of photographs.
   */
  const handleTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    const bar = progressRef.current;
    if (!bar || !Number.isFinite(el.duration) || el.duration <= 0) return;

    const clipMs = (el.duration * 1000) / (INTRO_VIDEO.playbackRate || 1);
    const clipShare = clipMs / (clipMs + STILLS_TOTAL_MS);
    const played = Math.min(el.currentTime / el.duration, 1);
    bar.style.transform = `scaleX(${played * clipShare})`;
  }, []);

  // The montage's share of the bar is handed to the compositor in one go. A JS
  // timer per slide would step it in seven visible jumps, and there is nothing
  // to be gained from re-rendering seven times to draw a line.
  useEffect(() => {
    if (phase !== 'stills') return;
    const bar = progressRef.current;
    if (!bar) return;

    bar.style.transitionDuration = `${STILLS_TOTAL_MS}ms`;
    bar.style.transform = 'scaleX(1)';
  }, [phase]);

  if (phase === 'done') return null;

  const isFading = phase === 'fading-video' || phase === 'fading-stills';
  const showStills = phase === 'stills' || phase === 'fading-stills';
  const showVideo = !showStills;
  /** Held on the last frame so the fade has something to fade out. */
  const visibleStill = Math.min(stillIndex, STILLS.length - 1);

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
      {/* Unmounted once the montage starts rather than merely hidden: the
          stills letterbox, so a frozen video frame left mounted underneath
          would show through the bars on either side of them. */}
      {showVideo && (
        <video
          ref={videoRef}
          src={INTRO_VIDEO.src}
          className="h-full w-full object-contain"
          // The whole 4 MB is wanted up front: this plays once, immediately,
          // off the same origin, and a re-buffer mid-clip is in front of an
          // audience.
          preload="auto"
          playsInline
          onEnded={advanceToStills}
          onError={advanceToStills}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      {/* All seven mounted for the whole intro, cut between by opacity alone.
          Swapping one element's `src` every 500ms would put a fetch and a
          decode on the critical path of each cut; this way every slide is
          already a decoded layer and the cut is free. No transition on them -
          hard cuts, see `stillDurationMs`. */}
      {STILLS.map((src, index) => (
        <img
          key={src}
          ref={(el) => {
            stillElsRef.current[index] = el;
          }}
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`absolute inset-0 h-full w-full object-contain ${
            showStills && index === visibleStill ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}

      {/* Controls. Sized for a fingertip on the venue touch panel, and held
          well in from the corners of a 72" screen where a bezel eats them. */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 sm:p-7">
        {INTRO_VIDEO.withSound && showVideo ? (
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
          title="ข้ามวิดีโอและภาพเปิดตัว เข้าสู่แดชบอร์ด"
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-5 py-2.5 text-sm font-semibold text-slate-200 backdrop-blur-sm transition-colors hover:border-sky-300/50 hover:text-white cursor-pointer"
        >
          <span>ข้ามการเปิดตัว</span>
          <SkipForward className="h-4 w-4" />
        </button>
      </div>

      {/* How much is left, for whoever is waiting to start speaking. Scaled
          from the left rather than resized, so it never triggers layout. The
          transition is declared here at 0ms so the clip's per-frame writes land
          instantly; the montage effect only has to change the duration. */}
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
