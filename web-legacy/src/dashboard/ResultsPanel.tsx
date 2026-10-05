import { useEffect, useState } from 'react';
import type { ApiError, FastPrediction, FullPrediction, Meta, TargetMeta } from '../api';
import { errorTitle } from '../api';
import { DisclaimerNote } from '../shared/Disclaimer';
import { CAVEATS, MOCK_LABEL } from '../shared/constants';
import { fullPredictionStatus, pct, pp, pts } from '../shared/format';
import { findBand, segments, type BandInfo } from '../shared/palette';
import { BandChip, RiskBar, RiskGauge } from './risk';

export interface ResultsProps {
  meta: Meta;
  bands: BandInfo[];
  overall: TargetMeta | null;
  vessels: TargetMeta[];
  prediction: FastPrediction | FullPrediction | null;
  full: FullPrediction | null;
  kind: 'preview' | 'full' | null;
  stale: boolean;
  busy: { fast: boolean; full: boolean };
  error: ApiError | null;
  selected: string | null;
  onSelect: (id: string) => void;
  paused: boolean;
  onRetry?: () => void;
}

/** The target's own cut points, taken from the response (they differ by target and may change when models are retrained). */
function cutsOf(t: TargetMeta, resp: { rule_out: number; rule_in: number; threshold: number } | undefined): TargetMeta {
  return resp ? { ...t, rule_out: resp.rule_out, rule_in: resp.rule_in, threshold: resp.threshold } : t;
}

