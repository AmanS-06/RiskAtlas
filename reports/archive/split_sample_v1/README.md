# Split-sample check, version 1 (superseded)

The first validation design held out 20% of patients (61), locked, and scored them once with the
first model set. The holdout was used exactly once; see `reports/holdout_lock.json`.

These files are that result, kept unchanged:

- `holdout_metrics.csv`, `holdout_summary.json`, `subgroups.csv`: the one-time holdout scores
- `calibration_*.png`, `decision_curve_holdout.*`: the holdout plots
- `metadata_v1.json`: the models that were scored
- `ml_results_v1.md`: the results report generated at that point

**Why it was superseded.** With 61 patients (about 22 RCA cases), a single holdout gives a very
wide interval and depends heavily on which patients happen to fall in it. Steyerberg (J Clin
Epidemiol 2018) recommends against random data splitting in small samples, and suggests at least
100 events and 100 non-events for reliable assessment. The project therefore moved to developing
on all 303 patients, with performance estimated by repeated cross-validation of the whole
modelling procedure, plus external validation on 920 independent patients.

The decision to change protocol was taken after this holdout result was seen, which is why it is
reported here in full rather than replaced.
