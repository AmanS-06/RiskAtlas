import { useMemo, useState } from 'react';
import type { Counterfactual, FastPrediction, FullPrediction, Meta, TargetMeta } from '../api';
import { formatUnit, num, pct, pp, pts, withUnit } from '../shared/format';
import { findBand, type BandInfo } from '../shared/palette';
import { BandChip } from './risk';
import { Tabs } from './Tabs';
import { direction, relativeContribution, shapView, type Direction } from './shap';
import { valueLabel, type FieldSpec, type Raw } from './form';

export interface AnalysisProps {
  meta: Meta;
  bands: BandInfo[];
  prediction: FastPrediction | FullPrediction | null;
  full: FullPrediction | null;
  stale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  specs: FieldSpec[];
  raw: Raw;
}

const GLYPH: Record<Direction, string> = { up: '▲', down: '▼', none: '●' };
const WORD: Record<Direction, string> = { up: 'raises risk', down: 'lowers risk', none: 'no effect' };

function useTarget(p: AnalysisProps): TargetMeta | undefined {
  return p.meta.targets.find((t) => t.id === p.selected) ?? p.meta.targets[0];
}

function TargetTabs({ p, children }: { p: AnalysisProps; children: React.ReactNode }) {
  const t = useTarget(p);
  return (
    <Tabs
      className="target-tabs"
      label="Target"
      tabs={p.meta.targets.map((x) => ({ id: x.id, label: x.mesh ?? x.id }))}
      active={t?.id ?? ''}
      onChange={p.onSelect}
    >
      {children}
    </Tabs>
  );
}

function Stale({ show }: { show: boolean }) {
  return show ? (
    <p className="notice notice-warn" data-testid="stale-note">
      Showing the explanation for the previous full prediction. It refreshes when you release the control or press Predict risk.
    </p>
  ) : null;
}

function Waiting() {
  return (
    <p className="empty" data-testid="needs-full">
      The explanation appears with the full prediction. Press Predict risk, or release a slider.
    </p>
  );
}

// ---------------------------------------------------------------------------------------------- explanation

