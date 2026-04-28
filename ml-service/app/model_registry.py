import joblib
from pathlib import Path
from .config import MODEL_DIR


def save_model(name: str, model):
    path = MODEL_DIR / f"{name}.joblib"
    joblib.dump(model, path)
    return str(path)


def load_model(name: str):
    path = MODEL_DIR / f"{name}.joblib"
    if not path.exists():
        return None
    return joblib.load(path)


def model_exists(name: str) -> bool:
    return (MODEL_DIR / f"{name}.joblib").exists()


def list_models():
    """Return list of available model names and their file sizes."""
    models = []
    for f in MODEL_DIR.glob("*.joblib"):
        models.append({"name": f.stem, "size_bytes": f.stat().st_size})
    return models
