// A deterministic, accessible marker colour per item id, so an item keeps the same marker across
// sessions and the leaderboard dot always matches its chart point.
//
// The lightness is per hue rather than a flat 46%, and the reason is measured: at a fixed 46%, 152
// of the 360 hues this function can produce fell below the 3:1 WCAG floor for graphical objects
// against a white chart, the worst at 1.98:1 on hue 60. Yellow at 46% lightness is simply not
// visible on white, and a chart point nobody can see is not a chart point.
//
// Dropping the whole wheel to the 36% that yellow needs would have satisfied the floor by flattening
// the palette -- the blues are already at 9.4:1 -- and how far apart two adjacent items look is the
// other half of what makes the chart readable. So each hue is darkened only as far as it has to be:
// the range across the wheel is 36% to 46%, and the worst contrast is 3.05:1.
//
// Memoised because the search runs a handful of iterations and every render asks for every item's
// colour; the answer for a hue never changes.
import { accessibleLightness } from './contrast.js';

export const MARKER_SATURATION = 62;
export const MARKER_BACKGROUND = '#ffffff';
// A margin over the 3:1 floor, so a hue that lands exactly on it cannot be pushed under by rounding
// to whole-percent lightness.
export const MARKER_TARGET_CONTRAST = 3.05;
const markerLightness = new Map();

export function markerHue(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function markerColour(id = '') {
  const hue = markerHue(id);
  if (!markerLightness.has(hue)) {
    markerLightness.set(
      hue,
      accessibleLightness(hue, MARKER_SATURATION, MARKER_BACKGROUND, MARKER_TARGET_CONTRAST),
    );
  }
  return `hsl(${hue} ${MARKER_SATURATION}% ${markerLightness.get(hue)}%)`;
}
