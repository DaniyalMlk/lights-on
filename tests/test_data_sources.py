import json

from backend.data_sources import DEFAULT_FIELD_MAP, build_buildings, comps_rent, load_field_map, normalize, to_number

# The tests use the placeholder column names, so a real data/field_map.json on a laptop can't break them.
FM = DEFAULT_FIELD_MAP

ROW = {"PropertyID": "101", "PropertyName": "Test Tower", "Address": "1 Main St", "Latitude": "29.757",
       "Longitude": "-95.366", "PropertyType": "Office", "NumberOfStories": "20", "RBA": "400,000",
       "TypicalFloorSF": "19,500", "VacancyPercent": "62%", "AskingRentPerSF": "$24.50",
       "AssessedValue": "$18,000,000", "YearBuilt": "1972"}
SQUARE = {"type": "Polygon", "coordinates": [[[-95.3662, 29.7568], [-95.3658, 29.7568], [-95.3658, 29.7572],
                                              [-95.3662, 29.7572], [-95.3662, 29.7568]]]}


def test_to_number():
    assert to_number("$1,234.5") == 1234.5 and to_number("62%") == 62 and to_number("") is None


def test_normalize_converts_units():
    b = normalize(ROW, FM)
    assert b["vacancy"] == 0.62 and b["stories"] == 20 and b["rba"] == 400_000 and b["id"] == "101"


def test_comps_rent_needs_enough_nearby_comps():
    b = normalize(ROW, FM)
    near = [{"lat": 29.758, "lon": -95.366, "rent_psf_month": r} for r in (2.4, 2.6, 2.5)]
    far = [{"lat": 29.80, "lon": -95.50, "rent_psf_month": 9.9}]
    assert comps_rent(b, near + far) == (2.5, 3)
    assert comps_rent(b, near[:2]) == (None, 2)


def test_build_joins_and_reports_skips():
    other = dict(ROW, PropertyID="102", PropertyName="No Footprint", Latitude="")
    retail = dict(ROW, PropertyID="103", PropertyType="Retail")
    buildings, skipped = build_buildings([ROW, other, retail], {"101": SQUARE}, field_map=FM)
    assert [b["id"] for b in buildings] == ["101"]
    assert skipped == [{"id": "102", "name": "No Footprint", "reasons": ["no footprint"]}]


def test_field_map_file_overrides_placeholders(tmp_path):
    path = tmp_path / "field_map.json"
    path.write_text(json.dumps({"vacancy": "Vac"}))
    field_map = load_field_map(path)
    assert field_map["vacancy"] == "Vac" and field_map["id"] == DEFAULT_FIELD_MAP["id"]
    assert load_field_map(tmp_path / "missing.json") == DEFAULT_FIELD_MAP


def test_coordinate_only_building_kept_without_analysis_footprint():
    buildings, skipped = build_buildings([ROW], {}, field_map=FM)
    assert not skipped and buildings[0]["footprint"] is None
