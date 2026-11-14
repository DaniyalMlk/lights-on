"""Turn the CoStar kit (plus footprints and rent comps) into data/buildings.json.

The real CoStar column names are part of CoStar's confidential schema (event terms, section 3.2),
so they never go in this public repo. Put them in data/field_map.json (git-ignored), for example
{"id": "<their id column>", "vacancy": "<their vacancy column>"}, then run:
    python -m scripts.build_dataset --help
"""
from __future__ import annotations

import csv
import json
import math
import re
import statistics
from pathlib import Path

FIELD_MAP_FILE = Path(__file__).resolve().parent.parent / "data" / "field_map.json"

# our field name -> column name in the CoStar kit. Placeholders only: data/field_map.json overrides them.
DEFAULT_FIELD_MAP = {
    "id": "PropertyID",
    "name": "PropertyName",
    "address": "Address",
    "lat": "Latitude",
    "lon": "Longitude",
    "property_type": "PropertyType",
    "stories": "NumberOfStories",
    "rba": "RBA",
    "typical_floor_sf": "TypicalFloorSF",
    "vacancy": "VacancyPercent",
    "office_rent_psf_year": "AskingRentPerSF",
    "assessed_value": "AssessedValue",
    "year_built": "YearBuilt",
}


def load_field_map(path: Path = FIELD_MAP_FILE) -> dict:
    """The placeholders, with the real column names from data/field_map.json on top when that file exists."""
    field_map = dict(DEFAULT_FIELD_MAP)
    if path.exists():
        field_map.update(json.loads(path.read_text()))
    return field_map


FIELD_MAP = load_field_map()
NUMERIC ={"lat", "lon", "stories", "rba", "typical_floor_sf", "vacancy", "office_rent_psf_year",
           "assessed_value", "year_built"}

COMPS_RADIUS_MILES = 0.75     # multifamily comps within this distance set the rent
MIN_COMPS = 3


def read_rows(path: str | Path) -> list[dict]:
    """Read a .csv, .json (list or {"records": [...]}) or .jsonl file into a list of dicts."""
    path = Path(path)
    if path.suffix == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    if path.suffix == ".jsonl":
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    data = json.loads(path.read_text())
    if isinstance(data, dict):
        data = next((v for v in data.values() if isinstance(v, list)), [])
    return data


def to_number(value):
    """'$1,234.5' -> 1234.5, '25%' -> 25.0, '' -> None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    cleaned = re.sub(r"[^\d.\-]", "", str(value))
    return float(cleaned) if cleaned not in ("", "-", ".") else None


def normalize(row: dict, field_map: dict = FIELD_MAP) -> dict:
    out = {}
    for ours, theirs in field_map.items():
        value = row.get(theirs)
        out[ours] = to_number(value) if ours in NUMERIC else value
    if out.get("vacancy") is not None and out["vacancy"] > 1:      # 62 -> 0.62
        out["vacancy"] = out["vacancy"] / 100
    if out.get("stories"):
        out["stories"] = int(out["stories"])
    out["id"] = str(out["id"])
    return out


def miles_between(lat1, lon1, lat2, lon2) -> float:
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def comps_rent(b: dict, comps: list[dict]) -> tuple[float | None, int]:
    """Median monthly multifamily rent per SF of comps near the building."""
    if b.get("lat") is None or b.get("lon") is None:
        return None, 0
    nearby = [c["rent_psf_month"] for c in comps
              if c.get("rent_psf_month") and miles_between(b["lat"], b["lon"], c["lat"], c["lon"]) <= COMPS_RADIUS_MILES]
    if len(nearby) < MIN_COMPS:
        return None, len(nearby)
    return statistics.median(nearby), len(nearby)


def build_buildings(costar_rows: list[dict], footprints: dict, comps: list[dict] | None = None,
                    office_only: bool = True, field_map: dict = FIELD_MAP) -> tuple[list[dict], list[dict]]:
    """Join CoStar records with footprints (by id) and rent comps. Returns (buildings, skipped with reasons)."""
    buildings, skipped = [], []
    for row in costar_rows:
        b = normalize(row, field_map)
        if office_only and b.get("property_type") and "office" not in str(b["property_type"]).lower():
            continue
        reasons = []
        if b["id"] not in footprints:
            reasons.append("no footprint")
        if not b.get("stories"):
            reasons.append("no stories")
        if reasons:
            skipped.append({"id": b["id"], "name": b.get("name"), "reasons": reasons})
            continue
        b["footprint"] = footprints[b["id"]]
        b["mf_rent_psf_month"], b["rent_comps_used"] = comps_rent(b, comps or [])
        b["synthetic"] = False
        buildings.append(b)
    return buildings, skipped


def load_footprints(geojson_path: str | Path, id_property: str = "PropertyID") -> dict:
    """GeoJSON FeatureCollection of building footprints -> {building id: polygon}."""
    data = json.loads(Path(geojson_path).read_text())
    out = {}
    for f in data["features"]:
        geom = f["geometry"]
        if geom["type"] == "MultiPolygon":       # keep the biggest part (the tower)
            rings = max(geom["coordinates"], key=lambda poly: len(poly[0]))
            geom = {"type": "Polygon", "coordinates": rings}
        out[str(f["properties"][id_property])] = geom
    return out
