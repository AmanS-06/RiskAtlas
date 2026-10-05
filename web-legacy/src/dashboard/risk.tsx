import { pct } from '../shared/format';
import { segments, type BandInfo } from '../shared/palette';
import type { TargetMeta } from '../api/types';

/** Band icon: a pie that fills as risk rises, so band is readable without colour. */
export function BandIcon({ band, bands }: { band: BandInfo; bands: BandInfo[] }) {
  const frac = (band.index + 1) / Math.max(1, bands.length);
  const a = frac * Math.PI * 2;
  const large = frac > 0.5 ? 1 : 0;
  const x = 8 + 6 * Math.sin(a);
  const y = 8 - 6 * Math.cos(a);
  return (
    <svg className="band-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {frac >= 1 ? (
        <circle cx="8" cy="8" r="6" fill={band.color} />
      ) : (
        <path d={`M8 8 L8 2 A6 6 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} fill={band.color} />
      )}
    </svg>
  );
}

export function BandChip({ band, bands }: { band: BandInfo | undefined; bands: BandInfo[] }) {
  if (!band) return null;
  return (
    <span className="chip band-chip" data-band={band.id}>
      <BandIcon band={band} bands={bands} />
      <span>{band.label}</span>
    </span>
  );
}

/** Semicircle gauge. Segments are the target's own cut points. */
export function RiskGauge({ target, probability, band, bands }: { target: TargetMeta; probability: number; band: BandInfo | undefined; bands: BandInfo[] }) {
  const cx = 120;
  const cy = 115;
  const r = 92;
  const pt = (p: number, rad = r): [number, number] => [cx - rad * Math.cos(Math.PI * p), cy - rad * Math.sin(Math.PI * p)];
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const segs = segments(bands, target);
  const [nx, ny] = pt(Math.min(1, Math.max(0, probability)), r - 22);
  const [mx, my] = pt(Math.min(1, Math.max(0, probability)), r + 10);
  return (
    <svg className="gauge" viewBox="0 0 240 138" role="img" aria-label={`${target.label} probability ${pct(probability)}${band ? `, ${band.label}` : ''}`}>
      <path d={arc(0, 1)} className="gauge-track" fill="none" strokeWidth="18" strokeLinecap="butt" />
      {segs.map((s) => (
        <path key={s.band.id} d={arc(s.from, Math.max(s.from + 0.002, s.to))} fill="none" stroke={s.band.color} strokeWidth="14" />
      ))}
      {segs.slice(1).map((s) => {
        const [x1, y1] = pt(s.from, r - 12);
        const [x2, y2] = pt(s.from, r + 12);
        return <line key={`t-${s.band.id}`} x1={x1} y1={y1} x2={x2} y2={y2} className="gauge-tick" strokeWidth="2" />;
      })}
      <line x1={nx} y1={ny} x2={mx} y2={my} className="gauge-needle" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Horizontal bar: band segments from the target's cut points, a marker at the probability, a whisker for the interval. */
export function RiskBar({
  target,
  probability,
  interval,
  bands,
}: {
  target: TargetMeta;
  probability: number;
  interval?: { low: number; high: number } | null;
  bands: BandInfo[];
}) {
  const segs = segments(bands, target);
  const left = (p: number) => `${Math.min(100, Math.max(0, p * 100))}%`;
  return (
    <span className="risk-bar" aria-hidden="true">
      {segs.map((s) => (
        <span
          key={s.band.id}
          className="risk-bar-seg"
          style={{ left: left(s.from), width: `${Math.max(0, (s.to - s.from) * 100)}%`, background: s.band.color }}
        />
      ))}
      {interval && (
        <span className="risk-bar-interval" style={{ left: left(interval.low), width: `${Math.max(0.5, (interval.high - interval.low) * 100)}%` }} />
      )}
      <span className="risk-bar-marker" style={{ left: left(probability) }} />
    </span>
  );
}
