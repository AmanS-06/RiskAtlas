"""Model families. Every candidate is Pipeline(prep, clf) wrapped in a probability calibrator."""
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from pipeline.preprocess import build_preprocessor
from pipeline.settings import cfg, seed

FAMILIES = ["lr", "rf", "xgb", "ensemble"]  # ordered simple to complex
GRIDS = {
    "lr": {"estimator__clf__C": [0.03, 0.1, 0.3, 1.0]},
    "rf": {"estimator__clf__min_samples_leaf": [2, 5, 10]},
    "xgb": {"estimator__clf__max_depth": [2, 3], "estimator__clf__n_estimators": [100, 250]},
    "ensemble": {},
}


def _lr():
    return LogisticRegression(C=0.3, max_iter=2000)


def _rf():
    return RandomForestClassifier(n_estimators=cfg()["models"]["rf_trees"], min_samples_leaf=3,
                                  random_state=seed(), n_jobs=1)


def _xgb():
    return XGBClassifier(n_estimators=150, max_depth=2, learning_rate=0.05, subsample=0.8,
                         colsample_bytree=0.8, reg_lambda=5.0, eval_metric="logloss",
                         random_state=seed(), n_jobs=1, verbosity=0)


def _classifier(family):
    if family == "ensemble":
        return VotingClassifier([("lr", _lr()), ("rf", _rf()), ("xgb", _xgb())], voting="soft")
    return {"lr": _lr, "rf": _rf, "xgb": _xgb}[family]()


def make_model(family, names, types=None):
    pipe = Pipeline([("prep", build_preprocessor(names, types)), ("clf", _classifier(family))])
    c = cfg()["calibration"]
    return CalibratedClassifierCV(estimator=pipe, method=c["method"], cv=c["folds"])


def make_search(family, names, types=None):
    model = make_model(family, names, types)
    if not GRIDS[family]:
        return model
    inner = StratifiedKFold(cfg()["cv"]["inner_splits"], shuffle=True, random_state=seed())
    return GridSearchCV(model, GRIDS[family], cv=inner, scoring=cfg()["cv"]["tune_scoring"],
                        n_jobs=1, refit=True)


def fitted_model(search):
    return getattr(search, "best_estimator_", search)


def best_params(search) -> dict:
    return dict(getattr(search, "best_params_", {}))


def predict_pos(model, X):
    return model.predict_proba(X)[:, 1]


class ProductModel:
    """P(vessel) = P(parent) * P(vessel | parent), for targets marked conditional_on in manifest.yaml.

    CAD means stenosis in at least one vessel, so modelling each vessel through CAD guarantees
    P(vessel) <= P(CAD) and lets the vessel models borrow strength from the stronger CAD model.
    Both parts arrive already fitted; this class only combines their predictions."""

    def __init__(self, parent, conditional):
        self.parent, self.conditional = parent, conditional
        self.classes_ = np.array([0, 1])

    def predict_proba(self, X):
        p = predict_pos(self.parent, X) * predict_pos(self.conditional, X)
        return np.column_stack([1 - p, p])
