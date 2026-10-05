import type { ReportStep } from './reportSteps';
import { DISCLAIMER } from '../shared/constants';

export interface PrintRow {
  id: string;
  label: string;
  probability: string;
  band: string;
  interval: string;
}

interface Props {
  patient: string;
  rows: PrintRow[];
  steps: ReportStep[];
  /** PNG data URLs of the 3D view, by step id */
  shots: Record<string, string>;
  date: string;
}

/** One A4 landscape page: the case, the 3D views that matter, the numbers, the reasons and the limits. Only visible when printing (app.css). */
export function PrintReport({ patient, rows, steps, shots, date }: Props) {
  const views = steps.filter((s) => shots[s.id] && s.id !== 'limits').slice(0, 4);
  const arteries = steps.filter((s) => ['LAD', 'LCX', 'RCA'].includes(s.id));
  const limits = steps.find((s) => s.id === 'limits');
  return (
    <div className="print-root" data-testid="print-report">
      <div className="pr-head">
        <h2 className="pr-title">RiskAtlas · coronary risk summary</h2>
        <p>
          {patient} · {date}
        </p>
      </div>
      <div className="pr-grid">
        <div className="pr-views">
          {views.map((s) => (
            <figure key={s.id}>
              <img src={shots[s.id]} alt={`3D view: ${s.title}`} />
              <figcaption>{s.title}</figcaption>
            </figure>
          ))}
        </div>
        <div className="pr-text">
          <table>
            <caption>Predicted risk</caption>
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Probability</th>
                <th scope="col">Band</th>
                <th scope="col">Interval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.label}</th>
                  <td>{r.probability}</td>
                  <td>{r.band}</td>
                  <td>{r.interval}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {arteries.map((s) => (
            <section key={s.id}>
              <h2>{s.title}</h2>
              <ul>
                {s.lines.slice(1).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                {s.notes.map((n, i) => (
                  <li key={`n${i}`} className="pr-note">
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <div className="pr-foot">
        {limits && <p>{limits.lines.join(' ')}</p>}
        <p className="pr-disclaimer">
          <b>Not for clinical use.</b> {DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
