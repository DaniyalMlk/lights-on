"""The loader is tested on a tiny made-up kit. Field names here are invented, so CoStar's schema never appears in the repo."""
import json

import pytest

from backend.costar_kit import buildings_from_kit, get, square_footprint

MAP = {
    "files": {"property": "p.jsonl", "occupancy": "o.jsonl", "listing": "l.jsonl", "sale": "s.jsonl", "apartment": "a.jsonl"},
    "office_type": 1, "active_status": 1, "monthly_basis": 1, "built_event": 9,
    "property": {"id": "pid", "name": "title", "street_number": "where.no", "street_name": "where.st", "street_type": "where.kind",
                 "lat": "where.la", "lon": "where.lo", "property_type": "kind", "stories": "levels", "height_ft": "tall",
                 "rba": "area", "typical_floor_sf": "floor_area", "events": "history", "event_type": "what", "event_year": "yr"},
    "occupancy": {"property_id": "pid", "end": "until", "spaces": "rooms", "space_sf": "sf"},
    "listing": {"property_id": "pid", "status": "state", "lease": "rent_side", "sale": "sale_side", "available_sf": "free_sf",
                "rate_low": "lo", "rate_high": "hi", "rate_basis": "per", "price_low": "p_lo", "price_high": "p_hi",
                "deal_value": "deal"},
    "sale": {"entities": "parts", "property_id": "pid", "price": "paid", "date": "on"},
    "apartment": {"lat": "at.la", "lon": "at.lo", "plans": "plans", "units": "n", "rent_min": "r1", "rent_max": "r2",
                  "sf_min": "s1", "sf_max": "s2"},
}

TOWER = {"pid": 7, "title": "Test Tower", "where": {"no": "1", "st": "Main", "kind": "St", "la": 29.756, "lo": -95.365},
         "kind": 1, "levels": 30, "tall": 400, "area": 600_000, "floor_area": 20_000, "history": [{"what": 9, "yr": 1975}]}
FAR_AWAY = {**TOWER, "pid": 8, "where": {**TOWER["where"], "la": 29.9}}
APARTMENTS = {**TOWER, "pid": 9, "kind": 2}
NO_FLOOR = {**TOWER, "pid": 10, "floor_area": None}


def write_kit(folder, rows_by_file):
    for name, rows in rows_by_file.items():
        (folder / name).write_text("\n".join(json.dumps(r) for r in rows) + "\n")


@pytest.fixture
def kit(tmp_path):
    comp = {"at": {"la": 29.757, "lo": -95.366}, "plans": [{"n": 10, "r1": 1500, "r2": 1700, "s1": 800, "s2": 800}]}
    write_kit(tmp_path, {
        "p.jsonl": [TOWER, FAR_AWAY, APARTMENTS, NO_FLOOR],
        "o.jsonl": [{"pid": 7, "until": None, "rooms": [{"sf": 150_000}, {"sf": 60_000}]},
                    {"pid": 7, "until": "2019-01-01", "rooms": [{"sf": 300_000}]}],        # ended: doesn't count
        "l.jsonl": [{"pid": 7, "state": 1, "rent_side": {"free_sf": 120_000, "lo": 2.0, "hi": 2.5, "per": 1}},
                    {"pid": 7, "state": 1, "sale_side": {"p_hi": 50_000_000}},
                    {"pid": 7, "state": 3, "rent_side": {"free_sf": 999_999}}],            # off market: ignored
        "s.jsonl": [{"parts": [{"pid": 7}], "paid": 80_000_000, "on": "2015-06-01"}],
        "a.jsonl": [comp, comp, comp],
    })
    return tmp_path


def test_get_follows_dotted_paths():
    assert get({"a": {"b": 3}}, "a.b") == 3
    assert get({"a": None}, "a.b") is None and get({}, "x") is None


def test_square_footprint_has_the_floor_area():
    ring = square_footprint(29.75, -95.36, 10_000)["coordinates"][0]
    assert len(ring) == 5 and ring[0] == ring[-1]


def test_builds_downtown_offices_only(kit):
    buildings, skipped = buildings_from_kit(kit, MAP)
    assert [b["id"] for b in buildings] == ["7"]
    assert skipped == [{"id": "10", "name": "1 Main St", "reasons": ["no typical floor size"]}]
    b = buildings[0]
    assert b["name"] == "Test Tower" and b["address"] == "1 Main St" and b["year_built"] == 1975
    assert b["vacancy"] == 0.65                     # 1 - 210,000 / 600,000
    assert b["availability"] == 0.2                 # 120,000 / 600,000
    assert b["office_rent_psf_year"] == 27.0        # (2.0 + 2.5) / 2, monthly x 12
    assert b["assessed_value"] == 50_000_000 and b["reference_source"].startswith("asking price")
    assert b["mf_rent_psf_month"] == 2.0 and b["rent_comps"] == 3     # 1,600 / 800


def test_falls_back_to_last_sale_without_a_listing(kit):
    (kit / "l.jsonl").write_text("")
    b = buildings_from_kit(kit, MAP)[0][0]
    assert b["assessed_value"] == 80_000_000 and b["reference_source"] == "last recorded sale"
    assert b["vacancy"] == 0.65 and b["availability"] == 0.0
