"""Draw apartments on the units band and count homes per floor.

Method: walk the facade (exterior ring). Each corner keeps a D x D square (a 2BR).
Between corners, cut the band perpendicular to the facade every unit width,
alternating 1BR / studio (width = unit area / depth). Pieces too small to be a home
become storage. If anything fails, fall back to: facade length / average unit width.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize, unary_union

from backend import config as C

MIN_EDGE_FT = 12.0
MIN_DEPTH_FT = 15.0


def _parts(geom: BaseGeometry) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def _cut_lines(plate: Polygon, blocked: BaseGeometry, depth: float) -> list[LineString]:
    """Cut lines perpendicular to the facade, one per unit boundary.

    The width of each unit is its area divided by the depth available at that spot
    (the depth shrinks where the core gets close to the window). Where less than
    MIN_DEPTH_FT is left, we cut 10 ft chunks: those become storage.
    """
    sizes = [C.UNIT_SF["1br"], C.UNIT_SF["studio"]]
    simple = plate.simplify(2.0, preserve_topology=True)
    coords = list(simple.exterior.coords)
    lines = []
    for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
        length = math.hypot(x1 - x0, y1 - y0)
        if length < MIN_EDGE_FT or length <= 2 * depth:
            continue
        ux, uy = (x1 - x0) / length, (y1 - y0) / length
        nx, ny = -uy, ux                      # points into the building (exterior ring is counter-clockwise)

        positions = [depth]                   # keep a depth x depth square at each corner for a 2BR
        t, i = depth, 0
        while t < length - depth:
            spot = Point(x0 + ux * t + nx, y0 + uy * t + ny)
            local_depth = min(depth, spot.distance(blocked)) if not blocked.is_empty else depth
            step = 10.0 if local_depth < MIN_DEPTH_FT else sizes[i % 2] / local_depth
            t += step
            i += 1
            positions.append(min(t, length - depth))

        for t in sorted(set(round(p, 2) for p in positions)):
            px, py = x0 + ux * t, y0 + uy * t
            lines.append(LineString([(px - nx * 2, py - ny * 2), (px + nx * (depth + 2), py + ny * (depth + 2))]))
    return lines


def classify(area_sf: float) -> str:
    if area_sf >= 0.9 * C.UNIT_SF["2br"]:
        return "2br"
    if area_sf >= 0.9 * C.UNIT_SF["1br"]:
        return "1br"
    if area_sf >= C.MIN_HOME_SF:
        return "studio"
    return "storage"


def layout_units(plate: Polygon, units_band: BaseGeometry, depth: float, core: BaseGeometry | None = None) -> dict:
    """Return unit polygons with types and the per-floor count."""
    blocked = core.buffer(C.CORRIDOR_FT) if core is not None else Polygon()
    try:
        # Cut all at once: polygonize the band's boundary together with every cut line.
        lines = _cut_lines(plate, blocked, depth)
        noded = unary_union([units_band.boundary, *lines])
        pieces = [p for p in polygonize(noded) if units_band.contains(p.representative_point())]
        units = []
        for p in pieces:
            kind = classify(p.area)
            # Oversized pieces (long straight runs the cutter missed) count as several homes.
            n = max(1, int(p.area // C.UNIT_SF["1br"])) if p.area > 2.2 * C.UNIT_SF["2br"] else 1
            units.append({"type": kind, "area_sf": round(p.area, 1), "homes": 0 if kind == "storage" else n, "poly": p})
        method = "facade_cut"
    except Exception:  # never let drawing kill the screen
        units, method = [], "fallback"

    homes = sum(u["homes"] for u in units)
    avg_width = (C.UNIT_SF["1br"] + C.UNIT_SF["studio"]) / 2 / depth
    fallback = int(plate.exterior.length // avg_width)
    if method == "fallback" or homes == 0:
        homes, method = fallback, "fallback"
    mix = {}
    for u in units:
        if u["homes"]:
            mix[u["type"]] = mix.get(u["type"], 0) + u["homes"]
    return {"homes_per_floor": homes, "mix": mix, "units": units, "method": method,
            "fallback_homes_per_floor": fallback}


def render_svg(plate: Polygon, core: BaseGeometry, zones, units: list[dict], title: str = "") -> str:
    """Floor plate SVG: units warm ('lights on'), corridor grey, dark zone black, core charcoal."""
    minx, miny, maxx, maxy = plate.bounds
    pad = 10
    w, h = maxx - minx + 2 * pad, maxy - miny + 2 * pad

    def path(g: BaseGeometry) -> str:
        out = []
        for p in _parts(g):
            for ring in [p.exterior, *p.interiors]:
                pts = " L ".join(f"{x - minx + pad:.1f},{maxy - y + pad:.1f}" for x, y in ring.coords)
                out.append(f"M {pts} Z")
        return " ".join(out)

    fill = {"2br": "#FFC857", "1br": "#FFD98A", "studio": "#FFE8B5", "storage": "#5A5A5A"}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="{title}">',
        f'<path d="{path(plate)}" fill="#1B1B1F" stroke="#E6E6E6" stroke-width="1.5"/>',
        f'<path d="{path(zones.dark)}" fill="#111114"/>',
        f'<path d="{path(zones.corridor)}" fill="#3A3A40"/>',
        f'<path d="{path(core)}" fill="#26262B" stroke="#555" stroke-width="0.8"/>',
    ]
    for u in units:
        parts.append(f'<path d="{path(u["poly"])}" fill="{fill[u["type"]]}" stroke="#1B1B1F" stroke-width="0.8">'
                     f'<title>{u["type"].upper()} · {u["area_sf"]:.0f} SF</title></path>')
    parts.append("</svg>")
    return "".join(parts)
