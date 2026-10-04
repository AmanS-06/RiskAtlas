// In-canvas vessel labels: small DOM chips pinned to the arteries. Purely presentational (aria-hidden): the dashboard and the viewer's own
// live region already name and announce every vessel, so a screen reader gains nothing from a second, positional copy of the same text.
// For sighted users the chips are a non-colour cue (the name, and the percentage when a prediction exists).

import type { VesselId } from './types';
import { chooseLabelSpot, separateChips } from './viewerLogic';
import type { ChipRect } from './viewerLogic';

export interface LabelItem {
  id: VesselId;
  text: string;
  color: string;
  selected: boolean;
  visible: boolean;
  /** anchor on the artery, CSS px from the container's top-left */
  x: number;
  y: number;
}

interface Entry { root: HTMLElement; chip: HTMLElement; line: HTMLElement; dot: HTMLElement; w: number; h: number; sig: string }

const CHIP_CSS = 'position:absolute;left:0;top:0;padding:3px 7px 3px 6px;border-radius:5px;background:rgba(12,16,22,0.88);color:#fff;font:600 12px/1.1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 1px 3px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.4);border-left-width:4px';

export class LabelOverlay {
  readonly el: HTMLElement;
  private readonly entries = new Map<VesselId, Entry>();

  constructor(container: HTMLElement) {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.dataset.viewerLabels = '';
    // zero-size anchor at the top-left corner (chips are absolutely placed inside the container's box): a full-size overlay would be a second full-canvas compositing layer, which costs frame rate on software GL
    el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;user-select:none';
    container.appendChild(el);
    this.el = el;
  }

  /** Positions are written only when something changed, so a still camera costs no DOM work. `centre` = screen position of the heart centre, `obstacles` = screen points of vessel vertices that chips should not cover. */
  update(items: LabelItem[], centre: { x: number; y: number }, box: { w: number; h: number }, obstacles: readonly { x: number; y: number }[] = []): void {
    const shown: { it: LabelItem; e: Entry; textSig: string }[] = [];
    for (const it of items) {
      const e = this.entries.get(it.id) ?? this.create(it.id);
      if (!it.visible) {
        if (e.root.style.display !== 'none') e.root.style.display = 'none';
        e.sig = '';
        continue;
      }
      const textSig = `${it.text}|${it.color}|${it.selected}`;
      if (e.sig.split('@')[0] !== textSig) {
        e.chip.textContent = it.text;
        e.chip.style.borderColor = it.selected ? '#fff' : 'rgba(255,255,255,.4)';
        e.chip.style.borderLeftColor = it.color;
        e.chip.style.fontWeight = it.selected ? '800' : '600';
        e.chip.style.boxShadow = it.selected ? '0 0 0 2px rgba(12,16,22,.9), 0 1px 4px rgba(0,0,0,.5)' : '0 1px 3px rgba(0,0,0,.4)';
        e.dot.style.background = it.color;
        e.root.style.zIndex = it.selected ? '2' : '1';
        e.root.style.display = '';
        e.w = e.chip.offsetWidth; e.h = e.chip.offsetHeight;
      }
      e.root.style.display = '';
      shown.push({ it, e, textSig });
    }
    const taken: ChipRect[] = [];
    for (const { it, e } of shown) {
      const p = chooseLabelSpot({ x: it.x, y: it.y }, centre, { w: e.w, h: e.h }, box, obstacles, taken);
      taken.push({ x: p.x, y: p.y, w: e.w, h: e.h });
    }
    const spread = separateChips(taken, box); // safety net: chips of nearby vessels must never cover each other
    shown.forEach(({ it, e, textSig }, i) => {
      const p = spread[i];
      const sig = `${textSig}@${p.x.toFixed(1)},${p.y.toFixed(1)},${it.x.toFixed(1)},${it.y.toFixed(1)}`;
      if (sig === e.sig) return;
      e.sig = sig;
      e.root.style.transform = `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px)`;
      e.line.style.width = `${Math.hypot(p.x - it.x, p.y - it.y).toFixed(1)}px`;
      e.line.style.transform = `rotate(${Math.atan2(p.y - it.y, p.x - it.x).toFixed(4)}rad)`;
      e.chip.style.transform = `translate(${(p.x - it.x - e.w / 2).toFixed(1)}px,${(p.y - it.y - e.h / 2).toFixed(1)}px)`;
    });
  }

  hideAll(): void {
    for (const e of this.entries.values()) { e.root.style.display = 'none'; e.sig = ''; }
  }

  dispose(): void {
    this.el.remove();
    this.entries.clear();
  }

  private create(id: VesselId): Entry {
    const root = document.createElement('div');
    root.dataset.label = id; // not data-vessel: the web app's tests use that attribute for the stub viewer's SVG paths
    root.style.cssText = 'position:absolute;left:0;top:0;display:none';
    const line = document.createElement('i');
    line.style.cssText = 'position:absolute;left:0;top:-0.75px;height:1.5px;width:0;transform-origin:0 50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 .5px rgba(12,16,22,.7)';
    const dot = document.createElement('i');
    dot.style.cssText = 'position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;border:1.5px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px rgba(12,16,22,.8)';
    const chip = document.createElement('span');
    chip.style.cssText = CHIP_CSS;
    root.append(line, dot, chip);
    this.el.appendChild(root);
    const e: Entry = { root, chip, line, dot, w: 40, h: 20, sig: '' };
    this.entries.set(id, e);
    return e;
  }
}
