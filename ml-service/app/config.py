from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(exist_ok=True)

FEATURE_COLUMNS = [
    "close",
    "volume",
    "rsi",
    "macd",
    "macd_signal",
    "ema_fast",
    "ema_slow",
    "atr",
    "funding_rate",
    "open_interest_change",
    "liquidation_long_usd",
    "liquidation_short_usd",
    "sentiment_score",
    "social_volume",
]

BUY_THRESHOLD = 0.60
SELL_THRESHOLD = 0.40
