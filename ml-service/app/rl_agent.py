import numpy as np

ACTIONS = ["HOLD", "BUY", "SELL", "REDUCE_RISK"]


def simple_rl_policy(market_features: dict, portfolio_state: dict):
    """Safe placeholder policy for Phase 3.

    Your coder can replace this with Stable-Baselines3 PPO after enough mock-trading data exists.
    This function intentionally starts conservative.
    """
    confidence = float(market_features.get("ml_confidence", 0.5) or 0.5)
    atr_pct = float(market_features.get("atr_pct", 0.0) or 0.0)
    drawdown = float(portfolio_state.get("drawdown", 0.0) or 0.0)
    position = float(portfolio_state.get("position", 0.0) or 0.0)

    if drawdown <= -0.05:
        return {"action": "REDUCE_RISK", "size_pct": 0.0, "reason": "drawdown protection"}

    if atr_pct > 0.04:
        return {"action": "HOLD", "size_pct": 0.0, "reason": "volatility too high"}

    if confidence >= 0.68 and position <= 0:
        return {"action": "BUY", "size_pct": 0.10, "reason": "high confidence long"}

    if confidence <= 0.32 and position >= 0:
        return {"action": "SELL", "size_pct": 0.10, "reason": "high confidence short/exit"}

    return {"action": "HOLD", "size_pct": 0.0, "reason": "no strong edge"}
