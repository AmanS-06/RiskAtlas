// Pure scroll maths of the landing page, so it can be tested without a browser.

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export const smoothStep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * How far through a tall pinned section the reader is, 0 to 1. `top` is the section's distance from the viewport top (negative once it has
 * scrolled past), `height` its full height. The stage stays pinned for `height - viewport`, and that stretch is the whole 0 to 1.
 */
export function scrollProgress(top: number, height: number, viewport: number): number {
  const span = height - viewport;
  if (!(span > 0)) return 0;
  return clamp01(-top / span);
}

export interface Chapter {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Opacity of a chapter at progress p: fades in between a and b, holds until c, fades out by d. */
export function chapterOpacity(p: number, ch: Chapter): number {
  if (p <= ch.a || p >= ch.d) return 0;
  if (p < ch.b) return smoothStep((p - ch.a) / (ch.b - ch.a));
  if (p <= ch.c) return 1;
  return smoothStep((ch.d - p) / (ch.d - ch.c));
}
