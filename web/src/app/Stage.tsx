import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AtlasStatus, AtlasStyle, AtlasViewer, HoverInfo, RegionPoint } from '../atlas/AtlasViewer';
import { liveRegions, REGIONS, regionById, clampBpm } from '../atlas/logic';
import { findBand } from '../shared/palette';
import { pct } from '../shared/format';
import { prefersReducedMotion } from '../shared/env';
import type { Dashboard } from '../dashboard/useDashboard';
import { buildRegionCard } from './regionInfo';
import { RegionCardView } from './RegionCardView';

interface Props {
  d: Dashboard;
  region: string | null;
  onRegion: (id: string | null) => void;
  style: AtlasStyle;
  onStyle: (s: AtlasStyle) => void;
  territory: boolean;
  onTerritory: (on: boolean) => void;
  enlarged: boolean;
  onEnlarge: () => void;
}

const BASE = import.meta.env.BASE_URL;
const CARD_W = 316;
const CHIP_PUSH = 38;

/** `?quality=high|low` forces a tier (for screenshots on machines without a GPU). */
function forcedQuality(): 'high' | 'low' | undefined {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('quality');
  return q === 'high' || q === 'low' ? q : undefined;
}

export function Stage({ d, region, onRegion, style, onStyle, territory, onTerritory, enlarged, onEnlarge }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<AtlasViewer | null>(null);
  const regionRef = useRef(onRegion);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<AtlasStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [points, setPoints] = useState<Record<string, RegionPoint>>({});
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const meta = d.meta;

  useEffect(() => {
    regionRef.current = onRegion;
  });

  // create the viewer (three.js is its own chunk: the page paints first, the heart follows)
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let cleanup = () => {};
    import('../atlas/AtlasViewer')
      .then(async ({ AtlasViewer }) => {
        if (!alive) return;
        const v = new AtlasViewer({
          container: el,
          modelUrl: `${BASE}models3d/heart.glb`,
          liteModelUrl: `${BASE}models3d/heart_lite.glb`,
          style,
          quality: forcedQuality(),
          reducedMotion: prefersReducedMotion(),
          background: getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() || '#050b14',
        });
        viewer.current = v;
        if (import.meta.env.DEV) (window as unknown as { __atlas?: AtlasViewer }).__atlas = v;
        const offs = [
          v.onSelect((id) => regionRef.current(id)),
          v.onHover((h) => setHover(h)),
          v.onPoints((pts) => setPoints(Object.fromEntries(pts.map((p) => [p.id, p])))),
        ];
        const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        cleanup = () => {
          ro.disconnect();
          offs.forEach((o) => o());
          v.dispose();
          viewer.current = null;
          if (import.meta.env.DEV) delete (window as unknown as { __atlas?: AtlasViewer }).__atlas;
        };
        await v.load();
        if (!alive) return;
        setStatus(v.getStatus());
        setReady(true);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      cleanup();
      setReady(false);
    };
    // the viewer is created once; style and the rest are pushed in by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) viewer.current?.setStyle(style);
  }, [ready, style]);
  useEffect(() => {
    if (ready) viewer.current?.setTerritory(territory);
  }, [ready, territory]);
  useEffect(() => {
    if (ready) viewer.current?.setScanning(d.busy.full);
  }, [ready, d.busy.full]);

  const vesselMeshes = useMemo(() => d.vessels.map((v) => v.mesh).filter((m): m is string => !!m), [d.vessels]);
  const live = useMemo(() => liveRegions(vesselMeshes, meta?.features.map((f) => f.anchor) ?? []), [vesselMeshes, meta]);
  useEffect(() => {
    if (ready) viewer.current?.setLive(live);
  }, [ready, live]);

  // predictions to the scene
  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const states: Record<string, { probability: number; band: string; color: string; uncertaintyWidth?: number } | undefined> = {};
    for (const t of d.vessels) {
      if (!t.mesh) continue;
      const r = d.prediction?.targets[t.id];
      const band = r && findBand(d.bands, r.band);
      const unc = d.full?.targets[t.id]?.uncertainty;
      states[t.mesh] =
        r && band
          ? { probability: r.probability, band: r.band, color: band.color, uncertaintyWidth: unc ? Math.min(1, Math.max(0, unc.width)) : undefined }
          : undefined;
    }
    v.setVessels(states);
    const o = d.overall && d.prediction?.targets[d.overall.id];
    const ob = o && findBand(d.bands, o.band);
    v.setOverall(o && ob ? { color: ob.color, probability: o.probability } : null);
  }, [ready, d.prediction, d.full, d.vessels, d.bands, d.overall]);

  // heart rate from the pulse input
  const pulse = d.parsed.inputs.pr;
  const bpm = clampBpm(pulse);
  useEffect(() => {
    if (ready) viewer.current?.setBpm(pulse);
  }, [ready, pulse]);

  // selection from outside (results rows, target tabs, keyboard list)
  useEffect(() => {
    if (ready) viewer.current?.select(region);
  }, [ready, region]);

  const select = useCallback((id: string | null) => onRegion(id), [onRegion]);

  // leave room for the region panel: the heart slides to the left while one is open
  useEffect(() => {
    if (ready) viewer.current?.setShift(region && box.w > 560 ? 0.2 : 0);
  }, [ready, region, box.w]);

  const card = useMemo(
    () =>
      region && meta
        ? buildRegionCard({ regionId: region, meta, bands: d.bands, prediction: d.prediction, full: d.full, inputs: d.parsed.inputs, specs: d.fieldSpecs })
        : null,
    [region, meta, d.bands, d.prediction, d.full, d.parsed.inputs, d.fieldSpecs],
  );
  const hoverDef = hover && hover.id !== region ? regionById(hover.id) : null;

  const chips = useMemo(() => {
    const cx = box.w / 2;
    const cy = box.h / 2;
    return [...live]
      .map((id) => ({ id, p: points[id] }))
      .filter((c): c is { id: string; p: RegionPoint } => !!c.p)
      .map(({ id, p }) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const target = d.vessels.find((t) => t.mesh === id);
        const resp = target && d.prediction?.targets[target.id];
        const band = resp && findBand(d.bands, resp.band);
        const def = regionById(id);
        const label = target
          ? `${target.mesh} ${resp ? pct(resp.probability) : ''}`.trim()
          : id === 'left_ventricle'
            ? 'LV'
            : id === 'ascending_aorta'
              ? 'Aorta'
              : (def?.label ?? id);
        return {
          id,
          label,
          x: p.x,
          y: p.y,
          cx: p.x + ux * CHIP_PUSH,
          cy: p.y + uy * CHIP_PUSH,
          facing: p.facing,
          color: band?.color ?? null,
          side: ux >= 0 ? 'r' : 'l',
        };
      });
  }, [live, points, box, d.vessels, d.prediction, d.bands]);

  const anchor = region ? points[region] : undefined;
  const cardX = Math.max(16, box.w - CARD_W - 16);
  const cardTop = 64;
  const lineEndY = anchor ? Math.max(cardTop + 30, Math.min(anchor.y, cardTop + 130)) : 0;

  const failed = status?.error ?? loadError;

  return (
    <section className="stage" aria-label="3D heart" data-testid="stage" data-ready={ready} data-region={region ?? ''}>
      <div ref={host} className="stage-canvas" data-testid="viewer" />

      {/* chips pinned to every region that has data */}
      <div className="hud" aria-hidden={false}>
        <svg className="hud-lines" width={box.w} height={box.h} aria-hidden="true">
          {chips.map((c) => (
            <g key={c.id} opacity={Math.max(0.25, c.facing)} className={region === c.id ? 'is-on' : ''}>
              <line x1={c.x} y1={c.y} x2={c.cx} y2={c.cy} />
              <circle cx={c.x} cy={c.y} r={3.5} fill={c.color ?? 'var(--hud-line)'} />
            </g>
          ))}
          {card && anchor && (
            <polyline className="hud-leader" points={`${anchor.x},${anchor.y} ${anchor.x + 26},${lineEndY} ${cardX},${lineEndY}`} key={region} />
          )}
        </svg>
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`hud-chip${region === c.id ? ' is-on' : ''}`}
            style={{
              transform: `translate(${c.cx}px, ${c.cy}px) translate(${c.side === 'r' ? '0' : '-100%'}, -50%)`,
              opacity: Math.max(0.3, c.facing),
              ['--chip' as string]: c.color ?? 'var(--hud-line)',
            }}
            onClick={() => select(region === c.id ? null : c.id)}
            aria-pressed={region === c.id}
            data-testid={`chip-${c.id}`}
          >
            <span className="chip-dot" aria-hidden="true" />
            {c.label}
          </button>
        ))}
        {hoverDef && hover && (
          <div className="hud-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }} role="presentation">
            {hoverDef.label}
            <span>{live.has(hoverDef.id) ? 'has data' : 'orientation only'}</span>
          </div>
        )}
        {card && anchor && (
          <div className="hud-card" style={{ left: cardX, top: cardTop, width: CARD_W }} data-testid="region-card" key={`card-${region}`}>
            <RegionCardView card={card} onClose={() => select(null)} bands={d.bands} />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="stage-tools" role="toolbar" aria-label="3D view controls">
        <div className="seg" role="radiogroup" aria-label="Look">
          {(
            [
              ['holo', 'Hologram'],
              ['real', 'Realistic'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={style === id}
              className={style === id ? 'is-on' : ''}
              onClick={() => onStyle(id)}
              data-testid={`style-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tool"
          aria-pressed={territory}
          onClick={() => onTerritory(!territory)}
          title="Tint the heart muscle by its nearest supplying artery (approximate)"
        >
          Territories
        </button>
        <button type="button" className="tool" onClick={() => viewer.current?.resetView()} disabled={!ready}>
          Reset view
        </button>
        <button
          type="button"
          className="tool"
          aria-pressed={enlarged}
          onClick={onEnlarge}
          data-testid="viewer-enlarge"
          title="Hide the side panels (Escape to return)"
        >
          {enlarged ? 'Show panels' : 'Focus'}
        </button>
      </div>

      <details className="structures" open>
        <summary>Structures</summary>
        <ul aria-label="Structures of the heart">
          {REGIONS.filter((r) => r.kind !== 'minor' || r.id === 'pulmonary_veins').map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={`${region === r.id ? 'is-on ' : ''}${live.has(r.id) ? 'has-data' : ''}`}
                aria-pressed={region === r.id}
                onClick={() => select(region === r.id ? null : r.id)}
              >
                <span className="s-dot" aria-hidden="true" />
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      </details>

      <div className="stage-foot">
        <span className="beat" data-testid="bpm">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 14 2 8a3.6 3.6 0 0 1 6-3.7A3.6 3.6 0 0 1 14 8z" fill="currentColor" />
          </svg>
          {Math.round(bpm)} bpm <em>{pulse === null || pulse === undefined ? 'resting default, no pulse entered' : 'from the pulse rate entered'}</em>
        </span>
        <span className="hint-line">Drag to rotate · scroll to zoom · click a structure · double-click to reset</span>
        {status && status.tier === 'low' && (
          <span className="tier" title={status.renderer}>
            Simple rendering (no GPU detected)
          </span>
        )}
      </div>

      {d.busy.full && (
        <div className="stage-scan" role="status">
          Scanning: computing intervals and explanation
        </div>
      )}
      {!ready && !failed && (
        <div className="stage-loading" role="status">
          Loading the 3D heart…
        </div>
      )}
      {failed && (
        <div className="stage-loading is-error" role="alert">
          The 3D view could not start ({failed}). The panels still work; pick structures from the list.
        </div>
      )}
    </section>
  );
}
