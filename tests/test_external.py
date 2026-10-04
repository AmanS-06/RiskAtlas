"""Parsing of the UCI Heart Disease archive, against a small synthetic zip."""
import io
import zipfile

import numpy as np

from pipeline import external

LINES = {
    "processed.cleveland.data": "63.0,1.0,1.0,145.0,233.0,1.0,2.0,150.0,0.0,2.3,3.0,0.0,6.0,0\n67,1,4,160,286,0,2,108,1,1.5,2,3,3,2\n",
    "processed.hungarian.data": "28,1,2,130,132,0,2,185,0,0,?,?,?,0\n",
    "processed.switzerland.data": "32,1,1,0,0,?,0,127,0,.7,1,?,?,1\n",
    "processed.va.data": "63,1,3,140,260,0,1,112,1,3,2,?,?,2\n",
}


def _zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in LINES.items():
            z.writestr(name, text)
    return buf.getvalue()


def test_parse_zip_reads_all_four_sites():
    df = external.parse_zip(_zip())
    assert len(df) == 5
    assert set(df["site"]) == set(external.SITES)
    assert df.loc[df["site"] == "hungary", "slope"].isna().all()


def test_uci_frame_maps_codes_and_treats_zero_bp_as_missing():
    X = external.uci_frame(external.parse_zip(_zip()))
    assert list(X.columns) == ["age", "sex", "bp", "fbs_high", "typical_chest_pain", "atypical", "nonanginal", "lvh"]
    swiss = X.iloc[3]
    assert np.isnan(swiss["bp"]) and np.isnan(swiss["fbs_high"])
    assert swiss["typical_chest_pain"] == 1 and swiss["atypical"] == 0
    assert X.iloc[0]["lvh"] == 1 and X.iloc[4]["nonanginal"] == 1
