import type { Direction } from '../dashboard/shap';
import { pct, pp } from '../shared/format';
import type { BandInfo } from '../shared/palette';
import { BandChip, RiskBar } from '../dashboard/risk';
import type { RegionCard } from './regionInfo';

const GLYPH: Record<Direction, string> = { up: '▲', down: '▼', none: '●' };
const WORD: Record<Direction, string> = { up: 'raises risk', down: 'lowers risk', none: 'no effect' };
const STATUS: Record<string, string> = { low: 'Low', normal: 'In range', high: 'High', missing: 'Not entered' };

/** The floating panel that opens when a structure is touched. Everything in it comes from the card model (regionInfo.ts). */
export function RegionCardView({ card, onClose, bands }: { card: RegionCard; onClose: () => void; bands: BandInfo[] }) {
  const h = card.headline;
  return (
    <article className="rc" aria-labelledby="rc-title" data-live={card.live} data-kind={card.kind}>
      <header className="rc-head">
        <div>
          <h2 id="rc-title">{card.title}</h2>
          <p className="rc-sub">{card.live ? (h ? 'Coronary artery · model output' : 'Structure with patient data') : 'Orientation only · no data attached'}</p>
        </div>
        <button type="button" className="rc-close" onClick={onClose} aria-label={`Close ${card.title}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {h && (
        <section className="rc-block" aria-label="Estimate">
          <div className="rc-prob">
            <span className="rc-num" data-testid="rc-prob">
              {pct(h.probability)}
            </span>
            <BandChip band={h.band} bands={bands} />
          </div>
          <RiskBar target={h.target} probability={h.probability} interval={h.interval ?? undefined} bands={bands} />
          <p className="rc-meta">
            {h.interval ? `Interval ${pct(h.interval.low)} to ${pct(h.interval.high)}` : 'Interval appears with the full prediction'} · decision threshold{' '}
            {pct(h.threshold)}
          </p>
        </section>
      )}

      {card.drivers.length > 0 && (
        <section className="rc-block" aria-label="What drives this estimate">
          <h3>What drives it</h3>
          <ul className="rc-list">
            {card.drivers.map((r) => (
              <li key={r.feature} data-dir={r.dir}>
                <span className={`rc-glyph dir-${r.dir}`} aria-hidden="true">
                  {GLYPH[r.dir]}
                </span>
                <span className="rc-label">
                  {r.label}
                  <span className="visually-hidden"> {WORD[r.dir]}</span>
                </span>
                <span className="rc-val">{pp(r.value)}</span>
                {r.caution && <p className="rc-caution">{r.caution}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.rows.length > 0 && (
        <section className="rc-block" aria-label="Findings">
          <h3>Findings on this structure</h3>
          <ul className="rc-list">
            {card.rows.map((r) => (
              <li key={r.feature} data-feature={r.feature}>
                <span className="rc-label">{r.label}</span>
                <span className="rc-val">
                  {r.value ?? <em>not entered</em>}
                  {r.status && r.status !== 'missing' && <span className={`rc-status s-${r.status}`}>{STATUS[r.status]}</span>}
                </span>
                {r.contribution && (
                  <span className={`rc-contrib dir-${r.contribution.dir}`}>
                    <span aria-hidden="true">{GLYPH[r.contribution.dir]}</span> {pp(r.contribution.value)}
                    <span className="visually-hidden"> {WORD[r.contribution.dir]}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.territory && (
        <section className="rc-block" aria-label="Supplying arteries">
          <h3>Fed by</h3>
          <ul className="rc-terr">
            {card.territory.map((t) => (
              <li key={t.id}>
                <span className="rc-swatch" style={{ background: t.band?.color ?? 'var(--border-strong)' }} aria-hidden="true" />
                {t.id}
                <span className="rc-val">{t.band ? `${pct(t.probability)} · ${t.band.label}` : 'no prediction'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.blurb && <p className="rc-blurb">{card.blurb}</p>}

      {card.notes.length > 0 && (
        <ul className="rc-notes">
          {card.notes.map((n, i) => (
            <li key={i} data-tone={n.tone}>
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
