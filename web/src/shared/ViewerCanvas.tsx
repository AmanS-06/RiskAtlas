import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, lowPowerDevice } from './env';
import { HeartViewer, type VesselId, type VesselState, type ViewerStatus, type Band } from './viewerAdapter';

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
  /** Mesh names that have no state yet are painted with this. */
  neutral: string;
  meshNames: string[];
}

const BASE = import.meta.env.BASE_URL;

export function ViewerCanvas({ vessels, overall, selectedMesh, onSelectMesh, neutral, meshNames }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<HeartViewer | null>(null);
  const onSelectRef = useRef(onSelectMesh);
  useEffect(() => {
    onSelectRef.current = onSelectMesh;
  });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewerStatus | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    const v = new HeartViewer({
      container: el,
      modelUrl: `${BASE}models3d/heart.glb`,
      liteModelUrl: `${BASE}models3d/heart_lite.glb`,
      lowPower: lowPowerDevice(),
      reducedMotion: prefersReducedMotion(),
    });
    viewer.current = v;
    const off = v.onSelect((id) => onSelectRef.current(id));
    v.load()
      .then(() => {
        if (!alive) return;
        setReady(true);
        setStatus(v.getStatus());
      })
      .catch((e: unknown) => {
        if (alive) setFailed(e instanceof Error ? e.message : String(e));
      });
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      off();
      v.dispose();
      viewer.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v || !ready) return;
    const states: Partial<Record<VesselId, VesselState>> = {};
    for (const name of meshNames) {
      const s = vessels[name];
      states[name as VesselId] = s
        ? { probability: s.probability, band: s.band as Band, color: s.color, uncertaintyWidth: s.uncertaintyWidth }
        : { probability: 0, band: 'low', color: neutral, uncertaintyWidth: 1 };
    }
    v.setVessels(states);
    v.setOverall(overall ? { probability: overall.probability, band: overall.band as Band, color: overall.color } : null);
  }, [ready, vessels, overall, neutral, meshNames]);

  useEffect(() => {
    if (ready) viewer.current?.select((selectedMesh as VesselId | null) ?? null);
  }, [ready, selectedMesh]);

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
        <button type="button" className="tool-button" onClick={() => viewer.current?.resetView()} disabled={!ready}>
          Reset view
        </button>
        <span className="viewer-status" data-testid="viewer-status">
          {status
            ? `${status.usingFallback === 'none' ? 'Full model' : status.usingFallback === 'lite' ? 'Lite model' : 'Schematic fallback'} · ${status.webgl ? 'WebGL' : 'no WebGL'}`
            : 'Loading 3D view'}
        </span>
      </div>
    </div>
  );
}
