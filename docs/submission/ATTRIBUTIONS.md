# Attributions and credits (paste-ready)

Source of truth: `ASSETS_AND_LICENSES.md` and `web/public/models3d/LICENSE-models.md`. The blocks below are copied
from them word for word. If those files change, re-copy. Do not retype from memory.

Where each block goes:

| Block | YouTube description | Devpost "Built with" / story | README | In the video (credits slide) |
|---|---|---|---|---|
| 1. Dataset (required, CC BY 4.0) | yes | yes | yes (README agent) | yes, on screen about 5 s |
| 2. External validation dataset | optional | optional | yes | optional |
| 3. 3D heart model (required, CC BY-SA 4.0) | yes | yes | yes (README agent) | yes, on screen about 5 s |
| 4. Libraries and tools | optional | short version | no | no |
| 5. Disclaimer | yes | yes | yes | shown in the UI throughout |

## 1. Dataset (training and evaluation)

> Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). *extention of Z-Alizadeh sani
> dataset* [Data set]. UCI Machine Learning Repository.
> https://doi.org/10.24432/C5461K
> Licensed under CC BY 4.0.

Page: https://archive.ics.uci.edu/dataset/411/extention+of+z+alizadeh+sani+dataset

Keep the dataset's own spelling "extention" (the UCI archive and citation spell it that way).

Plain-text version for the YouTube description (no markdown italics):

```
Dataset: Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). extention of Z-Alizadeh sani dataset [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C5461K. Licensed under CC BY 4.0.
```

## 2. External validation dataset

> Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). *Heart Disease*
> [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X
> Licensed under CC BY 4.0.

Plain-text version:

```
External validation data: Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). Heart Disease [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X. Licensed under CC BY 4.0.
```

## 3. 3D heart model (CC BY-SA 4.0 chain)

Licence of the two model files (`web/public/models3d/heart.glb`, `heart_lite.glb`): Creative Commons
Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/. Upstream chain as stated by
the data packager: Z-Anatomy (CC BY-SA 4.0) over BodyParts3D (CC BY-SA 2.1 Japan).

Exact attribution text (from `ASSETS_AND_LICENSES.md` and `LICENSE-models.md`, identical in both):

> 3D heart model: derived from "Z-Anatomy – The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on "BodyParts3D, (c) The Database Center for Life Science" (CC BY-SA 2.1 Japan). Obtained via the npm package @authorod/svitylo-3d-anatomy-data v1.1.0 (adapted for Svitylo 3D Anatomy Atlas). Changes by this project: extracted the heart, great-vessel and coronary-artery meshes from the combined cardiovascular chunk; split the merged mesh into one named mesh per structure; decoded meshopt/quantised geometry to float; re-centred and rescaled to a unit-size heart; assigned new materials. Distributed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

Further changes made by the RiskAtlas viewer build (`web/scripts/build_viewer_models.mjs`), from `LICENSE-models.md`:
merged the source structures of each coronary artery into one mesh node named `LAD`, `LCX` or `RCA` (LAD = anterior
interventricular artery + its septal branches; LCX = circumflex artery of heart; RCA = right coronary artery + its right
inferolateral branch), one material per artery; replaced the extraction's per-artery colours with one neutral grey; added
licence text to the glTF `asset.copyright` field. Geometry (vertices, triangles) was not edited.

Short version for space-limited places (YouTube description, Devpost "Built with" notes). It keeps the licence, the
upstream names and the fact that the model was modified:

```
3D heart model: adapted from Z-Anatomy, "The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on BodyParts3D, (c) The Database Center for Life Science (CC BY-SA 2.1 Japan). Obtained via the npm package @authorod/svitylo-3d-anatomy-data v1.1.0. Changed by this project: extracted the heart and coronary arteries, split into one named mesh per structure, re-centred, rescaled, new materials. Distributed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
```

Caveats to keep honest (from the repo's own notes, not independently confirmed by this submission pack):

- The upstream chain (Z-Anatomy CC BY-SA 4.0, BodyParts3D CC BY-SA 2.1 Japan) comes from the packager's own files. The
  packager marks its licence audit as "pending". The repo says to re-check the upstream licence pages before the final
  submission. This is a human task (AI had no access to those sites). See SUBMISSION_CHECKLIST.md.
- ShareAlike applies to the two `.glb` files, which are separate files loaded at runtime. The repo's reading that the
  application code can have its own licence is "common but untested" and "not legal advice".
- The mesh is a normal-anatomy atlas heart, schematic. Coronary course and dominance were judged from renders, not by a
  clinician. Do not describe it as a patient-specific or clinically validated anatomy.

## 4. Libraries and tools

Standard open-source dependencies are listed in `requirements.txt` and `web/package.json`. For the Devpost "Built with"
tags and a credits line, the main ones are:

```
Python 3.11, scikit-learn, XGBoost, SHAP, LIME, pandas, NumPy, FastAPI, Uvicorn, Pydantic, React, TypeScript, Vite, three.js
```

Versions (from the pinned files): see `requirements.txt` (for example scikit-learn 1.8.0, XGBoost 3.2.0, SHAP 0.51.0,
FastAPI 0.142.2) and `web/package.json` (React 19.3.0, three 0.186.1).

Licences of these libraries are not restated in the repo (the repo's rule is to list a library in
`ASSETS_AND_LICENSES.md` only if it carries an unusual obligation). Do not claim a licence for them in the submission
beyond "open source".

Experiment only, not shipped: TabPFN v2 (Prior Labs License, Apache 2.0 with an additional attribution requirement,
https://priorlabs.ai/tabpfn-license/), used in `experiments/model_comparison.py` and reported in `docs/ml_results.md`
section 14. If the video or Devpost text mentions TabPFN, cite: Hollmann et al., "Accurate predictions on small data with
a tabular foundation model", Nature 637 (2025). The repo flags that the licence's attribution wording must be checked on
the licence page before the final submission (unverified here, no access to that site).

Not used: the packager's viewer code (`@authorod/svitylo-3d-anatomy-atlas`, CPAL-1.0). Only its data package is used.

## 5. Disclaimer (identical wording to show in the UI and repeat in text)

The text the web app displays (from `web/src/shared/constants.ts`):

> RiskAtlas is a research prototype for decision support and educational purposes only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal diagnostic imaging or clinical judgement.

The README and the API use a slightly different sentence ("... must not be used to make patient care decisions."). The
repo's own `docs/web_findings.md` item 2 asks the team to pick one wording. For the Devpost text and the YouTube
description use the web-app wording above, because that is what the video shows.

## 6. Ready-to-paste YouTube description (full)

```
RiskAtlas: interactive 3D coronary artery disease risk visualization (Track A, Multimodal AI Hackathon 2026).

Predicts overall CAD and stenosis of the LAD, LCX and RCA from clinical, ECG, lab and echo features, colours the vessels of a 3D heart by predicted risk, and explains each prediction with SHAP.

Research prototype for decision support and educational purposes only. Not a medical device, not a diagnosis, not a substitute for formal diagnostic imaging or clinical judgement. Illustrative cases in the video are not real patients.

Code: <GITHUB REPO URL>
Devpost: <DEVPOST PROJECT URL>

Credits
Dataset: Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). extention of Z-Alizadeh sani dataset [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C5461K. Licensed under CC BY 4.0.
External validation data: Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). Heart Disease [Data set]. UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X. Licensed under CC BY 4.0.
3D heart model: adapted from Z-Anatomy, "The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on BodyParts3D, (c) The Database Center for Life Science (CC BY-SA 2.1 Japan). Obtained via the npm package @authorod/svitylo-3d-anatomy-data v1.1.0. Changed by this project: extracted the heart and coronary arteries, split into one named mesh per structure, re-centred, rescaled, new materials. Distributed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
Built with Python, scikit-learn, XGBoost, SHAP, FastAPI, React, TypeScript, Vite and three.js.

Team: <FULL NAME 1>, <FULL NAME 2>, <FULL NAME 3>, <FULL NAME 4>
```

Replace the three placeholders in angle brackets before upload. Do not leave the angle brackets in.
