from backend.tools.verifier import verify

WORK = {
    "econ": {"effective_rent_psf_month": 2.4167, "assessed_value": 52_000_000, "gap_per_gsf": -45.3},
    "market": {"vacancy": 0.256},
    "carbon": {"avoided_t_base": 5987.4},
    "geometry": {"homes": 372, "homes_range": [316, 428], "plate_sf": 17998, "stories": 20},
}
OTHER_BUILDING = {"geometry": {"homes": 868}}


def rejected(text, work=WORK):
    return [r["text"] for r in verify(text, work)["values"]["rejected"]]


def test_rounding_at_shown_precision_passes():
    assert rejected("Effective rent is $2.42 per SF.") == []


def test_percent_matches_fraction():
    assert rejected("A quarter of office space (25.6%) is empty.") == []


def test_millions_suffix():
    assert rejected("Assessed at $52M today.") == []


def test_trailing_zeros_mean_rounded():
    assert rejected("It avoids about 6,000 t of CO2.") == []


def test_ranges_check_both_ends():
    assert rejected("Between 316–428 homes.") == []
    assert rejected("Between 316–500 homes.") == ["500"]


def test_negative_gap_shown_as_positive():
    assert rejected("Needs $45/SF of incentives.") == []


def test_untraceable_number_is_rejected_with_fix():
    out = verify("Rent is $2.73 per SF.", WORK)
    assert out["status"] == "error"
    r = out["values"]["rejected"][0]
    assert r["text"] == "$2.73" and r["fix"] == "use $2.42"


# Fault tests: right number, wrong building / wrong metric
def test_number_from_another_building_fails():
    assert rejected("This tower fits 868 homes.") == ["868"]
    assert rejected("This tower fits 868 homes.", OTHER_BUILDING) == []


def test_number_with_wrong_unit_fails():
    assert rejected("It fits 372 homes.") == []
    assert rejected("It costs $372.") == ["$372"]          # 372 is a home count, not money
    assert rejected("The plate is 17,998 SF.") == []
    assert rejected("It fits 17,998 homes.") == ["17,998"]


def test_only_years_and_ids_are_skipped():
    out = verify("Built in 1972, permit TABS2025025699, 1BR units, a 20-story tower.", WORK)
    assert out["values"]["rejected"] == []                # 20 matches stories; it is checked, not skipped
    assert [s["reason"] for s in out["values"]["skipped"]] == ["year"]
    assert rejected("A 23-story tower.") == ["23"]


def test_the_standard_home_depth_passes():
    from backend.pipeline import analyze
    import json
    from pathlib import Path
    sample = json.loads((Path(__file__).resolve().parent.parent / "backend" / "sample_buildings.json").read_text())["buildings"][0]
    r = analyze(sample, save=False)
    out = verify("86% of the floor is within 36 feet of a window.", r)
    assert out["status"] == "success", out["values"]["rejected"]


def test_the_buildings_own_id_and_street_number_are_not_facts():
    work = {"building": {"id": "234004", "address": "1801 Smith St"}, "geometry": {"homes": 360}}
    out = verify("Building 234004 at 1801 Smith St fits 360 homes.", work)
    assert out["status"] == "success" and {s["text"] for s in out["values"]["skipped"]} == {"234004", "1801"}
    assert verify("It costs $1801.", work)["status"] == "error"           # a money figure is still checked
