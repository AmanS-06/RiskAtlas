# Track A brief (summary of the official problem statement)

Multimodal AI Hackathon 2026 (KamandPrompt, IIT Mandi). Track A: Cardiovascular Risk Visualization and Prediction.
Submission on Devpost, deadline 15 Oct 2026, 00:15 IST. Teams of up to 4.

**Challenge.** Interactive 3D visualization system that predicts CAD and overall cardiac risk from clinical data and
maps the predictions onto an interactive 3D human anatomical model.

## Required
- Models: overall CAD plus stenosis of LAD, LCX, RCA. Primary dataset: Extension of Z-Alizadeh Sani (303 patients).
  Exclude LAD, LCX, RCA and Cath from inputs. Report accuracy, precision, recall, F1, ROC-AUC.
- 3D: interactive torso or heart (Three.js, WebGL, R3F or VTK.js). LAD, LCX, RCA recolour live from predicted
  probability. Rotate, zoom, select regions for vessel-level detail. Open meshes allowed.
- Dashboard: CAD status and per-vessel probabilities beside the canvas. SHAP or LIME breakdown. Physiological
  measurements next to their contribution.
- A clear, visible disclaimer in the UI: decision support and education only, not a substitute for diagnostic imaging.
- Responsive 3D in modern browsers without a dedicated GPU. Architecture must allow adding features, models and
  structures without a redesign. Model outputs must correspond consistently to the displayed LAD/LCX/RCA structures.

## Deliverables
Working web prototype; trained pipeline and weights; explanation dashboard; documentation (max 6 pages);
3 to 10 minute YouTube demo video. Devpost entry lists AI tools under "Built With" and flags AI-assisted README sections.

## Scoring
| Criterion | Weight |
|---|---|
| Predictive performance (metrics, estimate quality, validation method) | 30% |
| 3D visualization (anatomy, spatial risk mapping, interactivity) | 25% |
| Clinical interpretability (attribution, clear explanation, physiological breakdown) | 20% |
| System integration (pipeline, model-dashboard link, real-time updates) | 15% |
| Technical implementation (architecture, quality, reproducibility, public data) | 10% |

## Limits of the data (do not overclaim)
Region RWMA and similar features are not 3D lesion coordinates. The model predicts per vessel, not per lesion, from a
single-centre cohort of angiography-referred patients. LCX and RCA AUC is about 0.72.
