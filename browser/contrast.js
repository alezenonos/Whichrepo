// WCAG contrast arithmetic, as pure functions, so the palette can be audited by a test rather than
// by eye. It exists because "a11y is currently manual" was true and the chart is the place a
// data-visualisation usually fails: measured on 2026-08-24, 152 of the 360 hues the marker colour
// can take fell below the 3:1 floor for graphical objects, the worst of them at 1.98:1.
//
// The formulae are WCAG 2.1's, not an approximation of them: relative luminance per the sRGB
// definition, and (L1 + 0.05) / (L2 + 0.05) for the ratio.

// SC 1.4.11 Non-text Contrast. A chart point, an axis line and a status dot are graphical objects
// required to understand the content, so 3:1 against their background.
export const MIN_NON_TEXT_CONTRAST = 3;
// SC 1.4.3 Contrast (Minimum), for body text at normal size and weight.
export const MIN_TEXT_CONTRAST = 4.5;

export function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((value) => Math.round(value * 255));
}

// Accepts the two notations this project actually writes: #rgb / #rrggbb in the stylesheet, and
// hsl(h s% l%) from `carColour`. Anything else returns null rather than a plausible black, because a
// colour silently read as #000 would pass every contrast check ever written against it.
export function parseColour(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
  }
  const hsl = /^hsl\(\s*([\d.]+)\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%\s*\)$/i.exec(text);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  const rgb = /^rgb\(\s*(\d+)\s*,?\s*(\d+)\s*,?\s*(\d+)\s*\)$/i.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

const channelLuminance = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(colour) {
  const rgb = Array.isArray(colour) ? colour : parseColour(colour);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channelLuminance);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

// The darkest the palette is allowed to go, so that a hue which cannot reach the target at any
// readable lightness fails loudly in a test rather than silently rendering near-black.
export const MIN_MARKER_LIGHTNESS = 25;

// Walks lightness down from `preferred` in whole percent until the colour clears `target` against
// `background`. Whole percent because the result is written straight into an `hsl()` string, and a
// fractional lightness would make the same car's colour depend on floating-point formatting.
//
// Per-hue rather than one lightness for the whole wheel: the floor is set by yellow, which needs
// about 36% to clear 3:1, and applying that to the blues -- already at 9.4:1 -- would darken the
// entire palette to satisfy one corner of it and flatten the differences between adjacent cars,
// which is the other half of what makes a chart readable.
export function accessibleLightness(hue, saturation, background, target, preferred = 46) {
  for (let lightness = Math.round(preferred); lightness >= MIN_MARKER_LIGHTNESS; lightness -= 1) {
    if (contrastRatio(hslToRgb(hue, saturation, lightness), background) >= target) return lightness;
  }
  return MIN_MARKER_LIGHTNESS;
}
