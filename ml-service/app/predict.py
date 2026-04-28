from .config import BUY_THRESHOLD, SELL_THRESHOLD
from .features import normalize_feature_dict
from .model_registry import load_model


def probability(model, X):
    if model is None:
        return None
    return float(model.predict_proba(X)[0][1])


def ensemble_score(rf_prob, xgb_prob):
    if rf_prob is None and xgb_prob is None:
        return None
    if rf_prob is None:
        return xgb_prob
    if xgb_prob is None:
        return rf_prob
    # XGBoost gets higher weight because it is usually stronger for structured features.
    return float((0.35 * rf_prob) + (0.65 * xgb_prob))


def signal_from_score(score):
    if score is None:
        return "NO_MODEL"
    if score >= BUY_THRESHOLD:
        return "BUY"
    if score <= SELL_THRESHOLD:
        return "SELL"
    return "HOLD"


def predict_signal(features: dict):
    X = normalize_feature_dict(features)
    rf = load_model("random_forest")
    xgb = load_model("xgboost")

    rf_prob = probability(rf, X)
    xgb_prob = probability(xgb, X)
    score = ensemble_score(rf_prob, xgb_prob)

    disagreement = None
    if rf_prob is not None and xgb_prob is not None:
        disagreement = abs(rf_prob - xgb_prob)

    return {
        "signal": signal_from_score(score),
        "confidence": score,
        "models": {
            "random_forest": rf_prob,
            "xgboost": xgb_prob,
            "ensemble": score,
            "disagreement": disagreement,
        },
    }
