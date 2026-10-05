// What a touched region says. Pure: model outputs and the patient's inputs in, a card model out. The HUD only draws it.
//
// Rules this file keeps (context/ML_NOTES.md):
//  - only vessels and regions that a feature is anchored to carry data; any other structure says so instead of inventing something;
//  - a vessel card says how far its estimate can be trusted for this patient (overall and by age band, from the validation reports);
//  - drivers that look protective only because of how this cohort was referred are marked, never narrated as protection;
//  - territory shading is an estimate of the nearest supplying artery, not a measured territory and not a lesion location.

import type { FastPrediction, FullPrediction, Inputs, Meta, Status, TargetMeta } from '../api/types';
import { valueLabel, toRaw, type FieldSpec } from '../dashboard/form';
import { direction, relativeContribution, shapView, type Direction } from '../dashboard/shap';
import { findBand, type BandInfo } from '../shared/palette';
import { regionById, type RegionKind } from '../atlas/logic';
import reliability from './reliability.json';

export interface CardNote {
  tone: 'info' | 'warn';
  text: string;
}

export interface CardDriver {
  feature: string;
  label: string;
  /** signed contribution to the probability, in probability units (0.05 = 5 percentage points) */
  value: number;
  dir: Direction;
  caution: string | null;
}

export interface CardRow {
  feature: string;
  label: string;
  value: string | null;
  status: Status | null;
  contribution: { value: number; dir: Direction } | null;
}

export interface RegionCard {
  id: string;
  title: string;
  kind: RegionKind;
  live: boolean;
  /** vessel cards */
  headline: { target: TargetMeta; probability: number; band: BandInfo | undefined; interval: { low: number; high: number } | null; threshold: number } | null;
  drivers: CardDriver[];
  /** chamber and great-vessel cards: the findings anchored to this region */
  rows: CardRow[];
  /** muscle cards: the three arteries and what they were predicted at */
  territory: { id: string; label: string; probability: number; band: BandInfo | undefined }[] | null;
  notes: CardNote[];
  blurb: string | null;
  /** which target the drivers and contributions explain */
  explains: TargetMeta | null;
}

export interface CardContext {
  regionId: string;
  meta: Meta;
  bands: BandInfo[];
  prediction: FastPrediction | FullPrediction | null;
  full: FullPrediction | null;
  inputs: Inputs;
  specs: FieldSpec[];
}

const BLURB: Record<string, string> = {
  left_atrium: 'Receives oxygenated blood from the lungs through the pulmonary veins and passes it to the left ventricle.',
  right_atrium: 'Receives deoxygenated blood from the body through the vena cavae and passes it to the right ventricle.',
  right_ventricle: 'Pumps deoxygenated blood to the lungs through the pulmonary artery.',
  pulmonary_trunk: 'Carries deoxygenated blood from the right ventricle to the lungs.',
  superior_vena_cava: 'Returns deoxygenated blood from the upper body to the right atrium.',
  pulmonary_veins: 'Bring oxygenated blood from the lungs back to the left atrium.',
  left_main: 'The short stem that divides into the left anterior descending and left circumflex arteries.',
  left_ventricle: 'The main pumping chamber. It sends oxygenated blood into the aorta, and its muscle is fed by the coronary arteries.',
  ascending_aorta: 'The main artery leaving the left ventricle. The coronary arteries start just above its valve.',
};

/**
 * In this cohort, valvular heart disease, dyspnea and atypical chest pain lower the predicted CAD risk. That reflects why these patients were sent for
 * angiography (another suspected cause), not a protective effect. Feature names are from config/features.yaml.
 */
const COHORT_ARTEFACT = new Set(['vhd', 'dyspnea', 'atypical']);
const CAUTION_TEXT =
  'Lowers the estimate in this referral cohort, where patients with this finding were more often tested for another reason. It is not evidence that the finding protects.';

export const territoryNote =
  'Muscle is tinted by the artery nearest to it on the model, brighter where that artery is predicted at higher risk. This is an estimate of the supplying artery, not a measured perfusion territory and not a lesion location.';

function ageBand(age: number): string {
  return age < 50 ? '<50' : age < 65 ? '50-64' : '65+';
}

const fix = (n: number) => n.toFixed(2);

