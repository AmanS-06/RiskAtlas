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
| TabPFN v2 (`tabpfn`, weights `Prior-Labs/TabPFN-v2-clf`) | Prior Labs License (Apache 2.0 with an additional attribution requirement), https://priorlabs.ai/tabpfn-license/ | **Experiment only, not shipped.** Used in `experiments/model_comparison.py`, whose results appear in `docs/ml_results.md` section 14. Not a dependency of the app. Check the attribution wording on the licence page before the final submission. Cite: Hollmann et al., "Accurate predictions on small data with a tabular foundation model", Nature 637 (2025). |
