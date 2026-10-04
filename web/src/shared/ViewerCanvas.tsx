import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, lowPowerDevice } from './env';
import type { HeartViewer, VesselId, VesselState, ViewerStatus, Band } from './viewerAdapter';

export interface ViewerVessel {
  probability: number;
  band: string;
  color: string;
  uncertaintyWidth?: number;
}

interface Props {
  /** Keyed by mesh node name (from /meta targets). */
  vessels: Record<string, ViewerVessel>;
  overall: { probability: number; band: string; color: string } | null;
  selectedMesh: string | null;
  onSelectMesh: (mesh: string | null) => void;
  meshNames: string[];
  /** Enlarged state, owned by the page (it changes the page layout: the form column steps aside). Omit both props for no Enlarge button. */
  enlarged?: boolean;
  onToggleEnlarged?: () => void;
}

const BASE = import.meta.env.BASE_URL;

export function ViewerCanvas({ vessels, overall, selectedMesh, onSelectMesh, meshNames, enlarged = false, onToggleEnlarged }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<HeartViewer | null>(null);
  const onSelectRef = useRef(onSelectMesh);
  useEffect(() => {
    onSelectRef.current = onSelectMesh;
  });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const enlargeButton = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef(onToggleEnlarged);
  useEffect(() => {
    toggleRef.current = onToggleEnlarged;
  });
  const [status, setStatus] = useState<ViewerStatus | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    let cleanup = () => {};
    // The viewer (and three.js behind it) is a separate chunk: the dashboard paints first, the 3D view follows.
    import('./viewerAdapter')
      .then(async ({ HeartViewer }) => {
        if (!alive) return;
        const v = new HeartViewer({
          container: el,
          modelUrl: `${BASE}models3d/heart.glb`,
          liteModelUrl: `${BASE}models3d/heart_lite.glb`,
          lowPower: lowPowerDevice() ? true : undefined, // undefined lets the viewer auto-detect software rendering
          reducedMotion: prefersReducedMotion(),
        });
        viewer.current = v;
        if (import.meta.env.DEV) (window as unknown as { __heartViewer?: HeartViewer }).__heartViewer = v; // handle for the browser tests (dev server only, absent from the production build)
        const off = v.onSelect((id) => onSelectRef.current(id));
        const ro = new ResizeObserver(() => v.resize());
        ro.observe(el);
        cleanup = () => {
          ro.disconnect();
          off();
          v.dispose();
          viewer.current = null;
          if (import.meta.env.DEV) delete (window as unknown as { __heartViewer?: HeartViewer }).__heartViewer;
        };
        await v.load();
        if (!alive) return;
        setReady(true);
        setStatus(v.getStatus());
      })
      .catch((e: unknown) => {
        if (alive) setFailed(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      cleanup();
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const states: Partial<Record<VesselId, VesselState | undefined>> = {};
    for (const name of meshNames) {
      const s = vessels[name];
      states[name as VesselId] = s ? { probability: s.probability, band: s.band as Band, color: s.color, uncertaintyWidth: s.uncertaintyWidth } : undefined; // no prediction yet: the viewer paints the vessel neutral
    }
    v.setVessels(states);
    v.setOverall(overall ? { probability: overall.probability, band: overall.band as Band, color: overall.color } : null);
  }, [ready, vessels, overall, meshNames]);

  useEffect(() => {
    if (ready) viewer.current?.select((selectedMesh as VesselId | null) ?? null);
  }, [ready, selectedMesh]);

  // The page re-lays out when the view is enlarged or shrunk: the viewer re-measures and re-fits its camera once the new size is in place
  // (its own ResizeObserver does the same; this also covers browsers and tests without one). On a phone the enlarged view is scrolled into reach.
  const wasEnlarged = useRef(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => viewer.current?.resize());
    if (enlarged && !wasEnlarged.current) host.current?.scrollIntoView?.({ block: 'nearest' });
    wasEnlarged.current = enlarged;
    return () => cancelAnimationFrame(id);
  }, [enlarged]);

  // Escape leaves the enlarged view, from anywhere on the page (when the 3D view itself has focus its own Escape, which clears the selection, runs as well).
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      toggleRef.current?.();
      enlargeButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enlarged]);

  return (
    <div className="viewer-wrap">
      <div
        ref={host}
        className="viewer"
        role="group"
        aria-label="Interactive 3D heart risk map. The vessel list below offers the same selection by keyboard."
        data-testid="viewer"
        data-ready={ready}
      />
      {failed && (
        <p className="viewer-note" role="alert">
          The 3D view could not start ({failed}). The dashboard works without it.
        </p>
      )}
      <div className="viewer-bar">
        <div className="viewer-actions">
          <button type="button" className="tool-button" onClick={() => viewer.current?.resetView()} disabled={!ready}>
            Reset view
          </button>
          {onToggleEnlarged && (
            <button
              type="button"
              ref={enlargeButton}
              className="tool-button"
              aria-pressed={enlarged}
              onClick={onToggleEnlarged}
              data-testid="viewer-enlarge"
              title={enlarged ? 'Back to the normal layout (Escape)' : 'Give the 3D view most of the screen (Escape to go back)'}
            >
              {enlarged ? 'Shrink' : 'Enlarge'}
            </button>
          )}
        </div>
        <span className="viewer-status" data-testid="viewer-status">
          {status
            ? `${status.usingFallback === 'none' ? 'Full model' : status.usingFallback === 'lite' ? 'Lite model' : 'Schematic fallback'} · ${status.webgl ? 'WebGL' : 'no WebGL'}`
            : 'Loading 3D view'}
        </span>
      </div>
    </div>
  );
}
