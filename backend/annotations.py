"""Labels for a scanned floor, placed in the scan's own 3D frame so the Matterport tour can show them in place.

Every label says how we know it:
  measured  computed from the scan's walls; the same answer every time
  checked   the scan compared with a second source
  assumed   not in the scan; our assumption, for a person to confirm
  estimate  what our screen proposes (an indicative layout, not a design)

Besides the labels for the floor as a whole, every room in the scan gets one label of its own (room_labels):
is it on the floor's outer wall, and how much of it is within reach of daylight. Both are measured.
"""
from __future__ import annotations

import statistics

from shapely.affinity import scale
from shapely.errors import ShapelyError
from shapely.geometry.polygon import orient

from backend import config as C
from backend.matterport import floor_outline
from backend.tools.geometry import analyze_plate
from backend.tools.layout import layout_units, plan_xy
from backend.tools.matterport_plan import _room_polygons

FT_PER_M = 3.28084
MIN_COVERAGE = 0.85          # a scan this much smaller than the typical floor is a suite, not the whole floor
DEFAULT_HEIGHT_M = 1.5       # about eye height, if the scan has no camera positions
ROOM_MIN_SF = 25.0           # smaller closed shapes are columns and shafts, not rooms (guess)
OUTER_WALL_FT = 2.0          # a room wall this close to the floor's outline is the outer wall
OUTER_WALL_MIN_FT = 5.0      # and it has to run along the outline at least this far, not just touch a corner


def _largest(geom):
    return max(getattr(geom, "geoms", [geom]), key=lambda part: part.area)


def _position(point_ft, height_m: float) -> dict:
    """A point on our plan (feet) back in the scan's frame: metres, z up."""
    return {"x": round(point_ft.x / FT_PER_M, 2), "y": round(point_ft.y / FT_PER_M, 2), "z": round(height_m, 2)}


def _spot(point_ft, height_m: float, plate) -> dict:
    """Where a label goes: in the 3D tour (position) and on the floor plate drawing (plan, feet)."""
    x, y = plan_xy(point_ft.x, point_ft.y, plate)
    return {"position": _position(point_ft, height_m), "plan": {"x": round(x, 1), "y": round(y, 1)}}


def room_labels(model: dict, plate, height_m: float) -> list[dict]:
    """One label per room of the scan, from the room's own walls. Nothing here is assumed except that the
    outer wall is glazed (the scan doesn't mark windows), and each label says so."""
    reach = plate.difference(plate.buffer(-C.BASE_DEPTH_FT))            # the part of the floor within 36 ft of the outline
    along_outline = plate.exterior.buffer(OUTER_WALL_FT)
    labels = []
    for scan_type, room in _room_polygons(model):
        if room.area < ROOM_MIN_SF or (scan_type or "").lower() == "void":
            continue                                                    # Matterport's "Void" is a hole, not a room
        on_outer_wall = room.exterior.intersection(along_outline).length >= OUTER_WALL_MIN_FT
        share = min(1.0, room.intersection(reach).area / room.area)
        in_reach = "all of it" if share >= 0.995 else f"{share:.0%} of it"
        typed = (f"Matterport's type for this room: {scan_type}." if scan_type
                 else "Matterport gives this room no type.")
        if on_outer_wall:
            title = f"Room on the outer wall: {in_reach} within {C.BASE_DEPTH_FT} ft"
            detail = (f"Measured from this room's walls in the scan: it runs along the floor's outer wall, and {in_reach} "
                      f"lies within {C.BASE_DEPTH_FT} ft of that wall. The scan doesn't mark windows, so the outer wall "
                      f"counts as glazed. {typed}")
        else:
            title = "Interior room: no outer wall"
            detail = (f"Measured from this room's walls in the scan: none of them is on the floor's outer wall, so it "
                      f"has no window. {in_reach[0].upper() + in_reach[1:]} lies within {C.BASE_DEPTH_FT} ft of the outer wall. {typed}")
        label = {"kind": "measured", "title": title, "detail": detail, "typed": bool(scan_type),
                 **_spot(room.representative_point(), height_m, plate)}
        if not on_outer_wall:
            label["tone"] = "interior"                                  # drawn in its own color, in the tour and the panel
        labels.append(label)
    return labels


