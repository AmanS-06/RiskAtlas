// Demo harness: three sliders drive the viewer. Band ids, labels and colours come from config/risk_bands.yaml and
// the per-vessel cut points from models/metadata.json, both through viewer-config.generated.json (npm run gen).
import cfg from './viewer-config.generated.json';
import { HeartViewer } from '../src/viewer';
import type { Band, VesselId, VesselState } from '../src/viewer';

interface Cfg { bands: { id: string; label: string; color: string }[]; vessels: { id: string; label: string; rule_out: number; rule_in: number }[]; overall: { label: string; rule_out: number; rule_in: number } }
const C = cfg as unknown as Cfg;

const bandFor = (p: number, t: { rule_out: number; rule_in: number }) => (p < t.rule_out ? C.bands[0] : p >= t.rule_in ? C.bands[2] : C.bands[1]);

const params = new URLSearchParams(location.search);
const flag = (k: string): boolean | undefined => (params.has(k) ? params.get(k) === '1' : undefined);
const lite = params.get('lite');

const stage = document.getElementById('stage')!;
const viewer = new HeartViewer({
  container: stage,
  modelUrl: params.get('model') ?? 'models3d/heart.glb',
  liteModelUrl: lite === 'none' ? undefined : (lite ?? 'models3d/heart_lite.glb'),
  lowPower: flag('lowPower'),
  reducedMotion: flag('reduced'),
  // appearance options (all optional; defaults are the recommended look)
  bodyStyle: params.get('body') === 'natural' ? 'natural' : undefined,
  labels: (['off', 'name', 'risk'] as const).find((l) => l === params.get('labels')),
  vesselBoost: params.has('boost') ? Number(params.get('boost')) : undefined,
  showHidden: flag('hidden'),
  fill: params.has('fill') ? Number(params.get('fill')) : undefined,
});
// handles for the browser tests (e2e/)
Object.assign(window, { __viewer: viewer, __HeartViewer: HeartViewer });

const probs: Record<string, number> = { LAD: 0.76, LCX: 0.38, RCA: 0.1 };
let width = 0.05;

const rows = document.getElementById('rows')!;
for (const v of C.vessels) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<label for="s-${v.id}"><span>${v.id} <small>${v.label}</small></span><output id="o-${v.id}"></output></label>
    <input id="s-${v.id}" type="range" min="0" max="100" step="1" value="${Math.round(probs[v.id] * 100)}" aria-label="${v.id} probability">
    <div class="state"><span class="swatch" id="w-${v.id}"></span><span id="t-${v.id}"></span></div>`;
  rows.appendChild(row);
  row.querySelector('input')!.addEventListener('input', (e) => { probs[v.id] = Number((e.target as HTMLInputElement).value) / 100; update(); });
}
const btns = document.getElementById('btns')!;
const selBtns = new Map<string, HTMLButtonElement>();
for (const v of C.vessels) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = v.id; b.setAttribute('aria-pressed', 'false'); b.id = `sel-${v.id}`;
  b.addEventListener('click', () => viewer.select(b.getAttribute('aria-pressed') === 'true' ? null : (v.id as VesselId)));
  btns.appendChild(b); selBtns.set(v.id, b);
}
const unc = document.getElementById('unc') as HTMLInputElement;
unc.addEventListener('input', () => { width = Number(unc.value); update(); });
document.getElementById('reset')!.addEventListener('click', () => viewer.resetView());
const themeBtn = document.getElementById('theme')!;
themeBtn.addEventListener('click', () => {
  const dark = themeBtn.getAttribute('aria-pressed') !== 'true';
  themeBtn.setAttribute('aria-pressed', String(dark));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
});

function update(): void {
  const states: Partial<Record<VesselId, VesselState>> = {};
  let max = 0;
  for (const v of C.vessels) {
    const p = probs[v.id], b = bandFor(p, v);
    states[v.id as VesselId] = { probability: p, band: b.id as Band, color: b.color, uncertaintyWidth: width };
    max = Math.max(max, p);
    document.getElementById(`o-${v.id}`)!.textContent = `${Math.round(p * 100)}%`;
    (document.getElementById(`w-${v.id}`) as HTMLElement).style.background = b.color;
    document.getElementById(`t-${v.id}`)!.textContent = b.label;
  }
  viewer.setVessels(states);
  // demo only: the overall CAD probability is at least the strongest vessel (the models guarantee P(vessel) <= P(CAD))
  const ob = bandFor(max, C.overall);
  viewer.setOverall({ probability: max, band: ob.id as Band, color: ob.color });
  document.getElementById('unc-out')!.textContent = width.toFixed(2);
}

viewer.onSelect((id) => {
  for (const [k, b] of selBtns) b.setAttribute('aria-pressed', String(k === id));
  refreshStatus();
});

// anchors: the viewer draws its own in-canvas labels; the harness only exposes the anchor positions to the browser tests (e2e/)
viewer.setAnchors(C.vessels.map((v) => ({ key: v.id, node: v.id })));
viewer.onAnchors((list) => { Object.assign(window, { __anchors: list }); });

function refreshStatus(): void {
  document.getElementById('status')!.textContent = JSON.stringify(viewer.getStatus(), null, 1);
}
update();
viewer.load().then(refreshStatus);
setInterval(refreshStatus, 1000);
