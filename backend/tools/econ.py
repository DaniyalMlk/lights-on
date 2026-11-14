"""Screening economics: what is the building worth as housing, and what's left to pay for it?

residual = value as housing - conversion cost - developer margin
This is an indicative residual for screening, not an offer price or an appraisal.
Three scenarios (downside / base / upside), a verdict and the two inputs that move it most.
"""
from __future__ import annotations

from backend import config as C


def base_conversion_psf(daylight_share: float) -> float:
    for threshold, psf in C.CONVERSION_PSF_BY_DAYLIGHT:
        if daylight_share >= threshold:
            return psf
    return C.CONVERSION_PSF_BY_DAYLIGHT[-1][1]


def effective_rent(rent_psf_month: float, free_weeks: float) -> float:
    return rent_psf_month * (1 - free_weeks / 52)


def value_per_nsf(rent_psf_month: float, free_weeks: float, opex: float, cap: float) -> float:
    return effective_rent(rent_psf_month, free_weeks) * 12 * (1 - opex) / cap


def run_case(case: dict, rent_psf_month: float, nsf: float, gfa: float, conversion_psf: float) -> dict:
    rent = rent_psf_month * case["rent_mult"]
    v_nsf = value_per_nsf(rent, case["free_weeks"], case["opex"], case["cap"])
    value = v_nsf * nsf
    cost = conversion_psf * case["cost_mult"] * gfa * C.SOFT_COST_MULT
    margin = cost * C.DEVELOPER_MARGIN
    residual = value - cost - margin
    return {
        "effective_rent_psf_month": effective_rent(rent, case["free_weeks"]),
        "value_per_nsf": v_nsf,
        "value": value,
        "cost": cost,
        "developer_margin": margin,
        "residual": residual,
        "residual_per_gsf": residual / gfa if gfa else 0.0,
    }


def tornado(rent_psf_month: float, nsf: float, gfa: float, conversion_psf: float, top: int = 2) -> list[dict]:
    """Move one input at a time from base to downside/upside; rank by how much the residual swings."""
    base = C.ECON_CASES["base"]
    base_be = run_case(base, rent_psf_month, nsf, gfa, conversion_psf)["residual"]
    bars = []
    for key in base:
        lo = dict(base, **{key: C.ECON_CASES["downside"][key]})
        hi = dict(base, **{key: C.ECON_CASES["upside"][key]})
        be_lo = run_case(lo, rent_psf_month, nsf, gfa, conversion_psf)["residual"]
        be_hi = run_case(hi, rent_psf_month, nsf, gfa, conversion_psf)["residual"]
        bars.append({"input": key, "low": be_lo - base_be, "high": be_hi - base_be,
                     "swing": abs(be_hi - be_lo),
                     "low_per_gsf": (be_lo - base_be) / gfa, "high_per_gsf": (be_hi - base_be) / gfa})
    return sorted(bars, key=lambda b: b["swing"], reverse=True)[:top]


def verdict(cases: dict, reference_value: float | None, gfa: float) -> dict:
    """Compare the residual with a reference value (assessed value or last sale: not a purchase price)."""
    base = cases["base"]["residual"]
    if base < 0:
        return {"code": "negative_residual", "gap_per_gsf": -base / gfa,
                "text": "Base case doesn't work even if the building were free"}
    if not reference_value:
        return {"code": "no_reference", "gap_per_gsf": None,
                "text": "No assessed or sale value to compare: showing the residual only"}
    if cases["downside"]["residual"] >= reference_value:
        return {"code": "supports_reference_all_cases", "gap_per_gsf": 0.0,
                "text": "Residual covers the reference value in every scenario: worth a professional study"}
    if base >= reference_value:
        return {"code": "supports_reference_base_only", "gap_per_gsf": 0.0,
                "text": "Residual covers the reference value in the base case only"}
    gap = (reference_value - base) / gfa
    return {"code": "gap_vs_reference", "gap_per_gsf": gap,
            "text": f"Base-case residual is ${gap:,.0f}/SF below the reference value"}


def econ(rent_psf_month: float, nsf: float, gfa: float, daylight_share: float,
         assessed_value: float | None = None, conversion_psf: float | None = None) -> dict:
    conv = conversion_psf or base_conversion_psf(daylight_share)
    cases = {name: run_case(case, rent_psf_month, nsf, gfa, conv) for name, case in C.ECON_CASES.items()}
    return {
        "inputs": {"rent_psf_month": rent_psf_month, "nsf": nsf, "gfa": gfa,
                   "conversion_psf_base": conv, "reference_value_assessed": assessed_value},
        "excluded": ["lease-up", "transaction costs", "carry before construction", "tenant buyouts"],
        "cases": cases,
        "verdict": verdict(cases, assessed_value, gfa),
        "tornado": tornado(rent_psf_month, nsf, gfa, conv),
    }
