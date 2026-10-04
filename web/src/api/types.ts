// Wire types for the RiskAtlas API. They mirror api/schemas.py and docs/ml_interface.md.
// Nothing here names a feature, a target or a band: all of those are strings that come from GET /meta.

export type FeatureType = 'numeric' | 'binary' | 'categorical';
export type Status = 'low' | 'normal' | 'high' | 'missing';
export type TargetKind = 'overall' | 'vessel';

export interface FeatureStats {
  median: number;
  std: number;
  min: number;
  max: number;
}

export interface FeatureMeta {
  name: string;
  label: string;
  type: FeatureType;
  unit: string | null;
  range: [number, number] | null;
  group: string;
  mutable: boolean;
  anchor: string | null;
  map: Record<string, number> | null;
  allowed: number[] | null;
  stats: FeatureStats | null;
}

export interface TargetMeta {
  id: string;
  label: string;
  kind: TargetKind;
  mesh: string | null;
  conditional_on: string | null;
  threshold: number | null;
  rule_out: number | null;
  rule_in: number | null;
  family: string | null;
  prevalence: number | null;
}

export interface BandMeta {
  id: string;
  label: string;
  color: string;
}

export interface ModelMeta {
  created: string;
  git_sha: string;
  protocol: string;
  n_patients: number;
}

export interface Meta {
  features: FeatureMeta[];
  groups: string[];
  targets: TargetMeta[];
  risk_bands: BandMeta[];
  uncertainty_interval: [number, number];
  forbidden_inputs: string[];
  model: ModelMeta | null;
  disclaimer: string;
  mock: boolean;
  api_version: string;
}

export interface Uncertainty {
  std: number;
  low: number;
  high: number;
  width: number;
}

export interface Shap {
  base: number;
  contributions: Record<string, number>;
}

export interface CounterfactualChange {
  feature: string;
  unit: string | null;
  from: number;
  to: number;
}

export interface Counterfactual {
  goal_probability: number;
  start: number;
  end: number;
  needed: boolean;
  achieved: boolean;
  changes: CounterfactualChange[];
  note: string;
}

export interface TargetFast {
  probability: number;
  band: string;
  threshold: number;
  rule_out: number;
  rule_in: number;
}

export interface TargetFull extends TargetFast {
  uncertainty: Uncertainty;
  shap: Shap;
  counterfactual: Counterfactual;
}

export interface Coherence {
  top_vessel: string;
  gap: number;
  below_top_vessel: boolean;
}

export interface PhysiologyItem {
  label: string;
  value: number | null;
  unit: string | null;
  range: [number, number];
  status: Status;
}

export interface Prediction<T extends TargetFast = TargetFast> {
  targets: Record<string, T>;
  coherence: Record<string, Coherence>;
  physiology: Record<string, PhysiologyItem>;
  input: { missing: string[]; ignored: string[] };
  model: { created: string; git_sha: string };
  timing_ms: Record<string, number>;
  disclaimer?: string;
  mock?: boolean;
}

export type FastPrediction = Prediction<TargetFast>;
export type FullPrediction = Prediction<TargetFull>;

/** Flat dict of canonical feature name to number. Absent or null means missing (imputed by the model). */
export type Inputs = Record<string, number | null>;

export type PredictMode = 'fast' | 'full';
export type Predict<M extends PredictMode> = M extends 'fast' ? FastPrediction : FullPrediction;

export function isFull(p: FastPrediction | FullPrediction | null | undefined): p is FullPrediction {
  if (!p) return false;
  return Object.values(p.targets).every((t) => 'shap' in t && 'uncertainty' in t);
}
