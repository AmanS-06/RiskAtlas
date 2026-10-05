import type { Dashboard } from './useDashboard';
import { PRESETS } from './useDashboard';
import { FeatureField } from './FeatureField';
import { groupTitle } from './form';

export function PatientForm({ d }: { d: Dashboard }) {
  const { meta, groups, raw, parsed } = d;
  if (!meta) return null;
  const errorNames = Object.keys(parsed.errors);
  const labelOf = new Map(meta.features.map((f) => [f.name, f.label]));
  return (
    <form
      className="patient-form"
      aria-labelledby="form-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        d.commit(true);
      }}
      data-testid="patient-form"
    >
      <div className="panel-head">
        <h2 id="form-title">Patient features</h2>
        <p className="count" data-testid="entered-count">
          {parsed.filled} of {meta.features.length} entered
        </p>
      </div>
      <p className="hint">
        Leave any field blank when it is unknown: the model estimates it and lists what it estimated. All values are canonical clinical features from the model
        configuration.
      </p>

      <div className="presets" role="group" aria-labelledby="presets-title">
        <p id="presets-title" className="presets-title">
          Illustrative cases, not real patients
        </p>
        <div className="preset-buttons">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="preset"
              aria-pressed={d.presetId === p.id}
              onClick={() => d.loadPreset(p.id)}
              data-testid={`preset-${p.id}`}
              title={p.summary}
            >
              <span className="preset-label">{p.label}</span>
              <span className="preset-summary">{p.summary}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" data-testid="predict-button">
          Predict risk
        </button>
        <button type="button" className="secondary" onClick={d.reset} data-testid="reset-button">
          Reset
        </button>
      </div>

      {errorNames.length > 0 && (
        <div className="notice notice-error" role="alert" data-testid="form-errors">
          <strong>{errorNames.length === 1 ? '1 input needs attention.' : `${errorNames.length} inputs need attention.`}</strong> Predictions are paused until
          they are fixed: {errorNames.map((n) => labelOf.get(n) ?? n).join(', ')}.
        </div>
      )}

      {groups.map(({ group, specs }) => {
        const filled = specs.filter((s) => (raw[s.feature.name] ?? '') !== '').length;
        return (
          <details key={group} className="group" open data-group={group}>
            <summary>
              <span className="group-title">{groupTitle(group)}</span>
              <span className="group-count">
                {filled} of {specs.length}
              </span>
            </summary>
            <div className="group-fields">
              {specs.map((s) => (
                <FeatureField key={s.feature.name} spec={s} value={raw[s.feature.name] ?? ''} onChange={d.setField} onCommit={() => d.commit(false)} />
              ))}
            </div>
          </details>
        );
      })}
    </form>
  );
}