export function ExplanationPanel(p: AnalysisProps) {
  const t = useTarget(p);
  const [topK, setTopK] = useState(8);
  const resp = t ? p.full?.targets[t.id] : undefined;
  const labelOf = useMemo(() => new Map(p.meta.features.map((f) => [f.name, f.label])), [p.meta]);
  const specOf = useMemo(() => new Map(p.specs.map((s) => [s.feature.name, s])), [p.specs]);
  const view = resp ? shapView(resp.shap, resp.probability, topK) : null;
  const band = resp ? findBand(p.bands, resp.band) : undefined;

  return (
    <section aria-labelledby="explain-title" className="panel" data-testid="explanation-panel">
      <div className="panel-head">
        <h2 id="explain-title">Why this estimate</h2>
      </div>
      <TargetTabs p={p}>
        {!p.full || !t || !resp || !view ? (
          p.prediction ? (
            <Waiting />
          ) : (
            <p className="empty">No prediction yet.</p>
          )
        ) : (
          <>
            <Stale show={p.stale} />
            <p className="lead">
              {t.label}: <strong>{pct(resp.probability)}</strong> <BandChip band={band} bands={p.bands} />
            </p>
            <p className="additivity" data-testid="additivity" data-ok={view.additivity.ok}>
              Base value {pct(view.additivity.base, 1)} (the average model output) {view.additivity.sum < 0 ? '−' : '+'} contributions{' '}
              {pts(Math.abs(view.additivity.sum))} = {pct(view.additivity.total, 1)}.{' '}
              {view.additivity.ok
                ? 'This adds up to the predicted probability.'
                : `This differs from the predicted ${pct(view.additivity.probability, 1)}: the explanation is approximate.`}
            </p>
            <p className="hint">
              Each bar shows how far one input moved the probability from the base value, in percentage points. {GLYPH.up} raises the estimate, {GLYPH.down}{' '}
              lowers it. These are associations learned from the training data, not causes.
            </p>
            <div className="topk" role="group" aria-label="How many inputs to show">
              {[5, 8, 15, 100].map((k) => (
                <button key={k} type="button" className="tool-button" aria-pressed={topK === k} onClick={() => setTopK(k)}>
                  {k === 100 ? 'All' : `Top ${k}`}
                </button>
              ))}
            </div>
            <table className="shap-table" data-testid="shap-table">
              <caption className="visually-hidden">Contribution of each input to the {t.label} estimate</caption>
              <thead>
                <tr>
                  <th scope="col">Input</th>
                  <th scope="col">Value</th>
                  <th scope="col" className="col-effect">
                    Effect
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => {
                  const spec = specOf.get(r.feature);
                  const vl = spec ? valueLabel(spec, p.raw[r.feature]) : null;
                  return (
                    <tr key={r.feature} data-feature={r.feature} data-direction={r.direction}>
                      <th scope="row">{labelOf.get(r.feature) ?? r.feature}</th>
                      <td>{vl ?? <em className="estimated">estimated</em>}</td>
                      <td className="col-effect">
                        <span className="shap-cell">
                          <span className={`shap-glyph dir-${r.direction}`} aria-hidden="true">
                            {GLYPH[r.direction]}
                          </span>
                          <span className="diverge" aria-hidden="true">
                            <span
                              className={`diverge-bar dir-${r.direction}`}
                              style={{ width: `${view.max > 0 ? (Math.abs(r.value) / view.max) * 50 : 0}%` }}
                            />
                          </span>
                          <span className="shap-value">
                            {pp(r.value)}
                            <span className="visually-hidden"> {WORD[r.direction]}</span>
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {view.rest.count > 0 && (
                  <tr className="rest-row">
                    <th scope="row">{view.rest.count} other inputs</th>
                    <td />
                    <td className="col-effect">
                      <span className="shap-cell">
                        <span className="shap-glyph" aria-hidden="true">
                          {GLYPH.none}
                        </span>
                        <span className="diverge" aria-hidden="true" />
                        <span className="shap-value">{pp(view.rest.sum)}</span>
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </TargetTabs>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- physiology

const STATUS_GLYPH = { low: '▼', normal: '●', high: '▲', missing: '?' } as const;
const STATUS_TEXT = { low: 'Low', normal: 'Normal', high: 'High', missing: 'Not provided' } as const;

export function PhysiologyPanel(p: AnalysisProps) {
  const t = useTarget(p);
  const [sortByEffect, setSortByEffect] = useState(false);
  const shap = t ? p.full?.targets[t.id]?.shap : undefined;
  const items = useMemo(() => Object.entries(p.prediction?.physiology ?? {}), [p.prediction]);
  const rows = useMemo(() => {
    const r = items.map(([name, item]) => ({ name, item, rel: shap ? relativeContribution(shap, name) : null }));
    return sortByEffect && shap ? [...r].sort((a, b) => (b.rel?.share ?? 0) - (a.rel?.share ?? 0)) : r;
  }, [items, shap, sortByEffect]);
  const maxShare = rows.reduce((a, r) => Math.max(a, r.rel?.share ?? 0), 0);

  return (
    <section aria-labelledby="physio-title" className="panel" data-testid="physiology-panel">
      <div className="panel-head">
        <h2 id="physio-title">Physiological measurements</h2>
      </div>
      <TargetTabs p={p}>
        {!p.prediction ? (
          <p className="empty">No prediction yet.</p>
        ) : (
          <>
            {!shap && <Waiting />}
            {shap && <Stale show={p.stale} />}
            <p className="hint">
              Each measurement against its reference range, with its share of the total effect on the {t?.label ?? 'selected'} estimate (the sum of absolute
              SHAP contributions of all inputs).
            </p>
            {shap && (
              <button type="button" className="tool-button" aria-pressed={sortByEffect} onClick={() => setSortByEffect((v) => !v)}>
                Sort by contribution
              </button>
            )}
            <div className="table-wrap">
              <table className="physio-table" data-testid="physio-table">
                <caption className="visually-hidden">Physiological measurements, reference ranges and contribution to the estimate</caption>
                <thead>
                  <tr>
                    <th scope="col">Measurement</th>
                    <th scope="col">Value</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Status</th>
                    <th scope="col">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ name, item, rel }) => {
                    const u = formatUnit(item.unit);
                    const dir: Direction = rel ? direction(rel.value) : 'none';
                    return (
                      <tr key={name} data-feature={name} data-status={item.status}>
                        <th scope="row">{item.label}</th>
                        <td>{item.value === null ? <em className="estimated">estimated</em> : withUnit(item.value, item.unit)}</td>
                        <td>
                          {num(item.range[0])} to {num(item.range[1])}
                          {u ? (u === '%' ? '' : ' ') + u : ''}
                        </td>
                        <td>
                          <span className={`status status-${item.status}`}>
                            <span aria-hidden="true">{STATUS_GLYPH[item.status]}</span> {STATUS_TEXT[item.status]}
                          </span>
                        </td>
                        <td>
                          {rel ? (
                            <span className="shap-cell">
                              <span className={`shap-glyph dir-${dir}`} aria-hidden="true">
                                {GLYPH[dir]}
                              </span>
                              <span className="share-bar" aria-hidden="true">
                                <span className={`share-fill dir-${dir}`} style={{ width: `${maxShare > 0 ? (rel.share / maxShare) * 100 : 0}%` }} />
                              </span>
                              <span className="shap-value">
                                {pct(rel.share, 1)}
                                <span className="visually-hidden"> of total effect, {WORD[dir]}</span>
                                <span className="sub"> {pp(rel.value)}</span>
                              </span>
                            </span>
                          ) : (
                            <span className="muted">after full prediction</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TargetTabs>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- what-if

export function WhatIfPanel(p: AnalysisProps & { onApply: (changes: Counterfactual['changes']) => void }) {
  const t = useTarget(p);
  const resp = t ? p.full?.targets[t.id] : undefined;
  const cf = resp?.counterfactual;
  const labelOf = useMemo(() => new Map(p.meta.features.map((f) => [f.name, f.label])), [p.meta]);
  const specOf = useMemo(() => new Map(p.specs.map((s) => [s.feature.name, s])), [p.specs]);
  const fmt = (name: string, v: number, unit: string | null) => {
    const s = specOf.get(name);
    if (s && s.kind !== 'number') return valueLabel(s, String(v)) ?? num(v);
    return withUnit(v, unit);
  };

  return (
    <section aria-labelledby="whatif-title" className="panel" data-testid="whatif-panel">
      <div className="panel-head">
        <h2 id="whatif-title">What-if</h2>
      </div>
      <TargetTabs p={p}>
        {!p.full || !t || !resp || !cf ? (
          p.prediction ? (
            <Waiting />
          ) : (
            <p className="empty">No prediction yet.</p>
          )
        ) : (
          <>
            <Stale show={p.stale} />
            <p className="lead">
              {t.label} now {pct(cf.start)}. Goal: below {pct(cf.goal_probability)} (this target&apos;s rule-in cut point).
            </p>
            {!cf.needed ? (
              <p className="notice notice-info" data-testid="cf-status">
                No change is needed to reach the goal: the estimate is already below it.
              </p>
            ) : cf.changes.length === 0 ? (
              <p className="notice notice-warn" data-testid="cf-status">
                The search found no combination of modifiable inputs that reaches the goal.
              </p>
            ) : (
              <>
                <p data-testid="cf-status" className="cf-status">
                  {cf.achieved ? 'These changes bring the estimate below the goal' : 'These changes lower the estimate but do not reach the goal'}:{' '}
                  {pct(cf.start)} to <strong>{pct(cf.end)}</strong> ({pp(cf.end - cf.start)}).
                </p>
                <ul className="cf-list" data-testid="cf-changes">
                  {cf.changes.map((c) => (
                    <li key={c.feature}>
                      <span className="cf-name">{labelOf.get(c.feature) ?? c.feature}</span>
                      <span className="cf-change">
                        {fmt(c.feature, c.from, c.unit)} <span aria-label="to">{'→'}</span> {fmt(c.feature, c.to, c.unit)}
                      </span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="secondary" onClick={() => p.onApply(cf.changes)} data-testid="cf-apply">
                  Try these values in the form
                </button>
              </>
            )}
            <p className="cf-note" data-testid="cf-note">
              <strong>Note:</strong> {cf.note}
            </p>
          </>
        )}
      </TargetTabs>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- about

export function AboutPanel({ meta, bands, assets }: { meta: Meta; bands: BandInfo[]; assets: string }) {
  const m = meta.model;
  return (
    <section aria-labelledby="about-title" className="panel" data-testid="about-panel">
      <div className="panel-head">
        <h2 id="about-title">About this model</h2>
      </div>
      {m ? (
        <dl className="kv">
          <dt>Trained on</dt>
          <dd data-testid="about-n">{m.n_patients} patients (angiography-referred, single centre)</dd>
          <dt>Validation protocol</dt>
          <dd>{m.protocol}</dd>
          <dt>Model created</dt>
          <dd>{m.created}</dd>
          <dt>Code version</dt>
          <dd>
            <code>{m.git_sha.slice(0, 10)}</code>
            {m.git_sha.endsWith('-dirty') ? ' (with uncommitted changes)' : ''}
          </dd>
          <dt>API version</dt>
          <dd>{meta.api_version}</dd>
        </dl>
      ) : (
        <p className="notice notice-info">Model details are not served in mock mode. API version: {meta.api_version}.</p>
      )}
      <h3>Targets</h3>
      <div className="table-wrap">
        <table className="about-table">
          <caption className="visually-hidden">Prediction targets, model family, prevalence and cut points</caption>
          <thead>
            <tr>
              <th scope="col">Target</th>
              <th scope="col">Mesh node</th>
              <th scope="col">Model family</th>
              <th scope="col">Prevalence</th>
              <th scope="col">Threshold</th>
              <th scope="col">{bands[0]?.label ?? 'Low'} below</th>
              <th scope="col">{bands[bands.length - 1]?.label ?? 'High'} from</th>
            </tr>
          </thead>
          <tbody>
            {meta.targets.map((t) => (
              <tr key={t.id}>
                <th scope="row">
                  {t.label} <span className="mesh-id">{t.id}</span>
                </th>
                <td>{t.mesh ?? 'overall'}</td>
                <td>{t.family ?? 'n/a'}</td>
                <td>{t.prevalence === null ? 'n/a' : pct(t.prevalence, 1)}</td>
                <td>{t.threshold === null ? 'n/a' : pct(t.threshold, 1)}</td>
                <td>{t.rule_out === null ? 'n/a' : pct(t.rule_out, 1)}</td>
                <td>{t.rule_in === null ? 'n/a' : pct(t.rule_in, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Prevalence is the share of positive patients in the development cohort, which was referred for angiography and is not a general population.
        Cross-validated discrimination and calibration for each target are in <code>docs/ml_results.md</code>.
      </p>
      <h3>Data and attribution</h3>
      <p className="para">
        Dataset: Alizadehsani, R., Roshanzamir, M., &amp; Sani, Z. (2013). <em>extention of Z-Alizadeh sani dataset</em> [Data set]. UCI Machine Learning
        Repository. <a href="https://doi.org/10.24432/C5461K">https://doi.org/10.24432/C5461K</a>. Licensed under CC BY 4.0.
      </p>
      <p className="para">
        3D heart model: attribution and licence terms (including CC BY-SA 4.0 where it applies) are listed in ASSETS_AND_LICENSES.md, reproduced below.
      </p>
      <details className="note-details">
        <summary>ASSETS_AND_LICENSES.md</summary>
        <pre className="assets" data-testid="assets-text">
          {assets}
        </pre>
      </details>
    </section>
  );
}
