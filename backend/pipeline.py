"""Run every tool on one building and save the results to work/<building_id>/.

The agent and the API both read these files. That's what lets the verifier check
that every number shown to a user came from here.
"""
from __future__ import annotations

import json
from pathlib import Path

from backend import config as C
from backend import matterport
from backend.tools.carbon import scenarios
from backend.tools.econ import econ
from backend.tools.geo import to_feet
from backend.tools.geometry import analyze_plate, floor_check, floor_to_floor
from backend.tools.layout import layout_units, render_svg
from backend.tools.matterport_plan import MIN_COVERAGE, coverage, plate_and_core

ROOT = Path(__file__).resolve().parent.parent
WORK_DIR = ROOT / "work"


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def score(daylight_share: float, econ_out: dict | None, b: dict) -> dict:
    """0-100 score. Weights live in config.py and are frozen at H8."""
    w = C.SCORE_WEIGHTS
    geometry = _clamp((daylight_share - 0.40) / 0.45)

    economics = 0.5
    if econ_out and b.get("assessed_value"):
        gfa = econ_out["inputs"]["gfa"]
        gap = econ_out["cases"]["base"]["residual_per_gsf"] - b["assessed_value"] / gfa
        economics = _clamp(0.5 + gap / 200)          # +/- $100 per SF around today's basis

    market = 0.5
    if b.get("mf_rent_psf_month") and b.get("office_rent_psf_year"):
        ratio = b["mf_rent_psf_month"] * 12 / b["office_rent_psf_year"]
        market = _clamp((ratio - 0.8) / 0.8)

    context = 0.5                                     # TODO: Vexcel surroundings once we have the attributes

    parts = {"geometry": geometry, "economics": economics, "market": market, "context": context}
    total = sum(parts[k] * w[k] for k in w)
    return {"total": round(total, 1), "parts": {k: round(v * w[k], 1) for k, v in parts.items()}}


def scan_plate(b: dict) -> dict | None:
    """The building's real floor plate from a saved full-floor Matterport scan, or None to keep its footprint.

    Same rule as the 3D labels: the scan has to cover at least 85% of the typical floor, otherwise it's a suite.
    The plate is in the scan's own frame (feet, not north-aligned), so it replaces the footprint for the
    geometry only; the map keeps drawing the georeferenced footprint.
    """
    if b.get("synthetic") or not b.get("typical_floor_sf"):
        return None                                      # sample buildings never get real scans; no floor size, no check
    for scan in matterport.scans_for(b, matterport.load_index()):
        model = matterport.load_floor(scan["model_id"]) if scan["full_floor"] else None
        if not model:
            continue
        plate, core = plate_and_core(model)
        if plate is None or coverage(plate, b["typical_floor_sf"]) < MIN_COVERAGE:
            continue
        return {"plate": plate, "core": core, "model_id": scan["model_id"], "matched_by": scan["matched_by"],
                "coverage": coverage(plate, b["typical_floor_sf"])}
    return None


