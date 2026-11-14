"""CoStar's raw values never reach the screen through an agent replay. Every figure here is made up."""
from backend.redact import HIDDEN, MONEY_HIDDEN, protected_values, redact, redact_text

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


def test_our_own_counts_and_scores_stay():
    text = "512 homes at 36 ft; 81% near a window; plate 21,904 SF from the scan; score 47.1"
    assert redact_text(text, P) == text


def test_dollar_figures_of_a_real_building_are_hidden():
    # A total cost divided by our published cost per SF is the floor area, so our own totals go too
    out = redact_text("residual -$64.2M; cost $188,900,000.00; a residual per GSF of -$71; needs $300/SF of hard cost", P)
    for raw in ("64.2", "188,900,000", "71", "300"):
        assert raw not in out
    assert out.count(MONEY_HIDDEN) == 4
    out = redact_text('{"cost": 188900000.0, "residual": -64200000.0, "residual_per_gsf": -104.9, "homes": 512}', P)
    assert "188900000" not in out and "64200000" not in out and "104.9" not in out
    assert '"homes": 512' in out
    out = redact_text("- **Residual (Base Case):** -64,200,000.25\n- Cost (Base Case): 188,900,000.5\n- Score: 47.1", P)
    assert "64,200,000" not in out and "188,900,000" not in out and "Score: 47.1" in out
    assert redact_text("Screen building 10819844 for vacancy eligibility.", P) == "Screen building 10819844 for vacancy eligibility."


def test_dollar_figures_of_a_sample_building_stay():
    sample = protected_values(dict(TOWER, synthetic=True))
    text = "residual -$64.2M; cost $188.9M"
    assert redact_text(text, sample) == text


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
