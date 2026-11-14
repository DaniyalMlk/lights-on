"""Plate and core from a scan's wall graph, tested on hand-made floors (metres, like Matterport's)."""
import pytest
from shapely.affinity import scale
from shapely.geometry import box

from backend import annotations
from backend.matterport import floor_outline
from backend.tools import matterport_plan as MP
from backend.tools.geometry import analyze_plate
from backend.tools.matterport_plan import plate_and_core

SQ_FT_PER_SQ_M = MP.FT_PER_M ** 2


def floor(points: dict, rooms: list[tuple[str, list[tuple[str, str]]]]) -> dict:
    """A saved Matterport floor. `rooms` is [(label, [(vertex, vertex), ...])]: each room lists its wall edges."""
    edges = sorted({tuple(sorted(pair)) for _, walls in rooms for pair in walls})
    return {
        "name": "Test floor",
        "floors": [{"id": "f1",
                    "vertices": [{"id": k, "position": {"x": x, "y": y}} for k, (x, y) in points.items()],
                    "edges": [{"id": f"{s}-{t}", "type": "wall", "vertices": [{"id": s}, {"id": t}]} for s, t in edges]}],
        "rooms": [{"id": f"r{i}", "floor": {"id": "f1"},
                   "classifications": [{"label": label, "confidence": 1.0}] if label else [],
                   "boundary": {"edges": [{"id": "-".join(sorted(pair))} for pair in walls]}}
                  for i, (label, walls) in enumerate(rooms)],
    }


# A 40 x 20 m floor in three strips: office | elevators and stairs | office.
STRIP_POINTS = {"a": (0, 0), "b": (16, 0), "c": (24, 0), "d": (40, 0),
                "e": (40, 20), "f": (24, 20), "g": (16, 20), "h": (0, 20)}
WEST = [("a", "b"), ("b", "g"), ("g", "h"), ("h", "a")]
MIDDLE = [("b", "c"), ("c", "f"), ("f", "g"), ("g", "b")]
EAST = [("c", "d"), ("d", "e"), ("e", "f"), ("f", "c")]
THREE_ROOMS = floor(STRIP_POINTS, [("Office", WEST), ("Elevator", MIDDLE), ("Office", EAST)])


def one_room_with_void(void_side_m: float) -> dict:
    """A 40 x 20 m floor that is one big room with a square void in the middle, like a column or a shaft."""
    lo_x, lo_y = 20 - void_side_m / 2, 10 - void_side_m / 2
    hi_x, hi_y = lo_x + void_side_m, lo_y + void_side_m
    points = {"a": (0, 0), "b": (40, 0), "c": (40, 20), "d": (0, 20),
              "p": (lo_x, lo_y), "q": (hi_x, lo_y), "r": (hi_x, hi_y), "s": (lo_x, hi_y)}
    outer = [("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")]
    void = [("p", "q"), ("q", "r"), ("r", "s"), ("s", "p")]
    return floor(points, [("Other", outer + void), ("Void", void)])


def test_three_rooms_give_the_plate_and_the_core_in_feet():
    plate, core = plate_and_core(THREE_ROOMS)
    assert plate.area == pytest.approx(40 * 20 * SQ_FT_PER_SQ_M, rel=0.01)
    assert core.area == pytest.approx(8 * 20 * SQ_FT_PER_SQ_M, rel=0.03)
    assert plate.buffer(0.1).contains(core)
    assert core.centroid.x == pytest.approx(20 * MP.FT_PER_M, abs=1.0)


def test_a_space_nobody_scanned_is_core_too():
    walls_only = floor(STRIP_POINTS, [("Office", WEST), ("Office", EAST)])
    walls_only["floors"][0] = THREE_ROOMS["floors"][0]              # the middle walls exist, but no room claims them
    plate, core = plate_and_core(walls_only)
    assert plate.area == pytest.approx(40 * 20 * SQ_FT_PER_SQ_M, rel=0.01)
    assert core.area == pytest.approx(8 * 20 * SQ_FT_PER_SQ_M, rel=0.03)


@pytest.mark.parametrize("void_side_m", [1.0, 4.0])     # a column (11 sf), then a shaft worth 2% of the floor
def test_columns_and_small_voids_are_not_a_core(void_side_m):
    plate, core = plate_and_core(one_room_with_void(void_side_m))
    assert plate.area == pytest.approx(40 * 20 * SQ_FT_PER_SQ_M, rel=0.01)
    assert core is None


def test_a_labelled_core_room_counts_even_if_the_big_room_ignores_its_walls():
    model = one_room_with_void(10.0)                                  # a 10 x 10 m elevator lobby, 12.5% of the floor
    big_room = model["rooms"][0]
    big_room["boundary"]["edges"] = big_room["boundary"]["edges"][:4]  # the open office lists only its outer walls
    model["rooms"][1]["classifications"] = [{"label": "Elevator Lobby", "confidence": 0.9}]
    _, core = plate_and_core(model)
    assert core.area == pytest.approx(10 * 10 * SQ_FT_PER_SQ_M, rel=0.03)


def test_no_rooms_means_no_core_and_open_walls_mean_no_plate():
    no_rooms = {**THREE_ROOMS, "rooms": []}
    plate, core = plate_and_core(no_rooms)
    assert plate is not None and core is None

    open_walls = floor(STRIP_POINTS, [("Office", WEST[:2])])
    assert plate_and_core(open_walls) == (None, None)
    assert plate_and_core({"floors": []}) == (None, None)


def test_the_scan_core_replaces_the_assumed_one():
    plate, core = plate_and_core(THREE_ROOMS)
    geo = analyze_plate(plate, core)
    assert geo["core_source"] == "matterport"
    z = geo["by_depth"][36]
    assert z.units_sf + z.corridor_sf + z.dark_sf + geo["core_sf"] == pytest.approx(plate.area, abs=1.0)
    assert analyze_plate(plate)["core_source"] == "assumed_centered"


def test_plate_is_the_outline_the_3d_labels_use(monkeypatch):
    plate, _ = plate_and_core(THREE_ROOMS)
    assert plate.equals(scale(floor_outline(THREE_ROOMS), MP.FT_PER_M, MP.FT_PER_M, origin=(0, 0)))
    floor_label = next(x for x in annotations.floor_labels(THREE_ROOMS)["labels"] if x["title"].startswith("Floor:"))
    assert f"{plate.area:,.0f} sf" in floor_label["title"]                 # same area on the label and in the analysis

    monkeypatch.setattr(MP, "floor_outline", lambda model: box(0, 0, 10, 10))   # whatever floor_outline says, we use
    plate, _ = plate_and_core({**THREE_ROOMS, "rooms": []})
    assert plate.area == pytest.approx(100 * SQ_FT_PER_SQ_M)


def test_same_full_floor_rule_as_the_3d_labels():
    assert MP.MIN_COVERAGE == annotations.MIN_COVERAGE and MP.FT_PER_M == annotations.FT_PER_M
