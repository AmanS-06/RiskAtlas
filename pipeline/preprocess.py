"""Preprocessing built from the feature registry. Always used inside a Pipeline."""
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from pipeline import features


def build_preprocessor(names, types=None) -> ColumnTransformer:
    types = types or features.types(names)
    group = lambda kind: [n for n in names if types[n] == kind]
    parts = []
    if group("numeric"):
        parts.append(("num", Pipeline([("imp", SimpleImputer(strategy="median")),
                                       ("sc", StandardScaler())]), group("numeric")))
    if group("binary"):
        parts.append(("bin", SimpleImputer(strategy="most_frequent"), group("binary")))
    if group("categorical"):
        parts.append(("cat", Pipeline([("imp", SimpleImputer(strategy="most_frequent")),
                                       ("oh", OneHotEncoder(handle_unknown="ignore"))]), group("categorical")))
    return ColumnTransformer(parts, remainder="drop")
