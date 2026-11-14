import pytest

from backend.tools.carbon import scenarios
from backend.tools.econ import base_conversion_psf, econ, value_per_nsf, verdict

ELEV8_RENT = 2003 / 733   # 733 SF 1BR from $2,003/mo (apartments.com listing)


@pytest.mark.parametrize("cap,expected", [(0.06, 314), (0.055, 343), (0.065, 290)])
def test_elev8_sanity_values(cap, expected):
    # Spec §6.2: $2.42/SF effective (6 weeks free), 35% opex -> ~$314 per net SF at a 6% cap
    assert abs(value_per_nsf(ELEV8_RENT, 6, 0.35, cap) - expected) < 1.0


def test_cases_are_ordered():
    out = econ(ELEV8_RENT, nsf=300_000, gfa=400_000, daylight_share=0.7)
    r = {k: v["residual"] for k, v in out["cases"].items()}
    assert r["downside"] < r["base"] < r["upside"]


def test_conversion_cost_by_daylight():
    assert base_conversion_psf(0.8) == 200
    assert base_conversion_psf(0.6) == 300
    assert base_conversion_psf(0.3) == 375


def test_verdict_rule():
    cases = {"downside": {"residual": 10e6}, "base": {"residual": 30e6}}
    assert verdict(cases, 5e6, 100_000)["code"] == "supports_reference_all_cases"
    assert verdict(cases, 20e6, 100_000)["code"] == "supports_reference_base_only"
    v = verdict(cases, 50e6, 100_000)
    assert v["code"] == "gap_vs_reference" and abs(v["gap_per_gsf"] - 200) < 1e-6
    assert verdict(cases, None, 100_000)["code"] == "no_reference"
    assert verdict({"downside": {"residual": -9e6}, "base": {"residual": -5e6}}, 1e6, 100_000)["code"] == "negative_residual"


def test_higher_cost_or_cap_lowers_the_residual():
    from backend.tools.econ import run_case
    base = {"rent_mult": 1, "free_weeks": 6, "cap": 0.06, "opex": 0.35, "cost_mult": 1}
    r = run_case(base, ELEV8_RENT, 300_000, 400_000, 300)["residual"]
    assert run_case(base, ELEV8_RENT, 300_000, 400_000, 350)["residual"] < r
    assert run_case(dict(base, cap=0.07), ELEV8_RENT, 300_000, 400_000, 300)["residual"] < r


def test_tornado_has_two_ranked_bars():
    bars = econ(ELEV8_RENT, nsf=300_000, gfa=400_000, daylight_share=0.7)["tornado"]
    assert len(bars) == 2 and bars[0]["swing"] >= bars[1]["swing"]


def test_carbon_ranges():
    s = scenarios(gfa_sf=400_000, homes=372)
    assert s["avoided_t_low"] < s["avoided_t_base"] < s["avoided_t_high"]
    assert s["convert"]["new_embodied_t_high"] < s["demolish_rebuild"]["new_embodied_t_high"]
    assert s["leave_empty"]["homes"] == 0
