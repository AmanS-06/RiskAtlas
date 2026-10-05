# RiskAtlas 3D viewer

`web/src/viewer/` is a framework-free three.js class, `HeartViewer`, that draws an interactive heart with the
three coronary arteries LAD, LCX and RCA colour-coded from model output. It is built for Track A's 3D requirement
and for the constraint "responsive without a dedicated GPU". Everything numeric in this file was measured by the
tests in `web/viewer-demo/` (section 9) or computed by the scripts named next to it.

> Predictions are **per vessel**. The models do not say where in a vessel a lesion is, and the viewer never implies
> it: the whole artery (all of its branches) takes one colour. Decision support and educational use only.

## 1. Use it

Runtime dependency: `three` (pinned `0.186.1`). The viewer imports `three` and
`three/examples/jsm/{controls/OrbitControls,loaders/GLTFLoader,utils/BufferGeometryUtils}.js`, which all ship in the
`three` package. Nothing is loaded from a CDN.

```ts
import { HeartViewer } from './viewer';           // web/src/viewer/index.ts
import type { VesselId, VesselState } from './viewer';

const viewer = new HeartViewer({
  container: document.getElementById('heart')!,    // needs an explicit size (CSS height)
  modelUrl: '/models3d/heart.glb',                 // web/public/models3d/ (use import.meta.env.BASE_URL if not at /)
  liteModelUrl: '/models3d/heart_lite.glb',
});
await viewer.load();                               // never rejects; check getStatus()

// from the API response (reports/example_prediction.json shape) and /meta (risk_bands.yaml colours)
const states: Partial<Record<VesselId, VesselState>> = {};
for (const id of ['LAD', 'LCX', 'RCA'] as const) {
  const t = response.output.targets[id];
  states[id] = { probability: t.probability, band: t.band, color: bandColour[t.band], uncertaintyWidth: t.uncertainty?.width };
}
viewer.setVessels(states);
const cad = response.output.targets.CAD;
viewer.setOverall({ probability: cad.probability, band: cad.band, color: bandColour[cad.band] });
const off = viewer.onSelect((id) => showVesselCard(id));   // id is 'LAD' | 'LCX' | 'RCA' | null
```

React (strict-mode safe, `dispose()` is idempotent and `load()` after dispose is harmless):

```tsx
useEffect(() => {
  const v = new HeartViewer({ container: ref.current!, modelUrl, liteModelUrl });
  v.load();
  setViewer(v);
  return () => v.dispose();
}, []);
```

Integration notes:

- **Pass `lowPower: undefined` unless you have a reason.** `undefined` lets the viewer pick the cheap path on software
  GL (roughly two to three times the frame rate, section 6). An explicit `false` forces full quality even on a CPU rasteriser. A
  heuristic that returns `false` on ordinary machines, such as "few cores or little memory", should be passed as
  `lowPower: heuristic() ? true : undefined`.
- The viewer replaces the container's `role` and `aria-label` while it is alive and restores the previous values on
  `dispose()`. Put your own description in a visible heading or `aria-describedby`, not in the container's label.
- It observes the container itself; calling `resize()` from your own `ResizeObserver` is unnecessary (harmless). On every resize the camera is re-framed for the new shape (section 3b), so the container may change size freely (a taller stage, an "enlarge" mode, a rotated phone).
- `getStatus().usingFallback` is `'none'`, `'lite'` or `'procedural'`; show it if you want, it is not an error state.

