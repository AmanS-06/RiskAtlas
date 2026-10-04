import { describe, expect, it, vi } from 'vitest';
import {
  Emitter, FrameMeter, SelectionModel, UNCERTAINTY, VESSEL_IDS, applyUncertainty, clamp01, computePixelRatio, describeSummary, describeVessel,
  desaturationAmount, easeInOutCubic, fitDistance, glowHalo, glowSize, glowTint, isSoftwareRenderer, isVesselId, keyAction, luminance, missingVesselNodes,
  overallGlow, parseHex, planLoadSteps, BODY_NEUTRAL, NEUTRAL_TINT_SHARE, UNSCORED_VESSEL, VESSEL_LOOK, bodyColor, chooseLabelSpot, deltaE, labelPlacement, separateChips, labelText, rgbToLab, simulateVision, pointTriangleDistance, pulseActive, pulseExtra, renderBudget, runLoadChain, toHex, tweenProgress, withTimeout, EMISSIVE, PULSE,
} from './viewerLogic';
import type { VesselState } from './types';

const vs = (probability: number, color = '#D64545', band: VesselState['band'] = 'high', uncertaintyWidth?: number): VesselState => ({ probability, band, color, uncertaintyWidth });

describe('colour', () => {
  it('parses #rgb and #rrggbb, rejects the rest', () => {
    expect(parseHex('#fff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(toHex(parseHex('#D64545')!)).toBe('#d64545');
    expect(parseHex('D64545')).not.toBeNull();
    for (const bad of ['', '#12', '#12345', '#gggggg', 'red', 'rgb(1,2,3)', '#1234567']) expect(parseHex(bad)).toBeNull();
  });
  it('toHex clamps', () => {
    expect(toHex({ r: 2, g: -1, b: 0.5 })).toBe('#ff0080');
  });
});

describe('uncertainty desaturation', () => {
  it('is zero when width is missing, invalid or at most CRISP', () => {
    for (const w of [undefined, NaN, Infinity, -1, 0, UNCERTAINTY.CRISP]) expect(desaturationAmount(w as number | undefined)).toBe(0);
  });
  it('reaches MAX at FULL and beyond, never exceeds it, and is monotonic', () => {
    expect(desaturationAmount(UNCERTAINTY.FULL)).toBeCloseTo(UNCERTAINTY.MAX, 12);
    expect(desaturationAmount(1)).toBeCloseTo(UNCERTAINTY.MAX, 12);
    let prev = -1;
    for (let w = 0; w <= 1; w += 0.01) { const a = desaturationAmount(w); expect(a).toBeGreaterThanOrEqual(prev); expect(a).toBeLessThanOrEqual(UNCERTAINTY.MAX + 1e-12); prev = a; }
  });
  it('returns the colour unchanged for crisp predictions', () => {
    expect(applyUncertainty('#D64545', undefined)).toBe('#d64545');
    expect(applyUncertainty('#D64545', 0.02)).toBe('#d64545');
  });
  it('keeps luminance and reduces chroma as width grows', () => {
    const base = parseHex('#D64545')!;
    const chroma = (h: string) => { const c = parseHex(h)!; return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); };
    let prevChroma = chroma('#D64545');
    for (const w of [0.1, 0.2, 0.3, 0.5]) {
      const out = applyUncertainty('#D64545', w);
      expect(Math.abs(luminance(parseHex(out)!) - luminance(base))).toBeLessThan(0.004); // rounding to 8 bit only
      expect(chroma(out)).toBeLessThan(prevChroma);
      prevChroma = chroma(out);
    }
  });
  it('maximum desaturation keeps a trace of hue (distinguishable bands)', () => {
    const out = parseHex(applyUncertainty('#2E9E6A', 1))!;
    expect(out.g).toBeGreaterThan(out.r);
  });
  it('leaves greys alone and passes invalid input through', () => {
    expect(applyUncertainty('#808080', 0.5)).toBe('#808080');
    expect(applyUncertainty('nope', 0.5)).toBe('nope');
  });
});

describe('overallGlow', () => {
  const vessels = { LAD: vs(0.6, '#aa0000'), LCX: vs(0.3, '#00aa00'), RCA: vs(0.1, '#0000aa') };
  it('is null without an overall state', () => {
    expect(overallGlow(null, vessels)).toBeNull();
  });
  it('uses the overall state when it is the strongest (the normal case, P(CAD) >= P(vessel), band >= band)', () => {
    expect(overallGlow({ probability: 0.9, band: 'high', color: '#ff0000' }, vessels)).toEqual({ color: '#ff0000', probability: 0.9, source: 'overall' });
  });
  it('is never weaker than the strongest vessel: a higher-band vessel takes over the colour, ties go to overall', () => {
    expect(overallGlow({ probability: 0.2, band: 'low', color: '#00ff00' }, vessels)).toEqual({ color: '#aa0000', probability: 0.6, source: 'LAD' });
    expect(overallGlow({ probability: 0.6, band: 'high', color: '#ffaa00' }, vessels)!.source).toBe('overall');
  });
  it('compares bands, not only probabilities: per-target cut points let a vessel be in a higher band than CAD at a lower probability', () => {
    const v = { LCX: vs(0.3, '#e0a030', 'moderate') };
    const g = overallGlow({ probability: 0.35, band: 'low', color: '#2e9e6a' }, v)!;
    expect(g.source).toBe('LCX');
    expect(g.color).toBe('#e0a030');
    expect(g.probability).toBe(0.35); // intensity: the highest probability of all
  });
  it('same band: the higher probability wins the colour; intensity is the maximum', () => {
    const g = overallGlow({ probability: 0.5, band: 'moderate', color: '#e0a030' }, { RCA: vs(0.7, '#e8b040', 'moderate') })!;
    expect(g).toEqual({ color: '#e8b040', probability: 0.7, source: 'RCA' });
  });
  it('halo, size and tint rise with probability and clamp', () => {
    for (const f of [glowHalo, glowSize, glowTint]) { expect(f(1)).toBeGreaterThan(f(0)); expect(f(5)).toBe(f(1)); expect(f(-1)).toBe(f(0)); expect(f(NaN)).toBe(f(0)); }
  });
  it('clamp01', () => {
    expect([clamp01(-1), clamp01(0.4), clamp01(2), clamp01(NaN)]).toEqual([0, 0.4, 1, 0]);
  });
});

describe('selection state machine', () => {
  it('starts empty, reports changes only', () => {
    const s = new SelectionModel();
    expect(s.selected).toBeNull();
    expect(s.select(null)).toBe(false);
    expect(s.select('LAD')).toBe(true);
    expect(s.select('LAD')).toBe(false);
    expect(s.select('RCA')).toBe(true);
    expect(s.selected).toBe('RCA');
    expect(s.select(null)).toBe(true);
    expect(s.selected).toBeNull();
  });
  it('rejects unknown ids without changing state', () => {
    const s = new SelectionModel();
    s.select('LCX');
    expect(s.select('CAD' as never)).toBe(false);
    expect(s.select('lad' as never)).toBe(false);
    expect(s.selected).toBe('LCX');
  });
  it('knows the vessel ids', () => {
    expect(VESSEL_IDS).toEqual(['LAD', 'LCX', 'RCA']);
    expect(isVesselId('LAD')).toBe(true);
    expect(isVesselId('CAD')).toBe(false);
    expect(isVesselId(undefined)).toBe(false);
  });
});

describe('Emitter', () => {
  it('delivers, unsubscribes (idempotently) and counts', () => {
    const e = new Emitter<number>();
    const a = vi.fn(), b = vi.fn();
    const offA = e.on(a); e.on(b);
    expect(e.size).toBe(2);
    e.emit(1);
    offA(); offA();
    e.emit(2);
    expect(a.mock.calls).toEqual([[1]]);
    expect(b.mock.calls).toEqual([[1], [2]]);
    expect(e.size).toBe(1);
    e.clear();
    expect(e.size).toBe(0);
  });
  it('a throwing listener does not stop the others', () => {
    const e = new Emitter<number>();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    e.on(() => { throw new Error('boom'); });
    e.on(ok);
    e.emit(7);
    expect(ok).toHaveBeenCalledWith(7);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('keyboard map', () => {
  it('1/2/3 select, in VESSEL_IDS order; other digits do nothing', () => {
    expect(keyAction({ key: '1' })).toEqual({ type: 'select', id: 'LAD' });
    expect(keyAction({ key: '2' })).toEqual({ type: 'select', id: 'LCX' });
    expect(keyAction({ key: '3' })).toEqual({ type: 'select', id: 'RCA' });
    expect(keyAction({ key: '4' })).toBeNull();
    expect(keyAction({ key: '9' })).toBeNull();
  });
  it('escape, reset, zoom, arrows', () => {
    expect(keyAction({ key: 'Escape' })).toEqual({ type: 'clear' });
    expect(keyAction({ key: '0' })).toEqual({ type: 'reset' });
    const zi = keyAction({ key: '+' }), zo = keyAction({ key: '-' });
    expect(zi).toMatchObject({ type: 'zoom' });
    expect((zi as { factor: number }).factor).toBeLessThan(1);
    expect((zo as { factor: number }).factor).toBeGreaterThan(1);
    expect(keyAction({ key: '=' })).toEqual(zi);
    const l = keyAction({ key: 'ArrowLeft' }) as { dAzimuth: number }, r = keyAction({ key: 'ArrowRight' }) as { dAzimuth: number };
    expect(l.dAzimuth).toBeLessThan(0); expect(r.dAzimuth).toBeGreaterThan(0);
    expect(keyAction({ key: 'ArrowUp' })).toMatchObject({ type: 'rotate', dAzimuth: 0 });
    expect(keyAction({ key: 'a' })).toBeNull();
  });
  it('leaves browser shortcuts alone', () => {
    for (const m of ['ctrlKey', 'altKey', 'metaKey']) expect(keyAction({ key: '1', [m]: true })).toBeNull();
    expect(keyAction({ key: '+', shiftKey: true } as never)).not.toBeNull(); // "+" is Shift+= on many layouts
  });
});

describe('model fallback logic', () => {
  it('plans standard, lite, procedural; lite first when lowPower', () => {
    const o = { modelUrl: '/m.glb', liteModelUrl: '/l.glb' };
    expect(planLoadSteps({ ...o, lowPower: false }).map((s) => s.level)).toEqual(['none', 'lite', 'procedural']);
    expect(planLoadSteps({ ...o, lowPower: true }).map((s) => s.level)).toEqual(['lite', 'none', 'procedural']);
    expect(planLoadSteps({ modelUrl: '/m.glb', lowPower: true }).map((s) => s.level)).toEqual(['none', 'procedural']);
    expect(planLoadSteps({ ...o, lowPower: false }).map((s) => s.url)).toEqual(['/m.glb', '/l.glb', undefined]);
  });
  it('first loader that resolves wins and later ones are not called', async () => {
    const calls: string[] = [];
    const steps = planLoadSteps({ modelUrl: '/m', liteModelUrl: '/l', lowPower: false });
    const r = await runLoadChain(steps, async (s) => { calls.push(s.level); return s.level; });
    expect(r).toEqual({ ok: true, level: 'none', value: 'none' });
    expect(calls).toEqual(['none']);
  });
  it('falls through standard -> lite -> procedural and reports each failure', async () => {
    const steps = planLoadSteps({ modelUrl: '/m', liteModelUrl: '/l', lowPower: false });
    const failed: string[] = [];
    const r = await runLoadChain(steps, async (s) => { if (s.url) throw new Error('404 ' + s.url); return 'proc'; }, (s) => failed.push(s.url ?? 'procedural'));
    expect(r).toEqual({ ok: true, level: 'procedural', value: 'proc' });
    expect(failed).toEqual(['/m', '/l']);
  });
  it('lite is used when only the standard model fails', async () => {
    const steps = planLoadSteps({ modelUrl: '/m', liteModelUrl: '/l', lowPower: false });
    const r = await runLoadChain(steps, async (s) => { if (s.url === '/m') throw new Error('x'); return s.level; });
    expect(r).toMatchObject({ ok: true, level: 'lite' });
  });
  it('never rejects: ok=false with all errors when everything fails', async () => {
    const steps = planLoadSteps({ modelUrl: '/m', liteModelUrl: '/l', lowPower: false });
    const r = await runLoadChain(steps, async () => { throw new Error('nope'); });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors).toHaveLength(3);
  });
  it('withTimeout rejects a hanging promise and passes results through', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'x.glb')).rejects.toThrow('x.glb timed out after 20 ms');
    await expect(withTimeout(Promise.resolve(5), 20, 'x')).resolves.toBe(5);
    await expect(withTimeout(Promise.reject(new Error('bad')), 20, 'x')).rejects.toThrow('bad');
  });
  it('reports vessel nodes missing from a model', () => {
    expect(missingVesselNodes(['LAD', 'LCX', 'RCA', 'left_ventricle'])).toEqual([]);
    expect(missingVesselNodes(['LAD', 'right_coronary_artery'])).toEqual(['LCX', 'RCA']);
    expect(missingVesselNodes([])).toEqual(['LAD', 'LCX', 'RCA']);
  });
});

describe('rendering budget', () => {
  it('detects software renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)')).toBe(false);
    expect(isSoftwareRenderer('Apple M2')).toBe(false);
    expect(isSoftwareRenderer('unknown')).toBe(false);
  });
  it('caps pixel ratio by device ratio, option cap and pixel budget', () => {
    const hi = renderBudget(false), lo = renderBudget(true);
    expect(lo.maxPixelRatio).toBe(1);
    expect(computePixelRatio(800, 600, 3, hi)).toBe(1.5);
    expect(computePixelRatio(800, 600, 1, hi)).toBe(1);
    expect(computePixelRatio(800, 600, 2, lo)).toBeLessThanOrEqual(1);
    const huge = computePixelRatio(3840, 2160, 1, hi);
    expect(huge).toBeLessThan(1);
    expect(3840 * 2160 * huge * huge).toBeLessThanOrEqual(hi.maxPixels * 1.0001);
    expect(computePixelRatio(1920, 1080, 1, lo) ** 2 * 1920 * 1080).toBeLessThanOrEqual(lo.maxPixels * 1.0001);
    expect(computePixelRatio(0, 0, NaN, hi)).toBeGreaterThan(0);
  });
  it('fitDistance fits the sphere in the narrower dimension', () => {
    const wide = fitDistance(1, 35, 2), tall = fitDistance(1, 35, 0.5);
    expect(tall).toBeGreaterThan(wide);
    expect(fitDistance(1, 35, 1)).toBeCloseTo(1 / Math.sin((35 * Math.PI) / 360), 9);
    expect(fitDistance(2, 35, 1)).toBeCloseTo(2 * fitDistance(1, 35, 1), 9);
  });
});

