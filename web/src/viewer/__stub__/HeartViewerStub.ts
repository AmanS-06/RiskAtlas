// Placeholder with the same interface as web/src/viewer/HeartViewer.ts (the 3D viewer, owned by the viewer track).
// It draws a flat schematic with three clickable vessels so the dashboard can be built and tested without WebGL.
// Swap the real viewer in with one line in src/shared/viewerAdapter.ts.

export type Band = 'low' | 'moderate' | 'high';
export type VesselId = 'LAD' | 'LCX' | 'RCA';
export interface VesselState {
  probability: number;
  band: Band;
  color: string;
  uncertaintyWidth?: number;
}
export interface HeartViewerOptions {
  container: HTMLElement;
  modelUrl: string;
  liteModelUrl?: string;
  lowPower?: boolean;
  reducedMotion?: boolean;
}
export interface ViewerStatus {
  loaded: boolean;
  usingFallback: 'none' | 'lite' | 'procedural';
  webgl: boolean;
  triangles: number;
  fps?: number;
}

const NS = 'http://www.w3.org/2000/svg';
const PATHS: Record<VesselId, { d: string; label: [number, number] }> = {
  LAD: { d: 'M150 70 C 120 110, 112 160, 120 215', label: [96, 150] },
  LCX: { d: 'M150 70 C 100 80, 70 120, 76 180', label: [52, 112] },
  RCA: { d: 'M190 70 C 235 90, 245 150, 225 205', label: [236, 135] },
};

export class HeartViewer {
  private root: SVGSVGElement | null = null;
  private heart: SVGPathElement | null = null;
  private readonly vessels = new Map<VesselId, SVGPathElement>();
  private readonly cbs = new Set<(id: VesselId | null) => void>();
  private selected: VesselId | null = null;
  private loaded = false;

  constructor(private readonly opts: HeartViewerOptions) {}

  async load(): Promise<void> {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 260');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Placeholder heart schematic (3D viewer not loaded)');
    svg.style.cssText = 'width:100%;height:100%;display:block';
    this.heart = document.createElementNS(NS, 'path');
    this.heart.setAttribute('d', 'M150 60 C 90 20, 20 70, 70 150 C 100 195, 135 225, 150 245 C 165 225, 200 195, 230 150 C 280 70, 210 20, 150 60 Z');
    this.heart.setAttribute('fill', 'currentColor');
    this.heart.setAttribute('fill-opacity', '0.08');
    this.heart.setAttribute('stroke', 'currentColor');
    this.heart.setAttribute('stroke-opacity', '0.5');
    this.heart.setAttribute('stroke-width', '2');
    svg.appendChild(this.heart);
    for (const [id, spec] of Object.entries(PATHS) as [VesselId, (typeof PATHS)[VesselId]][]) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', spec.d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-opacity', '0.4');
      p.setAttribute('stroke-width', '9');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('data-vessel', id);
      p.style.cursor = 'pointer';
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(id);
        this.cbs.forEach((cb) => cb(id));
      });
      const t = document.createElementNS(NS, 'text');
      t.textContent = id;
      t.setAttribute('x', String(spec.label[0]));
      t.setAttribute('y', String(spec.label[1]));
      t.setAttribute('fill', 'currentColor');
      t.setAttribute('font-size', '13');
      t.setAttribute('font-weight', '600');
      svg.append(p, t);
      this.vessels.set(id, p);
    }
    svg.addEventListener('click', () => {
      this.select(null);
      this.cbs.forEach((cb) => cb(null));
    });
    this.opts.container.replaceChildren(svg);
    this.root = svg;
    this.loaded = true;
  }

  setVessels(states: Partial<Record<VesselId, VesselState | undefined>>): void {
    for (const [id, st] of Object.entries(states) as [VesselId, VesselState | undefined][]) {
      const p = this.vessels.get(id);
      if (!p) continue;
      if (!st) {
        // an explicit undefined clears the vessel back to neutral, as the real viewer does
        p.setAttribute('stroke', 'currentColor');
        p.setAttribute('stroke-opacity', '0.4');
        p.removeAttribute('data-band');
        p.removeAttribute('data-probability');
        continue;
      }
      p.setAttribute('stroke', st.color);
      p.setAttribute('stroke-opacity', String(1 - Math.min(0.6, st.uncertaintyWidth ?? 0)));
      p.setAttribute('data-band', st.band);
      p.setAttribute('data-probability', st.probability.toFixed(3));
    }
  }

  setOverall(state: { probability: number; band: Band; color: string } | null): void {
    if (!this.heart) return;
    this.heart.setAttribute('fill', state ? state.color : 'currentColor');
    this.heart.setAttribute('fill-opacity', state ? '0.25' : '0.08');
    this.heart.setAttribute('data-band', state?.band ?? '');
  }

  select(id: VesselId | null): void {
    this.selected = id;
    for (const [v, p] of this.vessels) p.setAttribute('stroke-width', v === id ? '15' : '9');
  }

  onSelect(cb: (id: VesselId | null) => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  resetView(): void {
    this.select(null);
  }

  resize(): void {}

  getStatus(): ViewerStatus {
    return { loaded: this.loaded, usingFallback: 'procedural', webgl: false, triangles: 0 };
  }

  get selection(): VesselId | null {
    return this.selected;
  }

  dispose(): void {
    this.cbs.clear();
    this.root?.remove();
    this.root = null;
    this.vessels.clear();
    this.loaded = false;
  }
}
