"""CoStar's raw values never reach the screen through an agent replay. Every figure here is made up."""
from backend.redact import HIDDEN, protected_values, redact, redact_text

TOWER = {"id": "T1", "vacancy": 0.4, "assessed_value": 41_500_000, "rba": 612_000, "typical_floor_sf": 23_040,
         "mf_rent_psf_month": 2.71, "office_rent_psf_year": 27.25}
RESULT = {"econ": {"inputs": {"rent_psf_month": 2.71, "gfa": 612_000, "nsf": 489_600,
                              "reference_value_assessed": 41_500_000}}}
P = protected_values(TOWER, RESULT)


def test_vacancy_phrases_are_hidden():
    assert redact_text("The building with ID T1 has a vacancy of 0.4.", P) == f"The building with ID T1 has a vacancy of {HIDDEN}."
    assert "0.4" not in redact_text("Building T1: Vacancy 0.4", P)
    assert "62%" not in redact_text("The current 62% vacancy compounds it.", P)
    assert "62%" not in redact_text("a vacancy rate of 62%", P)


def test_values_after_costar_keys_are_hidden():
    text = '{"rent_psf_month": 2.71, "nsf": 489600.0, "gfa": 612000, "conversion_psf_base": 300, "reference_value_assessed": 41500000}'
    out = redact_text(text, P)
    for raw in ("2.71", "489600", "612000", "41500000"):
        assert raw not in out
    assert '"conversion_psf_base": 300' in out                       # our own assumption stays


def test_prices_and_areas_are_hidden_however_they_are_rounded():
    for text in ("listed at $41.5M", "listed at $41,500,000", "0.6M SF of floor area", "about 23,000 SF a floor",
                 "rent of $2.71 per SF", "office rent $27.25"):
        assert HIDDEN in redact_text(text, P), text


def test_our_own_numbers_stay():
    text = "512 homes at 36 ft; residual -$64.2M; cost $188.9M; plate 21,904 SF from the scan; score 47.1"
    assert redact_text(text, P) == text


def test_sample_buildings_are_left_alone():
    sample = dict(TOWER, synthetic=True)
    text = "Building SAMPLE-1 spans 612,000 SF"
    assert redact_text(text, protected_values(sample)) == text


def test_every_string_in_an_event_is_scrubbed():
    event = {"type": "plan", "todos": [{"content": "Check vacancy of 40%", "status": "done"}],
             "args": {"text": "asking $41.5M"}, "n": 41_500_000}
    out = redact(event, P)
    assert "40%" not in out["todos"][0]["content"] and HIDDEN in out["args"]["text"]
    assert out["n"] == 41_500_000                                    # only text is shown, numbers in fields aren't


def test_json_keeps_its_commas():
    assert redact_text('"gfa": 612000,\n"x": 1', P) == f'"gfa": {HIDDEN},\n"x": 1'
