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

from backend import matterport
from backend.annotations import floor_labels
from backend.data_sources import has_map_location, indicative_map_square
from backend.pipeline import ROOT, WORK_DIR, analyze, load_result
from backend.redact import protected_values, redact
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


_records = load_buildings()
BUILDINGS = {key: b for key, b in _records.items() if b.get("footprint")}
MAP_ONLY = [b for b in _records.values() if not b.get("footprint") and has_map_location(b)]


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
                "address": b.get("address"),
                "residual_worst": (econ.get("cases") or {}).get("downside", {}).get("residual"),
                "indicative": "square stand-in" in (b.get("footprint_source") or ""),
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
    for b in MAP_ONLY:
        # A fixed-size location symbol. Never pass it to the analysis pipeline.
        features.append({
            "type": "Feature", "geometry": indicative_map_square(b["lat"], b["lon"]),
            "properties": {"id": b["id"], "name": b.get("name") or b["id"],
                           "indicative": True, "map_only": True, "height_ft": 0},
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
def building_svg(building_id: str, depth: int = 36):
    if depth not in (30, 36, 42):
        raise HTTPException(422, "Supported depths are 30, 36 and 42 ft")
    if building_id not in BUILDINGS:
        raise HTTPException(404, "Unknown building")
    path = WORK_DIR / building_id / f"plate_{depth}.svg"
    if not path.exists():
        analyze(BUILDINGS[building_id])
    svg = path.read_text()
    return Response(svg, media_type="image/svg+xml")


@app.get("/api/buildings/{building_id}/recording")
def recording(building_id: str):
    if building_id not in BUILDINGS:
        raise HTTPException(404, "Unknown building")
    path = WORK_DIR / building_id / "trace.json"
    if not path.exists():
        raise HTTPException(404, "No recorded run for this building")
    trace = json.loads(path.read_text())
    trace["events"] = redact(trace.get("events", []), _protect(building_id))
    return trace


def _protect(building_id: str | None) -> dict:
    """CoStar figures to keep off the screen: one building's, or every building's for a run without one."""
    ids = [building_id] if building_id in BUILDINGS else list(BUILDINGS)
    merged = {"large": [], "rents": []}
    for i in ids:
        values = protected_values(BUILDINGS[i], load_result(i))
        merged["large"] += values["large"]
        merged["rents"] += values["rents"]
    return merged


@app.get("/api/buildings/{building_id}/labels")
def building_labels(building_id: str):
    """Measured labels for the building's scanned office floor, in the Matterport model's own coordinates."""
    if building_id not in BUILDINGS:
        raise HTTPException(404, f"Unknown building {building_id}")
    b = BUILDINGS[building_id]
    reason = "no full-floor Matterport scan saved for this building"
    scans = [] if b.get("synthetic") else matterport.scans_for(b, matterport.load_index())
    for scan in scans:
        model = matterport.load_floor(scan["model_id"]) if scan["full_floor"] else None
        if model:
            out = floor_labels(model, b.get("typical_floor_sf"))
            if out["labels"]:
                return {"model_id": scan["model_id"], "frame": "Matterport model coordinates, metres, z up",
                        "panos": [{"id": p["id"], "position": p["position"]} for p in model.get("panoLocations", []) if p.get("id") and p.get("position")], **out}
            reason = out["reason"]
    # No measured floor, but the building may still have a tour to walk through. Only scans filed under this
    # building's own CoStar id count: a scan that is merely nearby could be the tower next door.
    tour = next((s for s in scans if s["matched_by"] == "costar_id"), None)
    return {"model_id": None, "labels": [], "reason": reason,
            "tour_model_id": tour["model_id"] if tour else None,
            "tour_full_floor": bool(tour and tour["full_floor"])}


@app.get("/api/config")
def frontend_config():
    """The Matterport Showcase SDK key from .env, so it never sits in the repo or the JS bundle."""
    return {"matterport_sdk_key": os.environ.get("MATTERPORT_SDK_KEY") or None}


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
            protect = _protect(building_id)
            for e in agent.stream_agent(goal, building_id):
                yield f"data: {json.dumps(redact(e, protect))}\n\n"
                if e["type"] == "timeout":
                    raise RuntimeError("live run took too long")
        except Exception as err:
            yield f"data: {json.dumps({'type': 'fallback', 'reason': str(err)})}\n\n"
            for e in agent.replay_trace(building_id):
                yield f"data: {json.dumps(e)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
