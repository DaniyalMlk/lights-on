"""Coordinate helpers: GeoJSON lon/lat <-> local feet (Texas South Central, EPSG:2278, US survey feet)."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from pyproj import Transformer
from shapely import transform
from shapely.geometry import Polygon, mapping, shape
from shapely.geometry.polygon import orient

HOUSTON_EPSG = 2278  # NAD83 / Texas South Central (ftUS)


@lru_cache(maxsize=4)
def _transformer(src: int, dst: int) -> Transformer:
    return Transformer.from_crs(src, dst, always_xy=True)


def _reproject(geom, t: Transformer):
    return transform(geom, lambda xy: np.column_stack(t.transform(xy[:, 0], xy[:, 1])))


def to_feet(geojson_polygon: dict, epsg: int = HOUSTON_EPSG) -> Polygon:
    """GeoJSON Polygon in lon/lat -> shapely Polygon in feet, exterior counter-clockwise."""
    poly = shape(geojson_polygon)
    t = _transformer(4326, epsg)
    projected = _reproject(poly, t)
    if projected.geom_type != "Polygon":
        projected = max(projected.geoms, key=lambda g: g.area)
    return orient(projected.buffer(0), sign=1.0)


def to_lonlat(poly_ft: Polygon, epsg: int = HOUSTON_EPSG) -> dict:
    t = _transformer(epsg, 4326)
    return mapping(_reproject(poly_ft, t))
