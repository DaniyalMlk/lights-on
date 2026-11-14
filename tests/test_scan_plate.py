"""analyze() swaps the stand-in footprint for the real plate when a full-floor scan of the building is saved."""
import copy

import pytest
from fastapi.testclient import TestClient
from test_matterport_plan import SQ_FT_PER_SQ_M, THREE_ROOMS

from backend import main, matterport
from backend import validation as V
from backend.costar_kit import square_footprint
from backend.pipeline import analyze, scan_plate

SCAN_SF = 40 * 20 * SQ_FT_PER_SQ_M                       # the hand-made floor: 40 x 20 m, about 8,611 sf
INDEX = [{"sid": "SCAN1", "name": "35th Floor", "costar_property_id": "777", "lat": "29.7535", "lon": "-95.3693",
          "pano_count": "100", "room_count": "3"}]


def tower(typical_floor_sf=SCAN_SF, **extra) -> dict:
    return {"id": "777", "name": "Test Tower", "address": "1 Test St", "lat": 29.7535, "lon": -95.3693, "stories": 20,
            "typical_floor_sf": typical_floor_sf, "vacancy": 0.6,
            "footprint": square_footprint(29.7535, -95.3693, typical_floor_sf),
            "footprint_source": "a square stand-in sized to the typical floor", **extra}


@pytest.fixture(autouse=True)
def saved_scan(monkeypatch):
    monkeypatch.setattr(matterport, "load_index", lambda: INDEX)
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: THREE_ROOMS if model_id == "SCAN1" else None)


def test_full_floor_scan_becomes_the_plate():
    r = analyze(tower(), save=False)
    g = r["geometry"]
    assert g["plate_source"] == "matterport_scan" and g["scan_model_id"] == "SCAN1"
    assert g["plate_sf"] == pytest.approx(SCAN_SF, rel=0.01)
    assert g["scan_coverage_share"] == pytest.approx(1.0, abs=0.02)
    assert g["core_source"] == "matterport"                         # this scan shows its core
    assert "scan" in r["building"]["footprint_source"] and "SCAN1" in r["building"]["footprint_source"]
    assert "matterport" in g["source"]


def test_the_scan_never_replaces_the_map_footprint(monkeypatch, tmp_path):
    """The scan is in Matterport's own coordinates, not lon/lat: it feeds the analysis, never the map."""
    b = tower()
    before = copy.deepcopy(b)
    r = analyze(b, save=False)
    assert r["geometry"]["plate_source"] == "matterport_scan"
    assert b == before and "footprint" not in r["building"]          # the building record is left as it was

    monkeypatch.setattr("backend.pipeline.WORK_DIR", tmp_path)
    monkeypatch.setattr(main, "BUILDINGS", {"777": b})
    feature = TestClient(main.app).get("/api/buildings").json()["features"][0]
    assert feature["geometry"] == before["footprint"]
    for lon, lat in feature["geometry"]["coordinates"][0]:
        assert -95.5 < lon < -95.2 and 29.6 < lat < 29.9             # still downtown Houston, not (0, 0)


def test_a_suite_keeps_the_stand_in_footprint():
    b = tower(typical_floor_sf=3 * SCAN_SF)                         # the scan is a third of this building's floor
    assert scan_plate(b) is None
    r = analyze(b, save=False)
    assert r["geometry"]["plate_source"] == "footprint" and r["geometry"]["scan_model_id"] is None
    assert r["geometry"]["plate_sf"] == pytest.approx(3 * SCAN_SF, rel=0.01)
    assert r["building"]["footprint_source"] == "a square stand-in sized to the typical floor"
    assert "square stand-in" in r["geometry"]["source"]


def test_scan_can_be_switched_off_and_is_never_used_for_sample_buildings():
    assert analyze(tower(), save=False, use_scan=False)["geometry"]["plate_source"] == "footprint"
    assert scan_plate(tower(synthetic=True)) is None
    assert scan_plate({**tower(), "typical_floor_sf": None}) is None      # nothing to check the scan against


def test_unsaved_or_unit_scans_are_skipped(monkeypatch):
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: None)          # in the index, not pulled yet
    assert scan_plate(tower()) is None
    monkeypatch.setattr(matterport, "load_floor", lambda model_id: THREE_ROOMS)
    monkeypatch.setattr(matterport, "load_index", lambda: [{**INDEX[0], "name": "2 BR, 2 BA - 1,200 SF"}])
    assert scan_plate(tower()) is None                                             # an apartment, not an office floor


def test_input_sensitivity_compares_the_stand_in_with_the_real_plate(monkeypatch):
    calls = []
    real = V.analyze
    monkeypatch.setattr(V, "analyze", lambda b, **kw: calls.append(kw) or real(b, **kw))
    row = V.input_sensitivity({"777": tower()})[0]
    assert {"save": False, "use_scan": False} in calls and {"save": False} in calls
    assert row["plate_source"] == "matterport_scan"
    assert row["plate"] == "scanned floor"


def test_plate_name_says_which_outline_was_used():
    assert V.plate_name({"footprint_origin": "vexcel"}, "footprint") == "Vexcel outline"
    assert V.plate_name({"footprint_origin": "square"}, "footprint") == "square stand-in"
    assert V.plate_name({"footprint_origin": "vexcel"}, "matterport_scan") == "scanned floor"
