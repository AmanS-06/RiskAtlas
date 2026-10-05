import { memo, useId } from 'react';
import { formatUnit, num } from '../shared/format';
import { check, parseNumber, rangeStatus, type FieldSpec } from './form';

export type Edit = 'preview' | 'commit' | 'none';

interface Props {
  spec: FieldSpec;
  value: string;
  onChange: (name: string, value: string, mode: Edit) => void;
  onCommit: () => void;
}

const RANGE_WORD = { low: 'below', normal: 'within', high: 'above' } as const;

function FeatureFieldImpl({ spec, value, onChange, onCommit }: Props) {
  const { feature: f } = spec;
  const uid = useId();
  const hintId = `${uid}-hint`;
  const unit = formatUnit(f.unit);
  const verdict = check(spec, value);
  const num_ = parseNumber(value);
  const inRange = spec.kind === 'number' && num_ !== null && !Number.isNaN(num_) ? rangeStatus(f, num_) : null;

  const hints: string[] = [];
  if (spec.kind === 'number') {
    if (f.range) hints.push(`Reference ${num(f.range[0])} to ${num(f.range[1])}${unit ? ' ' + unit : ''}`);
    if (f.stats) hints.push(`Training range ${num(f.stats.min)} to ${num(f.stats.max)}`);
  }
  const status = verdict.level !== 'ok' ? verdict.message : inRange ? `${RANGE_WORD[inRange]} the reference range` : '';

  if (spec.kind === 'binary') {
    return (
      <fieldset className="field field-binary" data-feature={f.name}>
        <legend>{f.label}</legend>
        <div className="segmented" role="radiogroup" aria-label={f.label}>
          {[
            { v: '1', t: 'Yes' },
            { v: '0', t: 'No' },
            { v: '', t: 'Not provided' },
          ].map((o) => (
            <label key={o.t} className={value === o.v ? 'is-on' : ''}>
              <input
                type="radio"
                name={`${uid}-${f.name}`}
                checked={value === o.v}
                onChange={() => onChange(f.name, o.v, 'commit')}
                data-testid={`field-${f.name}-${o.t === 'Yes' ? 'yes' : o.t === 'No' ? 'no' : 'unset'}`}
              />
              <span>{o.t}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  const label = (
    <label htmlFor={uid}>
      {f.label}
      {unit && <span className="unit"> ({unit})</span>}
    </label>
  );

  if (spec.kind === 'select') {
    return (
      <div className="field" data-feature={f.name}>
        {label}
        <select id={uid} value={value} onChange={(e) => onChange(f.name, e.target.value, 'commit')} data-testid={`field-${f.name}`}>
          <option value="">Not provided</option>
          {spec.options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const slider = f.mutable && f.stats;
  const sliderValue = num_ !== null && !Number.isNaN(num_) ? num_ : f.stats ? f.stats.median : 0;
  const commitSoon = () => onCommit();
  return (
    <div className={`field${verdict.level === 'error' ? ' has-error' : ''}`} data-feature={f.name}>
      {label}
      <input
        id={uid}
        type="text"
        inputMode={spec.integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        placeholder="Not provided"
        value={value}
        aria-invalid={verdict.level === 'error'}
        aria-describedby={hintId}
        onChange={(e) => onChange(f.name, e.target.value, 'preview')}
        onBlur={commitSoon}
        data-testid={`field-${f.name}`}
      />
      {slider && f.stats && (
        <input
          type="range"
          className="slider"
          min={f.stats.min}
          max={f.stats.max}
          step={spec.step}
          value={sliderValue}
          aria-label={`${f.label} slider${unit ? ` (${unit})` : ''}`}
          aria-valuetext={num_ === null ? 'Not provided. Move to set a value.' : `${num(sliderValue)}${unit ? ' ' + unit : ''}`}
          onChange={(e) => onChange(f.name, e.target.value, 'preview')}
          onPointerUp={commitSoon}
          onPointerCancel={commitSoon}
          onKeyUp={commitSoon}
          onBlur={commitSoon}
          data-testid={`slider-${f.name}`}
        />
      )}
      <p id={hintId} className={`field-hint${verdict.level === 'error' ? ' is-error' : verdict.level === 'warn' ? ' is-warn' : ''}`}>
        {hints.join(' · ')}
        {status && (
          <span className="field-status" data-level={verdict.level === 'ok' ? inRange : verdict.level}>
            {hints.length > 0 ? ' · ' : ''}
            {verdict.level === 'error' ? 'Error: ' : verdict.level === 'warn' ? 'Note: ' : 'Value is '}
            {status}
          </span>
        )}
      </p>
    </div>
  );
}

export const FeatureField = memo(FeatureFieldImpl);
