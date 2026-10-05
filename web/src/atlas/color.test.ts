import { describe, expect, it } from 'vitest';
import { UNCERTAINTY, applyUncertainty, desaturationAmount, easeInOutCubic, isSoftwareRenderer, linearToSrgb, parseHex, srgbToLinear, toHex } from './color';

const lum = (hex: string) => {
  const c = parseHex(hex)!;
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
};

describe('hex', () => {
  it('round-trips and accepts short forms', () => {
    expect(toHex(parseHex('#d64545')!)).toBe('#d64545');
    expect(toHex(parseHex('f80')!)).toBe('#ff8800');
    expect(parseHex('not a colour')).toBeNull();
  });
  it('converts between sRGB and linear light', () => {
    for (const v of [0, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
});

describe('uncertainty', () => {
  it('draws narrow intervals crisp and wide ones desaturated, never fully grey', () => {
    expect(desaturationAmount(undefined)).toBe(0);
    expect(desaturationAmount(UNCERTAINTY.CRISP)).toBe(0);
    expect(desaturationAmount(UNCERTAINTY.FULL)).toBeCloseTo(UNCERTAINTY.MAX);
    expect(desaturationAmount(1)).toBeCloseTo(UNCERTAINTY.MAX);
    expect(UNCERTAINTY.MAX).toBeLessThan(1);
  });
  it('keeps the luminance of the colour', () => {
    const wide = applyUncertainty('#d64545', 0.4);
    expect(wide).not.toBe('#d64545');
    expect(lum(wide)).toBeCloseTo(lum('#d64545'), 2);
  });
  it('leaves a crisp colour and an invalid colour alone', () => {
    expect(applyUncertainty('#d64545', 0.01)).toBe('#d64545');
    expect(applyUncertainty('nope', 0.5)).toBe('nope');
  });
});

describe('helpers', () => {
  it('eases from 0 to 1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
  it('recognises CPU renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA GeForce RTX 4060)')).toBe(false);
  });
});
