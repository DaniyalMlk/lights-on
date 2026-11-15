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


def test_an_unlinked_full_floor_at_the_address_is_offered_as_a_nearby_tour(monkeypatch):
    """Matterport's list leaves some office floors without a building id. A full floor scanned at this address and
    filed under no building is offered as a tour, and says it was matched by location. A neighbour's scan never is."""
    building = {"id": "777", "lat": 29.7535, "lon": -95.3693, "typical_floor_sf": FULL_FLOOR_SF}
    unlinked_floor = {"sid": "FLOOR53", "name": "Level 53", "costar_property_id": "", "lat": "29.7535", "lon": "-95.3693",
                      "pano_count": "115", "room_count": "5"}
    unlinked_suite = {"sid": "SUITE9", "name": "Suite 900", "costar_property_id": "", "lat": "29.7535", "lon": "-95.3693",
                      "pano_count": "300", "room_count": "9"}
    neighbours_floor = {"sid": "NEXTDOOR", "name": "12th Floor", "costar_property_id": "999", "lat": "29.7536",
                        "lon": "-95.3694", "pano_count": "80", "room_count": "4"}
    own_suite = {"sid": "OWN1", "name": "Suite 400", "costar_property_id": "777", "lat": "29.7535", "lon": "-95.3693",
                 "pano_count": "12", "room_count": "3"}
    monkeypatch.setattr(main, "BUILDINGS", {"777": building})
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: None)
    client = TestClient(main.app)

    monkeypatch.setattr(matterport, "load_index", lambda: [unlinked_suite, neighbours_floor, unlinked_floor])
    out = client.get("/api/buildings/777/labels").json()
    assert out["tour_model_id"] == "FLOOR53" and out["tour_matched_by"] == "distance" and out["tour_full_floor"] is True
    assert out["labels"] == [] and out["model_id"] is None                     # offered to walk through, never measured

    monkeypatch.setattr(matterport, "load_index", lambda: [unlinked_floor, own_suite])
    out = client.get("/api/buildings/777/labels").json()
    assert out["tour_model_id"] == "OWN1" and out["tour_matched_by"] == "costar_id"      # the building's own scan wins

    monkeypatch.setattr(matterport, "load_index", lambda: [unlinked_suite, neighbours_floor])
    out = client.get("/api/buildings/777/labels").json()
    assert out["tour_model_id"] is None and out["tour_matched_by"] is None


def test_building_list_says_which_buildings_have_a_tour(monkeypatch, tmp_path):
    """The list marks every building whose 3D tour can be opened, so the tours are not hidden one click deep."""
    from backend.costar_kit import square_footprint

    def tower(building_id, lat):
        return {"id": building_id, "name": building_id, "lat": lat, "lon": -95.3693, "stories": 20, "vacancy": 0.6,
                "typical_floor_sf": 20000.0, "footprint": square_footprint(lat, -95.3693, 20000.0)}

    index = [{"sid": "OWN", "name": "Suite 400", "costar_property_id": "A", "lat": "29.7535", "lon": "-95.3693",
              "pano_count": "12", "room_count": "3"},
             {"sid": "LEVEL9", "name": "Level 9", "costar_property_id": "", "lat": "29.7600", "lon": "-95.3693",
              "pano_count": "90", "room_count": "4"}]
    monkeypatch.setattr("backend.pipeline.WORK_DIR", tmp_path)
    monkeypatch.setattr(main, "BUILDINGS", {"A": tower("A", 29.7535), "B": tower("B", 29.7600), "C": tower("C", 29.7700)})
    monkeypatch.setattr(main, "MAP_ONLY", [])
    monkeypatch.setattr(matterport, "load_index", lambda: index)
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: None)
    monkeypatch.setenv("MATTERPORT_SDK_KEY", "sdk-test")
    client = TestClient(main.app)

    def tours():
        return {f["properties"]["id"]: f["properties"]["tour"] for f in client.get("/api/buildings").json()["features"]}

    assert tours() == {"A": "costar_id", "B": "distance", "C": None}     # its own scan, a floor at the address, none
    monkeypatch.delenv("MATTERPORT_SDK_KEY")
    assert tours() == {"A": None, "B": None, "C": None}                  # no key, no tour to open: don't promise one