def floor_labels(model: dict, typical_floor_sf: float | None = None) -> dict:
    """Labels for one scanned floor. Returns {"labels": [...], "coverage": share or None, "reason": why there are none},
    plus "rooms" (one label per room) and "room_summary" (how many, and how many Matterport gives a type)."""
    outline = floor_outline(model)
    if outline is None:
        return {"labels": [], "coverage": None, "reason": "the scan's walls don't close into an outline"}

    plate = orient(scale(outline, FT_PER_M, FT_PER_M, origin=(0, 0)))
    coverage = plate.area / typical_floor_sf if typical_floor_sf else None
    if coverage is not None and coverage < MIN_COVERAGE:
        return {"labels": [], "coverage": coverage,
                "reason": f"the scan covers {coverage:.0%} of the typical floor: a suite, not the whole floor"}

    heights = [p["position"]["z"] for p in model.get("panoLocations") or []]
    height_m = statistics.median(heights) if heights else DEFAULT_HEIGHT_M

    geo = analyze_plate(plate)
    base = geo["by_depth"][C.BASE_DEPTH_FT]
    layout = layout_units(plate, base.units, base.effective_depth_ft, geo["core"])
    homes = [u for u in layout["units"] if u["homes"]]
    window_spot = homes[0]["poly"] if homes else _largest(base.units)
    homes_spot = homes[len(homes) // 2]["poly"] if homes else geo["core"]

    labels = [{
        "kind": "measured",
        "title": f"Within {C.BASE_DEPTH_FT} ft of a window: {base.daylight_share:.0%} of the floor outside the core",
        "detail": "Measured from the scan's walls. The scan doesn't mark windows, so the whole facade counts as glazed.",
        **_spot(window_spot.representative_point(), height_m, plate),
    }]
    if base.dark_sf >= 1:
        labels.append({
            "kind": "measured",
            "title": f"Dark zone: {base.dark_sf:,.0f} sf",
            "detail": f"More than {C.BASE_DEPTH_FT} ft from any window, outside the corridor and core: no bedrooms here.",
            **_spot(_largest(base.dark).representative_point(), height_m, plate),
        })
    labels.append({
        "kind": "assumed",
        "title": "Core: assumed, not in the scan",
        "detail": f"Elevators and stairs aren't in the scan's walls. We assume a centered core of "
                  f"{C.CORE_SHARE:.0%} of the floor; a person should confirm it.",
        **_spot(geo["core"].centroid, height_m, plate),
    })
    labels.append({
        "kind": "checked" if coverage is not None else "measured",
        "title": f"Floor: {plate.area:,.0f} sf inside the walls",
        "detail": (f"{coverage:.0%} of the typical floor in CoStar, so the scan covers the whole floor."
                   if coverage is not None else "Measured from the scan. No second source to compare with."),
        **_spot(_largest(base.corridor).representative_point(), height_m, plate),
    })
    labels.append({
        "kind": "estimate",
        "title": f"About {layout['homes_per_floor']} homes fit on this floor",
        "detail": f"Indicative layout at {C.BASE_DEPTH_FT} ft unit depth from the scan's outline: a screening estimate, not a design.",
        **_spot(homes_spot.representative_point(), height_m, plate),
    })
    try:
        rooms = room_labels(model, plate, height_m)
    except ShapelyError:
        rooms = []                                   # a room shape we can't measure must not cost the floor its labels
    interior = sum(room.get("tone") == "interior" for room in rooms)
    summary = {"total": len(rooms), "outer_wall": len(rooms) - interior, "interior": interior,
               "typed": sum(room.pop("typed") for room in rooms)}
    return {"labels": labels, "coverage": coverage, "reason": None, "rooms": rooms, "room_summary": summary}
