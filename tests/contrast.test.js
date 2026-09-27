import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markerColour } from '../browser/colour.js';
import {
  MIN_NON_TEXT_CONTRAST,
  MIN_TEXT_CONTRAST,
  accessibleLightness,
  contrastRatio,
  hslToRgb,
  parseColour,
  relativeLuminance,
} from '../browser/contrast.js';

describe('the contrast arithmetic is WCAG\'s, not an approximation of it', () => {
  it('reproduces the reference ratios', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
    // #767676 on white is WCAG's own worked example of a colour that just clears 4.5:1.
    assert.equal(Number(contrastRatio('#767676', '#ffffff').toFixed(2)), 4.54);
  });

  it('is symmetric, because a ratio has no foreground', () => {
    assert.equal(contrastRatio('#1d4ed8', '#eff6ff'), contrastRatio('#eff6ff', '#1d4ed8'));
  });

  it('reads the two notations this project writes, and refuses the rest', () => {
    assert.deepEqual(parseColour('#fff'), [255, 255, 255]);
    assert.deepEqual(parseColour('#7c3aed'), [124, 58, 237]);
    assert.deepEqual(parseColour('hsl(210 62% 46%)'), hslToRgb(210, 62, 46));
    assert.deepEqual(parseColour('rgb(1, 2, 3)'), [1, 2, 3]);
  });

  // A colour this cannot read must not come back as a plausible black. Black passes every contrast
  // check ever written against a light background, so an unparsed value would silently certify
  // itself -- the same shape as the absence-becoming-zero rule the rest of this project runs on.
  it('returns nothing at all for a colour it cannot read, never a default', () => {
    for (const value of ['transparent', 'var(--accent)', 'currentColor', '', null, undefined, '#12345']) {
      assert.equal(parseColour(value), null, `${value} should not parse`);
      assert.equal(relativeLuminance(value), null);
      assert.equal(contrastRatio(value, '#ffffff'), null);
    }
  });
});

// SC 1.4.11. Measured on 2026-08-24, the marker palette published `hsl(h 62% 46%)` for every hue and
// 152 of the 360 fell below 3:1 against the white chart -- the worst at 1.98:1 on hue 60, a yellow
// dot on a white background. This is the check that would have caught it.
describe('every colour a chart marker can take is visible on the chart', () => {
  it('clears the non-text floor on all 360 hues', () => {
    const failures = [];
    for (let hue = 0; hue < 360; hue += 1) {
      const colour = `hsl(${hue} 62% ${accessibleLightness(hue, 62, '#ffffff', 3.05)}%)`;
      const ratio = contrastRatio(colour, '#ffffff');
      if (ratio < MIN_NON_TEXT_CONTRAST) failures.push(`hue ${hue}: ${ratio.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, []);
  });

  // `markerColour` hashes an id, so which hues are actually in use is a fact about an instance's
  // committed catalogue, and an item added tomorrow gets whatever hue its id produces. An instance
  // sweeps its own catalogue; here every id shape the hash can meet is swept instead.
  it('clears the floor for every colour the hash produces from ordinary ids', () => {
    const failures = [];
    for (let index = 0; index < 720; index += 1) {
      const id = `item-${index}-${'x'.repeat(index % 7)}`;
      const ratio = contrastRatio(markerColour(id), '#ffffff');
      if (ratio < MIN_NON_TEXT_CONTRAST) failures.push(`${id}: ${ratio.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, []);
  });

  // The point of per-hue lightness rather than one flat value dark enough for the worst hue. If the
  // palette ever collapses onto a single lightness it still passes the floor above while telling a
  // reader far less, so the spread is asserted as its own property.
  it('keeps the palette varied rather than darkening the whole wheel to satisfy yellow', () => {
    const lightnesses = new Set();
    for (let hue = 0; hue < 360; hue += 1) lightnesses.add(accessibleLightness(hue, 62, '#ffffff', 3.05));
    assert.ok(lightnesses.size > 4, `palette collapsed onto ${lightnesses.size} lightness value(s)`);
    assert.ok(Math.max(...lightnesses) - Math.min(...lightnesses) >= 8);
  });

  it('is deterministic, so an item keeps its colour between sessions', () => {
    assert.equal(markerColour('skoda-kodiaq'), markerColour('skoda-kodiaq'));
    assert.notEqual(markerColour('skoda-kodiaq'), markerColour('mazda-cx-60'));
  });
});

