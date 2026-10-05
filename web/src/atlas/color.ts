// Colour and easing helpers of the Atlas heart. Pure.
// An uncertain estimate is drawn desaturated, never lighter or darker, so band and risk stay readable.

export interface RGB {
  r: number;
  g: number;
  b: number;
} // sRGB, 0..1

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Uncertainty width (10th to 90th percentile interval, 0..1) to desaturation amount (0..MAX):
 * crisp up to CRISP, the maximum from FULL on, smooth in between. MAX < 1 keeps some hue, so a very uncertain artery can still be told apart by band.
 */
export const UNCERTAINTY = { CRISP: 0.05, FULL: 0.35, MAX: 0.8 } as const;

export function desaturationAmount(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width)) return 0;
  const t = Math.min(1, Math.max(0, (width - UNCERTAINTY.CRISP) / (UNCERTAINTY.FULL - UNCERTAINTY.CRISP)));
  return UNCERTAINTY.MAX * t * t * (3 - 2 * t);
}

/** The colour actually drawn: the supplied colour mixed toward the grey of equal luminance, in linear light. Luminance is unchanged. */
export function applyUncertainty(hex: string, width: number | undefined): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const a = desaturationAmount(width);
  if (a === 0) return toHex(rgb);
  const lin = [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)] as const;
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const [r, g, b] = lin.map((v) => linearToSrgb(v + (y - v) * a)) as [number, number, number];
  return toHex({ r, g, b });
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** True for a CPU rasteriser (SwiftShader, llvmpipe, ...), which cannot hold the full effects. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}
