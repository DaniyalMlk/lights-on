"""Keep CoStar's raw values off the screen.

A recorded or live agent run can quote a building's vacancy, rents, price or floor areas: the screener reports
vacancy, and a sub-agent may read econ.json. CoStar lets us show building names and our own home counts, not
those values. So every event is scrubbed here before it reaches the browser. The trace on disk stays as it was.

Three passes, each simple on its own:
1. A key from CoStar's record followed by a value ("gfa": 612000)   -> the value is hidden.
2. A vacancy phrase ("has a vacancy of 0.4", "62% vacancy")           -> the number is hidden.
3. Any number close to one of this building's CoStar figures          -> hidden. "Close" depends on how the
   number was rounded: "$41.5M" matches 41,500,000 and "0.6M SF" matches 612,000.
4. On a real building, every dollar figure that is left                -> hidden too. Our own totals give CoStar's
   figures away: a total cost divided by our published cost per SF is the floor area, and a residual next to
   the "needs $X/SF more" verdict is the reference price. Home counts, shares and scores stay.
Sample buildings are made up, so they are left alone.
"""
from __future__ import annotations

import re

HIDDEN = "[CoStar value hidden]"
MONEY_HIDDEN = "[dollar figure hidden]"

COSTAR_KEYS = ("vacancy", "availability", "rent_psf_month", "mf_rent_psf_month", "office_rent_psf_year",
               "reference_value_assessed", "assessed_value", "rba", "typical_floor_sf", "gfa", "gfa_sf", "nsf")
_KEY_VALUE = re.compile(r"""(["']?\b(?:%s)\b["']?\s*[:=]\s*)(-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?)"""
                        % "|".join(COSTAR_KEYS), re.I)
_VACANCY_AFTER = re.compile(r"(\b(?:vacancy|vacant|availability)(?:\s+(?:rate|share))?"
                            r"(?:\s+(?:of|is|at|was|=))?[\s:]*)(\d+(?:\.\d+)?\s*%?)", re.I)
_VACANCY_BEFORE = re.compile(r"(\d+(?:\.\d+)?\s*%)(\s+(?:vacancy|vacant|availability)\b)", re.I)
# Our own money outputs, as keys in a tool output and as dollar amounts in prose ("-$64.2M", "$188,900,000.00")
MONEY_KEYS = ("effective_rent_psf_month", "value_per_nsf", "value", "cost", "residual", "residual_per_gsf",
              "gap_vs_reference", "swing", "low", "high")
# The key may carry a note and markdown before its value: "**Residual (Base Case):** -64,200,000.25"
_MONEY_KEY_VALUE = re.compile(r"""(["']?\b(?:%s)\b(?:\s*\([^)\n]{0,30}\))?["'*]*\s*[:=]\s*\**\s*)(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?)"""
                              % "|".join(MONEY_KEYS), re.I)
# A number in the millions written with commas or decimals is a money total. (Building ids are plain digits.)
_MILLIONS = re.compile(r"-?\b(?:\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?|\d{7,}\.\d+)\b")
_MONEY = re.compile(r"-?\$\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:million|billion|[MBKk])\b)?")
_NUMBER = re.compile(r"(\$?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*(?:M\b|K\b|k\b|million\b))?")
_SCALE = {"m": 1e6, "million": 1e6, "k": 1e3}


def protected_values(building: dict, result: dict | None = None) -> dict:
    """The building's CoStar figures: large ones (prices, floor areas) and rents (dollars per SF).
    money: True for a real building, where every remaining dollar figure is hidden as well."""
    if building.get("synthetic"):
        return {"large": [], "rents": [], "money": False}
    inputs = ((result or {}).get("econ") or {}).get("inputs") or {}
    large = [building.get(k) for k in ("assessed_value", "rba", "typical_floor_sf")]
    large += [inputs.get(k) for k in ("gfa", "nsf", "reference_value_assessed")]
    rents = [building.get(k) for k in ("mf_rent_psf_month", "office_rent_psf_year")] + [inputs.get("rent_psf_month")]
    return {"large": sorted({float(v) for v in large if v and float(v) >= 1000}),
            "rents": sorted({round(float(v), 2) for v in rents if v}), "money": True}


def _close_to(token: str, scale: float, value: float, targets: list[float]) -> bool:
    digits = token.replace(",", "")
    decimals = len(digits.split(".")[1]) if "." in digits else 0
    half_unit = 0.5 * 10 ** -decimals * scale              # how far a rounded number can sit from the truth
    return any(abs(value - t) <= half_unit + 0.005 * t for t in targets)


def redact_text(text: str, protect: dict) -> str:
    text = _KEY_VALUE.sub(lambda m: m.group(1) + HIDDEN, text)
    text = _VACANCY_AFTER.sub(lambda m: m.group(1) + HIDDEN, text)
    text = _VACANCY_BEFORE.sub(lambda m: HIDDEN + m.group(2), text)

    def number(m: re.Match) -> str:
        dollar, token, suffix = m.group(1), m.group(2), (m.group(3) or "").strip().lower()
        scale = _SCALE.get(suffix, 1.0)
        value = float(token.replace(",", "")) * scale
        if value >= 1000 and _close_to(token, scale, value, protect["large"]):
            return HIDDEN
        if dollar and not suffix and round(value, 2) in protect["rents"]:
            return HIDDEN
        return m.group(0)

    text = _NUMBER.sub(number, text)
    if protect.get("money"):
        text = _MONEY_KEY_VALUE.sub(lambda m: m.group(1) + MONEY_HIDDEN, text)
        text = _MONEY.sub(MONEY_HIDDEN, text)
        text = _MILLIONS.sub(MONEY_HIDDEN, text)
    return text


def redact(value, protect: dict):
    """Scrub every string inside an event (text, summaries, tool arguments, plan items)."""
    if isinstance(value, str):
        return redact_text(value, protect)
    if isinstance(value, list):
        return [redact(v, protect) for v in value]
    if isinstance(value, dict):
        return {k: redact(v, protect) for k, v in value.items()}
    return value
