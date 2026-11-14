from backend import validation as V

BUILDINGS = {"X": {"id": "X", "name": "Smith tower", "address": "1801 Smith St", "stories": 20, "vacancy": 0.6,
                   "typical_floor_sf": 18000,
                   "footprint": {"type": "Polygon", "coordinates": [[[-95.3662, 29.7568], [-95.3655, 29.7568],
                                 [-95.3655, 29.7573], [-95.3662, 29.7573], [-95.3662, 29.7568]]]}}}


def test_missing_buildings_report_no_data():
    rows = [V.check_case(c, {}) for c in V.CASES]
    assert {r["status"] for r in rows} == {"no data"}


def test_case_matched_by_address_gets_an_error_pct():
    row = V.check_case(V.CASES[0], BUILDINGS)
    assert row["building_id"] == "X" and row["status"] in ("pass", "miss") and "error_pct" in row


def test_run_writes_proof_and_keeps_history(monkeypatch, tmp_path):
    monkeypatch.setattr(V, "WORK_DIR", tmp_path)
    V.run(BUILDINGS)
    V.run(BUILDINGS)
    assert (tmp_path / "proof.json").exists()
    assert len((tmp_path / "proof_history.jsonl").read_text().splitlines()) == 2


def test_input_sensitivity_has_both_ranks():
    row = V.input_sensitivity(BUILDINGS)[0]
    assert {"homes_costar_only", "homes_with_footprint", "rank_costar_only", "rank_with_footprint"} <= row.keys()