Run the harness: `cd web/viewer-demo && npm ci && npm run dev` (http://127.0.0.1:5174). Query switches for
experiments: `?lowPower=0|1`, `?reduced=1`, `?model=<url>`, `?lite=<url>|none`, and for the appearance options of
section 3a `?body=natural`, `?labels=off|name|risk`, `?boost=<number>`, `?hidden=0|1`.

## 2. Public contract

Exported from `HeartViewer.ts` (also `index.ts`). Types: `Band`, `VesselId`, `VesselState`, `HeartViewerOptions` as
specified, plus `OverallState`, `ViewerStatus`, `FallbackLevel`, `AnchorSpec`, `ScreenAnchor`.

| Member | Behaviour |
|---|---|
| `new HeartViewer({container, modelUrl, liteModelUrl?, lowPower?, reducedMotion?, bodyStyle?, vesselBoost?, labels?, showHidden?, fill?})` | The last five are optional appearance options, section 3a (defaults are the recommended look; passing none changes nothing about the contract). Creates the canvas inside `container`, sets `role="application"`, an `aria-label`, `tabindex=0` (if none) and `position:relative` (if static), and an aria-live region. `lowPower` default: automatic, true on software GL. `reducedMotion` default: the OS `prefers-reduced-motion` setting, read once. |
| `load(): Promise<void>` | Standard GLB, then lite, then the built-in procedural heart (order reversed when `lowPower`, see 6). A GLB without mesh nodes named `LAD`, `LCX`, `RCA` is rejected with a `console.error` naming the missing nodes and the next fallback is tried. 20 s timeout per file. Never rejects. Safe to call twice. |
| `setVessels(states)` | Merges: vessels not mentioned are unchanged, an explicit `undefined` value clears one to neutral grey. Cheap: writes material colours, no geometry or material is re-created. Colours must be `#rgb` or `#rrggbb`, otherwise that entry is ignored with a warning. Works before `load()` (applied on load). |
| `setOverall(state \| null)` | Heart-level glow, see 4. `null` removes it. |
| `select(id \| null)` | Highlights the vessel (outline, pulse, brighter), turns the camera to face it, announces it. `onSelect` fires when the selection actually changes, whether it came from a click, a key or this method (so do not call `select` from an `onSelect` callback with a different value). Unknown ids are ignored with a warning. |
| `onSelect(cb)` | Returns the unsubscribe function. A throwing callback does not affect the others. |
| `setAnchors(specs: {key, node}[])`, `onAnchors(cb)` | Pins callouts to mesh nodes, see 8. `cb` gets `{key, node, x, y, visible}[]`, CSS px from the container's top-left, whenever any position changes. |
| `resetView()` | Animates (or jumps, when reduced motion) to the home pose. Does not change the selection. |
| `resize()` | Re-measures the container, re-frames the camera for its new shape (section 3b) and redraws synchronously. Also automatic through a `ResizeObserver`. |
| `getStatus()` | `{loaded, usingFallback: 'none'\|'lite'\|'procedural', webgl, triangles, fps?}`. `usingFallback:'lite'` is also reported when lite was chosen by `lowPower`, not only after a failure. `fps` is only present while frames are being drawn continuously (orbiting, tween). |
| `getFraming()` | Diagnostics (added with the framing work, optional to use): `{width, height, distance, autoDistance, direction, fitted, silhouette}`. `silhouette` is the projected extent of the whole model (aorta and arteries included) in CSS px from the canvas's top-left, `fitted` is true while the camera is at the auto-fit distance. The tests use it; apps do not need it. |
| `dispose()` | Cancels frames and timers, removes every listener and observer, disposes geometries, materials and the renderer, forces the GL context loss, removes everything it added to `container` and restores the attributes it set. Idempotent. All methods are no-ops afterwards. |

Deviations from the requested contract: none. Additions: `OverallState` and the anchor types, `onAnchors`
(the contract left `setAnchors` open), the semantics stated above for `setVessels`, `lowPower`, `onSelect`, and the
five optional options (`bodyStyle`, `vesselBoost`, `labels`, `showHidden`, section 3a; `fill`, section 3b) with the types
`BodyStyle`, `LabelMode` and `ViewerFraming`, and the `getFraming()` diagnostic. Every method and every existing option behaves as before.

## 3. Colour and uncertainty

The caller owns every colour and band; the viewer holds no risk colour, no threshold and no band name (it draws a vessel
without a state in light neutral grey, the outline in white and near-black, the body in a neutral slate, section 3a).
The only band logic is the order `low` < `moderate` < `high`, used for the heart-level glow (section 4). The vessel
ids `LAD | LCX | RCA` are the only hardcoded names. They are the `mesh` values of `config/manifest.yaml`; this is
enforced twice: at load time the viewer checks the model's node names and logs a clear error if one is missing, and
`web/src/viewer/models.test.ts` fails if the type, the manifest and both shipped `.glb` files disagree.

**Uncertainty.** `uncertaintyWidth` (the API's `uncertainty.width`, a 10th to 90th percentile interval, 0 to 1)
desaturates the vessel colour toward the grey of equal luminance, in linear light:

```
t       = clamp((width - 0.05) / (0.35 - 0.05), 0, 1)
amount  = 0.8 * t * t * (3 - 2t)                      (smoothstep, so 0 up to width 0.05, 0.8 from width 0.35)
c'      = c + (Y(c) - c) * amount                     per linear channel, Y = 0.2126 R + 0.7152 G + 0.0722 B
```

Luminance is unchanged, so a vessel never looks lighter or darker because it is uncertain, and `amount < 1` keeps a
trace of hue so bands stay distinguishable. The constants are `UNCERTAINTY` in `viewerLogic.ts`. They were chosen from
the single example in `reports/example_prediction.json` (widths 0.05 to 0.18), not from a distribution:
see `docs/viewer_findings.md` item 5.

**Rendered colour is not exactly the legend hex.** Vessels are lit (hemisphere light, a camera-attached light, and an
emissive term of 0.3 to 0.7 times the colour), so a face-on pixel is close to, not equal to, the supplied hex. The
legend swatches should still use the hex; they match by hue and band ordering (verified by pixel read-back,
section 9).

## 3a. Making the arteries the focus (appearance options)

Problem seen in the first app screenshots: a pale pink heart with thin dark-pink arteries, so the risk colours barely
stood out and the three vessels were hard to tell apart. What the viewer does now, each measured below:

| Change | Why | Cost / limit |
|---|---|---|
| **Neutral body** (`bodyStyle: 'neutral'`, default). Chambers `#728092`, great vessels `#909aaa`, left main stem `#4c5461`, unscored arteries light grey `#c9ced6` (`BODY_NEUTRAL`, `UNSCORED_VESSEL` in `viewerLogic.ts`). `'natural'` restores the GLB's pink. | The three band colours become the only saturated colours in the scene. A *mid-dark* slate on purpose: amber and green sit at L* 62 to 70, so a mid-light grey body (tried first, `#a9b2be`) left amber only 26 delta E from the body and the pale-blue safe-palette colour even closer; against the slate each band colour is lighter or more saturated. | A viewer constant, not data. It carries no risk meaning; risk colours still come only from the app. |
| **Calibre exaggeration** (`vesselBoost`, default 1 = 0.006 model units along the smooth normal). | At default zoom arteries were 3 to 5 px wide. Thin branches now stay visible: 1.8 times the vessel pixels at boost 1 against boost 0, 2.6 times at boost 2 (13,043 / 7,181 pixels at 1180x760). `0` draws the modelled calibre. | Visual only: picking, anchors, the triangle budget (23,283 / 6,691, asserted) are unaffected. The arteries are drawn wider than anatomical; this is an atlas-style schematic and the doc says so. |
| **Rim light and view-space lift** on the vessel material. A fresnel rim in the vessel's own lightened colour makes tubes read as round; `lift` (0.02 model units toward the camera) keeps an artery that is slightly buried in the surface (the decimated lite model) from being cut off by the heart wall. | Edge definition on any body colour; fewer broken-up arteries. | Both are in the existing standard/Lambert material through `onBeforeCompile`, no extra pass. |
| **Permanent thin dark edge** around every artery (full-quality mode only). | Separates the colour from the body on screenshots and projectors. | One extra pass over the arteries; skipped on software GL. |
| **Hidden-artery ghost** (`showHidden`, default true, false in low-power mode). Arteries behind the heart wall are drawn again at 32% opacity, flat colour, only where the wall hides them (`depthFunc: GreaterDepth`). | From any side all three arteries remain visible, and their colour tells the risk even when the artery is behind the surface. Translucent chambers were considered and rejected: they wash the colour of every vessel and need depth sorting between overlapping double-sided meshes. | One transparent pass over the arteries; together with the edge pass, full quality is 4 to 17% slower (section 6). |
| **In-canvas labels** (`labels`, default `'risk'`): a small chip per artery, "LAD 76%" (`'name'`: "LAD"), pinned to a visible point of the artery with a leader line. A coloured stripe repeats the band colour; the name and number identify the artery without colour. | A judge reads the artery and its risk at a glance, and a colour-blind viewer has the number. | See below. |
| **Overall-glow tint damped** to 35% of its old strength on the neutral body (`NEUTRAL_TINT_SHARE`). | The tint turned the grey body pink again. The halo behind the heart still carries the overall state. | |
| **Home view** turned from (0.5, 0.3, 1) to (0.85, 0.3, 1). | The LCX runs on the left edge: from the old pose only a sliver showed, so a high-risk LCX was easy to miss. | The RCA stays on the front face. |

**Labels, in detail.** Each label sits on one of 20 sample points spread over its artery (farthest-point sampling,
starting at the vertex nearest the artery's centroid, so the trunk is preferred). A point is usable if it faces the
camera and a ray from the camera to it is not blocked by the heart wall (a body hit more than 0.03 model units in front
of it blocks, because arteries sit partly in the surface). The label stays on its point while that point stays visible
(no jumping), otherwise it moves to the next visible candidate, and is hidden when none is visible, so a label never
points at a vessel that cannot be seen (tested over 8 views around the heart by reading the canvas pixel at each label
anchor). The chip is placed in one of 8 directions around the anchor so it covers the fewest vessel vertices
and no other chip (`chooseLabelSpot`), then pushed apart from neighbours (`separateChips`) and kept inside the container.
Positions are recomputed at most every 100 ms while the camera moves, plus once when it stops (a timer, not a frame:
the viewer still draws 0 frames when idle).

**Accessibility of the labels.** The overlay is `aria-hidden="true"` and `pointer-events:none`. That is deliberate: the
dashboard already lists every vessel with its band and probability, the viewer's own live region announces selections
("LAD selected. high risk, probability 76 percent."), and the container's `aria-label` names the arteries, so a screen
reader gains nothing from a second, positional copy of the same text, and a moving chip would be read out of order. For
sighted users, including colour-blind ones, the chip is a non-colour cue. Reduced motion does not hide labels (they do
not animate; they just follow the camera, which reduced motion already freezes between user actions). Chips have white
text on 88% near-black with a white border, about 15:1, and do not depend on the page theme. The overlay uses the
attribute `data-label`, not `data-vessel` (the web app's tests use `data-vessel` for the stub viewer's SVG).

**Colour separation, measured** (pixel read-back of the WebGL canvas, median colour of the pixels of each band
colour and of the body, CIE76 delta E; `web/viewer-demo/e2e/appearance.e2e.test.ts`; the canvas is transparent, so the
vessel-body numbers are the same in the light and dark theme; the body against the app's `--viewer-bg` tokens is 36.1
(light `#e6edf5`) and 53.2 (dark `#0a1018`)):

| Palette, vision | high-body | moderate-body | low-body | high-moderate | moderate-low | high-low |
|---|---|---|---|---|---|---|
| config bands, normal | 65.2 | 29.0 | 43.7 | 55.0 | 37.3 | 92.3 |
| config bands, protanopia | 27.7 | 29.0 | 27.5 | 8.5 | 6.2 | 14.0 |
| config bands, deuteranopia | 43.3 | 29.6 | 19.9 | 13.8 | 9.8 | 23.4 |
| config bands, tritanopia | 82.3 | 17.1 | 30.0 | 65.4 | 45.7 | 110.8 |
| safe palette (`--safe-band-*`), normal | 56.0 | 28.0 | 32.4 | 51.2 | 47.8 | 81.5 |
| safe palette, protanopia | 28.9 | 27.7 | 31.7 | 30.8 | 46.8 | 60.4 |
| safe palette, deuteranopia | 31.0 | 28.8 | 30.4 | 17.1 | 46.9 | 57.3 |
| safe palette, tritanopia | 71.8 | 18.9 | 34.7 | 53.7 | 47.6 | 99.8 |

The tests assert, for normal vision, every vessel against the body above 22 (moderate-body is the weakest, 28 to 29) and
every pair above 30; under all three deficiencies every vessel against the body above 15; and for the safe palette
every pair above 12 under deficiencies (crimson against orange under deuteranopia, 17, is its weakest). The config
palette's pairwise collapse under red-green deficiency (moderate-low 6 to 10, high-moderate 8 to 14 in the rendered
canvas; `docs/viewer_findings.md` item 3 has the swatch-level numbers) is a property of the palette that the app
passes in, not of the viewer: the labels' numbers and the app's colour-blind-safe palette are the mitigations, and the
viewer deliberately does not recolour what it is given.

## 3b. Camera framing (size of the heart in its box)

The viewer fits the camera to the heart, not to a bounding sphere. A bounding sphere around a heart with its aorta is 30 to 40
percent looser than the silhouette, and the old fit (`fitDistance(radius * 0.8)`) was also computed once, for the size the
container had at load. Now:

- **What is fitted.** About 190 extreme points of the whole model (`supportPoints`: the vertex furthest along evenly spread
  directions, a stand-in for the convex hull; aorta, arteries and chambers all included) are projected through the real perspective
  camera. `fitPoints` returns the smallest distance at which every one lies within `fill` of the half-extent of the canvas, in
  both directions, and for the home view also moves the look-at point so the silhouette is centred (the aorta makes it
  asymmetric). Exact, not iterative in distance; a few cheap passes only for the centring.
- **`fill`** (option, default `0.88`, clamped to 0.5 to 0.98): the share of the **limiting** canvas dimension the silhouette
  fills at the home view. The heart is tall and narrow, so in a wide box the height limits and the width is about 40 to 55
  percent used; in a phone-shaped box the width limits. The remaining 6 percent per side keeps the label chips (which are
  clamped into the canvas by `chooseLabelSpot` / `separateChips`) and the halo inside. Measured on the rendered pixels in the
  browser tests: 87.8 to 88.2 percent for every box from 286x318 to 1200x400.
- **When it is re-fitted.** (1) At load and on `resetView()` (the tween ends at the fit for the current box). (2) On every resize:
  at the home view the pose is re-fitted from scratch; if the user orbited or panned but did **not zoom**, the camera is still at
  the auto-fit distance (within 2 percent), so the **orbit angle is kept and only the distance is re-fitted** for it; if the user
  deliberately zoomed or a vessel is focused, the zoom is kept relative to the canvas instead (distance scaled by the ratio of the
  bounding-sphere fits of the two shapes, so the same share of the heart stays in frame); a running camera tween is retargeted.
  Rule of thumb: "fitted" means "distance equals the last auto-fit distance"; `getFraming().fitted` reports it.
- **Zoom limits** follow the fit: closest = min(0.8, 0.4 x fit), farthest = max(6 x radius, 2.5 x fit), so you can always get about
  2.5 times closer than the fit and at least 2.5 times further out, whatever the box shape. Tested: 50 zoom-out and 100 zoom-in
  key presses reach at least 2x out and 0.5x in.
- **Render on demand is unchanged**: a resize draws once (synchronously) and then the viewer is idle again (tested: 0 frames and
  0 rAF requests in 1.5 s after a resize).

Numbers (headless Chromium, software GL, demo harness, opaque pixels of the canvas; limiting dimension = max of width and height share):

| Canvas (CSS px) | before | after |
|---|---|---|
| 813 x 405 (old sticky column at 1920x1030) | 82.9 % | 88.1 % |
| 660 x 257 (old column at 1440x900) | 83.1 % | 88.2 % |
| 400 x 500 (tall) | 75.4 % | 88.4 % |
| 300 x 600 (phone shaped) | 76.8 % | 87.9 % |
| 500 x 500 (square) | 82.9 % | 88.0 % |

The old fit was already tight in the height of a wide box; what looked like "60 percent" is the heart's width in a wide box (about 40 to
55 percent after the change as well, because the heart is narrow) and the small box itself. The gains are the taller box (see
`docs/web.md`, Layout), the 88 percent fill, and the correct fit on tall and phone-shaped boxes.

## 4. Heart-level glow (`setOverall`)

A soft halo behind the heart plus a faint tint of the chambers. Opacity **and size** grow with probability, so the
halo carries information without colour: `halo opacity = 0.2 + 0.75 p`, `halo size = (2.1 + 0.9 p) x heart radius`,
`chamber tint = 0.05 + 0.17 p` (x1.6 in low-power mode, which has no halo; x0.35 on the neutral body, section 3a).

**Never visually weaker than the strongest vessel.** The glow takes the colour of the strongest of
`{overall, LAD, LCX, RCA}`, where "strongest" means the higher band (`low` < `moderate` < `high`), then the higher
probability, ties to the overall state, and it takes the highest probability of all of them for its opacity, size and
tint (`overallGlow()` in `viewerLogic.ts`; unit-tested, and checked by pixel read-back in the browser test). Bands
are compared as well as probabilities because each target has its own cut points (`models/metadata.json`
`rule_out` / `rule_in`, for example CAD `0.40 / 0.79` against LCX `0.20 / 0.56`): a vessel can sit in a higher band
than CAD while `P(vessel) <= P(CAD)` still holds, and then the glow follows the vessel's colour instead of showing a
calmer colour than the vessel beneath it. `null` means no glow.

## 5. Interaction

| Input | Effect |
|---|---|
| Drag / one-finger drag | Rotate (OrbitControls, damping off under reduced motion) |
| Wheel / pinch | Zoom, from 0.8 model units (the heart is about 1 unit wide) to 6 bounding-sphere radii from the centre |
| Right-drag / two-finger drag | Pan, clamped so the heart cannot leave the view |
| Click / tap a vessel | Select it. Hits within 6 px (14 px for touch) of a vessel count, because arteries are about 5 px wide. A vessel hidden behind the heart cannot be hit (the ray takes the first surface it meets) |
| Click / tap empty space or the heart body | Clear the selection |
| Hover (mouse) | Pointer cursor and a white outline on a vessel; a faint lift on a chamber. Chambers are never selectable. The in-canvas labels never take the pointer |
| `1` `2` `3` | Select LAD, LCX, RCA (order of `VESSEL_IDS`) |
| `Escape` | Clear selection |
| Arrow keys | Rotate |
| `+` / `-` (also `=`) | Zoom |
| `0` | Reset view |

Keys work when the container has focus (a click on the canvas focuses it; Tab reaches it) and are ignored with
Ctrl, Alt or Meta held and when the key event comes from UI placed inside the container.

**The selected vessel does not depend on colour:** it gets a two-tone outline (white next to the vessel, dark outside
it, so it shows on light and dark pages), a brighter emissive level, three emissive pulses (skipped under reduced
motion), its label chip gets a heavier border and weight, and the camera turns to face it. Verified by pixel counts in the browser test.

## 6. Rendering policy, fallbacks and performance

- **On demand.** A frame is requested only when something changed: new state, resize, camera movement or damping,
  the 0.5 s camera tween, the three-pulse selection animation, hover change. There is no standing animation loop.
  Measured: an idle viewer draws 0 frames and schedules 0 `requestAnimationFrame` callbacks in 1.5 s.
- **Software GL detection.** A throwaway context reads `WEBGL_debug_renderer_info`; SwiftShader, llvmpipe, softpipe,
  "Basic Render Driver" count as software. Then antialiasing is off (also when `lowPower` is forced to false).
- **`lowPower`** (default: automatic = software GL): lite model first, Lambert instead of PBR materials, no halo
  (stronger tint instead), pixel ratio 1, 0.8 MP drawing-buffer budget. Otherwise: standard model, PBR materials,
  halo, pixel ratio up to 1.5, 1.8 MP budget. Above the budget the drawing buffer is rendered smaller and scaled up
  by CSS, so a 4K screen costs the same as 1.8 MP.
- **Fallback chain**, reported by `getStatus().usingFallback`: `none` (standard GLB) -> `lite` -> `procedural` (a
  stylised heart built in code, same node names, so selection, anchors and colouring behave identically). If even that
  fails (it cannot, short of a WebGL failure) `loaded` is false and the text fallback below is shown.
- **WebGL unavailable or context lost** never throws. `getStatus().webgl` is false and a text fallback element
  (`role="img"`, with an `aria-label`) fills the container, stating the situation and listing each vessel's band and
  percentage. Selection, `setVessels` and announcements keep working without WebGL. On `webglcontextlost` the viewer
  calls `preventDefault()` so the browser may restore the context; on `webglcontextrestored` the canvas comes back and
  the current state is drawn (tested with `WEBGL_lose_context`).

Measured numbers (headless Chromium 141 on a shared 4-vCPU VM with **no GPU**, WebGL2 through ANGLE/SwiftShader,
measured as frames drawn per second while the pointer orbits the heart continuously, which is the worst case; the
`TIMING` tests in `web/viewer-demo/e2e/viewer.e2e.test.ts`; the machine was shared with other jobs, treat as
order-of-magnitude, +-30%):

| Scenario (canvas about 830 x 530 CSS px unless stated) | run A | run B |
|---|---|---|
| default on software GL (auto low power: lite model, Lambert materials, no halo), 1280x800 window | 27.4 fps | 32.4 fps |
| `lowPower: true` with the standard model (`lite` disabled), 1280x800 | 17.1 fps | 22.2 fps |
| full quality forced (`lowPower: false`: standard model, PBR materials, halo), 1280x800 | 12.0 fps | 11.4 fps |
| default, 1920x1080 window (canvas about 1550 x 640, drawing buffer capped at 0.8 MP) | 14.7 fps | 15.1 fps |
| default, 390x844 phone viewport | 43.6 fps | 32.3 fps |

Run A and B are two complete runs of `npm run test:e2e` on the final code, a few minutes apart, with other jobs using
the same four vCPUs (load average 5 to 7), so expect about +-30%; the phone row shows how much a run can move. The
frame rate is counted as `WebGL clear()` calls per second while the pointer orbits the heart, which is one per
rendered frame; it agrees with `getStatus().fps` (the viewer's own median frame-interval meter) within about 20%.
For comparison, the research proof of concept measured 12 to 14 fps (standard model) and 16 fps (lite) at 1280x800
on the same kind of machine. Row 3 against row 2 is the cost of PBR materials plus the halo (30 and 49% slower in the two runs,
and in ad-hoc runs on a calmer moment: 13 to 17 fps against 24 to 28). Only the halo was isolated: adding it to
low-power mode cost about 30% (19 to 23 fps against 30 to 32). One pick (click or hover) costs about 3 ms. All of
this is the worst case, no GPU at all; hardware GL is expected to be faster and was not measured.

**Before and after the legibility pass (section 3a)**, same machine and session, the `TIMING` tests of the old commit
(`b795a64`, in a second worktree) and of this branch run back to back, twice each (frames per second while orbiting;
the VM was calmer than in runs A and B above, hence the higher absolute numbers):

| Scenario | before, run 1 / 2 | after, run 1 / 2 / final run | change |
|---|---|---|---|
| default on software GL (lite, low power), 1280x800 | 32.1 / 35.9 | 28.7 / 31.5 / 30.5 | -5 to -12% |
| `lowPower: true`, standard model, 1280x800 | 28.4 / 24.9 | 25.4 / 23.8 / 27.8 | within noise to -10% |
| full quality, 1280x800 | 18.4 / 17.9 | 15.6 / 14.9 / 17.7 | -4 to -17% (ghost and edge passes, which low power skips) |
| default, 1920x1080 | 20.8 / 21.5 | 21.1 / 18.7 / 19.7 | within noise to -13% |
| default, 390x844 phone | 59.2 / 60.1 | 56.1 / 56.4 / 55.6 | about -6% |

A finer A/B of the default scenario (8 orbit runs each, medians): before 37.2 fps, after 35.5 fps with labels, 37.0 with
`labels: 'off'`. The labels are the main cost (one DOM write per label per update, at most every 100 ms; the occlusion rays
cost about 1.3 ms per update). Things that were measured and removed to keep software GL at its old rate: the edge pass and
the ghost pass in low-power mode, a full-size label overlay layer (now a zero-size anchor), and per-frame label updates
(now throttled). The new rates stay inside the 27 to 32 fps band measured for the first version. Idle cost is unchanged
(0 frames, 0 `requestAnimationFrame` calls; the label throttle uses one `setTimeout`, not a frame). Triangle budget unchanged:
23,283 (standard) and 6,691 (lite); the extra passes reuse the vessel geometry (8,030 vessel triangles in the standard model,
1,668 in lite; drawn up to three times at full quality, once plus a rim shader in low power).

Page load to first drawn model on localhost (including the 680 kB JS bundle and parsing the GLB): standard 646 and
847 ms, lite 531 and 374 ms (runs A and B). Over a real network add the transfer of 561 kB (`heart.glb`, 311 kB with `gzip -9`) or 202 kB
(`heart_lite.glb`, 108 kB with `gzip -9`).

Models (`npm run validate` in `web/scripts`): `heart.glb` 560,588 bytes, 23,283 triangles, 22 meshes (draw calls),
glTF validator 0 errors 0 warnings. `heart_lite.glb` 201,916 bytes, 6,691 triangles, 22 meshes, 0 errors 0 warnings.
Procedural fallback: 23,040 triangles. Team limit is about 150k triangles. The demo's production bundle,
which is the viewer plus three.js plus about 100 lines of demo code, is 680.7 kB (174.5 kB gzip).

## 7. Accessibility

- Container: `role="application"`, `tabindex="0"` (if none), `aria-label` naming LAD, LCX, RCA and the keys. The canvas
  is `aria-hidden` (it is not the accessible representation).
- Selection is announced in a visually hidden `aria-live="polite"` region created inside the container, for example
  "LAD selected. high risk, probability 76 percent." and "Selection cleared." The band is the id the caller passed
  (`low`, `moderate`, `high`).
- Full keyboard operation (section 5). Focus ring: the browser's own `:focus-visible` ring is not suppressed.
- Risk is not communicated by colour alone: the selected vessel has outline, pulse and camera focus; the halo changes
  size and opacity with probability; the text fallback and announcements give band and percentage. The dashboard must
  still show the band label next to every colour (`config/risk_bands.yaml` rule).
- `prefers-reduced-motion` (or `reducedMotion: true`): no damping tail, no camera tween, no pulse.
- The provisional band colours are borderline for red-green colour blindness: `docs/viewer_findings.md` item 3.
- The in-canvas labels are `aria-hidden` on purpose, see section 3a.
- Touch: the canvas uses `touch-action: none`, so dragging on it rotates and does not scroll the page; leave some
  page margin around it on phones. Mouse wheel over the canvas zooms and does not scroll the page.
- Not tested with a real screen reader; only the DOM contract (roles, live-region text) is tested.

## 8. Anchors: where SHAP callouts can be pinned

`config/features.yaml` `anchor` names a mesh node. This branch sets eight. Everything else stays `null`: either
the feature is systemic (labs, demographics, risk factors, symptoms) or its anatomy is not in the model.

| Feature | Anchor | Why it is defensible |
|---|---|---|
| `ef_tte` (ejection fraction) | `left_ventricle` | EF is a property of the left ventricle's pumping |
| `region_rwma` (regional wall motion abnormality) | `left_ventricle` | wall motion of LV walls on echo |
| `lvh` (left ventricular hypertrophy) | `left_ventricle` | the name says it |
| `st_elevation`, `st_depression`, `t_inversion` | `left_ventricle` | ST/T changes are ventricular repolarisation; the standard 12-lead reads mostly LV myocardium |
| `q_wave` | `left_ventricle` | marks prior myocardial necrosis, which is in LV muscle whichever artery supplied it (inferior, anterior and lateral walls are all LV) |
| `bp` (blood pressure) | `ascending_aorta` | systemic arterial pressure, drawn at the aortic root. Schematic, because pressure is measured peripherally |

Deliberately not anchored: `poor_r_progression` (non-specific, also technique dependent), `bbb` (LBBB vs RBBB is
categorical, one node would be wrong half the time), `systolic_murmur`, `diastolic_murmur`, `vhd` (the valves are not
in the model), `chf` (a syndrome of the whole heart), `pr` (rate, set by the whole conduction system), `htn`, and all
labs, demographics and symptoms.

**An anchor is only a place to hang a callout.** It does not say where the disease is and must not be read as a lesion
location. In particular `left_ventricle` for an ST change does not imply any artery.

`setAnchors([{key: 'ef_tte', node: 'left_ventricle'}, ...])` then `onAnchors(list => ...)`. Each node is reduced
to one surface point (the vertex on the side facing away from the heart centre, best aligned with the node's
centroid direction), projected after every frame, and reported when a position or a `visible` flag changes (positions compared at 0.1 px).
`visible` is false if the node name does not exist (also logged once), the point is off screen, or it is on the far side
of the heart (near-hemisphere test). It is an approximation: there is no occlusion test, so a point on the near side
can still be partly covered by a great vessel. Node names available: `LAD`, `LCX`, `RCA`, `left_coronary_artery`,
`left_atrium`, `left_ventricle`, `right_atrium`, `right_ventricle`, four papillary muscles, `ascending_aorta`,
`pulmonary_trunk`, `bifurcation_of_pulmonary_trunk`, `left_pulmonary_artery`, `right_pulmonary_artery`,
`superior_vena_cava`, four pulmonary veins. The procedural fallback has the same names for the chambers, `LAD`, `LCX`,
`RCA`, `left_coronary_artery`, `ascending_aorta`, `pulmonary_trunk`, `superior_vena_cava`.

## 9. Tests (all run, results from this branch)

```
cd web/scripts && npm ci && npm run models && npm run validate && npm run bands -- --check
cd web/viewer-demo && npm ci
npm run typecheck        # tsc --noEmit
npm test                 # vitest, pure logic, no browser
npm run test:e2e         # builds the demo, launches Chromium under software GL through playwright-core
```

`test:e2e` uses Chromium from `/opt/pw-browsers` (override with `CHROMIUM_PATH`), never downloads a browser.

Results of the final run on this branch (Node 22.22, Chromium 141, headless, SwiftShader, no GPU):

| Command | Result |
|---|---|
| `npm run validate` (web/scripts) | glTF validator 0 errors, 0 warnings on both models; all checks passed |
| `npm run bands -- --check` | generated config is up to date |
| `npm run typecheck` | no errors (strict, noUnusedLocals) |
| `npm test` | 2 files, **72 tests passed** (pure logic: colour and desaturation maths, glow rule, selection state machine, emitter, key map, load fallback order and status, render budget, fps meter, tween and pulse, picking geometry, announcement text, the framing maths (exact fill for wide to phone-shaped canvases, centring, nothing leaves the canvas at any orbit angle, support points); plus manifest / `VesselId` / `.glb` consistency) |
| `npm run test:e2e` | 2 files, **56 tests passed** in 207 s |

The framing work (section 3b) adds a `camera framing` group of 5 browser tests (`e2e/viewer.e2e.test.ts`): fill of 80 to 95 percent of
the limiting dimension measured on the rendered pixels for 8 box shapes (and the camera maths agrees with the pixels), chips inside the canvas
for the same shapes with and without a selection, re-fit on resize / orbit angle kept / `resetView()` / zoom kept / zoom range, 0 idle frames
after a resize, and the `fill` option with clamping. The 35 original browser tests, by group: environment and loading (7: WebGL2 context on SwiftShader and antialiasing off, standard
GLB with 23,283 triangles, lite by `lowPower` and by auto-detection, fallback to lite, fallback to the procedural heart
and using it, GLB without the manifest nodes rejected with a clear error); colour coding (4: `setVessels` recolours the
rendered arteries for all three bands, verified by reading pixels back (about 6,400 red, 6,600 green, 6,200 amber
pixels for the three bands, 0 to 11 pixels of the other colours), clearing a vessel, uncertainty desaturation, overall
halo size, colour and "never weaker than a vessel"); interaction (8: real mouse click selects LAD, LCX and RCA, background
click clears, a drag does not select, touch tap, hover, outline pixels appear on selection (2,056 dark and 2,623 white
pixels against 0 and 0 before), keyboard 1 2 3 Escape arrows + - 0, keys typed into UI inside the container ignored,
wheel zoom, drag, `resetView()`, anchors); rendering policy (4: idle viewer draws 0 frames and 0 rAF callbacks,
reduced motion, drawing-buffer cap at 0.8 MP / 1.8 MP, resize); accessibility (1: roles, label, live-region texts, Tab);
robustness (4: WebGL unavailable by stubbing `getContext` to null, WebGL disabled at browser level, context loss and
restore with the pixels drawn again, dispose leaks nothing: 16 listeners were attached while alive and 0 remained, the
GL context is lost, no frame or rAF after dispose, 12 create/dispose cycles raise no context warning); screenshots (1: 12
states rendered, viewed by hand, curated copies in `web/viewer-demo/screenshots/`); performance (6, the `TIMING` tests
above).

The legibility pass adds a second browser-test file, `e2e/appearance.e2e.test.ts` (16 tests), and 18 unit tests.
Unit (`viewerLogic.test.ts`): CIE L*a*b* and delta E against textbook values, colour-vision simulation, the neutral palette
constants (chroma, lightness, every band colour more saturated than the body), `bodyColor`, label text, label placement,
collision spreading and spot choice. Browser: (1) every vessel colour against the body and against each other, for the
config palette and the safe palette, normal vision and three deficiencies, light and dark page (the table in section 3a);
the body against the `--viewer-bg` tokens; the body is muted (maximum chroma below 40 with all arteries unscored) and
`bodyStyle: 'natural'` is warm where the default is cool; the overall glow does not turn the body red; (2) `vesselBoost`
0 / 1 / 2 give 7,181 / 13,043 / 18,338 vessel pixels with identical triangle counts (23,283; lite 6,691); (3) labels: one
chip per vessel with name and percent, `aria-hidden`, `pointer-events:none`, inside the container, no two chips overlapping;
`'name'` and `'off'`; at 8 views around the heart every visible label has vessel-coloured pixels under its anchor and
every label is hidden in some view (so hidden when occluded), they follow the camera and return on reset, they render with
reduced motion, the selected chip is emphasised, dispose removes the overlay; (4) the ghost adds faint pixels from behind
and `showHidden: false` removes them; (5) screenshot smoke test of 3 band combinations, both themes, back, each vessel
selected, safe palette, lite, phone (no horizontal scroll). The existing 35 browser tests pass unchanged.

`TIMING` tests depend on machine speed. They use floors far below the measured values (4 to 8 fps, 5 fps at 1080p),
are configured to retry twice, and print what they measured; no other test is timing dependent. The measured numbers
are written to `web/viewer-demo/dist/e2e/results.json`.

Real bugs these tests found and that were fixed before this was written: anchor visibility was judged by the mesh's
vertex normals, which are unreliable on thin tubes (now a near-hemisphere test); a drag left damping momentum that
pulled the camera off the pose set by `resetView()`; picking by ring sampling missed a 5 px artery for a 14 px touch
radius (now triangle-distance picking, 3 ms per pick); the heart-level glow compared probabilities only, although
bands have per-target cut points (now band first); the context-lost message stayed visible after restore because an
inline `display` overrode the `hidden` attribute. Not tested: real GPUs, Safari, Firefox, a real screen reader, Node 20.

Screenshots (`web/viewer-demo/screenshots/`, regenerated by the browser tests, viewed by hand): the original twelve
(`front_standard`, `back_standard`, `selected_LAD`, `selected_LCX`, `selected_RCA`, `bands_all_low` / `moderate` / `high`,
`uncertainty_wide_high`, `dark_theme_selected_LCX`, `phone`, `lite_lowpower_selected_LAD`,
`procedural_fallback_selected_RCA`) now show the legibility pass, and the new set is the one to use for the demo video:
`combo_hml_light` (LAD high, LCX moderate, RCA low), `combo_lhm_light` / `combo_lhm_dark`, `combo_mlh_light`,
`combo_hml_dark`, `selected_LAD_hml`, `selected_LCX_hml`, `selected_RCA_hml`, `selected_LCX_dark`, `back_hml` (hidden
arteries as ghosts), `safe_palette_hml`, `lite_hml`, `phone_hml`, and the app itself in `app_desktop_light`,
`app_desktop_dark`, `app_phone_light` (older, kept for comparison). The size pass adds the app at the sizes that matter, real backend, with the
larger viewer and the 88 percent fill: `app_1920x1030_light`, `app_1920x890_light`, `app_1920x1080_light`, `app_1440x900_light`,
`app_1366x768_light` / `_dark`, `app_tablet_768x1024_light`, `app_phone_390x844_light`, `app_phone_390x844_dark_selected_LCX`,
`app_1920x1030_dark_selected_LAD`, `app_1920x1030_moderate_light`, `app_1920x1030_low_dark`, and the Enlarge mode
`app_1920x1030_enlarged_light`, `app_1920x1030_enlarged_dark_selected_RCA`. `before/` holds the old front view, the old selected LAD
(standard and lite), the old app screenshot and `before_app_*` (the same sizes before the size pass) for comparison. Best for the video: `selected_LCX_hml` (the selected artery is unmistakable, its label
and the other two stay readable), `combo_lhm_dark` and `combo_hml_light` (three bands at a glance in both themes).
The back view still hides the LCX behind the left atrium; select it to bring it to the front.

## 10. Model assets and attribution

- `web/public/models3d/heart.glb`, `heart_lite.glb`, built by `web/scripts/build_viewer_models.mjs` from the verified
  Z-Anatomy extraction in `web/scripts/source/` (sha256 checked). Nodes `LAD`, `LCX`, `RCA` are exactly the mesh names
  in `config/manifest.yaml` (the script refuses to run if the manifest and its vessel mapping disagree). Each is one mesh
  with one private material named like the node, so colour is per artery. LAD = anterior interventricular artery plus
  its septal branches; RCA = right coronary artery plus its right inferolateral branch; LCX = circumflex artery.
  The short left main stem stays a separate neutral node (`left_coronary_artery`) because it feeds both LAD and LCX;
  it is not scored. Frame: +X patient left, +Y up, +Z anterior, heart about 1 unit wide.
- Rebuild: `cd web/scripts && npm ci && npm run models && npm run validate`. Validation checks: glTF validator, node
  names, one distinct material per artery used by that node only, triangle counts equal to the source, no orphan
  materials, size budgets, licence notice present.
- Re-extraction from the 68 MB npm tarball (not needed for normal use; re-run on 2026-10-04 and it reproduced both
  source files byte for byte):
  ```
  npm pack @authorod/svitylo-3d-anatomy-data@1.1.0          # sha256 380ac07687042e620bff79d4119ac78d77ed9f4b99237ce4066c8a59ad7dfd50
  mkdir svdata && tar xzf authorod-svitylo-3d-anatomy-data-1.1.0.tgz -C svdata
  mkdir x && cd x && npm init -y && npm i @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 meshoptimizer@1.3.0
  # package.json needs "type": "module"; copy web/scripts/source/extract_heart_from_svitylo.mjs here as extract.mjs
  B=../svdata/package/releases/1.1.0
  node extract.mjs $B standard std.glb $LIST && node extract.mjs $B economy eco.glb $LIST
  ```
  where `$LIST` is the 24 comma-separated structure ids: `left_coronary_artery`, `anterior_interventricular_artery`,
  `septal_branches_of_anterior_interventricular_artery`, `circumflex_artery_of_heart`, `right_coronary_artery`,
  `right_inferolateral_branch_of_right_coronary_artery`, `left_atrium`, `left_ventricle`, `right_atrium`,
  `right_ventricle`, `inferior_papillary_muscle_of_left_ventricle`, `anterior_papillary_muscle_of_right_ventricle`,
  `inferior_papillary_muscle_of_right_ventricle`, `septal_papillary_muscle_of_right_ventricle`, `ascending_aorta`,
  `pulmonary_trunk`, `bifurcation_of_pulmonary_trunk`, `right_pulmonary_artery`, `left_pulmonary_artery`,
  `superior_vena_cava`, `left_superior_pulmonary_vein`, `left_inferior_pulmonary_vein`,
  `right_superior_pulmonary_vein`, `right_inferior_pulmonary_vein`. The outputs have sha256 `cdb91627...8805`
  (standard) and `649fb9d7...3ba4` (economy), the values `build_viewer_models.mjs` checks before it builds.
- **Attribution is mandatory.** The CC BY-SA 4.0 attribution text in `ASSETS_AND_LICENSES.md` must appear in the
  README and on the app's About / Credits page. The `.glb` files are adapted material under **CC BY-SA 4.0
  (ShareAlike)** and are loaded as separate files, so the application code can have its own licence (a common
  reading, not legal advice). The upstream chain could only be confirmed from the data packager's own files.
  `ASSETS_AND_LICENSES.md` says what is and is not confirmed.

## 11. Known limits

- **The fit follows the silhouette at the current orbit angle.** After the user orbits and the box then changes shape, the distance is re-fitted for that angle but the pivot stays where the user left it, so the silhouette can sit a little off centre (the home view is centred exactly). The heart is narrow: in a wide box it uses 40 to 55 percent of the width at an 88 percent height fill.
- **Per vessel only.** No lesion location inside a vessel; all branches of an artery share one colour.
- **Atlas anatomy, not the patient's.** A normal adult atlas heart (right-dominant by appearance). Coronary course,
  branch completeness and dominance were judged from renders, not by a clinician. The arteries are thin non-watertight
  surfaces, and the lite model's arteries are visibly blocky. Treat the picture as schematic. Valve leaflets are not in
  the model, so valve features have no anchor.
- **LCX is on the back of the heart.** The home view (turned 10 degrees further to the patient's left in the legibility
  pass) shows its course along the left edge; the rest is behind the left atrium and shows only as the faint hidden-artery
  ghost (full quality). Select it (key `2`, or click its label in the dashboard) and the camera turns to it.
- **The lite model's arteries are fragmented.** Z-Anatomy's economy mesh (`heart_lite.glb`, the default on software GL)
  breaks the arteries into disconnected pieces where the decimation cut them; the viewer lifts and thickens them but cannot
  reconnect them (`docs/viewer_findings.md` item 8).
- **Arteries are drawn wider than anatomy** (calibre exaggeration, `vesselBoost`); `0` turns it off.
- **Left main is not coloured.** It belongs to two vessels and has no model output.
- **No heartbeat animation and no 17-segment bullseye** (`docs/viewer_findings.md` item 7).
- **Tested only in headless Chromium 141 on SwiftShader.** Not on real GPUs, Safari, Firefox, or Node 20 (tooling ran
  on Node 22.22).
- **One viewer per page is the intended use.** Browsers cap live WebGL contexts at roughly 16; creating and disposing
  12 in a row raised no warning in the test.
- **Reduced-motion preference is read once** when the viewer is created.
- **Anchor `visible`** is approximate (section 8).

## 12. Dependencies for the app agent

Runtime (for `web/package.json`): `three@0.186.1`. Dev (versions in use, exact): `typescript@5.9.3`, `vite@8.3.2`,
`@types/three@0.186.0`, `@types/node@22.19.1`, `vitest@4.1.11`, `playwright-core@1.56.1`. Node `^20.19.0 || >=22.12.0`
(Vite 8's requirement).

`web/viewer-demo/package.json` is self-contained so it cannot clash with the app's own: the app imports
`web/src/viewer/` directly and needs only `three` (and `@types/three`). `web/viewer-demo/.npmrc` sets
`legacy-peer-deps=true`; without it npm 10.9 fails on this tree with "Cannot read properties of null (reading
'edgesOut')" (an npm resolver bug with vitest's optional peers). `web/scripts/package.json` holds the asset tooling
(`@gltf-transform/core@4.5.1`, `gltf-validator@2.0.0-dev.3.10`, `yaml@2.9.1`); none of it ships to the browser.

`web/viewer-demo/vite.config.ts` contains a three-line plugin that resolves `three` for files in `web/src/viewer`
from the demo's `node_modules`; in the merged app, `three` resolves from `web/node_modules` and the plugin is not needed.

`web/viewer-demo/viewer-config.generated.json` (band ids, labels, colours from `config/risk_bands.yaml`, per-vessel
cut points from `models/metadata.json`) is generated by `web/scripts/gen_viewer_bands.mjs` (`npm run bands`, `--check`
in CI) and used only by the demo. The app reads these values from `/meta`.
