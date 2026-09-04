/**
 * siteLinkService.ts
 * The arc that links the five site pins, and the gradient that draws it on.
 *
 * Geometry and paint expressions only - Solar3DViewer owns the source, the
 * layers and the animation frame. Keeping the maths here is what makes the
 * reveal testable without a WebGL context.
 *
 * ---------------------------------------------------------------------------
 * WHY A GRADIENT AND NOT A GROWING GEOMETRY
 *
 * The obvious way to draw a line on is to push one more coordinate into the
 * GeoJSON each frame and call `setData`. That re-parses the feature, re-tiles
 * the source and re-uploads the buffer 60 times a second, on the machine that
 * is already orbiting a 3D map under five live telemetry cards.
 *
 * `line-gradient` moves that work to where it belongs: the geometry is
 * uploaded once, complete, and each frame only swaps a small gradient ramp
 * that hides everything past the drawing tip. `line-progress` is a normalised
 * distance along the feature, which is also why the source needs
 * `lineMetrics: true` - without it the gradient silently does nothing.
 * ---------------------------------------------------------------------------
 */

import type { Feature, LineString } from 'geojson';
import type { ExpressionSpecification } from 'maplibre-gl';
import { SITE_LINK_SPEC } from '../config/mapConfig';

export interface SiteLinkPoint {
  lng: number;
  lat: number;
}

/**
 * Quadratic bezier arc between two pins, sampled into a polyline.
 *
 * The control point sits off the midpoint, perpendicular to the segment, by
 * `curvature` of the segment's length. Working in raw degrees rather than
 * projected metres is a deliberate simplification: at 6-10°N a degree of
 * longitude is 99% of a degree of latitude, so the arcs are symmetrical to
 * well within a line width.
 *
 * Only the first segment passes `includeStart`. Every later one begins at
 * index 1, because the previous segment already emitted that pin as its own
 * endpoint - and a duplicated vertex puts a zero-length step into
 * `line-progress`, which is a stall in the reveal at every pin.
 */
function arcBetween(a: SiteLinkPoint, b: SiteLinkPoint, includeStart: boolean): Array<[number, number]> {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy);

  // Two pins on top of each other have no perpendicular to speak of.
  const bulge = length === 0 ? 0 : SITE_LINK_SPEC.curvature * length;
  const control: SiteLinkPoint =
    length === 0
      ? { lng: a.lng, lat: a.lat }
      : {
          // (-dy, dx) normalised: the same side of travel for every segment,
          // so the chain sweeps consistently instead of zig-zagging.
          lng: (a.lng + b.lng) / 2 + (-dy / length) * bulge,
          lat: (a.lat + b.lat) / 2 + (dx / length) * bulge,
        };

  const steps = SITE_LINK_SPEC.stepsPerSegment;
  const out: Array<[number, number]> = [];

  for (let i = includeStart ? 0 : 1; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;
    out.push([
      inv * inv * a.lng + 2 * inv * t * control.lng + t * t * b.lng,
      inv * inv * a.lat + 2 * inv * t * control.lat + t * t * b.lat,
    ]);
  }

  return out;
}

/**
 * One LineString through every pin, or null when there is nothing to link.
 *
 * Fewer than two pins is a supported state, not a broken one: a board with a
 * single site has no link to draw, and the caller is expected to leave the
 * layers empty rather than invent a segment.
 */
