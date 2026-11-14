from shapely.geometry import box

from backend import config as C
from backend.tools.geometry import analyze_plate, centered_core, floor_check, floor_to_floor, zones
from backend.tools.layout import layout_units, render_svg

SLAB = box(0, 0, 70, 250)        # narrow slab, Elev8-like proportions (17,500 SF)
SQUARE = box(0, 0, 200, 200)     # deep square plate (40,000 SF)


def test_zones_partition_the_plate():
    core = centered_core(SLAB)
    for d in C.DEPTHS_FT:
        z = zones(SLAB, core, d)
        total = z.units_sf + z.corridor_sf + z.dark_sf + core.area
        assert abs(total - SLAB.area) < 1.0


def test_core_share_matches_config():
    assert abs(centered_core(SQUARE).area / SQUARE.area - C.CORE_SHARE) < 1e-6


def test_narrow_slab_beats_deep_square():
    slab, square = analyze_plate(SLAB), analyze_plate(SQUARE)
    assert slab["base_daylight_share"] > square["base_daylight_share"]
    assert not slab["deep_plate"]
    assert square["deep_plate"]          # dark zone > 25% of a 200 x 200 ft plate


def test_deeper_units_light_more_area():
    res = analyze_plate(SQUARE)["by_depth"]
    assert res[30].units_sf < res[36].units_sf < res[42].units_sf


def test_core_to_window_on_slab():
    a = analyze_plate(SLAB)
    core_w = 70 * C.CORE_SHARE ** 0.5
    assert abs(a["core_to_window"]["min_ft"] - (70 - core_w) / 2) < 0.5


def test_floor_check_flags_podium():
    assert floor_check(SQUARE, 0.6 * SQUARE.area)["branch"] == "podium"
    assert floor_check(SQUARE, SQUARE.area)["flag"] == "ok"
    assert floor_check(SQUARE, None)["flag"] == "no_typical_floor"


def test_floor_to_floor_flags():
    assert floor_to_floor(200, 20)["flag"] == "red"       # 10 ft
    assert floor_to_floor(230, 20)["flag"] == "amber"     # 11.5 ft
    assert floor_to_floor(260, 20)["flag"] == "ok"        # 13 ft
    assert floor_to_floor(None, 20)["flag"] == "unknown"


def test_layout_counts_real_homes_only():
    a = analyze_plate(SLAB)
    z = a["by_depth"][C.BASE_DEPTH_FT]
    lay = layout_units(SLAB, z.units, z.effective_depth_ft, a["core"])
    assert lay["method"] == "facade_cut"
    assert lay["homes_per_floor"] > 0
    assert sum(u["area_sf"] for u in lay["units"]) <= z.units_sf + 1
    for u in lay["units"]:
        assert u["homes"] == 0 or u["area_sf"] >= C.MIN_HOME_SF


def test_svg_renders():
    a = analyze_plate(SLAB)
    z = a["by_depth"][C.BASE_DEPTH_FT]
    lay = layout_units(SLAB, z.units, z.effective_depth_ft, a["core"])
    svg = render_svg(SLAB, a["core"], z, lay["units"], "slab")
    assert svg.startswith("<svg") and svg.endswith("</svg>") and "#FFC857" in svg
