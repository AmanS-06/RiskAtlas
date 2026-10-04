# Licence of the 3D heart models in this folder

Files: `heart.glb`, `heart_lite.glb` (and the files in `licence/`).

These two files are adapted material and are licensed under
**Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**:
<https://creativecommons.org/licenses/by-sa/4.0/>. The application source code is a separate
work and is not covered by this licence.

## Attribution (reproduce wherever the models are shown or redistributed)

> 3D heart model: derived from "Z-Anatomy – The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on "BodyParts3D, (c) The Database Center for Life Science" (CC BY-SA 2.1 Japan). Obtained via the npm package @authorod/svitylo-3d-anatomy-data v1.1.0 (adapted for Svitylo 3D Anatomy Atlas). Changes by this project: extracted the heart, great-vessel and coronary-artery meshes from the combined cardiovascular chunk; split the merged mesh into one named mesh per structure; decoded meshopt/quantised geometry to float; re-centred and rescaled to a unit-size heart; assigned new materials. Distributed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

Further changes made by `web/scripts/build_viewer_models.mjs` (RiskAtlas viewer build):
merged the source structures of each coronary artery into one mesh node named `LAD`, `LCX` or
`RCA` (LAD = anterior interventricular artery + its septal branches; LCX = circumflex artery of
heart; RCA = right coronary artery + its right inferolateral branch), one material per artery;
replaced the extraction's per-artery colours with one neutral grey; added licence text to the
glTF `asset.copyright` field. Geometry (vertices, triangles) was not edited.

## ShareAlike

Anyone who modifies these files and distributes the result must release it under CC BY-SA 4.0
(or a licence CC lists as compatible), with attribution and a note of the changes.

## Not independently confirmed

The upstream licence chain (Z-Anatomy CC BY-SA 4.0 over BodyParts3D CC BY-SA 2.1 Japan) is taken
from the data packager's own `LICENSES.md` / `ATTRIBUTION.md` (copied in `licence/`). The
packager marks its licence audit as "pending", and the Z-Anatomy repository and the BodyParts3D
site could not be reached to confirm it. This is not legal advice.