export function buildSiteLinkFeature(points: SiteLinkPoint[]): Feature<LineString> | null {
  const usable = points.filter(
    (p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)
  );
  if (usable.length < 2) return null;

  const coordinates: Array<[number, number]> = [];
  for (let i = 0; i < usable.length - 1; i++) {
    coordinates.push(...arcBetween(usable[i], usable[i + 1], i === 0));
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

/**
 * Assemble an `interpolate` ramp over `line-progress`.
 *
 * MapLibre rejects a gradient whose stops are not strictly increasing, and
 * several of the offsets below collide at the ends of the animation (a tail at
 * progress 0, a head at progress 1). Rather than special-case each of those,
 * anything that does not advance past the previous stop is dropped - a
 * gradient one stop poorer, never an invalid one that throws mid-reveal.
 */
function toGradient(stops: Array<[number, string]>): ExpressionSpecification {
  const expression: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  let last = -1;

  for (const [rawOffset, color] of stops) {
    const offset = Math.min(1, Math.max(0, rawOffset));
    if (offset <= last) continue;
    expression.push(offset, color);
    last = offset;
  }

  // An interpolate with a single stop is not a valid ramp either.
  if (expression.length < 7) {
    expression.length = 3;
    expression.push(0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)');
  }

  // The one cast in this module. `ExpressionSpecification` is a union of fixed
  // tuples, which a ramp assembled at runtime cannot satisfy structurally -
  // the stop count is not known until the loop above has run. Validity is the
  // loop's job instead: strictly increasing offsets, at least two of them.
  return expression as unknown as ExpressionSpecification;
}

const TRANSPARENT = 'rgba(0,0,0,0)';
/** Length of the bright tip, as a fraction of the whole line. */
const HEAD_LENGTH = 0.07;

/**
 * Into 0..1, with non-finite input pinned to 0 rather than carried through.
 *
 * `Math.min(1, Math.max(0, NaN))` is NaN, so a plain clamp lets one bad number
 * reach the stop offsets - and a gradient with a NaN offset does not throw, it
 * just stops drawing the line. A misconfigured `flowMs` of 0 is enough to get
 * there (`now % 0` is NaN), which is far too quiet a way to lose the line.
 */
function normalise01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The line revealed up to `progress` (0..1), with a bright tip leading it.
 *
 * `bodyColor` is a parameter because the line is drawn twice - a wide soft
 * glow under a crisp stroke - and both passes have to be revealed by the same
 * progress or the glow runs ahead of its own line.
 *
 * At 1 this is a flat ramp of the body colour: the held state, with no
 * gradient work left to do on any later frame.
 */
export function siteLinkGradient(
  progress: number,
  bodyColor: string = SITE_LINK_SPEC.bodyColor
): ExpressionSpecification {
  const p = normalise01(progress);

  if (p <= 0) {
    return toGradient([
      [0, TRANSPARENT],
      [1, TRANSPARENT],
    ]);
  }

  if (p >= 1) {
    return toGradient([
      [0, bodyColor],
      [1, bodyColor],
    ]);
  }

  return toGradient([
    [0, bodyColor],
    [Math.max(0, p - HEAD_LENGTH), bodyColor],
    [p, SITE_LINK_SPEC.headColor],
    // The hard cut just past the tip is what makes this read as drawing rather
    // than as fading up: everything ahead of the pen is simply not there.
    [p + 0.004, TRANSPARENT],
    [1, TRANSPARENT],
  ]);
}

/** Ease-out: the pen leaves fast and settles onto the last pin. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

// ---------------------------------------------------------------------------
// The flow
//
// Once the line is drawn, bright pulses run along it from pin 1 to pin 5 for
// as long as the dashboard is up. Same mechanism as the reveal - a gradient
// ramp swapped per frame - because the alternative, moving a short feature
// along the line with `setData`, re-tiles the source on every frame.
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

/**
 * Parse the `rgba()` / `rgb()` strings SITE_LINK_SPEC is written in.
 *
 * Not a general CSS colour parser: it only has to read this dashboard's own
 * config. Anything it cannot read comes back fully opaque white, which is
 * wrong but visible - far easier to spot and fix than a silently invisible
 * line.
 */
function parseRgba(color: string): Rgba {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return [255, 255, 255, 1];
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts[3] === undefined ? 1 : Number(parts[3])];
}

function mixRgba(from: Rgba, to: Rgba, k: number): string {
  const at = (i: number) => from[i] + (to[i] - from[i]) * k;
  return `rgba(${Math.round(at(0))},${Math.round(at(1))},${Math.round(at(2))},${at(3).toFixed(3)})`;
}

/**
 * How bright a pulse is at position `p`, 0..1 along the line.
 *
 * Faded over the first and last stretch so a pulse grows out of pin 1 and
 * dissolves into pin 5, rather than snapping into existence at the ends -
 * which at these speeds reads as a flicker, not as movement.
 */
const FLOW_EDGE_FADE = 0.12;

function pulseEnvelope(p: number): number {
  return Math.max(0, Math.min(1, p / FLOW_EDGE_FADE, (1 - p) / FLOW_EDGE_FADE));
}

/**
 * The drawn line with `pulses` bright bumps travelling along it.
 *
 * `phase` advances 0..1 and wraps; each pulse sits at an even offset from it,
 * so the spacing stays constant and nothing has to be tracked between frames.
 *
 * The pulse colour is mixed towards `headColor` rather than laid over the line
 * at partial alpha: these stops ARE the line's colour, so a translucent pulse
 * would punch a hole in the line instead of lighting it up.
 */
export function siteLinkFlowGradient(
  phase: number,
  bodyColor: string = SITE_LINK_SPEC.bodyColor
): ExpressionSpecification {
  const t = normalise01(phase);
  const body = parseRgba(bodyColor);
  const head = parseRgba(SITE_LINK_SPEC.headColor);
  const width = SITE_LINK_SPEC.flowPulseWidth;
  const count = Math.max(1, SITE_LINK_SPEC.flowPulses);

  const stops: Array<[number, string]> = [[0, bodyColor]];

  // Ascending, so the stops below are emitted in order and survive
  // toGradient's strictly-increasing filter.
  const positions = Array.from({ length: count }, (_, i) => (((t + i / count) % 1) + 1) % 1).sort(
    (a, b) => a - b
  );

  for (const p of positions) {
    stops.push([p - width, bodyColor]);
    stops.push([p, mixRgba(body, head, pulseEnvelope(p))]);
    stops.push([p + width, bodyColor]);
  }

  stops.push([1, bodyColor]);
  return toGradient(stops);
}