describe('FrameMeter', () => {
  it('is undefined until enough continuous frames, then reports the median fps', () => {
    const m = new FrameMeter();
    let t = 1000;
    expect(m.fps(t)).toBeUndefined();
    for (let i = 0; i < 4; i++) { m.tick(t); t += 20; }
    expect(m.fps(t)).toBeUndefined();
    for (let i = 0; i < 10; i++) { m.tick(t); t += 20; }
    expect(m.fps(t)).toBeCloseTo(50, 5);
  });
  it('ignores idle gaps and goes stale', () => {
    const m = new FrameMeter();
    let t = 1000;
    for (let i = 0; i < 10; i++) { m.tick(t); t += 16; }
    m.tick(t + 5000); // idle for 5 s, then one frame: not a 0.2 fps sample
    expect(m.fps(t + 5000)).toBeUndefined();
    for (let i = 1; i <= 8; i++) m.tick(t + 5000 + i * 25);
    expect(m.fps(t + 5000 + 200)).toBeCloseTo(40, 5);
    expect(m.fps(t + 5000 + 200 + 1500)).toBeUndefined();
  });
  it('median resists one slow frame', () => {
    const m = new FrameMeter();
    let t = 0;
    for (let i = 0; i < 9; i++) { m.tick(t); t += 20; }
    t += 200; m.tick(t);
    expect(m.fps(t)).toBeCloseTo(50, 5);
  });
});