/** Notes about how far one target's estimate can be trusted for this patient. */
export function reliabilityNotes(targetId: string, age: number | null | undefined): CardNote[] {
  const notes: CardNote[] = [];
  const overall = (reliability.overall as Record<string, { auc: number; lo: number; hi: number }>)[targetId];
  if (overall && overall.auc < 0.8) {
    notes.push({
      tone: 'info',
      text: `Moderate discrimination: cross-validated ROC-AUC ${fix(overall.auc)} (95% interval ${fix(overall.lo)} to ${fix(overall.hi)}). Read this colour as coarse.`,
    });
  }
  if (typeof age === 'number' && Number.isFinite(age) && overall) {
    const band = ageBand(age);
    const sub = (reliability.subgroups as Record<string, Record<string, Record<string, { n: number; auc: number }>>>)[targetId]?.age?.[band];
    if (sub && (sub.auc < 0.7 || sub.auc < overall.auc - 0.08)) {
      notes.push({
        tone: 'warn',
        text: `In patients aged ${band} this estimate discriminated worse: ROC-AUC ${fix(sub.auc)} (n = ${sub.n}). Weigh it with extra care.`,
      });
    }
  }
  return notes;
}

function driversOf(full: FullPrediction | null, target: TargetMeta, meta: Meta, probability: number, topK: number): CardDriver[] {
  const shap = full?.targets[target.id]?.shap;
  if (!shap) return [];
  const label = new Map(meta.features.map((f) => [f.name, f.label]));
  return shapView(shap, probability, topK).rows.map((r) => ({
    feature: r.feature,
    label: label.get(r.feature) ?? r.feature,
    value: r.value,
    dir: r.direction,
    caution: r.direction === 'down' && COHORT_ARTEFACT.has(r.feature) ? CAUTION_TEXT : null,
  }));
}

export function buildRegionCard(ctx: CardContext): RegionCard {
  const { meta, bands, prediction, full, inputs, specs } = ctx;
  const def = regionById(ctx.regionId);
  const base: RegionCard = {
    id: ctx.regionId,
    title: def?.label ?? ctx.regionId,
    kind: def?.kind ?? 'minor',
    live: false,
    headline: null,
    drivers: [],
    rows: [],
    territory: null,
    notes: [],
    blurb: BLURB[ctx.regionId] ?? null,
    explains: null,
  };
  if (!def) return base;

  const vessel = meta.targets.find((t) => t.mesh === def.id);
  const overall = meta.targets.find((t) => t.kind === 'overall') ?? null;
  const age = inputs.age ?? null;

  // a coronary artery with a model behind it
  if (vessel) {
    const resp = prediction?.targets[vessel.id];
    const unc = full?.targets[vessel.id]?.uncertainty;
    base.live = true;
    base.title = vessel.label;
    base.explains = vessel;
    base.headline = resp
      ? {
          target: vessel,
          probability: resp.probability,
          band: findBand(bands, resp.band),
          interval: unc ? { low: unc.low, high: unc.high } : null,
          threshold: resp.threshold,
        }
      : null;
    if (resp) {
      base.drivers = driversOf(full, vessel, meta, resp.probability, 4);
      if (base.drivers.length === 0) base.notes.push({ tone: 'info', text: 'The drivers of this estimate appear with the full prediction.' });
      base.notes.push(...reliabilityNotes(vessel.id, age));
    } else {
      base.notes.push({ tone: 'info', text: 'No prediction yet. Load an illustrative case or enter patient features.' });
    }
    base.notes.push({ tone: 'info', text: 'Per vessel, not per lesion: this does not say where along the artery a narrowing would be.' });
    return base;
  }

  // a region that features are anchored to
  const anchored = meta.features.filter((f) => f.anchor === def.id);
  if (anchored.length > 0) {
    base.live = true;
    base.explains = overall;
    const shap = overall ? full?.targets[overall.id]?.shap : undefined;
    const specOf = new Map(specs.map((s) => [s.feature.name, s]));
    base.rows = anchored.map((f) => {
      const spec = specOf.get(f.name);
      const v = inputs[f.name];
      const phys = prediction?.physiology[f.name];
      const rel = shap ? relativeContribution(shap, f.name) : null;
      return {
        feature: f.name,
        label: f.label,
        value: spec ? valueLabel(spec, toRaw(v)) : null,
        status: phys?.status ?? null,
        contribution: rel ? { value: rel.value, dir: direction(rel.value) } : null,
      };
    });
    if (def.id === 'left_ventricle' || def.id === 'right_ventricle') {
      const arteries = meta.targets.filter((t) => t.mesh);
      base.territory = arteries.map((t) => {
        const r = prediction?.targets[t.id];
        return { id: t.id, label: t.label, probability: r?.probability ?? 0, band: r ? findBand(bands, r.band) : undefined };
      });
      base.notes.push({ tone: 'info', text: territoryNote });
    }
    if (overall) base.notes.push({ tone: 'info', text: `Contributions are to the ${overall.label} estimate.` });
    if (!shap && prediction) base.notes.push({ tone: 'info', text: 'Contributions appear with the full prediction.' });
    return base;
  }

  // a structure the model has nothing to say about
  base.notes.push({ tone: 'info', text: 'No input or output of the model is attached to this structure.' });
  return base;
}
