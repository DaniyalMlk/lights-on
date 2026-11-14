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