describe('animation helpers', () => {
  it('tween progress is eased 0..1 and jumps when motion is reduced', () => {
    expect(tweenProgress(0, 500, false)).toBe(0);
    expect(tweenProgress(250, 500, false)).toBeCloseTo(0.5, 9);
    expect(tweenProgress(900, 500, false)).toBe(1);
    expect(tweenProgress(0, 500, true)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
  });
  it('pulse runs for a fixed number of cycles then stops; none when reduced', () => {
    const total = PULSE.cycles * PULSE.periodMs;
    expect(pulseExtra(0, false)).toBeCloseTo(0, 9);
    expect(pulseExtra(PULSE.periodMs / 2, false)).toBeCloseTo(EMISSIVE.pulseExtra, 9);
    expect(pulseExtra(total, false)).toBe(0);
    expect(pulseExtra(PULSE.periodMs / 2, true)).toBe(0);
    expect(pulseActive(total - 1, false)).toBe(true);
    expect(pulseActive(total, false)).toBe(false);
    expect(pulseActive(10, true)).toBe(false);
  });
});

describe('text for assistive tech', () => {
  it('describes a selected vessel with band and rounded percent', () => {
    expect(describeVessel('LAD', vs(0.7621, '#d64545', 'high'))).toBe('LAD selected. high risk, probability 76 percent.');
    expect(describeVessel('RCA', undefined)).toContain('No prediction yet');
  });
  it('summarises only vessels that have a state, in id order', () => {
    expect(describeSummary({})).toBe('No prediction yet.');
    expect(describeSummary({ RCA: vs(0.1, '#2e9e6a', 'low'), LAD: vs(0.5, '#e0a030', 'moderate') })).toBe('LAD: moderate risk (50%); RCA: low risk (10%)');
  });
});

describe('pointTriangleDistance (near-miss picking)', () => {
  const T = [0, 0, 10, 0, 0, 10] as const; // right triangle, legs along +x and +y
  it('is 0 inside and on the boundary', () => {
    expect(pointTriangleDistance(2, 2, ...T)).toBe(0);
    expect(pointTriangleDistance(5, 0, ...T)).toBe(0);
    expect(pointTriangleDistance(0, 0, ...T)).toBe(0);
  });
  it('is the distance to the nearest edge outside', () => {
    expect(pointTriangleDistance(5, -3, ...T)).toBeCloseTo(3, 12);
    expect(pointTriangleDistance(-4, 5, ...T)).toBeCloseTo(4, 12);
    expect(pointTriangleDistance(10, 10, ...T)).toBeCloseTo(Math.hypot(5, 5) * 1, 12); // hypotenuse x+y=10: distance from (10,10) is 10/sqrt2
  });
  it('is the distance to the nearest corner beyond a vertex', () => {
    expect(pointTriangleDistance(-3, -4, ...T)).toBeCloseTo(5, 12);
  });
  it('works for either winding and for a degenerate (collinear) triangle', () => {
    expect(pointTriangleDistance(2, 2, 0, 0, 0, 10, 10, 0)).toBe(0);
    expect(pointTriangleDistance(5, 3, 0, 0, 10, 0, 20, 0)).toBeCloseTo(3, 12);
  });
});

describe('perceptual colour (CIE L*a*b*, CIE76)', () => {
  it('maps white, black and mid grey to the textbook values', () => {
    const [lw, aw, bw] = rgbToLab('#ffffff');
    expect(lw).toBeCloseTo(100, 1); expect(aw).toBeCloseTo(0, 1); expect(bw).toBeCloseTo(0, 1);
    expect(rgbToLab('#000000')[0]).toBeCloseTo(0, 5);
    expect(rgbToLab('#808080')[0]).toBeCloseTo(53.59, 1);
    expect(rgbToLab([255, 0, 0]).map((v) => Math.round(v))).toEqual([53, 80, 67]); // sRGB red under D65
  });
  it('deltaE is a symmetric distance, zero for identical colours', () => {
    const a = rgbToLab('#2E9E6A'), b = rgbToLab('#D64545');
    expect(deltaE(a, a)).toBe(0);
    expect(deltaE(a, b)).toBeCloseTo(deltaE(b, a), 12);
    expect(deltaE(rgbToLab('#000'), rgbToLab('#fff'))).toBeCloseTo(100, 1);
  });
  it('colour-vision simulation: normal is the identity, greys stay grey, red and green collapse for deuteranopia', () => {
    expect(simulateVision([10, 120, 250], 'normal')).toEqual([10, 120, 250]);
    for (const k of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const g = simulateVision([128, 128, 128], k);
      for (const c of g) expect(Math.abs(c - 128)).toBeLessThan(2);
    }
    const red = rgbToLab(simulateVision([0xd6, 0x45, 0x45], 'deuteranopia')), green = rgbToLab(simulateVision([0x2e, 0x9e, 0x6a], 'deuteranopia'));
    expect(deltaE(red, green)).toBeLessThan(deltaE(rgbToLab('#D64545'), rgbToLab('#2E9E6A'))); // same direction as web/scripts/cvd_check.mjs
  });
});

describe('neutral body colours', () => {
  const chroma = (hex: string) => { const [, a, b] = rgbToLab(hex); return Math.hypot(a, b); };
  it('are muted (chroma below 12), and an unscored artery is much lighter than the body and hueless, so it reads without a risk colour', () => {
    for (const c of Object.values(BODY_NEUTRAL)) expect(chroma(c)).toBeLessThan(12);
    expect(rgbToLab(UNSCORED_VESSEL.neutral)[0] - rgbToLab(BODY_NEUTRAL.chamber)[0]).toBeGreaterThan(25);
    expect(chroma(UNSCORED_VESSEL.neutral)).toBeLessThan(6);
  });
  it('every band colour of config/risk_bands.yaml and of the colour-blind-safe palette is far more saturated than the body', () => {
    for (const c of ['#2E9E6A', '#E0A030', '#D64545', '#e89a2e', '#8e0f35']) expect(chroma(c)).toBeGreaterThan(chroma(BODY_NEUTRAL.chamber) + 25);
  });
  it('bodyColor: natural keeps the GLB colour (null); neutral picks chamber / stem / other by mesh name', () => {
    expect(bodyColor('natural', 'left_ventricle')).toBeNull();
    expect(bodyColor('neutral', 'left_ventricle')).toBe(BODY_NEUTRAL.chamber);
    expect(bodyColor('neutral', 'right_atrium')).toBe(BODY_NEUTRAL.chamber);
    expect(bodyColor('neutral', 'left_coronary_artery')).toBe(BODY_NEUTRAL.stem);
    expect(bodyColor('neutral', 'ascending_aorta')).toBe(BODY_NEUTRAL.other);
  });
  it('constants stay inside sane ranges (a typo here would silently wreck the look)', () => {
    expect(VESSEL_LOOK.inflate).toBeGreaterThan(0); expect(VESSEL_LOOK.inflate).toBeLessThan(0.02);
    expect(VESSEL_LOOK.lift).toBeLessThan(0.05);
    expect(VESSEL_LOOK.ghost).toBeGreaterThan(0.1); expect(VESSEL_LOOK.ghost).toBeLessThan(0.6);
    expect(NEUTRAL_TINT_SHARE).toBeGreaterThan(0); expect(NEUTRAL_TINT_SHARE).toBeLessThanOrEqual(1);
  });
});

describe('labels', () => {
  it('labelText: off = none, name = id, risk = id and rounded percent when a state exists', () => {
    expect(labelText('LAD', vs(0.764), 'off')).toBeNull();
    expect(labelText('LAD', vs(0.764), 'name')).toBe('LAD');
    expect(labelText('LAD', vs(0.764), 'risk')).toBe('LAD 76%');
    expect(labelText('LCX', undefined, 'risk')).toBe('LCX');
    expect(labelText('RCA', vs(2), 'risk')).toBe('RCA 100%'); // out-of-range probabilities are clamped, like everywhere else
  });
  const box = { w: 800, h: 500 }, chip = { w: 70, h: 20 };
  it('labelPlacement pushes the chip away from the heart centre, so it does not sit on its own vessel', () => {
    const right = labelPlacement({ x: 500, y: 250 }, { x: 400, y: 250 }, chip, box);
    expect(right.x).toBeGreaterThan(500 + chip.w / 2 - 1); expect(right.y).toBeCloseTo(250, 5);
    const above = labelPlacement({ x: 400, y: 100 }, { x: 400, y: 250 }, chip, box);
    expect(above.y).toBeLessThan(100 - chip.h / 2 + 1);
    expect(right.length).toBeGreaterThan(chip.w / 2);
  });
  it('labelPlacement keeps the whole chip inside the container', () => {
    for (const a of [{ x: 5, y: 5 }, { x: 795, y: 495 }, { x: 790, y: 10 }, { x: 400, y: 250 }]) {
      const p = labelPlacement(a, { x: 400, y: 250 }, chip, box);
      expect(p.x - chip.w / 2).toBeGreaterThanOrEqual(0); expect(p.x + chip.w / 2).toBeLessThanOrEqual(box.w);
      expect(p.y - chip.h / 2).toBeGreaterThanOrEqual(0); expect(p.y + chip.h / 2).toBeLessThanOrEqual(box.h);
      expect(Number.isFinite(p.angle) && Number.isFinite(p.length)).toBe(true);
    }
  });
  it('labelPlacement survives an anchor exactly at the centre and a container smaller than the chip', () => {
    expect(Number.isFinite(labelPlacement({ x: 100, y: 100 }, { x: 100, y: 100 }, chip, box).x)).toBe(true);
    expect(Number.isFinite(labelPlacement({ x: 10, y: 10 }, { x: 0, y: 0 }, chip, { w: 40, h: 10 }).y)).toBe(true);
  });
});

describe('separateChips', () => {
  const box = { w: 600, h: 300 };
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, w = 70, h = 20) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
  it('leaves chips that do not overlap exactly where they are', () => {
    const chips = [{ x: 100, y: 50, w: 70, h: 20 }, { x: 300, y: 50, w: 70, h: 20 }, { x: 100, y: 150, w: 70, h: 20 }];
    expect(separateChips(chips, box)).toEqual([{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 100, y: 150 }]);
  });
  it('pushes overlapping chips apart vertically, keeps their order, and does not move them sideways', () => {
    const chips = [{ x: 200, y: 100, w: 70, h: 20 }, { x: 210, y: 104, w: 70, h: 20 }, { x: 190, y: 98, w: 70, h: 20 }];
    const out = separateChips(chips, box);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j])).toBe(false);
    out.forEach((o, i) => expect(o.x).toBe(chips[i].x));
  });
  it('keeps chips inside the container even when pushed against an edge, and handles identical positions', () => {
    const chips = [{ x: 100, y: 12, w: 70, h: 20 }, { x: 100, y: 12, w: 70, h: 20 }];
    const out = separateChips(chips, box);
    for (const o of out) { expect(o.y - 10).toBeGreaterThanOrEqual(0); expect(o.y + 10).toBeLessThanOrEqual(box.h); }
    expect(overlap(out[0], out[1])).toBe(false);
  });
  it('does not mutate its input and returns an empty list for no chips', () => {
    const chips = [{ x: 1, y: 1, w: 10, h: 10 }, { x: 2, y: 2, w: 10, h: 10 }];
    const copy = JSON.stringify(chips);
    separateChips(chips, box);
    expect(JSON.stringify(chips)).toBe(copy);
    expect(separateChips([], box)).toEqual([]);
  });
});

