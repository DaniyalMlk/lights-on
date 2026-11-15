import pytest
from fastapi.testclient import TestClient
from shapely.geometry import Point

from backend import main, matterport
from backend.annotations import FT_PER_M, floor_labels
from backend.matterport import floor_outline

SQ_FT_PER_SQ_M = FT_PER_M ** 2


def wall_graph(width=60.0, depth=30.0):
    """A made-up 60 x 30 m floor: four outer walls and one wall splitting it into two rooms."""
    corners = {"a": (0, 0), "b": (width, 0), "c": (width, depth), "d": (0, depth),
               "e": (width / 2, 0), "f": (width / 2, depth)}
    vertices = [{"id": k, "position": {"x": x, "y": y}} for k, (x, y) in corners.items()]
    pairs = [("a", "e"), ("e", "b"), ("b", "c"), ("c", "f"), ("f", "d"), ("d", "a"), ("e", "f")]
    edges = [{"id": f"{s}{t}", "type": "wall", "vertices": [{"id": s}, {"id": t}]} for s, t in pairs]
    return {"name": "Test floor", "floors": [{"id": "f1", "vertices": vertices, "edges": edges}],
            "rooms": [], "panoLocations": [{"id": "p1", "position": {"x": 5, "y": 5, "z": 1.4}},
                                           {"id": "p2", "position": {"x": 9, "y": 9, "z": 1.6}}]}


FLOOR = wall_graph()
FULL_FLOOR_SF = 60 * 30 * SQ_FT_PER_SQ_M


def test_outline_from_walls():
    outline = floor_outline(FLOOR)
    assert outline.area == pytest.approx(1800, rel=0.01)
    assert floor_outline({"floors": []}) is None
    open_walls = wall_graph()
    open_walls["floors"][0]["edges"] = open_walls["floors"][0]["edges"][:2]      # walls that don't close
    assert floor_outline(open_walls) is None


def test_labels_say_how_we_know_and_sit_on_the_floor():
    out = floor_labels(FLOOR, FULL_FLOOR_SF)
    kinds = {label["kind"] for label in out["labels"]}
    assert {"measured", "checked", "assumed", "estimate"} <= kinds
    outline = floor_outline(FLOOR)
    for label in out["labels"]:
        p = label["position"]
        assert outline.buffer(0.01).contains(Point(p["x"], p["y"])), label["title"]
        assert p["z"] == 1.5                                    # median camera height of the scans
    assert out["coverage"] == pytest.approx(1.0, rel=0.02)


def test_same_scan_same_labels():
    assert floor_labels(FLOOR, FULL_FLOOR_SF) == floor_labels(FLOOR, FULL_FLOOR_SF)


def test_partial_scan_gets_no_labels():
    out = floor_labels(FLOOR, FULL_FLOOR_SF * 3)               # the scan is a third of the floor
    assert out["labels"] == [] and "suite" in out["reason"]


def test_labels_endpoint(monkeypatch):
    building = {"id": "777", "lat": 29.7535, "lon": -95.3693, "typical_floor_sf": FULL_FLOOR_SF}
    index = [{"sid": "SCAN1", "name": "35th Floor", "costar_property_id": "777", "lat": "29.7535", "lon": "-95.3693",
              "pano_count": "100", "room_count": "2"}]
    monkeypatch.setattr(main, "BUILDINGS", {"777": building})
    monkeypatch.setattr(matterport, "load_index", lambda: index)
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: FLOOR)
    monkeypatch.setenv("MATTERPORT_SDK_KEY", "sdk-test")
    client = TestClient(main.app)

    out = client.get("/api/buildings/777/labels").json()
    assert out["model_id"] == "SCAN1" and len(out["labels"]) >= 4
    assert client.get("/api/buildings/NOPE/labels").status_code == 404
    assert client.get("/api/config").json() == {"matterport_sdk_key": "sdk-test"}


