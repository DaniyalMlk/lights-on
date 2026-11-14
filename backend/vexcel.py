"""Vexcel: the outline of a building as seen from the air (Houston and LA only).

One call per building to the property endpoint, saved to data/vexcel/property_<id>.json (git-ignored,
deleted with the rest of the sponsor data on Sunday), so rebuilding the data never calls it twice.

The outline is the whole building at ground level. For a tower with a podium, an attached garage or a
neighbour it shares walls with, that is much bigger than an office floor. So we only use it as the floor
plate when its area is within 15% of CoStar's typical floor; otherwise the square stand-in stays.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
from shapely import wkt
from shapely.geometry import mapping

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "vexcel"

API_URL = "https://api.vexcelgroup.com/v2/property/extract"
LAYERS = "urban,urban-r,wide-area,urban-g"
MATCH = (0.85, 1.15)       # outline area / typical floor; outside this it isn't an office floor (guess)
SOURCE = "the Vexcel outline, within 15% of the typical floor"


def fetch_property(building_id: str, lat: float, lon: float, cache_dir: Path = CACHE_DIR) -> dict | None:
    """The saved property record, or a fresh one if VEXCEL_API_KEY is set. None if there's nothing at this point."""
    path = cache_dir / f"property_{building_id}.json"
    if path.exists():
        return json.loads(path.read_text())
    key = os.environ.get("VEXCEL_API_KEY")
    if not key:
        return None
    response = httpx.get(API_URL, headers={"X-API-KEY": key}, timeout=120, params={
        "wkt": f"POINT({lon} {lat})", "srid": 4326,      # WKT is longitude first
        "layer": LAYERS, "latest": "true", "include": "precomputed", "unit-system": "imperial"})
    if response.status_code == 404:
        return None                                     # a street, water, or outside Vexcel's coverage
    response.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(response.text)
    return response.json()


def main_structure(prop: dict | None) -> dict | None:
    """The building on the parcel that Vexcel marks as primary (the first one if none is marked)."""
    features = (prop or {}).get("features") or []
    structures = features[0]["properties"].get("structures") or [] if features else []
    primary = [s for s in structures if s.get("primary-structure")]
    return (primary or structures or [None])[0]


def floor_outline(prop: dict | None, typical_floor_sf: float | None) -> tuple[dict | None, float | None]:
    """(outline as a GeoJSON Polygon in lon/lat, outline area / typical floor).

    The outline is None when the ratio is outside MATCH: then it's the base of the building, not a floor.
    """
    s = main_structure(prop)
    if not s or not s.get("footprint.wkt") or not s.get("footprint.area") or not typical_floor_sf:
        return None, None
    ratio = s["footprint.area"] / typical_floor_sf
    if not MATCH[0] <= ratio <= MATCH[1]:
        return None, ratio
    outline = wkt.loads(s["footprint.wkt"])
    if outline.geom_type == "MultiPolygon":
        outline = max(outline.geoms, key=lambda g: g.area)
    return mapping(outline), ratio


def apply_outlines(buildings: list[dict], cache_dir: Path = CACHE_DIR) -> None:
    """Swap the square stand-in for the Vexcel outline wherever it passes the 15% check. Edits in place."""
    for b in buildings:
        outline, ratio = floor_outline(fetch_property(b["id"], b["lat"], b["lon"], cache_dir), b.get("typical_floor_sf"))
        b["vexcel_ratio"] = round(ratio, 2) if ratio else None
        if outline:
            b["footprint"] = outline
            b["footprint_source"] = SOURCE
            b["footprint_origin"] = "vexcel"
