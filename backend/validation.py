"""Pre-registered checks against real Houston buildings (docs/preregistration.md).

Cases are matched to our data by address. Ground truth is written here BEFORE running.
A building that isn't in our data can still be checked on published dimensions: give the case a
"public_plate" (width, length, stories, a label and the source). Its result carries that label.
Run:  python -m scripts.run_validation
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from pyproj import Transformer
from shapely.geometry import box

from backend import config as C
from backend.pipeline import WORK_DIR, analyze
from backend.tools.geo import HOUSTON_EPSG, to_feet, to_lonlat

CASES = [
    {"case": "1801 Smith (Elev8)", "address": "1801 Smith", "role": "development check, not a holdout",
     "truth_homes": 372, "residential_floors": None, "source": "HAR listing: 372 units"},
    # Not in our CoStar data, so it runs on published dimensions: a 90 x 233 ft rectangle (AECOM's 21,000 SF
    # typical floor and 90 ft minimum depth) with the assumed centered core, on the 23 residential floors as filed.
    {"case": "One City Centre", "address": "1021 Main",
     "role": "planned program, not built yet; inputs: AECOM, public numbers, not CoStar",
     "truth_homes": 460, "residential_floors": 23, "source": "TDLR TABS2025025699: 460 apartments on levels 7-29",
     "public_plate": {"width_ft": 90, "length_ft": 233, "stories": 29, "label": "AECOM, public numbers, not CoStar",
                      "source": "AECOM 2023 study p. 81: 21,000 SF typical floor, 90 ft minimum depth"},
     "expect_deep_plate": True},
    {"case": "708 Main", "address": "708 Main", "role": "AECOM 2023 deep dive; dropped: not in our data",
     "truth_homes": None, "residential_floors": None, "source": "AECOM Downtown Houston study (direction only)"},
    {"case": "1415 Louisiana", "address": "1415 Louisiana", "role": "AECOM 2023 deep dive; described, not scored",
     "truth_homes": None, "residential_floors": None, "source": "AECOM Downtown Houston study (direction only)"},
]
TOLERANCE = 0.15
DOWNTOWN_LONLAT = (-95.3698, 29.7604)     # where a hand-entered plate is placed; only its shape matters


def params_version() -> str:
    """Short hash of every parameter in config.py, so each result says which model produced it."""
    values = {k: v for k, v in vars(C).items() if k.isupper()}
    return hashlib.sha1(json.dumps(values, sort_keys=True, default=str).encode()).hexdigest()[:8]


def find_building(buildings: dict, address: str) -> dict | None:
    needle = address.lower()
    return next((b for b in buildings.values() if needle in str(b.get("address", "")).lower()), None)


def public_building(case: dict) -> dict:
    """A record for a building that isn't in our data: a rectangular floor from published dimensions.

    It has no rents, vacancy or value, so only the geometry and the home count mean anything.
    """
    p = case["public_plate"]
    x, y = Transformer.from_crs(4326, HOUSTON_EPSG, always_xy=True).transform(*DOWNTOWN_LONLAT)
    plate = box(x, y, x + p["length_ft"], y + p["width_ft"])
    return {"id": "public-" + case["address"].lower().replace(" ", "-"), "name": case["case"],
            "address": case["address"], "stories": p["stories"], "typical_floor_sf": p["width_ft"] * p["length_ft"],
            "footprint": to_lonlat(plate),
            "footprint_source": f"a {p['width_ft']} x {p['length_ft']} ft rectangle: {p['label']} ({p['source']})"}


def check_case(case: dict, buildings: dict) -> dict:
    b = find_building(buildings, case["address"])
    row = {k: case[k] for k in ("case", "role", "source")}
    inputs = "our data"
    if not b and case.get("public_plate"):
        b, inputs = public_building(case), f"{case['public_plate']['label']} ({case['public_plate']['source']})"
    if not b:
        return {**row, "status": "no data", "predicted": None, "truth": case["truth_homes"]}
    r = analyze(b, save=inputs == "our data")            # a hand-entered building is never cached as if it were data
    geometry = r["geometry"]
    per_floor = geometry["by_depth"][str(C.BASE_DEPTH_FT)]["homes_per_floor"]
    floors = case["residential_floors"] or geometry["residential_floors"]
    predicted = per_floor * floors
    row.update(building_id=b["id"], predicted=predicted, truth=case["truth_homes"], floors_used=floors,
               inputs=inputs, plate_source=geometry["plate_source"], deep_plate=geometry["deep_plate"])
    if case["truth_homes"] is None:
        verdict = (r.get("econ") or {}).get("verdict", {}).get("code")
        return {**row, "status": "compare by hand", "our_verdict": verdict}
    error = (predicted - case["truth_homes"]) / case["truth_homes"]
    missed = ["home count"] if abs(error) > TOLERANCE else []
    if "expect_deep_plate" in case and geometry["deep_plate"] != case["expect_deep_plate"]:
        missed.append("deep-plate branch")               # a pre-registered condition, so it counts toward pass / miss
    return {**row, "error_pct": round(100 * error, 1), "missed": missed, "status": "miss" if missed else "pass"}


def costar_only_plate(b: dict) -> dict:
    """The same building without Vexcel: a square floor with CoStar's typical floor area."""
    side = (b.get("typical_floor_sf") or 15_000) ** 0.5
    center = to_feet(b["footprint"]).centroid
    square = box(center.x - side / 2, center.y - side / 2, center.x + side / 2, center.y + side / 2)
    return {**b, "footprint": to_lonlat(square)}


def plate_name(b: dict, plate_source: str) -> str:
    """What the "with footprint" run actually used, in words for the Proof tab."""
    if plate_source == "matterport_scan":
        return "scanned floor"
    return "Vexcel outline" if b.get("footprint_origin") == "vexcel" else "square stand-in"


def input_sensitivity(buildings: dict) -> list[dict]:
    """Does the real plate change the answer? Shows sensitivity to the layer, not accuracy.

    "CoStar only" is a square of the typical floor. "With footprint" is the best plate we have: the scanned
    floor where a full-floor Matterport scan is saved, the footprint otherwise (plate_source says which).
    """
    rows = []
    for b in buildings.values():
        with_fp = analyze(b, save=False)
        without = analyze(costar_only_plate(b), save=False, use_scan=False)
        key = str(C.BASE_DEPTH_FT)
        rows.append({"building_id": b["id"], "name": b.get("name"),
                     "plate_source": with_fp["geometry"]["plate_source"],
                     "plate": plate_name(b, with_fp["geometry"]["plate_source"]),
                     "vexcel_verified": plate_name(b, with_fp["geometry"]["plate_source"]) == "Vexcel outline",
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
