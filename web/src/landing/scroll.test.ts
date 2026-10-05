import { describe, expect, it } from 'vitest';
import { chapterOpacity, scrollProgress, smoothStep } from './scroll';

describe('scroll progress', () => {
  it('is 0 before the stage pins, 1 when it lets go, and linear in between', () => {
    expect(scrollProgress(300, 5000, 800)).toBe(0);
    expect(scrollProgress(0, 5000, 800)).toBe(0);
    expect(scrollProgress(-2100, 5000, 800)).toBeCloseTo(0.5);
    expect(scrollProgress(-4200, 5000, 800)).toBe(1);
    expect(scrollProgress(-9000, 5000, 800)).toBe(1);
  });
  it('does not divide by zero for a section no taller than the screen', () => {
    expect(scrollProgress(-50, 800, 800)).toBe(0);
    expect(scrollProgress(-50, 400, 800)).toBe(0);
  });
});

describe('chapters', () => {
  const ch = { a: 0.2, b: 0.3, c: 0.5, d: 0.6 };
  it('fade in, hold, fade out, and are invisible outside', () => {
    expect(chapterOpacity(0.1, ch)).toBe(0);
    expect(chapterOpacity(0.25, ch)).toBeGreaterThan(0);
    expect(chapterOpacity(0.25, ch)).toBeLessThan(1);
    expect(chapterOpacity(0.4, ch)).toBe(1);
    expect(chapterOpacity(0.55, ch)).toBeGreaterThan(0);
    expect(chapterOpacity(0.55, ch)).toBeLessThan(1);
    expect(chapterOpacity(0.7, ch)).toBe(0);
  });
  it('is symmetric and smooth', () => {
    expect(chapterOpacity(0.25, ch)).toBeCloseTo(chapterOpacity(0.55, ch));
    expect(smoothStep(-1)).toBe(0);
    expect(smoothStep(2)).toBe(1);
    expect(smoothStep(0.5)).toBe(0.5);
  });
});