def test_labels_never_print_costar_floor_area():
    """CoStar's typical floor is used for the coverage check, but its value stays off screen."""
    costar_floor = round(FULL_FLOOR_SF * 1.03)                  # a little more than the scan measures
    out = floor_labels(FLOOR, costar_floor)
    text = " ".join(label["title"] + " " + label["detail"] for label in out["labels"])
    assert out["labels"] and f"{costar_floor:,}" not in text and str(costar_floor) not in text


def test_labels_know_where_they_sit_on_the_drawing():
    """Each label also carries its spot on the floor plate drawing, inside the drawing's margins."""
    out = floor_labels(FLOOR, FULL_FLOOR_SF)
    width_ft, depth_ft = 60 * FT_PER_M, 30 * FT_PER_M
    for label in out["labels"]:
        assert 10 <= label["plan"]["x"] <= width_ft + 10 and 10 <= label["plan"]["y"] <= depth_ft + 10, label["title"]


def test_a_scan_that_is_not_measured_still_offers_its_tour(monkeypatch):
    """Tour only, no labels: and only for a scan filed under this building's id, never a neighbour's."""
    building = {"id": "777", "lat": 29.7535, "lon": -95.3693, "typical_floor_sf": FULL_FLOOR_SF}
    own = {"sid": "SUITE1", "name": "Suite 400", "costar_property_id": "777", "lat": "29.7535", "lon": "-95.3693",
           "pano_count": "12", "room_count": "3"}
    nearby = {"sid": "NEXTDOOR", "name": "Lobby", "costar_property_id": "999", "lat": "29.7536", "lon": "-95.3694",
              "pano_count": "40", "room_count": "1"}
    monkeypatch.setattr(main, "BUILDINGS", {"777": building})
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: None)          # nothing pulled, so nothing measured
    client = TestClient(main.app)

    monkeypatch.setattr(matterport, "load_index", lambda: [nearby, own])
    out = client.get("/api/buildings/777/labels").json()
    assert out["labels"] == [] and out["model_id"] is None and out["tour_model_id"] == "SUITE1"

    monkeypatch.setattr(matterport, "load_index", lambda: [nearby])
    assert client.get("/api/buildings/777/labels").json()["tour_model_id"] is None


def grid_floor(side=10.0):
    """A made-up 30 x 30 m floor cut into nine 10 m rooms. Only the middle room has no outer wall."""
    vertices = [{"id": f"v{i}{j}", "position": {"x": i * side, "y": j * side}} for i in range(4) for j in range(4)]
    edges = [{"id": f"h{i}{j}", "type": "wall", "vertices": [{"id": f"v{i}{j}"}, {"id": f"v{i + 1}{j}"}]}
             for i in range(3) for j in range(4)]
    edges += [{"id": f"w{i}{j}", "type": "wall", "vertices": [{"id": f"v{i}{j}"}, {"id": f"v{i}{j + 1}"}]}
              for i in range(4) for j in range(3)]
    types = {(0, 0): "Office", (2, 2): "Void"}                  # Matterport types two rooms; one is not a room at all
    rooms = [{"id": f"r{i}{j}", "floor": {"id": "f1"},
              "classifications": [{"label": types[i, j], "confidence": 1.0}] if (i, j) in types else [],
              "boundary": {"edges": [{"id": f"h{i}{j}"}, {"id": f"h{i}{j + 1}"}, {"id": f"w{i}{j}"}, {"id": f"w{i + 1}{j}"}]}}
             for i in range(3) for j in range(3)]
    return {"name": "Test grid", "floors": [{"id": "f1", "vertices": vertices, "edges": edges}], "rooms": rooms,
            "panoLocations": [{"id": "p1", "position": {"x": 5, "y": 5, "z": 1.5}}]}


GRID = grid_floor()
GRID_SF = 30 * 30 * SQ_FT_PER_SQ_M


