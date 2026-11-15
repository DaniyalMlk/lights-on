"""The room-by-room walk, tested with a made-up floor, made-up photos and a stand-in for the vision model."""
import json

import pytest
from fastapi.testclient import TestClient

from backend import main, matterport
from backend.annotations import floor_labels
from backend.tools import room_vision as RV
from tests.test_annotations import GRID_SF, grid_floor


def floor_with_a_pano_in_each_room():
    """The nine-room grid, with one panorama in the middle of every room except r21, and two in r00."""
    model = grid_floor()
    model["panoLocations"] = [{"id": f"p{i}{j}", "position": {"x": i * 10 + 5, "y": j * 10 + 5, "z": 1.5}}
                              for i in range(3) for j in range(3) if (i, j) != (2, 1)]
    model["panoLocations"].append({"id": "corner", "position": {"x": 1, "y": 1, "z": 1.5}})
    return model


FLOOR = floor_with_a_pano_in_each_room()
ANSWERS = {"p00": "Private office", "p11": "Kitchen or break room", "p10": "Meeting room"}


@pytest.fixture
def walk_setup(monkeypatch, tmp_path):
    """Saved answers go to a temp folder; Matterport and the photo downloads are stand-ins that count their calls."""
    calls = {"graph": 0, "photos": [], "looks": []}
    monkeypatch.setattr(RV, "FLOORS_DIR", tmp_path)

    def graph(query, variables):
        calls["graph"] += 1
        return {"model": {"panoLocations": [{"id": p["id"], "skybox": {"status": "available",
                "children": [f"https://photos.test/{p['id']}/{n}" for n in range(6)]}} for p in FLOOR["panoLocations"]]}}
    monkeypatch.setattr(RV.matterport, "graph", graph)

    def download(url):
        calls["photos"].append(url)
        return url.encode()
    monkeypatch.setattr(RV, "_download", download)

    def look(photos):
        pano = photos[0].decode().split("/")[3]
        calls["looks"].append(pano)
        return {"type": ANSWERS.get(pano, "Unclear"), "evidence": "desks and a door"}
    return calls, look


def test_one_panorama_per_room_the_one_nearest_the_middle():
    chosen = RV.pano_for_each_room(FLOOR)
    assert chosen["r00"] == "p00"                               # not the one in the corner
    assert "r21" not in chosen                                  # nobody scanned inside this room
    assert "r22" not in chosen                                  # Matterport calls it Void: not a room
    assert len(chosen) == 7


def test_the_walk_needs_costars_yes(monkeypatch, walk_setup):
    calls, look = walk_setup
    monkeypatch.delenv("COSTAR_LLM_OK", raising=False)
    with pytest.raises(PermissionError):
        RV.walk("SCAN", FLOOR, look=look)
    assert calls == {"graph": 0, "photos": [], "looks": []}     # nothing was fetched, nothing was sent


def test_the_walk_looks_once_per_room_saves_and_picks_up_where_it_stopped(monkeypatch, walk_setup, tmp_path):
    calls, look = walk_setup
    monkeypatch.setenv("COSTAR_LLM_OK", "yes")
    first = RV.walk("SCAN", FLOOR, look=look, limit=3, say=lambda line: None)
    assert len(first) == 3 and len(calls["looks"]) == 3
    assert all(url.split("/")[-1] in "1234" for url in calls["photos"])        # the four sides, not up or down
    assert len(calls["photos"]) == 12

    seen = RV.walk("SCAN", FLOOR, look=look, say=lambda line: None)
    assert len(seen) == 7 and len(calls["looks"]) == 7          # the three from before were not looked at again
    assert seen["r00"] == {"type": "Private office", "evidence": "desks and a door", "pano_id": "p00"}
    assert json.loads((tmp_path / "SCAN.rooms.json").read_text()) == seen == RV.load("SCAN")

    RV.walk("SCAN", FLOOR, look=look, say=lambda line: None)
    assert len(calls["looks"]) == 7 and calls["graph"] == 2     # all done: no query, no photos, no model


def test_a_room_that_fails_is_skipped_and_tried_again_next_time(monkeypatch, walk_setup):
    calls, look = walk_setup
    monkeypatch.setenv("COSTAR_LLM_OK", "yes")

    def flaky(photos):
        if "p11" in photos[0].decode():
            raise TimeoutError("model too slow")
        return look(photos)
    seen = RV.walk("SCAN", FLOOR, look=flaky, say=lambda line: None)
    assert "r11" not in seen and len(seen) == 6
    assert "r11" in RV.walk("SCAN", FLOOR, look=look, say=lambda line: None)


@pytest.mark.parametrize("reply, expected", [
    ('{"type": "Meeting room", "evidence": "long table, eight chairs"}', ("Meeting room", "long table, eight chairs")),
    ('Sure! ```json\n{"type": "meeting room", "evidence": "table"}\n```', ("Meeting room", "table")),
    ('{"type": "Ballroom", "evidence": "chandelier"}', ("Unclear", "")),          # not on our list
    ("I think this is an office.", ("Unclear", "")),                              # no JSON at all
    ('{"type": "Gym", "evidence": "' + "x" * 300 + '"}', ("Gym", "x" * 80)),
])
def test_the_models_reply_is_read_strictly(reply, expected):
    answer = RV.read_answer(reply)
    assert (answer["type"], answer["evidence"]) == expected


