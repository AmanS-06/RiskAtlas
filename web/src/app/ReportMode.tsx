import type { ReportStep } from './reportSteps';
import { BandChip } from '../dashboard/risk';
import type { BandInfo } from '../shared/palette';

interface Props {
  steps: ReportStep[];
  index: number;
  playing: boolean;
  bands: BandInfo[];
  printing: boolean;
  onIndex: (i: number) => void;
  onPlaying: (on: boolean) => void;
  onPrint: () => void;
  onClose: () => void;
}

/** The guided tour: one stop per finding, with the camera already there. Caption on the left, the heart on the right. */
export function ReportMode({ steps, index, playing, bands, printing, onIndex, onPlaying, onPrint, onClose }: Props) {
  const step = steps[index];
  if (!step) return null;
  const last = steps.length - 1;
  return (
    <section className="report" aria-label="Case report" data-testid="report" data-step={step.id}>
      <div className="report-card" key={step.id}>
        <p className="report-kicker">
          {step.band ? <BandChip band={step.band} bands={bands} /> : <span>{step.kicker}</span>}
          <span className="report-count">
            {index + 1} of {steps.length}
          </span>
        </p>
        <h2>{step.title}</h2>
        <ul className="report-lines">
          {step.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {step.notes.length > 0 && (
          <ul className="report-notes">
            {step.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="report-bar">
        <button type="button" className="btn" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0}>
          Back
        </button>
        <ol className="report-dots" aria-label="Report steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={`${s.kicker}: ${s.title}`}
                aria-current={i === index ? 'step' : undefined}
                className={i === index ? 'is-on' : i < index ? 'is-done' : ''}
                onClick={() => onIndex(i)}
              />
            </li>
          ))}
        </ol>
        <button type="button" className="btn" onClick={() => onIndex(Math.min(last, index + 1))} disabled={index === last}>
          Next
        </button>
        <button type="button" className="btn" aria-pressed={playing} onClick={() => onPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-primary" onClick={onPrint} disabled={printing} data-testid="report-print">
          {printing ? 'Preparing…' : 'Print summary'}
        </button>
        <button type="button" className="btn" onClick={onClose} data-testid="report-exit">
          Exit report
        </button>
      </div>
    </section>
  );
}