export function ResultsPanel(p: ResultsProps) {
  const { meta, bands, prediction, full } = p;
  const labelOf = new Map(meta.features.map((f) => [f.name, f.label]));
  const announce = useAnnouncement(p);

  const rows = [...(p.overall ? [p.overall] : []), ...p.vessels];
  const selMeta = meta.targets.find((t) => t.id === p.selected) ?? p.overall ?? p.vessels[0];
  const selResp = selMeta && prediction?.targets[selMeta.id];
  const coherence = p.overall && prediction ? prediction.coherence[p.overall.id] : undefined;
  const [lo, hi] = meta.uncertainty_interval;
  const ordinal = (q: number) => `${Math.round(q * 100)}th`;
  const coherenceFailed = !!coherence?.below_top_vessel; // a failed check is a warning and stays on screen; a passed one sits in the notes below

  return (
    <section className="panel results" aria-labelledby="results-title" data-testid="results-panel">
      <div className="panel-head">
        <h2 id="results-title">Predicted risk</h2>
        {prediction && (
          <p className="status-line" data-testid="status-line" data-cached={prediction.cached ? 'true' : undefined}>
            {p.kind === 'preview'
              ? 'Live preview (fast model). Intervals and explanation refresh on release.'
              : p.busy.full
                ? 'Refreshing the full explanation.'
                : fullPredictionStatus(prediction.timing_ms?.total, prediction.cached)}
          </p>
        )}
        {(prediction?.mock || meta.mock) && (
          <span className="mock-chip small" data-testid="mock-flag">
            {MOCK_LABEL}
          </span>
        )}
      </div>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="announce">
        {announce}
      </div>

      {p.error && (
        <div className="notice notice-error" role="alert" data-testid="api-error">
          <strong>{errorTitle(p.error)}.</strong> {p.error.message}
          {p.error.details.length > 0 && (
            <ul>
              {p.error.details.map((d, i) => (
                <li key={i}>
                  {d.field ? <code>{d.field}</code> : null} {d.message}
                </li>
              ))}
            </ul>
          )}
          {p.prediction && <span> The last good result stays on screen. The next edit will try again.</span>}
          {p.onRetry && p.error.transient && (
            <div>
              <button type="button" className="tool-button" onClick={p.onRetry} data-testid="retry-button">
                Try again now
              </button>
            </div>
          )}
        </div>
      )}

      {p.paused && (
        <p className="notice notice-warn" data-testid="paused-note">
          Results are paused until the highlighted inputs are corrected.
        </p>
      )}

      {!prediction ? (
        <p className="empty" data-testid="empty-results">
          No prediction yet. Enter patient features, or load an illustrative case, and the risk map and explanations appear here. Fields left blank are
          estimated by the model.
        </p>
      ) : (
        <>
          <ul className="target-list">
            {rows.map((t) => {
              const resp = prediction.targets[t.id];
              if (!resp) return null;
              const band = findBand(bands, resp.band);
              const unc = full?.targets[t.id]?.uncertainty;
              const isOverall = t.kind === 'overall';
              const cut = cutsOf(t, resp);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`target-row${isOverall ? ' target-overall' : ''}`}
                    aria-pressed={p.selected === t.id}
                    onClick={() => p.onSelect(t.id)}
                    data-testid={`target-${t.id}`}
                    data-band={resp.band}
                  >
                    {isOverall && <RiskGauge target={cut} probability={resp.probability} band={band} bands={bands} />}
                    <span className="row-main">
                      <span className="row-title">
                        {t.label}
                        {t.mesh && <span className="mesh-id">{t.mesh}</span>}
                      </span>
                      <span className="row-prob" data-testid={`prob-${t.id}`}>
                        {pct(resp.probability)}
                      </span>
                      <BandChip band={band} bands={bands} />
                    </span>
                    {!isOverall && <RiskBar target={cut} probability={resp.probability} interval={unc} bands={bands} />}
                    <span className={`row-interval${p.stale ? ' is-stale' : ''}`}>
                      {unc ? (
                        <>
                          Interval {pct(unc.low)} to {pct(unc.high)}
                          {p.stale ? ' (previous full result)' : ''}
                        </>
                      ) : (
                        'Interval appears with the full prediction'
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selMeta && selResp && (
            <div className="legend" data-testid="legend">
              <h3>Risk bands for {selMeta.label}</h3>
              <span className="legend-target" aria-hidden="true">
                {selMeta.mesh ?? selMeta.id}
              </span>
              <ul>
                {segments(bands, cutsOf(selMeta, selResp)).map((s) => (
                  <li key={s.band.id}>
                    <BandChip band={s.band} bands={bands} />
                    <span>
                      {s.band.index === 0 ? `below ${pct(s.to)}` : s.band.index === bands.length - 1 ? `from ${pct(s.from)}` : `${pct(s.from)} to ${pct(s.to)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {prediction.input.missing.length > 0 && (
            <details className="note-details" data-testid="missing-note">
              <summary>
                Estimated without {prediction.input.missing.length} of {meta.features.length} inputs
              </summary>
              <p>Missing values are imputed by the model. Estimated without: {prediction.input.missing.map((n) => labelOf.get(n) ?? n).join(', ')}.</p>
            </details>
          )}
          {prediction.input.ignored.length > 0 && <p className="hint">Ignored inputs: {prediction.input.ignored.join(', ')}.</p>}

          {coherenceFailed && coherence && p.overall && <Coherence coherence={coherence} meta={meta} overall={p.overall} />}
        </>
      )}

      <div className="panel-foot">
        <p className="caveat">{CAVEATS.schematic}</p>
        <details className="note-details foot-more">
          <summary>Cut points, consistency check, data limits, clinical safety</summary>
          {prediction && selMeta && selResp && (
            <p className="caveat" data-testid="cutpoint-note">
              Cut points belong to each target and differ between targets. Decision threshold for {selMeta.label}: {pct(selResp.threshold)}. Interval:{' '}
              {ordinal(lo)} to {ordinal(hi)} percentile of refitted models; the point estimate can sit outside it.
            </p>
          )}
          {!coherenceFailed && coherence && p.overall && <Coherence coherence={coherence} meta={meta} overall={p.overall} />}
          <p className="caveat">{CAVEATS.perVessel}</p>
          <p className="caveat">{CAVEATS.cohort}</p>
          <DisclaimerNote />
        </details>
      </div>
    </section>
  );
}

function Coherence({
  coherence,
  meta,
  overall,
}: {
  coherence: { top_vessel: string; gap: number; below_top_vessel: boolean };
  meta: Meta;
  overall: TargetMeta;
}) {
  const top = meta.targets.find((t) => t.id === coherence.top_vessel);
  if (coherence.below_top_vessel) {
    return (
      <p className="notice notice-warn" data-testid="coherence-note">
        Consistency check failed: {top?.label ?? coherence.top_vessel} ({pp(coherence.gap)} versus {overall.label}) is above the overall estimate. The models
        were probably trained with a manifest that drops the conditional link between vessels and overall CAD, so treat the vessel figures with extra care.
      </p>
    );
  }
  return (
    <p className="caveat" data-testid="coherence-note">
      Consistency check passed: no vessel exceeds {overall.label} (highest, {top?.label ?? coherence.top_vessel}, is {pts(Math.abs(coherence.gap))} below).
    </p>
  );
}

/** One screen-reader summary, only after a full result or when edits go quiet, so dragging a slider does not chatter. */
function useAnnouncement(p: ResultsProps): string {
  const [text, setText] = useState('');
  const { prediction, meta, bands } = p;
  useEffect(() => {
    if (!prediction) return;
    const parts = meta.targets
      .filter((t) => prediction.targets[t.id])
      .map((t) => {
        const r = prediction.targets[t.id]!;
        return `${t.label} ${pct(r.probability)}, ${findBand(bands, r.band)?.label ?? r.band}`;
      });
    const id = setTimeout(() => setText(`${p.kind === 'preview' ? 'Preview. ' : ''}${parts.join('. ')}.`), p.kind === 'full' ? 150 : 900);
    return () => clearTimeout(id);
  }, [prediction, meta, bands, p.kind]);
  return prediction ? text : '';
}
