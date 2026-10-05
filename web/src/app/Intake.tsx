import { useState } from 'react';
import { FeatureField } from '../dashboard/FeatureField';
import { groupTitle } from '../dashboard/form';
import { PRESETS, type Dashboard } from '../dashboard/useDashboard';

/** The patient column: illustrative cases, then the features one group at a time (groups come from /meta). */
export function Intake({ d }: { d: Dashboard }) {
  const { meta, groups, raw, parsed } = d;
  const [step, setStep] = useState(0);
  if (!meta) return null;
  const at = Math.min(step, Math.max(0, groups.length - 1)); // a step past the end (the groups changed) falls back to the last one
  const current = groups[at];
  const errorNames = Object.keys(parsed.errors);
  const labelOf = new Map(meta.features.map((f) => [f.name, f.label]));

  return (
    <form
      className="intake"
      aria-labelledby="intake-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        d.commit(true);
      }}
      data-testid="patient-form"
    >
      <div className="intake-head">
        <h2 id="intake-title">
          Patient
          <span className="count" data-testid="entered-count">
            {parsed.filled} of {meta.features.length} entered
          </span>
        </h2>
        <p className="hint">Leave a field blank when it is unknown: the model estimates it and lists what it estimated.</p>
        <div className="cases" role="group" aria-label="Illustrative cases, not real patients">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="case"
              aria-pressed={d.presetId === p.id}
              onClick={() => d.loadPreset(p.id)}
              data-testid={`preset-${p.id}`}
              title={p.summary}
            >
              <b>{p.label}</b>
              <span>{p.summary}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="steps" role="tablist" aria-label="Feature groups">
        {groups.map((g, i) => {
          const filled = g.specs.filter((s) => (raw[s.feature.name] ?? '') !== '').length;
          return (
            <button key={g.group} type="button" role="tab" className="step" aria-selected={i === at} onClick={() => setStep(i)} data-group={g.group}>
              {groupTitle(g.group)}
              <small>
                {filled}/{g.specs.length}
              </small>
            </button>
          );
        })}
      </div>

      {errorNames.length > 0 && (
        <div className="notice notice-error" role="alert" data-testid="form-errors" style={{ margin: '10px 16px 0' }}>
          <strong>{errorNames.length === 1 ? '1 input needs attention.' : `${errorNames.length} inputs need attention.`}</strong> Predictions are paused until
          they are fixed: {errorNames.map((n) => labelOf.get(n) ?? n).join(', ')}.
        </div>
      )}

      <div className="intake-body" role="tabpanel">
        {current?.specs.map((s) => (
          <FeatureField key={s.feature.name} spec={s} value={raw[s.feature.name] ?? ''} onChange={d.setField} onCommit={() => d.commit(false)} />
        ))}
      </div>

      <div className="intake-foot">
        <button type="button" className="btn" onClick={() => setStep(Math.max(0, at - 1))} disabled={at === 0}>
          Back
        </button>
        <button type="button" className="btn" onClick={() => setStep(Math.min(groups.length - 1, at + 1))} disabled={at >= groups.length - 1}>
          Next
        </button>
        <span className="grow" />
        <button type="button" className="btn" onClick={d.reset} data-testid="reset-button">
          Reset
        </button>
        <button type="submit" className="btn btn-primary" data-testid="predict-button">
          Predict risk
        </button>
      </div>
    </form>
  );
}
