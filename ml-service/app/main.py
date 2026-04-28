from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Dict, Any
from .training import train_phase1
from .predict import predict_signal
from .rl_agent import simple_rl_policy
from .model_registry import list_models, model_exists

app = FastAPI(title="XSJPRD55 ML Service", version="1.0.0")


class TrainRequest(BaseModel):
    csv_path: str
    target: str = "target_up"


class PredictRequest(BaseModel):
    features: Dict[str, Any] = Field(default_factory=dict)


class RLRequest(BaseModel):
    market_features: Dict[str, Any] = Field(default_factory=dict)
    portfolio_state: Dict[str, Any] = Field(default_factory=dict)


@app.get("/health")
def health():
    models = list_models()
    return {
        "ok": True,
        "service": "xsjprd55-ml-service",
        "models": models,
        "model_count": len(models),
    }


@app.post("/train/phase1")
def train(req: TrainRequest):
    metrics = train_phase1(req.csv_path, req.target)
    return {"ok": True, "phase": 1, "metrics": metrics}


@app.post("/predict")
def predict(req: PredictRequest):
    result = predict_signal(req.features)
    return {"ok": True, **result}


@app.post("/rl/decide")
def rl_decide(req: RLRequest):
    decision = simple_rl_policy(req.market_features, req.portfolio_state)
    return {"ok": True, "decision": decision}