def test_labels_say_what_the_model_saw_and_that_nobody_confirmed_it():
    seen = {"r00": {"type": "Private office", "evidence": "one desk", "pano_id": "p00"},
            "r11": {"type": "Kitchen or break room", "evidence": "sink and fridge", "pano_id": "p11"},
            "r10": {"type": "Unclear", "evidence": "", "pano_id": "p10"}}
    out = floor_labels(FLOOR, GRID_SF, seen)
    with_type = [room for room in out["rooms"] if room.get("seen")]
    assert sorted(room["seen"]["type"] for room in with_type) == ["Kitchen or break room", "Private office"]
    for room in with_type:
        assert room["kind"] == "measured"                       # the daylight part is still measured
        assert "seen by an AI model" in room["detail"] and "Not confirmed by a person" in room["detail"]
    kitchen = next(room for room in with_type if room["seen"]["type"].startswith("Kitchen"))
    assert kitchen["tone"] == "interior" and "sink and fridge" in kitchen["detail"]
    summary = out["room_summary"]
    assert summary["walked"] == 3
    assert summary["seen"] == {"Kitchen or break room": 1, "Private office": 1}
    assert summary["amenities"] == {"Kitchen or break room": 1}


def test_no_walk_means_the_labels_are_exactly_as_before():
    plain = floor_labels(FLOOR, GRID_SF)
    assert all("seen" not in room for room in plain["rooms"])
    assert plain["room_summary"]["walked"] == 0 and plain["room_summary"]["amenities"] == {}
    assert floor_labels(FLOOR, GRID_SF, {})["rooms"] == plain["rooms"]
    assert floor_labels(FLOOR, GRID_SF, {"r00": {"type": "Gym", "evidence": "", "pano_id": "p00"}})["labels"] == plain["labels"]


def test_labels_endpoint_adds_what_the_walk_saved(monkeypatch, tmp_path):
    building = {"id": "779", "lat": 29.7535, "lon": -95.3693, "typical_floor_sf": GRID_SF}
    index = [{"sid": "SCAN3", "name": "9th Floor", "costar_property_id": "779", "lat": "29.7535", "lon": "-95.3693",
              "pano_count": "100", "room_count": "9"}]
    monkeypatch.setattr(main, "BUILDINGS", {"779": building})
    monkeypatch.setattr(matterport, "load_index", lambda: index)
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: FLOOR)
    monkeypatch.setattr(RV, "FLOORS_DIR", tmp_path)
    (tmp_path / "SCAN3.rooms.json").write_text(json.dumps({"r12": {"type": "Lounge", "evidence": "sofas", "pano_id": "p12"}}))
    out = TestClient(main.app).get("/api/buildings/779/labels").json()
    assert out["room_summary"]["amenities"] == {"Lounge": 1}
    assert sum(1 for room in out["rooms"] if room.get("seen")) == 1


def test_a_persons_check_is_saved_shown_and_takes_a_wrong_room_out_of_the_amenities(monkeypatch, tmp_path):
    monkeypatch.setattr(RV, "FLOORS_DIR", tmp_path)
    seen = {"r00": {"type": "Private office", "evidence": "one desk", "pano_id": "p00"},
            "r11": {"type": "Kitchen or break room", "evidence": "sink", "pano_id": "p11"}}
    (tmp_path / "SCAN.rooms.json").write_text(json.dumps(seen))
    RV.mark("SCAN", "r00", True)
    RV.mark("SCAN", "r11", False)
    out = floor_labels(FLOOR, GRID_SF, RV.load("SCAN"))
    office = next(room for room in out["rooms"] if room.get("seen", {}).get("type") == "Private office")
    kitchen = next(room for room in out["rooms"] if room.get("seen", {}).get("type", "").startswith("Kitchen"))
    assert "A person checked it in the tour: right." in office["detail"] and office["room_id"] == "r00"
    assert "A person checked it in the tour: wrong." in kitchen["detail"]
    summary = out["room_summary"]
    assert (summary["checked"], summary["right"]) == (2, 1)
    assert summary["seen"] == {"Private office": 1, "Kitchen or break room": 1}      # what the model said stays on record
    assert summary["amenities"] == {}                                                # but a wrong kitchen is not counted
    RV.mark("SCAN", "r11", None)                                                     # taking the check back
    assert "checked" not in RV.load("SCAN")["r11"]
    with pytest.raises(KeyError):
        RV.mark("SCAN", "nobody-looked-here", True)


def test_looking_again_replaces_the_answer_and_the_check(monkeypatch, walk_setup, tmp_path):
    calls, look = walk_setup
    monkeypatch.setenv("COSTAR_LLM_OK", "yes")
    RV.walk("SCAN", FLOOR, look=look, limit=2, say=lambda line: None)
    first_room = next(iter(RV.load("SCAN")))
    RV.mark("SCAN", first_room, True)
    before = len(calls["looks"])
    RV.walk("SCAN", FLOOR, look=look, limit=2, say=lambda line: None, again=True)
    assert len(calls["looks"]) == before + 2                     # the same two rooms were looked at once more
    assert "checked" not in RV.load("SCAN")[first_room]          # a new answer has not been checked by anyone
