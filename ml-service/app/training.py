import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier
from .features import build_training_xy
from .model_registry import save_model


def train_phase1(csv_path: str, target: str = "target_up"):
    df = pd.read_csv(csv_path)
    X, y = build_training_xy(df, target)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, shuffle=False
    )

    rf = RandomForestClassifier(
        n_estimators=300,
        max_depth=8,
        min_samples_leaf=10,
        random_state=42,
        n_jobs=-1,
        class_weight="balanced",
    )
    rf.fit(X_train, y_train)

    xgb = XGBClassifier(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
    )
    xgb.fit(X_train, y_train)

    metrics = {}
    for name, model in [("random_forest", rf), ("xgboost", xgb)]:
        proba = model.predict_proba(X_test)[:, 1]
        pred = (proba >= 0.5).astype(int)
        metrics[name] = {
            "accuracy": float(accuracy_score(y_test, pred)),
            "roc_auc": float(roc_auc_score(y_test, proba)) if len(set(y_test)) > 1 else None,
        }
        save_model(name, model)

    return metrics
