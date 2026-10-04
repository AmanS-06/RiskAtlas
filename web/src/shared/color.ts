// Colour maths used by palette handling and by the tests that guard accessibility.
export type Rgb = [number, number, number];
export type Vision = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
};

export const rgbToHex = (rgb: Rgb): string =>
  '#' +
  rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

export const lerpHex = (a: string, b: string, t: number): string => {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((v, i) => v + (y[i]! - v) * t) as Rgb);
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const MATRICES: Record<Vision, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function lab(hex: string, vision: Vision): [number, number, number] {
  const lin = hexToRgb(hex).map(toLinear);
  const m = MATRICES[vision];
  const [r, g, b] = m.map((row) => Math.min(1, Math.max(0, row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!)));
  const X = 0.4124 * r! + 0.3576 * g! + 0.1805 * b!;
  const Y = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const Z = 0.0193 * r! + 0.1192 * g! + 0.9505 * b!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X / 0.95047), f(Y), f(Z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference as seen with the given vision. Around 20 or more reads as clearly different. */
export function deltaE(a: string, b: string, vision: Vision = 'normal'): number {
  const [p, q] = [lab(a, vision), lab(b, vision)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export const lightness = (hex: string, vision: Vision = 'normal'): number => lab(hex, vision)[0];

export const VISIONS: Vision[] = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
