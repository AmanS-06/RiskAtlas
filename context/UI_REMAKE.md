# UI remake

_Started 2026-10-05._ Goal: replace the current admin-style dashboard with a clinician-useful, visually strong UI.
Backend, ML and API are not touched.

## Decisions (agreed with the team, 2026-10-05)
1. **Direction: Hybrid.** Cinematic landing page (skeleton/X-ray video background) leading into a calm, professional
   workspace. Main focus: the heart's interactivity.
2. **Sci-fi "touch to inspect" heart.** Touching a region opens a floating data panel with a leader line (holographic
   HUD). Panels carry real patient values and SHAP drivers, not decoration. It must help a doctor, not just look good.
3. **Touchable regions are problem-first.** Every region can be identified (muted label), but only regions that carry
   model or patient data are "live": LAD, LCX, RCA; left ventricle (EF, RWMA, ECG findings, LVH); aorta (blood
   pressure); overall CAD. Myocardial "area of concern" is the muscle territory fed by each artery, shaded by that
   artery's risk and labelled approximate. It is never presented as a lesion location.
4. **Heartbeat animation, no sound.** Beat rate follows the pulse rate (`pr`) from the report/inputs.
5. **Special report mode.** Cinematic fly-through of findings plus a printable one-page summary with 3D snapshots
   (final form open; see Open items).
6. **Two visual styles, decide later:** holographic sci-fi and realistic organ. Built behind one switch so the team can
   compare. Risk colours (green/amber/red from `config/risk_bands.yaml`) and the colour-blind palette stay.
7. **Performance:** all current laptops are RTX, so full effects are on. Still keep automatic quality tiers so a weak
   machine degrades to simpler effects, because the brief requires no dedicated GPU. Target: no visible lag.
8. **Laptop only for now.** No mobile support in the remake. (The old UI already has responsive layouts.)
9. **Old UI is preserved** in the repo with its tests (see below). The new UI is what gets deployed.
10. **Workflow:** no PRs, commit directly to `main` (Harsh has write access). Commits carry Harsh's name only. This `context/` folder is updated with every commit.

## Constraints to keep
- Visible disclaimer at all times (rubric).
- Probabilities, SHAP and physiology stay beside the canvas (rubric).
- Config-driven: features, vessels, bands come from `GET /meta`; nothing hardcoded about them.
- 3D uses `HeartViewer` via `viewerAdapter.ts`; `setAnchors/onAnchors` already exist and are unused.
- WCAG AA contrast for text pairs; reduced-motion respected.
- Heart mesh is CC BY-SA 4.0 (Z-Anatomy / BodyParts3D). Anything derived (including a rendered video) carries the attribution.

## Plan (today 5 Oct; core freeze 8 Oct; deploy 12 Oct; submit evening of 14 Oct)
1. Preserve old UI: copy `web/` to `web-legacy/` (own tests intact) and tag `legacy-ui-v1`. Optionally serve it at `/legacy`.
2. Tokens and shell: new theme, layout, landing route, workspace route.
3. Viewer: selectable regions, hover/touch HUD panels with leader lines (use `setAnchors`), territory shading,
   heartbeat from pulse rate, quality tiers.
4. Workspace: guided intake (from `/meta` groups), results panel, explanation, physiology, what-if as before-and-after.
5. Landing: rendered skeleton/X-ray loop, scroll story, honest-numbers section, "try an illustrative case" entry.
6. Report mode and demo tour.
7. Tests updated alongside. Deploy and verify.

## Status
- Done: tokens, shell, viewer (regions, hover, click, fly-to, heartbeat, territories, two looks, bloom, tiers), HUD chips and region card, intake, ported tests.
- Done: landing page with the skeleton video (scroll-scrubbed), honest-numbers section, routes.
- Next: report mode, richer panels (waterfall, what-if ghost heart), new browser e2e, deploy (new UI at `/`, old UI at `/legacy`), cleanup of unused old viewer files.

## Open items
- Final form of the special report (fly-through only, or also PDF).
- Which visual style wins (decide after both exist).
