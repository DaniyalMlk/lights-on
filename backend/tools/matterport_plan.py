"""Turn a saved Matterport floor into a floor plate and, when the scan shows one, a core. Both in feet.

The scan's wall graph is in metres in the model's own frame (not north-aligned), so the plate and the
core always come from the same scan. Never place a scan's core inside a georeferenced footprint.

    plate = the outer outline of the walls (backend.matterport.floor_outline), converted to feet
    core  = the parts of the plate that no scanned room covers (elevators and stairs usually aren't scanned),
            plus rooms labelled Void / Elevator / Stair / Restroom

Columns show up as tiny voids too, so small pieces are dropped, and what's left only counts as a core
if it adds up to a believable share of the floor. Otherwise the core is None and the caller keeps the
assumed centered core (config.CORE_SHARE).
"""
from __future__ import annotations

from shapely.affinity import scale
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

from backend.matterport import floor_outline

FT_PER_M = 3.28084
MIN_COVERAGE = 0.85            # a scan this much smaller than the typical floor is a suite, not the whole floor
CORE_WORDS = ("void", "elevator", "stair", "restroom")
WALL_GAP_FT = 1.0              # slivers thinner than two of these are wall thickness, not space
MIN_CORE_PART_SF = 100.0       # smaller unscanned pieces are columns and risers (guess)
CORE_SHARE_RANGE = (0.05, 0.40)   # outside this share of the plate, the scan isn't showing us a core (guess)


def _is_core_label(label: str | None) -> bool:
    return bool(label) and any(word in label.lower() for word in CORE_WORDS)


def _room_polygons(model: dict) -> list[tuple[str | None, Polygon]]:
    """Each room on the scanned floor as (label, polygon in feet), built from the room's own wall edges."""
    level = model["floors"][0]
    points = {v["id"]: (v["position"]["x"] * FT_PER_M, v["position"]["y"] * FT_PER_M) for v in level["vertices"]}
    walls = {}
    for edge in level["edges"]:
        ends = [v["id"] for v in edge["vertices"]]
        if len(ends) == 2 and all(e in points for e in ends):
            walls[edge["id"]] = LineString([points[ends[0]], points[ends[1]]])

    rooms = []
    for room in model.get("rooms") or []:
        if (room.get("floor") or {}).get("id", level["id"]) != level["id"]:
            continue                                     # a room on another level of the same model
        lines = [walls[e["id"]] for e in (room.get("boundary") or {}).get("edges") or [] if e["id"] in walls]
        faces = list(polygonize(unary_union(lines))) if lines else []
        if faces:
            labels = room.get("classifications") or []
            # The biggest face is the room itself; smaller ones are holes inside it (columns, shafts).
            rooms.append((labels[0]["label"] if labels else None, max(faces, key=lambda f: f.area)))
    return rooms


def plate_and_core(model: dict) -> tuple[Polygon | None, BaseGeometry | None]:
    """(plate, core) in feet from one saved floor. (None, None) if the walls don't close; core None if not shown."""
    outline = floor_outline(model)
    if outline is None:
        return None, None
    plate = orient(scale(outline, FT_PER_M, FT_PER_M, origin=(0, 0)))

    rooms = _room_polygons(model)
    scanned = [polygon for label, polygon in rooms if not _is_core_label(label)]
    if not scanned:
        return plate, None                               # no room outlines: nothing to tell a core from
    labelled_core = unary_union([polygon for label, polygon in rooms if _is_core_label(label)])
    unscanned = plate.difference(unary_union(scanned).difference(labelled_core))
    opened = unscanned.buffer(-WALL_GAP_FT).buffer(WALL_GAP_FT)     # drops wall-thickness slivers
    parts = [p for p in getattr(opened, "geoms", [opened]) if p.geom_type == "Polygon" and p.area >= MIN_CORE_PART_SF]
    core_sf = sum(p.area for p in parts)
    low, high = CORE_SHARE_RANGE
    if not low <= core_sf / plate.area <= high:
        return plate, None
    return plate, unary_union(parts).intersection(plate)


def coverage(plate: Polygon, typical_floor_sf: float) -> float:
    """Scanned plate area as a share of the typical floor. Under MIN_COVERAGE it's a suite, not a floor."""
    return plate.area / typical_floor_sf
