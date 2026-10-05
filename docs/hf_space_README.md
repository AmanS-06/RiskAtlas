---
title: RiskAtlas
colorFrom: blue
colorTo: red
sdk: docker
app_port: 7860
pinned: false
short_description: Coronary risk map and explainable dashboard (research prototype)
---

<!--
  This file is the README of a Hugging Face Space, not of the project. A Space reads its settings from the
  front matter above, and the project README has none. Copy it over the Space's README.md (steps in docs/DEPLOY.md,
  section "Hugging Face Spaces"); it is kept here so the project README stays free of host settings.
  Front-matter keys: https://huggingface.co/docs/hub/spaces-config-reference (check them there before pushing).
-->

# RiskAtlas

Interactive 3D cardiovascular risk visualisation and prediction, built for Track A of the Multimodal AI Hackathon 2026
(KamandPrompt, IIT Mandi). A patient's clinical, ECG, laboratory and echocardiographic findings become calibrated
probabilities of overall coronary artery disease (CAD) and of stenosis in the LAD, LCX and RCA, drawn on a 3D heart
next to an explainability dashboard (SHAP, physiology against reference ranges, uncertainty, what-if).

> **Clinical safety disclaimer.** RiskAtlas is a research prototype for decision support and educational purposes
> only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal diagnostic
> imaging or clinical judgement.

The models load when the container starts (about 20 s), so the first visit after the Space was paused or restarted is
slow. Try the three illustrative cases (not real patients), press **Predict risk**, and see the About tab for data and
licence credits.

## Credits and licences

- Training data: Alizadehsani, R., Roshanzamir, M., & Sani, Z. (2013). *extention of Z-Alizadeh sani dataset* [Data set].
  UCI Machine Learning Repository. https://doi.org/10.24432/C5461K. Licensed under CC BY 4.0.
- External validation data: Janosi, A., Steinbrunn, W., Pfisterer, M., & Detrano, R. (1989). *Heart Disease* [Data set].
  UCI Machine Learning Repository. https://doi.org/10.24432/C52P4X. Licensed under CC BY 4.0.
- 3D heart mesh: Z-Anatomy "The libre 3D atlas of anatomy", based on BodyParts3D, licensed under CC BY-SA 4.0
  (details and the full attribution text: `ASSETS_AND_LICENSES.md` in the project, reproduced in the app's About tab).

Source code and documentation: the project repository (add its link here).
