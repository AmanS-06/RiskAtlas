# Assets and Licences

Every dataset, 3D mesh, font and third-party asset used in RiskAtlas must be listed
here **in the same commit that adds it**, with its source and licence.

The hackathon scores "use of public datasets and anatomical resources" under
Technical Implementation (10%), so this file is part of the submission, not an
afterthought.

---

## Datasets

### Extension of Z-Alizadeh Sani — primary training and evaluation

| | |
|---|---|
| **Source** | UCI Machine Learning Repository, dataset id **411** |
| **Page** | https://archive.ics.uci.edu/dataset/411/extention+of+z+alizadeh+sani+dataset |
| **Download** | `https://archive.ics.uci.edu/static/public/411/extention+of+z+alizadeh+sani+dataset.zip` |
| **DOI** | https://doi.org/10.24432/C5461K |
| **Licence** | **CC BY 4.0** — attribution required, commercial use and adaptation permitted |
| **Contents** | 303 patients, 59 features, no missing cells |
| **Used for** | Training and evaluating the CAD, LAD, LCX and RCA models |

**Required attribution** (reproduce in the README, the documentation and the demo
video credits):

> Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). *extention of Z-Alizadeh sani
> dataset* [Data set]. UCI Machine Learning Repository.
> https://doi.org/10.24432/C5461K
> Licensed under CC BY 4.0.

Note: UCI misspells "extention" in the URL, the archive and the citation. Preserve the
spelling when linking or citing.

### UCI Heart Disease — external validation

| | |
|---|---|
| **Source** | UCI Machine Learning Repository, dataset id **45** |
| **Page** | https://archive.ics.uci.edu/dataset/45/heart+disease |
| **Download** | `https://archive.ics.uci.edu/static/public/45/heart+disease.zip` |
| **Licence** | **CC BY 4.0** — attribution required |
| **Contents** | 920 patients across Cleveland, Hungary, Switzerland and VA Long Beach; 76 attributes, 14 in common use |
| **Used for** | External validation of a reduced-feature model |

**Required attribution:**

> Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). *Heart Disease*
> [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X
> Licensed under CC BY 4.0.

## 3D anatomical meshes

| Asset | Source | Licence | Attribution required | Used for | Added by |
|---|---|---|---|---|---|
| `web/public/models3d/heart.glb` (standard, 23,283 triangles) and `heart_lite.glb` (6,691 triangles): heart chambers, great vessels and coronary arteries `LAD`, `LCX`, `RCA` | Z-Anatomy "The libre 3D atlas of anatomy", based on BodyParts3D; obtained through npm package `@authorod/svitylo-3d-anatomy-data` v1.1.0 | **CC BY-SA 4.0** (Z-Anatomy), over BodyParts3D **CC BY-SA 2.1 Japan**, as stated by the packager; see "Not independently confirmed" below | Yes, text below. Must also appear in the README and the app's About / Credits | 3D viewer (`web/src/viewer`) | Person-3 (viewer) |
| Built-in procedural heart (`web/src/viewer/procedural.ts`) | Original code written for this project (uses `three`, MIT) | Same as the application code | No | Last fallback when no `.glb` loads | Person-3 (viewer) |

### Heart model: `heart.glb`, `heart_lite.glb`

- **Source.** npm `@authorod/svitylo-3d-anatomy-data@1.1.0`, chunk `cardiovascular/arterial_system.glb`
  (standard and economy quality). Tarball sha256
  `380ac07687042e620bff79d4119ac78d77ed9f4b99237ce4066c8a59ad7dfd50`. Z-Anatomy source named by the
  packager: `github.com/Z-Anatomy/Models-of-human-anatomy`, commit `e38ea5e6c7e22d229a975f3fde563a5aca52099e`.
- **Licence.** CC BY-SA 4.0 (<https://creativecommons.org/licenses/by-sa/4.0/>).
- **Required attribution** (visible in the README and in the app's About / Credits page; also in
  `web/public/models3d/LICENSE-models.md` and in the `asset.copyright` field inside each `.glb`):

  > 3D heart model: derived from "Z-Anatomy – The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on "BodyParts3D, (c) The Database Center for Life Science" (CC BY-SA 2.1 Japan). Obtained via the npm package @authorod/svitylo-3d-anatomy-data v1.1.0 (adapted for Svitylo 3D Anatomy Atlas). Changes by this project: extracted the heart, great-vessel and coronary-artery meshes from the combined cardiovascular chunk; split the merged mesh into one named mesh per structure; decoded meshopt/quantised geometry to float; re-centred and rescaled to a unit-size heart; assigned new materials. Distributed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

- **Further changes made in the viewer build** (`web/scripts/build_viewer_models.mjs`, reproducible, geometry not
  edited): each coronary artery's source structures were merged into one mesh node named exactly like the manifest
  mesh (`LAD` = anterior interventricular artery + its septal branches, `LCX` = circumflex artery of heart,
  `RCA` = right coronary artery + its right inferolateral branch), each with its own single material; the left
  main stem `left_coronary_artery` kept as a separate, unscored node; the extraction's per-artery colours replaced
  by one neutral grey; licence text added to the glTF `asset.copyright` field.
- **Re-verified on 2026-10-04.** The npm tarball has the sha256 above; running the committed extraction script
  (`web/scripts/source/extract_heart_from_svitylo.mjs`) on it reproduces both source `.glb` files byte for byte
  (sha256 `cdb91627e81af3054f51239d04fa914a43a0d6757834594305caa1d488ec8805` and
  `649fb9d7f70f64aeb53fdeb49dbca2962e6e81ae8388f829b5dbf818b22e3ba4`), and the licence files kept here are identical to
  the ones inside the tarball.
- **Upstream licence files** are kept in `web/public/models3d/licence/` (the packager's `LICENSES.md` and
  `ATTRIBUTION.md`, and its `package.json`). The extraction and build inputs are in `web/scripts/source/`.
- **ShareAlike implication.** The two `.glb` files are adapted material, so they stay under CC BY-SA 4.0:
  anyone who modifies and redistributes them must use CC BY-SA 4.0 too, with attribution and a note of changes.
  They are separate files loaded at runtime (not inlined into code), so the application source can have its own
  licence; that "separate work" reading is common but untested here, and this is not legal advice. If the
  hackathon requires one licence for the whole repository, either choose CC BY-SA-compatible terms for the
  repository or ship only the procedural fallback.
- **Not independently confirmed.** The upstream chain (Z-Anatomy CC BY-SA 4.0, BodyParts3D CC BY-SA 2.1 Japan)
  comes from the packager's own files. Two independent npm packagers state the same chain, but the packager
  marks its licence audit as "pending", and the Z-Anatomy repository and the BodyParts3D site could not be
  reached to confirm it. Another npm package states that BodyParts3D 4.0 is CC BY 4.0, which disagrees with the
  CC BY-SA 2.1 Japan statement; we treat the stricter CC BY-SA as binding. Re-check against the upstream licence
  pages before the final submission.
- **Not used.** The packager's viewer code (`@authorod/svitylo-3d-anatomy-atlas`, CPAL-1.0) is not used. Only the
  data package is. Assets in that data package with non-commercial or unverified terms (Dundee inner ear, Cowley
  kidney, Brainder cortex, UW white matter) are not part of the heart and are not in our files.
- **Not a clinical model.** The mesh is a normal-anatomy atlas heart. Coronary course, dominance and branch
  completeness were judged from renders only, not by a clinician.

Candidate sources named in the problem statement and what happened to them:

- **BodyParts3D** (Database Center for Life Science): the site was not reachable from the build environment; its
  heart data is used only through the Z-Anatomy derivative above.
- Open-source `.gltf` / `.glb` / `.obj` heart models via Sketchfab, Three.js repositories or the NIH 3D Print
  Exchange: not reachable or no model with separable coronary arteries found. Not used.

Check the licence **per asset**, not per site. Sketchfab models in particular vary from CC0 to all-rights-reserved.

## Fonts

| Font | Source | Licence | Used for |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

## Libraries

Standard open-source dependencies are tracked in `requirements.txt` and
`web/package.json` and are not duplicated here. List an entry below only if a
library carries an unusual obligation (attribution, copyleft, non-commercial).

| Library | Licence | Note |
|---|---|---|
| TabPFN v2 (`tabpfn`, weights `Prior-Labs/TabPFN-v2-clf`) | Prior Labs License (Apache 2.0 with an additional attribution requirement), https://priorlabs.ai/tabpfn-license/ | **Experiment only, not shipped.** Used in `experiments/model_comparison.py`, whose results appear in `docs/ml_results.md` section 14. Not a dependency of the app. Check the attribution wording on the licence page before the final submission. Cite: Hollmann et al., "Accurate predictions on small data with a tabular foundation model", Nature 637 (2025). |