def analyze(b: dict, save: bool = True, use_scan: bool = True) -> dict:
    """Run every tool on one building. use_scan=False keeps the footprint even if a scan is saved (for comparisons)."""
    scan = scan_plate(b) if use_scan else None
    plate = scan["plate"] if scan else to_feet(b["footprint"])
    if scan:
        plate_label = f"the walls of a scanned full floor (Matterport model {scan['model_id']})"
        plate_source = "matterport.scan"
    else:
        plate_label = b.get("footprint_source")
        plate_source = plate_label or "vexcel.footprint"
    stories = int(b["stories"])
    residential_floors = max(stories - C.NON_RESIDENTIAL_FLOORS, 1)
    gfa = b.get("rba") or plate.area * stories
    gfa_source = "costar.rba" if b.get("rba") else f"{plate_source} x costar.stories"

    geo = analyze_plate(plate, scan["core"] if scan else None)      # core=None keeps the assumed centered core
    by_depth, layouts = {}, {}
    for depth, z in geo["by_depth"].items():
        lay = layout_units(plate, z.units, z.effective_depth_ft, geo["core"])
        layouts[depth] = lay
        home_sf = sum(u["area_sf"] for u in lay["units"] if u["homes"])
        by_depth[str(depth)] = {
            "effective_depth_ft": round(z.effective_depth_ft, 1),
            "units_sf": round(z.units_sf),
            "corridor_sf": round(z.corridor_sf),
            "dark_sf": round(z.dark_sf),
            "daylight_share": round(z.daylight_share, 3),
            "homes_per_floor": lay["homes_per_floor"],
            "homes": lay["homes_per_floor"] * residential_floors,
            "mix_per_floor": lay["mix"],
            "home_nsf_per_floor": round(home_sf),
            "layout_method": lay["method"],
        }

    base = by_depth[str(C.BASE_DEPTH_FT)]
    share = base["daylight_share"]
    near_threshold = any(abs(share - t) <= C.MATTERPORT_BORDERLINE for t in C.DAYLIGHT_THRESHOLDS)

    geometry_out = {
        "plate_sf": round(plate.area),
        "plate_source": "matterport_scan" if scan else "footprint",
        "scan_model_id": scan["model_id"] if scan else None,
        "scan_matched_by": scan["matched_by"] if scan else None,
        "scan_coverage_share": round(scan["coverage"], 3) if scan else None,
        "core_sf": round(geo["core_sf"]),
        "core_source": geo["core_source"],
        "facade_ft": round(geo["facade_ft"]),
        "core_to_window_ft": {k: round(v, 1) for k, v in geo["core_to_window"].items()},
        "dark_band_ft": round(geo["dark_band_ft"], 1),
        "deep_plate": geo["deep_plate"],
        "floor_check": floor_check(plate, b.get("typical_floor_sf")),
        "floor_to_floor": floor_to_floor(b.get("height_ft"), stories),
        "residential_floors": residential_floors,
        "gfa_sf": round(gfa),
        "gfa_source": gfa_source,
        "by_depth": by_depth,
        "matterport_worth_pulling": near_threshold and geo["core_source"] != "matterport",
        "source": f"{plate_source} + costar.stories + config.py",
    }

    econ_out = None
    if b.get("mf_rent_psf_month"):
        nsf = base["home_nsf_per_floor"] * residential_floors
        econ_out = econ(b["mf_rent_psf_month"], nsf, gfa, share, b.get("assessed_value"))
        econ_out["inputs"]["reference_label"] = b.get("reference_source") or "assessed value"
        econ_out["source"] = "costar.multifamily_comps + costar reference value + config.py"

    carbon_out = scenarios(gfa, base["homes"])
    carbon_out["source"] = "config.py (embodied carbon literature range)"

    gated = (b.get("vacancy") or 0) < C.VACANCY_GATE
    result = {
        "building": {**{k: v for k, v in b.items() if k != "footprint"},
                     **({"footprint_source": plate_label} if plate_label else {})},
        "gated_out": gated,
        "geometry": geometry_out,
        "econ": econ_out,
        "carbon": carbon_out,
        "score": score(share, econ_out, b),
    }
    if save:
        save_result(b["id"], result, render_svg(plate, geo["core"], geo["by_depth"][C.BASE_DEPTH_FT],
                                               layouts[C.BASE_DEPTH_FT]["units"], b.get("name", b["id"])))
    return result


def save_result(building_id: str, result: dict, svg: str) -> None:
    folder = WORK_DIR / building_id
    folder.mkdir(parents=True, exist_ok=True)
    for key in ("building", "geometry", "econ", "carbon", "score"):
        (folder / f"{key}.json").write_text(json.dumps(result[key], indent=2))
    (folder / "status.json").write_text(json.dumps({"gated_out": result["gated_out"]}))
    (folder / "plate.svg").write_text(svg)


def load_result(building_id: str) -> dict | None:
    folder = WORK_DIR / building_id
    if not folder.exists():
        return None
    out = {}
    for f in folder.glob("*.json"):
        out[f.stem] = json.loads(f.read_text())
    out["gated_out"] = out.pop("status", {}).get("gated_out", False)
    return out
