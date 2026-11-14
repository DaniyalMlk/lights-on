"""Daylight geometry: which part of an office floor plate can become apartments.

All inputs and outputs are in feet. Pure functions, no I/O.
How we split a floor:
    units band = everything within D ft of a facade (minus the core and its corridor)
    corridor   = a 6 ft ring behind the units, plus a ring around the core
    dark zone  = what's left between corridor and core -> storage / coworking / amenity (what Elev8 did)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely import affinity, maximum_inscribed_circle
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from backend import config as C


@dataclass
class DepthResult:
    depth_ft: float
    effective_depth_ft: float      # narrow plates cap the unit depth (units on both sides of a central corridor)
    units_sf: float
    corridor_sf: float
    dark_sf: float
    daylight_share: float          # units / (plate - core)
    units: BaseGeometry = field(repr=False)
    corridor: BaseGeometry = field(repr=False)
    dark: BaseGeometry = field(repr=False)


def centered_core(plate: Polygon, core_share: float = C.CORE_SHARE) -> Polygon:
    """Placeholder core when Matterport doesn't give one: the plate scaled about its centroid."""
    f = math.sqrt(core_share)
    core = affinity.scale(plate, xfact=f, yfact=f, origin="centroid")
    return core.intersection(plate)


def zones(plate: Polygon, core: BaseGeometry, depth_ft: float, corridor_ft: float = C.CORRIDOR_FT) -> DepthResult:
    """Split one floor plate into units / corridor / dark zone / core at a given unit depth."""
    # On a narrow plate the units on both sides meet a central corridor before reaching full depth.
    half_width = maximum_inscribed_circle(plate).length
    depth = min(depth_ft, max(half_width - corridor_ft / 2, 0))

    core = core.intersection(plate)
    core_ring = core.buffer(corridor_ft).intersection(plate)
    inner = plate.buffer(-depth)
    inner2 = plate.buffer(-(depth + corridor_ft))

    units = plate.difference(inner).difference(core_ring)
    # One corridor: the ring behind the units, plus the core ring only where it clips the units (shallow wings).
    corridor = (inner.difference(inner2).union(core_ring.difference(core).difference(inner2)))
    corridor = corridor.intersection(plate).difference(units).difference(core)
    dark = plate.difference(units).difference(corridor).difference(core)

    usable = plate.area - core.area
    share = units.area / usable if usable > 0 else 0.0
    return DepthResult(depth_ft, depth, units.area, corridor.area, dark.area, share, units, corridor, dark)


def core_to_window(plate: Polygon, core: BaseGeometry) -> dict:
    """Distance from the facade to the core: min and a rough mean over facade sample points."""
    ring = plate.exterior
    n = max(40, int(ring.length // 10))
    dists = [ring.interpolate(i / n, normalized=True).distance(core) for i in range(n)]
    return {"min_ft": min(dists), "mean_ft": sum(dists) / len(dists), "max_ft": max(dists)}


def floor_check(plate: Polygon, typical_floor_sf: float | None) -> dict:
    """Footprint vs CoStar typical floor. ratio < 0.8 means the tower floor is smaller than the footprint (podium)."""
    if not typical_floor_sf:
        return {"ratio": None, "flag": "no_typical_floor", "branch": None}
    ratio = typical_floor_sf / plate.area
    if ratio < C.PODIUM_RATIO:
        flag, branch = "podium_or_setback", "podium"
    elif ratio > 1.2:
        flag, branch = "footprint_smaller_than_floor_check_data", None
    else:
        flag, branch = "ok", None
    return {"ratio": round(ratio, 3), "flag": flag, "branch": branch}


def floor_to_floor(height_ft: float | None, stories: int | None) -> dict:
    """Roof height / stories. A flag only, never a score input."""
    if not height_ft or not stories:
        return {"f2f_ft": None, "flag": "unknown"}
    f2f = height_ft / stories
    flag = "red" if f2f < C.F2F_RED_FT else "amber" if f2f < C.F2F_AMBER_FT else "ok"
    return {"f2f_ft": round(f2f, 2), "flag": flag}


def analyze_plate(plate: Polygon, core: BaseGeometry | None = None, depths=C.DEPTHS_FT) -> dict:
    """Run all depths. Returns plain numbers plus the shapely zones for drawing."""
    core_source = "matterport" if core is not None else "assumed_centered"
    core = core if core is not None else centered_core(plate)
    results = {d: zones(plate, core, d) for d in depths}
    base = results[C.BASE_DEPTH_FT]
    dark_share = base.dark_sf / plate.area if plate.area else 0.0
    c2w = core_to_window(plate, core)
    dark_band_ft = c2w["mean_ft"] - C.BASE_DEPTH_FT - C.CORRIDOR_FT
    return {
        "plate_sf": plate.area,
        "core_sf": core.area,
        "core_source": core_source,
        "facade_ft": plate.exterior.length,
        "core_to_window": c2w,
        "by_depth": results,
        "base_daylight_share": base.daylight_share,
        "base_dark_share": dark_share,
        "dark_band_ft": dark_band_ft,
        "deep_plate": dark_band_ft > C.DARK_BAND_BRANCH_FT,
        "core": core,
    }
