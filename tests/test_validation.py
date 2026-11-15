import pytest

from backend import config as C
from backend import pipeline
from backend import validation as V


@pytest.fixture(autouse=True)
def scratch_work_dir(tmp_path, monkeypatch):
    """check_case saves results like real data; keep them out of the real work/ folder."""
    monkeypatch.setattr(pipeline, "WORK_DIR", tmp_path)
    monkeypatch.setattr(V, "WORK_DIR", tmp_path)

BUILDINGS = {"X": {"id": "X", "name": "Smith tower", "address": "1801 Smith St", "stories": 20, "vacancy": 0.6,
                   "typical_floor_sf": 18000,
                   "footprint": {"type": "Polygon", "coordinates": [[[-95.3662, 29.7568], [-95.3655, 29.7568],
                                 [-95.3655, 29.7573], [-95.3662, 29.7573], [-95.3662, 29.7568]]]}}}


# A made-up case for a building that isn't in our data: a 70 x 250 ft slab, which fits 10 homes per floor at 36 ft.
MADE_UP = {"case": "Made-up tower", "address": "999 Nowhere", "role": "test", "truth_homes": 100, "residential_floors": 10,
           "source": "made up", "public_plate": {"width_ft": 70, "length_ft": 250, "stories": 12,
                            "label": "Made up, public numbers, not CoStar", "source": "p. 1"}}


def test_missing_buildings_report_no_data():
    rows = [V.check_case(c, {}) for c in V.CASES if not c.get("public_plate")]
    assert rows and {r["status"] for r in rows} == {"no data"}


def test_case_can_run_on_public_numbers_and_says_so(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.pipeline.WORK_DIR", tmp_path)
    row = V.check_case(MADE_UP, {})
    # Home counts sit on a knife edge: the last piece of a facade is a home or a storage room by a fraction of a
    # foot, and that differs between machines (10 or 9 homes a floor here). So the expected count comes from the
    # same analysis instead of a fixed number; either result is within the tolerance and passes.
    per_floor = V.analyze(V.public_building(MADE_UP), save=False)["geometry"]["by_depth"][str(C.BASE_DEPTH_FT)]["homes_per_floor"]
    assert row["predicted"] == per_floor * MADE_UP["residential_floors"] and per_floor in (9, 10)
    assert row["status"] == "pass" and row["missed"] == []
    assert row["inputs"] == "Made up, public numbers, not CoStar (p. 1)"
    assert list(tmp_path.iterdir()) == []                  # a hand-entered building is never cached as if it were data


def test_our_data_wins_over_public_numbers(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.pipeline.WORK_DIR", tmp_path)
    row = V.check_case({**MADE_UP, "address": "1801 Smith"}, BUILDINGS)
    assert row["inputs"] == "our data" and row["building_id"] == "X"


def test_deep_plate_expectation_is_part_of_the_result(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.pipeline.WORK_DIR", tmp_path)
    wrong = V.check_case({**MADE_UP, "expect_deep_plate": True}, {})        # a 70 ft slab is not a deep plate
    assert wrong["deep_plate"] is False and wrong["status"] == "miss" and wrong["missed"] == ["deep-plate branch"]
    right = V.check_case({**MADE_UP, "expect_deep_plate": False}, {})
    assert right["status"] == "pass"
    off = V.check_case({**MADE_UP, "truth_homes": 200}, {})
    assert off["status"] == "miss" and off["missed"] == ["home count"]


def test_case_matched_by_address_gets_an_error_pct():
    row = V.check_case(V.CASES[0], BUILDINGS)
    assert row["building_id"] == "X" and row["status"] in ("pass", "miss") and "error_pct" in row


def test_run_writes_proof_and_keeps_history(monkeypatch, tmp_path):
    monkeypatch.setattr(V, "WORK_DIR", tmp_path)
    monkeypatch.setattr(V, "CASES", [V.CASES[0], MADE_UP])     # the real pre-registered cases only run in run_validation
    V.run(BUILDINGS)
    V.run(BUILDINGS)
    assert (tmp_path / "proof.json").exists()
    assert len((tmp_path / "proof_history.jsonl").read_text().splitlines()) == 2


def test_input_sensitivity_has_both_ranks():
    row = V.input_sensitivity(BUILDINGS)[0]
    assert {"homes_costar_only", "homes_with_footprint", "rank_costar_only", "rank_with_footprint"} <= row.keys()


def test_costar_only_square_is_the_stand_in_itself():
    from backend.costar_kit import square_footprint
    b = {"id": "S", "lat": 29.7495, "lon": -95.372, "typical_floor_sf": 21_000,
         "footprint": square_footprint(29.7495, -95.372, 21_000)}
    assert V.costar_only_plate(b)["footprint"] == b["footprint"]
