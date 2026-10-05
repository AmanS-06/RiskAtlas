// The report: a guided tour of the case, one camera stop per finding, and the same words for the printed one-page summary.
// Pure. It reads the region cards (regionInfo.ts), so the report can never say anything the panels do not.

import type { BandInfo } from '../shared/palette';
import { CAVEATS, DISCLAIMER } from '../shared/constants';
import { pct, pp } from '../shared/format';
import { buildRegionCard, type CardContext, type RegionCard } from './regionInfo';

export interface ReportStep {
  id: string;
  /** region the camera goes to; null = the whole heart */
  regionId: string | null;
  kicker: string;
  title: string;
  band: BandInfo | undefined;
  lines: string[];
  notes: string[];
}

const WORD = { up: 'raises', down: 'lowers', none: 'does not change' } as const;

function driverLine(label: string, value: number, dir: 'up' | 'down' | 'none'): string {
  return `${label} ${WORD[dir]} the estimate by ${Math.abs(value * 100).toFixed(1)} percentage points`;
}

function stepFromVessel(card: RegionCard): ReportStep {
  const h = card.headline!;
  const lines: string[] = [];
  lines.push(
    h.interval
      ? `Interval ${pct(h.interval.low)} to ${pct(h.interval.high)}, decision threshold ${pct(h.threshold)}`
      : `Decision threshold ${pct(h.threshold)}`,
  );
  for (const d of card.drivers.slice(0, 3)) lines.push(driverLine(d.label, d.value, d.dir));
  return {
    id: card.id,
    regionId: card.id,
    kicker: h.band?.label ?? 'Coronary artery',
    title: `${card.title} · ${pct(h.probability)}`,
    band: h.band,
    lines,
    notes: card.notes.filter((n) => n.tone === 'warn' || /discrimination|per vessel/i.test(n.text)).map((n) => n.text),
  };
}

/** The steps of the report, in reading order: the whole heart, each artery from highest risk down, the left ventricle, and the limits. */
export function buildReportSteps(ctx: CardContext): ReportStep[] {
  const { meta, prediction } = ctx;
  if (!prediction) return [];
  const overall = meta.targets.find((t) => t.kind === 'overall');
  const steps: ReportStep[] = [];

  const cards = meta.targets
    .filter((t) => t.mesh)
    .map((t) => buildRegionCard({ ...ctx, regionId: t.mesh! }))
    .filter((c) => c.headline)
    .sort((a, b) => b.headline!.probability - a.headline!.probability);

  const o = overall && prediction.targets[overall.id];
  if (overall && o) {
    const band = ctx.bands.find((b) => b.id === o.band);
    const lines = [`${overall.label}: ${pct(o.probability)}${band ? `, ${band.label.toLowerCase()}` : ''}`];
    const top = cards[0];
    if (top?.headline) lines.push(`Highest-risk artery: ${top.id} at ${pct(top.headline.probability)}`);
    if (prediction.input.missing.length > 0) lines.push(`Estimated without ${prediction.input.missing.length} of ${meta.features.length} inputs`);
    steps.push({ id: 'overview', regionId: null, kicker: 'Overview', title: `${overall.label} · ${pct(o.probability)}`, band, lines, notes: [] });
  }

  for (const c of cards) steps.push(stepFromVessel(c));

  const lv = buildRegionCard({ ...ctx, regionId: 'left_ventricle' });
  if (lv.live) {
    const lines = lv.rows
      .filter((r) => r.value !== null)
      .slice(0, 4)
      .map((r) => `${r.label}: ${r.value}${r.contribution ? ` (${pp(r.contribution.value)} on the overall estimate)` : ''}`);
    if (lines.length === 0) lines.push('No findings on the left ventricle were entered.');
    steps.push({
      id: 'left_ventricle',
      regionId: 'left_ventricle',
      kicker: 'Left ventricle',
      title: 'The muscle these arteries feed',
      band: undefined,
      lines,
      notes: lv.notes.filter((n) => /territory|supplying/i.test(n.text)).map((n) => n.text),
    });
  }

  steps.push({
    id: 'limits',
    regionId: null,
    kicker: 'Limits',
    title: 'What this does not tell you',
    band: undefined,
    lines: [CAVEATS.perVessel, CAVEATS.cohort],
    notes: [DISCLAIMER],
  });
  return steps;
}
