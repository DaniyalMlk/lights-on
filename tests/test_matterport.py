import json

import httpx
import pytest

from backend import agent, matterport

# Shape copied from the Matterport quickstart's Rooms response (trimmed). IDs are made up.
FLOOR = {"data": {"model": {
    "name": "35th Floor", "geolocation": {"lat": "29.75", "long": "-95.37"}, "floors": [],
    "rooms": [
        {"id": "a", "classifications": [{"label": "Office", "confidence": 1.0}], "dimensions": {"areaFloor": 20.0}},
        {"id": "b", "classifications": [], "dimensions": None},
    ],
}}}

INDEX = [
    {"sid": "FLOOR1", "name": "35th Floor - 30,000sqft", "costar_property_id": "777", "lat": "29.7535", "lon": "-95.3693",
     "pano_count": "100", "room_count": "19"},
    {"sid": "UNIT1", "name": "2 BR, 2 BA - 1,200 SF", "costar_property_id": "", "lat": "29.7536", "lon": "-95.3694",
     "pano_count": "20", "room_count": "8"},
    {"sid": "FAR1", "name": "Level 3", "costar_property_id": "", "lat": "29.7700", "lon": "-95.3500",
     "pano_count": "50", "room_count": "10"},
]
TOWER = {"id": "777", "lat": 29.7535, "lon": -95.3693}


@pytest.fixture
def floors_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(matterport, "FLOORS_DIR", tmp_path / "matterport")
    return tmp_path / "matterport"


def test_full_floor_guess_from_the_name():
    assert matterport.looks_like_full_floor({"name": "43rd Floor - 30,373sqft"})
    assert matterport.looks_like_full_floor({"name": "1000 Louisiana - Level 53"})
    assert not matterport.looks_like_full_floor({"name": "2 BR, 2 BA - 1,367 SF"})
    assert not matterport.looks_like_full_floor({"name": "Fitness Center"})


def test_scans_for_matches_costar_id_or_distance(floors_dir):
    scans = matterport.scans_for(TOWER, INDEX)
    assert [s["model_id"] for s in scans] == ["FLOOR1", "UNIT1"]       # full floors first, far one dropped
    assert scans[0]["matched_by"] == "costar_id" and scans[1]["matched_by"] == "distance"
    assert scans[0]["full_floor"] and not scans[1]["full_floor"]


def test_fetch_floor_sends_key_and_token_and_saves(floors_dir, monkeypatch):
    monkeypatch.setenv("MATTERPORT_API_KEY", "k")
    monkeypatch.setenv("MATTERPORT_API_TOKEN", "t")
    sent = {}

    def fake_post(url, json=None, auth=None, timeout=None):
        sent.update(url=url, auth=auth, variables=json["variables"])
        return httpx.Response(200, json=FLOOR, request=httpx.Request("POST", url))

    monkeypatch.setattr(matterport.httpx, "post", fake_post)
    model = matterport.fetch_floor("FLOOR1")
    assert sent == {"url": matterport.API_URL, "auth": ("k", "t"), "variables": {"id": "FLOOR1"}}
    assert matterport.load_floor("FLOOR1") == model
    assert matterport.room_table(model) == [{"label": "Office", "area_sf": 215}, {"label": "(unlabelled)", "area_sf": 0}]


def test_agent_tool_reports_scans_and_saves_them(floors_dir, tmp_path, monkeypatch):
    floors_dir.mkdir()
    (floors_dir / "FLOOR1.json").write_text(json.dumps(FLOOR["data"]["model"]))
    monkeypatch.delenv("MATTERPORT_API_KEY", raising=False)
    monkeypatch.setattr(agent, "_buildings", lambda: {"777": TOWER})
    monkeypatch.setattr(agent, "WORK_DIR", tmp_path / "work")
    monkeypatch.setattr(matterport, "load_index", lambda: INDEX)

    out = json.loads(agent.check_matterport.invoke({"building_id": "777"}))
    assert out["status"] == "success"
    assert out["values"]["floors"][0]["scanned_area_sf"] == 215
    assert (tmp_path / "work" / "777" / "matterport.json").exists()


def test_agent_tool_never_claims_scans_for_sample_buildings(monkeypatch):
    monkeypatch.setattr(agent, "_buildings", lambda: {"SAMPLE-1": {"id": "SAMPLE-1", "synthetic": True}})
    out = json.loads(agent.check_matterport.invoke({"building_id": "SAMPLE-1"}))
    assert out["status"] == "warning" and "sample" in out["summary"]
