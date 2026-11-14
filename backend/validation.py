"""Pre-registered checks against real Houston buildings (docs/preregistration.md).

Cases are matched to our data by address. Ground truth is written here BEFORE running.
Run:  python -m scripts.run_validation
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import box

from backend import config as C
from backend.pipeline import WORK_DIR, analyze

CASES = [
    {"case": "1801 Smith (Elev8)", "address": "1801 Smith", "role": "development check, not a holdout",
     "truth_homes": 372, "residential_floors": None, "source": "HAR listing: 372 units"},
    {"case": "One City Centre", "address": "1021 Main", "role": "planned program, not built yet",
     "truth_homes": 460, "residential_floors": 23, "source": "TDLR TABS2025025699: 460 apartments on levels 7-29"},
    {"case": "708 Main", "address": "708 Main", "role": "AECOM 2023 deep dive",
     "truth_homes": None, "residential_floors": None, "source": "AECOM Downtown Houston study (direction only)"},
    {"case": "1415 Louisiana", "address": "1415 Louisiana", "role": "AECOM 2023 deep dive",
     "truth_homes": None, "residential_floors": None, "source": "AECOM Downtown Houston study (direction only)"},
]
TOLERANCE = 0.15


def params_version() -> str:
    """Short hash of every parameter in config.py, so each result says which model produced it."""
    values = {k: v for k, v in vars(C).items() if k.isupper()}
    return hashlib.sha1(json.dumps(values, sort_keys=True, default=str).encode()).hexdigest()[:8]


def find_building(buildings: dict, address: str) -> dict | None:
    needle = address.lower()
    return next((b for b in buildings.values() if needle in str(b.get("address", "")).lower()), None)


def check_case(case: dict, buildings: dict) -> dict:
    b = find_building(buildings, case["address"])
    row = {k: case[k] for k in ("case", "role", "source")}
    if not b:
        return {**row, "status": "no data", "predicted": None, "truth": case["truth_homes"]}
    r = analyze(b)
    per_floor = r["geometry"]["by_depth"][str(C.BASE_DEPTH_FT)]["homes_per_floor"]
    floors = case["residential_floors"] or r["geometry"]["residential_floors"]
    predicted = per_floor * floors
    row.update(building_id=b["id"], predicted=predicted, truth=case["truth_homes"], floors_used=floors)
    if case["truth_homes"] is None:
        verdict = (r.get("econ") or {}).get("verdict", {}).get("code")
        return {**row, "status": "compare by hand", "our_verdict": verdict}
    error = (predicted - case["truth_homes"]) / case["truth_homes"]
    return {**row, "error_pct": round(100 * error, 1),
            "status": "pass" if abs(error) <= TOLERANCE else "miss"}


def costar_only_plate(b: dict) -> dict:
    """The same building without Vexcel: a square floor with CoStar's typical floor area."""
    side = (b.get("typical_floor_sf") or 15_000) ** 0.5
    from backend.tools.geo import to_feet, to_lonlat
    center = to_feet(b["footprint"]).centroid
    square = box(center.x - side / 2, center.y - side / 2, center.x + side / 2, center.y + side / 2)
    return {**b, "footprint": to_lonlat(square)}


def input_sensitivity(buildings: dict) -> list[dict]:
    """Does the footprint change the answer? Shows sensitivity to the layer, not accuracy."""
    rows = []
    for b in buildings.values():
        with_fp = analyze(b, save=False)
        without = analyze(costar_only_plate(b), save=False)
        key = str(C.BASE_DEPTH_FT)
        rows.append({"building_id": b["id"], "name": b.get("name"),
                     "homes_costar_only": without["geometry"]["by_depth"][key]["homes"],
                     "homes_with_footprint": with_fp["geometry"]["by_depth"][key]["homes"],
                     "score_costar_only": without["score"]["total"],
                     "score_with_footprint": with_fp["score"]["total"]})
    for field in ("score_costar_only", "score_with_footprint"):
        ranked = sorted(rows, key=lambda r: r[field], reverse=True)
        for i, r in enumerate(ranked, 1):
            r[field.replace("score", "rank")] = i
    return rows


def run(buildings: dict) -> dict:
    result = {
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params_version": params_version(),
        "cases": [check_case(c, buildings) for c in CASES],
        "input_sensitivity": input_sensitivity(buildings),
    }
    out = WORK_DIR / "proof.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    history = WORK_DIR / "proof_history.jsonl"          # keep every run, including the first one
    with history.open("a") as f:
        f.write(json.dumps(result) + "\n")
    out.write_text(json.dumps(result, indent=1))
    return result
