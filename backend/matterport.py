"""Matterport: find the scans that belong to a building, and pull one floor's rooms and walls.

The Model API has no geographic search, so we use models_index.csv: one row per model the hackathon
keys can see, with its lat/lon and the CoStar property ID where known. Download it once with
    python -m scripts.check_keys --index
Everything we pull goes to data/ (git-ignored) and is deleted after the event.
"""
from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path

import httpx
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

from backend.data_sources import miles_between

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "data" / "raw" / "models_index.csv"
FLOORS_DIR = ROOT / "data" / "matterport"

API_URL = "https://api.matterport.com/api/models/graph"
INDEX_URL = ("https://static.matterport.com/hackathon/26.15.35-main-35-g24e0220/"
             "assets/quickstart/models_index.csv")

NEAR_M = 75                        # a scan this close to a building's lat/lon counts as inside it
METERS_PER_MILE = 1609.34
SQ_FT_PER_SQ_M = 10.7639

FLOOR_QUERY = """query Floor($id: ID!) { model(id: $id) {
  name
  geolocation { lat long }
  floors { id label vertices { id position { x y } } edges { id type thickness vertices { id } } }
  rooms { id floor { id } classifications { label confidence } boundary { edges { id } }
          dimensions(units: metric) { areaFloor width depth height } }
  panoLocations { id position { x y z } }
} }"""


def graph(query: str, variables: dict | None = None) -> dict:
    """Send one GraphQL query to the Model API. The key is the user name and the token is the password."""
    auth = (os.environ["MATTERPORT_API_KEY"], os.environ["MATTERPORT_API_TOKEN"])
    response = httpx.post(API_URL, json={"query": query, "variables": variables or {}}, auth=auth, timeout=60)
    response.raise_for_status()
    body = response.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"][0].get("message", "Matterport query failed"))
    return body["data"]


def fetch_floor(model_id: str) -> dict:
    """Pull a model's rooms and wall graph and save them to data/matterport/<id>.json."""
    model = graph(FLOOR_QUERY, {"id": model_id})["model"]
    FLOORS_DIR.mkdir(parents=True, exist_ok=True)
    (FLOORS_DIR / f"{model_id}.json").write_text(json.dumps(model, indent=1))
    return model


def load_floor(model_id: str) -> dict | None:
    path = FLOORS_DIR / f"{model_id}.json"
    return json.loads(path.read_text()) if path.exists() else None


def room_table(model: dict) -> list[dict]:
    """Rooms as {label, area_sf}, biggest first. Unlabelled rooms keep the label '(unlabelled)'."""
    rooms = []
    for room in model.get("rooms", []):
        labels = room.get("classifications") or []
        area_m2 = (room.get("dimensions") or {}).get("areaFloor") or 0
        rooms.append({"label": labels[0]["label"] if labels else "(unlabelled)",
                      "area_sf": round(area_m2 * SQ_FT_PER_SQ_M)})
    return sorted(rooms, key=lambda r: -r["area_sf"])


def load_index(path: Path = INDEX_PATH) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def looks_like_full_floor(row: dict) -> bool:
    """A guess from the model's name: '35th Floor', 'Level 53'. B checks the real area before we use it."""
    name = row.get("name", "")
    return bool(re.search(r"\b(floor|level)\b", name, re.I)) and not re.search(r"\d\s*b(r|ed)\b", name, re.I)


def scans_for(building: dict, index: list[dict]) -> list[dict]:
    """Scans that belong to a building: same CoStar property ID, or within NEAR_M of its lat/lon."""
    found = []
    for row in index:
        same_id = row.get("costar_property_id") and row["costar_property_id"] == str(building.get("id"))
        distance_m = None
        if row.get("lat") and row.get("lon") and building.get("lat") is not None and building.get("lon") is not None:
            distance_m = miles_between(building["lat"], building["lon"], float(row["lat"]), float(row["lon"])) * METERS_PER_MILE
        if same_id or (distance_m is not None and distance_m <= NEAR_M):
            found.append({"model_id": row["sid"], "name": row.get("name", ""),
                          "full_floor": looks_like_full_floor(row),
                          "panos": int(row.get("pano_count") or 0), "rooms": int(row.get("room_count") or 0),
                          "matched_by": "costar_id" if same_id else "distance",
                          "saved": (FLOORS_DIR / f"{row['sid']}.json").exists()})
    return sorted(found, key=lambda s: (not s["full_floor"], -s["panos"]))


def floor_outline(model: dict) -> Polygon | None:
    """The floor's outer outline from its wall graph, in the scan's own frame (metres). None if the walls don't close."""
    floors = model.get("floors") or []
    if not floors:
        return None
    points = {v["id"]: (v["position"]["x"], v["position"]["y"]) for v in floors[0]["vertices"]}
    walls = []
    for edge in floors[0]["edges"]:
        ends = [v["id"] for v in edge["vertices"]]
        if len(ends) == 2 and all(e in points for e in ends):
            walls.append(LineString([points[ends[0]], points[ends[1]]]))
    faces = list(polygonize(unary_union(walls)))
    if not faces:
        return None
    outline = unary_union(faces).buffer(0.3).buffer(-0.3)      # close hairline gaps between rooms
    if outline.geom_type == "MultiPolygon":
        outline = max(outline.geoms, key=lambda part: part.area)
    return Polygon(outline.exterior)