def test_every_room_gets_a_label_measured_from_its_own_walls():
    out = floor_labels(GRID, GRID_SF)
    rooms = out["rooms"]
    assert len(rooms) == 8                                      # nine rooms, minus the one Matterport calls Void
    assert all(room["kind"] == "measured" for room in rooms)
    interior = [room for room in rooms if room.get("tone") == "interior"]
    assert len(interior) == 1 and interior[0]["title"].startswith("Interior room")
    p = interior[0]["position"]
    assert 10 < p["x"] < 20 and 10 < p["y"] < 20                # the label stands in the middle room
    # The middle room is 32.8 ft wide and starts 32.8 ft from the outline: 35% of it is within 36 ft
    assert "35%" in interior[0]["detail"]
    outer = [room for room in rooms if room.get("tone") != "interior"]
    assert all("outer wall" in room["title"] and "all of it" in room["title"] for room in outer)


def test_room_labels_pass_on_matterports_own_type_and_count_the_gap():
    out = floor_labels(GRID, GRID_SF)
    typed = [room for room in out["rooms"] if "Office" in room["detail"]]
    assert len(typed) == 1
    assert sum("gives this room no type" in room["detail"] for room in out["rooms"]) == 7
    assert out["room_summary"] == {"total": 8, "outer_wall": 7, "interior": 1, "typed": 1,
                                   "walked": 0, "seen": {}, "amenities": {}}      # no vision walk on this floor


def test_room_labels_are_the_same_every_time_and_never_change_the_floor_labels():
    assert floor_labels(GRID, GRID_SF) == floor_labels(GRID, GRID_SF)
    no_rooms = dict(GRID, rooms=[])
    assert floor_labels(no_rooms, GRID_SF)["labels"] == floor_labels(GRID, GRID_SF)["labels"]
    assert floor_labels(no_rooms, GRID_SF)["rooms"] == []
    assert floor_labels(GRID, GRID_SF * 3).get("rooms", []) == []       # a suite: no floor labels, so no room labels


def test_a_room_deeper_than_the_window_band_says_how_much_is_in_reach():
    out = floor_labels(wall_graph(), FULL_FLOOR_SF)             # 60 x 30 m floor, no rooms listed
    assert out["rooms"] == []
    deep = wall_graph()                                         # the same floor as two 30 x 30 m rooms
    deep["rooms"] = [{"id": "west", "floor": {"id": "f1"}, "classifications": [],
                      "boundary": {"edges": [{"id": "ae"}, {"id": "ef"}, {"id": "fd"}, {"id": "da"}]}},
                     {"id": "east", "floor": {"id": "f1"}, "classifications": [],
                      "boundary": {"edges": [{"id": "eb"}, {"id": "bc"}, {"id": "cf"}, {"id": "ef"}]}}]
    rooms = floor_labels(deep, FULL_FLOOR_SF)["rooms"]
    assert len(rooms) == 2
    assert all("outer wall" in room["title"] and "% of it" in room["title"] for room in rooms)


def test_labels_endpoint_sends_the_rooms_too(monkeypatch):
    building = {"id": "778", "lat": 29.7535, "lon": -95.3693, "typical_floor_sf": GRID_SF}
    index = [{"sid": "SCAN2", "name": "12th Floor", "costar_property_id": "778", "lat": "29.7535", "lon": "-95.3693",
              "pano_count": "100", "room_count": "9"}]
    monkeypatch.setattr(main, "BUILDINGS", {"778": building})
    monkeypatch.setattr(matterport, "load_index", lambda: index)
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: GRID)
    out = TestClient(main.app).get("/api/buildings/778/labels").json()
    assert len(out["rooms"]) == 8 and out["room_summary"]["interior"] == 1


def test_a_room_we_cannot_measure_does_not_cost_the_floor_its_labels(monkeypatch):
    from shapely.errors import ShapelyError
    from backend import annotations

    def broken(*args):
        raise ShapelyError("bad room shape")
    monkeypatch.setattr(annotations, "room_labels", broken)
    out = floor_labels(GRID, GRID_SF)
    assert len(out["labels"]) >= 4 and out["rooms"] == [] and out["room_summary"]["total"] == 0
