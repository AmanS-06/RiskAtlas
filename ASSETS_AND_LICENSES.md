# Assets and Licences

Every dataset, 3D mesh, font and third-party asset used in RiskAtlas must be listed
here **in the same commit that adds it**, with its source and licence.

The hackathon scores "use of public datasets and anatomical resources" under
Technical Implementation (10%), so this file is part of the submission, not an
afterthought.

---

## Datasets

| Asset | Source | Licence | Used for | Added by |
|---|---|---|---|---|
| Extension of Z-Alizadeh Sani (303 patients) | UCI ML Repository / Kaggle | TBD — confirm before use | Primary training and evaluation | TBD |
| UCI Heart Disease (920 patients, 4 sites) | UCI ML Repository | TBD — confirm before use | External validation (reduced feature set) | TBD |

## 3D anatomical meshes

| Asset | Source | Licence | Attribution required | Used for | Added by |
|---|---|---|---|---|---|
| TBD — heart / coronary vessels | TBD (BodyParts3D, NIH 3D, Sketchfab) | TBD | TBD | 3D viewer | TBD |

Candidate sources named in the problem statement:

- **BodyParts3D** (Database Center for Life Science)
- Open-source `.gltf` / `.glb` / `.obj` heart models via Sketchfab, Three.js
  repositories, or the NIH 3D Print Exchange

Check the licence **per asset**, not per site. Sketchfab models in particular vary
from CC0 to all-rights-reserved.

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
| — | — | — |
