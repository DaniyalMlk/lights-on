"""Lights On API.

Run:  uvicorn backend.main:app --reload
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from backend.pipeline import ROOT, WORK_DIR, analyze, load_result
from backend.tools.verifier import verify

load_dotenv()

app = FastAPI(title="Lights On")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

# Real CoStar data goes in data/buildings.json (git-ignored). Until then we use synthetic samples.
DATA_FILE = ROOT / "data" / "buildings.json"
SAMPLE_FILE = ROOT / "backend" / "sample_buildings.json"


def load_buildings() -> dict[str, dict]:
    path = DATA_FILE if DATA_FILE.exists() else SAMPLE_FILE
    rows = json.loads(path.read_text())["buildings"]
    return {b["id"]: b for b in rows}


BUILDINGS = load_buildings()


def get_result(building_id: str) -> dict:
    if building_id not in BUILDINGS:
        raise HTTPException(404, f"Unknown building {building_id}")
    return load_result(building_id) or analyze(BUILDINGS[building_id])


@app.get("/api/health")
def health():
    return {"status": "ok", "buildings": len(BUILDINGS), "data": "costar" if DATA_FILE.exists() else "sample"}


@app.get("/api/buildings")
def buildings_geojson():
    """Every building as a GeoJSON feature, with the numbers the map needs (color, height, slider)."""
    features = []
    for b in BUILDINGS.values():
        r = get_result(b["id"])
        base = r["geometry"]["by_depth"]["36"]
        econ = r.get("econ") or {}
        features.append({
            "type": "Feature",
            "geometry": b["footprint"],
            "properties": {
                "id": b["id"],
                "name": b.get("name", b["id"]),
                "height_ft": b.get("height_ft") or b["stories"] * 13,
                "stories": b["stories"],
                "homes": base["homes"],
                "score": r["score"]["total"],
                "gated_out": r["gated_out"],
                "vacancy": b.get("vacancy"),
                "verdict": (econ.get("verdict") or {}).get("code", "no_rent_data"),
                "residual_base": (econ.get("cases") or {}).get("base", {}).get("residual"),
                "assessed_value": b.get("assessed_value"),
                "gfa_sf": r["geometry"]["gfa_sf"],
            },
        })
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/buildings/{building_id}")
def building_detail(building_id: str):
    return get_result(building_id)


@app.post("/api/buildings/{building_id}/analyze")
def building_reanalyze(building_id: str):
    if building_id not in BUILDINGS:
        raise HTTPException(404, f"Unknown building {building_id}")
    return analyze(BUILDINGS[building_id])


@app.get("/api/buildings/{building_id}/plate.svg")
def building_svg(building_id: str):
    get_result(building_id)
    svg = (WORK_DIR / building_id / "plate.svg").read_text()
    return Response(svg, media_type="image/svg+xml")


@app.get("/api/proof")
def proof():
    """Latest validation run (python -m scripts.run_validation)."""
    path = WORK_DIR / "proof.json"
    if not path.exists():
        raise HTTPException(404, "No validation run yet: python -m scripts.run_validation")
    return json.loads(path.read_text())


class VerifyRequest(BaseModel):
    building_id: str
    text: str


@app.post("/api/verify")
def verify_text(req: VerifyRequest):
    return verify(req.text, get_result(req.building_id))


class AgentRequest(BaseModel):
    goal: str = "Which downtown offices can become homes, and at what price?"
    building_id: str | None = None


@app.post("/api/agent/run")
def agent_run(req: AgentRequest):
    if not os.getenv("LIGHTS_ON_MODEL"):
        raise HTTPException(503, "Set LIGHTS_ON_MODEL in .env to run the agent")
    from backend.agent import run_agent   # imported here so the API starts without an LLM key

    return run_agent(req.goal, req.building_id)


@app.get("/api/agent/stream")
def agent_stream(building_id: str | None = None, goal: str = AgentRequest().goal):
    """Server-sent events: the live run if a model is configured, otherwise a labeled replay of the last run."""
    from backend import agent

    def events():
        try:
            if not os.getenv("LIGHTS_ON_MODEL"):
                raise RuntimeError("no model configured")
            for e in agent.stream_agent(goal, building_id):
                yield f"data: {json.dumps(e)}\n\n"
                if e["type"] == "timeout":
                    raise RuntimeError("live run took too long")
        except Exception as err:
            yield f"data: {json.dumps({'type': 'fallback', 'reason': str(err)})}\n\n"
            for e in agent.replay_trace(building_id):
                yield f"data: {json.dumps(e)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