describe('chooseLabelSpot', () => {
  const box = { w: 600, h: 300 }, chip = { w: 70, h: 20 };
  it('goes away from the heart centre when nothing is in the way', () => {
    const p = chooseLabelSpot({ x: 300, y: 150 }, { x: 200, y: 150 }, chip, box, []);
    expect(p.x).toBeGreaterThan(300 + chip.w / 2 - 1);
    expect(Math.abs(p.y - 150)).toBeLessThan(1);
  });
  it('avoids covering vessel points: a vessel running outward pushes the chip to another side', () => {
    const vessel = Array.from({ length: 60 }, (_, i) => ({ x: 300 + i * 2, y: 150 }));
    const p = chooseLabelSpot({ x: 300, y: 150 }, { x: 200, y: 150 }, chip, box, vessel);
    const covers = vessel.some((o) => Math.abs(o.x - p.x) < chip.w / 2 + 3 && Math.abs(o.y - p.y) < chip.h / 2 + 3);
    expect(covers).toBe(false);
  });
  it('does not land on a chip that is already placed, and stays inside the box', () => {
    const taken = [{ x: 345, y: 150, w: 70, h: 20 }];
    const p = chooseLabelSpot({ x: 300, y: 150 }, { x: 200, y: 150 }, chip, box, [], taken);
    expect(Math.abs(p.x - 345) < 72 && Math.abs(p.y - 150) < 22).toBe(false);
    const edge = chooseLabelSpot({ x: 598, y: 298 }, { x: 300, y: 150 }, chip, box, []);
    expect(edge.x + chip.w / 2).toBeLessThanOrEqual(box.w); expect(edge.y + chip.h / 2).toBeLessThanOrEqual(box.h);
    expect(Number.isFinite(edge.angle + edge.length)).toBe(true);
  });
});
