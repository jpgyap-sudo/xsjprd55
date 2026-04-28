import pandas as pd
from .config import FEATURE_COLUMNS


def normalize_feature_dict(features: dict) -> pd.DataFrame:
    """Return a 1-row dataframe in the exact training feature order."""
    row = {}
    for col in FEATURE_COLUMNS:
        row[col] = float(features.get(col, 0) or 0)
    return pd.DataFrame([row], columns=FEATURE_COLUMNS)


def build_training_xy(df: pd.DataFrame, target: str):
    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required feature columns: {missing}")
    if target not in df.columns:
        raise ValueError(f"Missing target column: {target}")
    clean = df.dropna(subset=FEATURE_COLUMNS + [target]).copy()
    X = clean[FEATURE_COLUMNS]
    y = clean[target].astype(int)
    return X, y
