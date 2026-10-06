import { describe, expect, it } from 'vitest';
import {
  BPM,
  beatPeriod,
  beatPose,
  bump,
  clampBpm,
  liveRegions,
  qualityFor,
  regionOfNode,
  shouldDowngrade,
  subsample,
  territoryWeights,
  REGIONS,
  ADAPT,
  adaptStep,
  type Adapt,
  initialAdapt,
} from './logic';

describe('regions', () => {
  it('owns every node of the model exactly once', () => {
    const nodes = REGIONS.flatMap((r) => r.nodes);
    expect(new Set(nodes).size).toBe(nodes.length);
  });
  it('finds the region of a node', () => {
    expect(regionOfNode('inferior_papillary_muscle_of_left_ventricle')?.id).toBe('left_ventricle');
    expect(regionOfNode('nope')).toBeUndefined();
  });
  it('marks vessels and feature anchors as live, nothing else', () => {
    const live = liveRegions(['LAD', 'LCX', 'RCA'], ['ascending_aorta', 'left_ventricle', null, 'not_a_region']);
    expect([...live].sort()).toEqual(['LAD', 'LCX', 'RCA', 'ascending_aorta', 'left_ventricle']);
    expect(live.has('left_atrium')).toBe(false);
  });
});

describe('heartbeat', () => {
  it('falls back to a resting rate for missing or silly input and clamps the rest', () => {
    expect(clampBpm(null)).toBe(BPM.rest);
    expect(clampBpm(undefined)).toBe(BPM.rest);
    expect(clampBpm(Number.NaN)).toBe(BPM.rest);
    expect(clampBpm(-5)).toBe(BPM.rest);
    expect(clampBpm(10)).toBe(BPM.min);
    expect(clampBpm(400)).toBe(BPM.max);
    expect(clampBpm(88)).toBe(88);
  });
  it('beats once per period', () => {
    expect(beatPeriod(60)).toBeCloseTo(1);
    expect(beatPeriod(120)).toBeCloseTo(0.5);
  });
  it('bump is zero outside and one at the middle', () => {
    expect(bump(0.1, 0.2, 0.4)).toBe(0);
    expect(bump(0.5, 0.2, 0.4)).toBe(0);
    expect(bump(0.3, 0.2, 0.4)).toBeCloseTo(1);
  });
  it('contracts the atria before the ventricles, with a second small beat after', () => {
    const early = beatPose(0.07);
    const mid = beatPose(0.26);
    const late = beatPose(0.45);
    expect(early.atria).toBeGreaterThan(early.ventricle);
    expect(mid.ventricle).toBeGreaterThan(0.9);
    expect(late.dub).toBeGreaterThan(0.9);
    expect(late.ventricle).toBe(0);
  });
  it('is periodic and rests between beats', () => {
    expect(beatPose(1.26).ventricle).toBeCloseTo(beatPose(0.26).ventricle);
    expect(beatPose(-0.74).ventricle).toBeCloseTo(beatPose(0.26).ventricle);
    const rest = beatPose(0.8);
    expect(rest.atria + rest.ventricle + rest.aorta + rest.dub).toBe(0);
  });
});

describe('territories', () => {
  const arteries = [Float32Array.from([0, 0, 0]), Float32Array.from([10, 0, 0])];
  it('gives the nearest artery the larger share and normalises the weights', () => {
    const { weights, cover } = territoryWeights([1, 0, 0, 9, 0, 0, 5, 0, 0], arteries, 3);
    expect(weights[0]!).toBeGreaterThan(weights[1]!);
    expect(weights[2]!).toBeLessThan(weights[3]!);
    expect(weights[4]! + weights[5]!).toBeCloseTo(1);
    expect(weights[4]!).toBeCloseTo(weights[5]!);
    expect(cover[0]!).toBeGreaterThan(cover[2]!);
  });
  it('fades the cover far from every artery without producing NaN', () => {
    const { weights, cover } = territoryWeights([1000, 1000, 1000], arteries, 1);
    expect(cover[0]).toBe(0);
    expect(Number.isNaN(weights[0])).toBe(false);
  });
  it('subsamples every n-th vertex', () => {
    expect(Array.from(subsample([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], 2))).toEqual([0, 0, 0, 2, 2, 2]);
  });
});

describe('quality', () => {
  it('uses full effects on a real GPU and a plain scene on software rendering', () => {
    expect(qualityFor(false).tier).toBe('high');
    expect(qualityFor(false).bloom).toBe(true);
    expect(qualityFor(true).tier).toBe('low');
    expect(qualityFor(true).bloom).toBe(false);
    expect(qualityFor(true, 'high').tier).toBe('high');
  });
  it('downgrades only on sustained slow frames', () => {
    expect(shouldDowngrade(Array(30).fill(60))).toBe(false);
    expect(shouldDowngrade(Array(120).fill(8))).toBe(false);
    expect(shouldDowngrade(Array(120).fill(40))).toBe(true);
  });
});

describe('adapting to the machine', () => {
  it('draws fewer pixels first when frames are too slow, down to a floor', () => {
    let a = initialAdapt();
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = adaptStep(a, 40);
      a = r.next;
      if (r.action === 'scale-down') seen.push(a.scale);
    }
    expect(seen[0]).toBeCloseTo(ADAPT.down);
    expect(seen.every((v, i) => i === 0 || v < seen[i - 1]!)).toBe(true);
    expect(a.scale).toBeCloseTo(ADAPT.minScale);
  });

  it('then takes effects away in order, and stops when there is nothing left', () => {
    let a: Adapt = { ...initialAdapt(), scale: ADAPT.minScale };
    const actions: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = adaptStep(a, 40);
      a = r.next;
      actions.push(r.action);
    }
    expect(actions).toEqual(['drop-particles', 'drop-bloom', 'stop-rotate', 'none', 'none', 'none']);
  });

  it('does nothing while the frame time is acceptable', () => {
    const r = adaptStep(initialAdapt(), 19.5);
    expect(r.action).toBe('none');
    expect(r.next.scale).toBe(1);
  });

  it('lets the resolution creep back after a long calm stretch, but never above what failed before', () => {
    let a = adaptStep(initialAdapt(), 40).next;
    expect(a.ceiling).toBeCloseTo(0.95);
    let ups = 0;
    for (let i = 0; i < 60; i++) {
      const r = adaptStep(a, 16.7);
      a = r.next;
      if (r.action === 'scale-up') ups++;
    }
    expect(ups).toBeGreaterThan(0);
    expect(a.scale).toBeLessThanOrEqual(0.95 + 1e-9);
    expect(a.scale).toBeGreaterThan(0.85);
  });

  it('a window between calm and slow resets the calm count', () => {
    let a = initialAdapt();
    for (let i = 0; i < 5; i++) a = adaptStep(a, 16.7).next;
    expect(a.calm).toBe(5);
    a = adaptStep(a, 20).next;
    expect(a.calm).toBe(0);
  });
});
