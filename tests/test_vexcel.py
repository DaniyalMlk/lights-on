"""Vexcel outlines: used only when they match the typical floor. Invented records, no real data."""
import json

from shapely.geometry import shape

from backend import vexcel
from backend.tools.geo import to_feet

# About 160 x 160 ft near downtown Houston
OUTLINE = "POLYGON ((-95.3700 29.7600, -95.36950 29.7600, -95.36950 29.76044, -95.3700 29.76044, -95.3700 29.7600))"


def record(area_sf: float, primary: bool = True, extra: list | None = None) -> dict:
    structure = {"primary-structure": primary, "footprint.area": area_sf, "footprint.wkt": OUTLINE}
    return {"features": [{"properties": {"structures": [structure] + (extra or [])}}]}


def test_outline_used_when_it_matches_the_typical_floor():
    outline, ratio = vexcel.floor_outline(record(25_600), 25_000)
    assert ratio == 25_600 / 25_000
    assert outline["type"] == "Polygon"
    assert abs(to_feet(outline).area - 25_600) / 25_600 < 0.1      # same building, now in feet


def test_outline_refused_when_it_is_the_base_of_the_building():
    outline, ratio = vexcel.floor_outline(record(37_500), 29_000)   # 1.29x: a podium or garage
    assert outline is None and round(ratio, 2) == 1.29


def test_primary_structure_wins_over_a_bigger_neighbour():
    neighbour = {"primary-structure": False, "footprint.area": 90_000, "footprint.wkt": OUTLINE}
    outline, ratio = vexcel.floor_outline(record(25_000, extra=[neighbour]), 25_000)
    assert outline is not None and ratio == 1.0


def test_nothing_to_use():
    assert vexcel.floor_outline(None, 25_000) == (None, None)
    assert vexcel.floor_outline({"features": []}, 25_000) == (None, None)
    assert vexcel.floor_outline(record(25_000), None) == (None, None)


def test_saved_record_is_reused_and_no_key_means_no_call(tmp_path, monkeypatch):
    monkeypatch.delenv("VEXCEL_API_KEY", raising=False)
    (tmp_path / "property_B1.json").write_text(json.dumps(record(25_000)))
    assert vexcel.fetch_property("B1", 29.76, -95.37, tmp_path) == record(25_000)
    assert vexcel.fetch_property("B2", 29.76, -95.37, tmp_path) is None


def test_apply_outlines_keeps_the_square_unless_the_outline_matches(tmp_path, monkeypatch):
    monkeypatch.delenv("VEXCEL_API_KEY", raising=False)
    (tmp_path / "property_FIT.json").write_text(json.dumps(record(25_000)))
    (tmp_path / "property_BASE.json").write_text(json.dumps(record(60_000)))
    square = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    buildings = [{"id": i, "lat": 29.76, "lon": -95.37, "typical_floor_sf": 25_000, "footprint": square,
                  "footprint_source": "a square stand-in sized to the typical floor", "footprint_origin": "square"}
                 for i in ("FIT", "BASE", "NONE")]
    vexcel.apply_outlines(buildings, tmp_path)
    fit, base, none = buildings
    assert fit["footprint_origin"] == "vexcel" and fit["footprint_source"] == vexcel.SOURCE
    assert shape(fit["footprint"]).bounds[0] < -95.36
    assert base["footprint"] == square and base["footprint_origin"] == "square" and base["vexcel_ratio"] == 2.4
    assert none["footprint"] == square and none["vexcel_ratio"] is None
