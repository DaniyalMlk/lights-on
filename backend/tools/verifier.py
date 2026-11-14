"""Checks that every number in a draft comes from this building's saved tool outputs (work/<id>/*.json).

How a number passes:
- It has to match a value saved for THIS building (numbers from other buildings don't count).
- It has to match the right kind of value: "$" numbers only match money fields, "%" only shares,
  "... homes" only home counts, "... SF" only areas, "... t" only carbon.
- It can be rounded the way it's shown: "$2.42" matches 2.4167, "6,000" matches 5,987,
  "25.6%" matches 0.256, "$52M" matches 52,000,000.
Only years, IDs (numbers glued to letters, like TABS2025025699 or 1BR) and the building's own id and street
number (234004, the 1801 in "1801 Smith St") are skipped.
"""
from __future__ import annotations

import math
import re

NUM_RE = re.compile(
    r"(?<![\w.])(?P<cur>\$)?(?P<sign>[-−])?(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?P<frac>\.\d+)?"
    r"(?:\s?(?P<pct>%)|(?P<mult>[kKmMbB])(?![A-Za-z]))?(?![\w])"
)
MULT = {"k": 1e3, "K": 1e3, "m": 1e6, "M": 1e6, "b": 1e9, "B": 1e9}

# Which saved fields each kind of number is allowed to match (by key name)
KIND_KEYS = {
    "money": ("value", "cost", "residual", "margin", "rent", "assessed", "psf", "gap"),
    "share": ("share", "vacancy", "cap", "opex", "ratio", "reuse"),
    "homes": ("homes",),
    "area": ("_sf", "sf_", "nsf", "gfa", "area"),
    "carbon": ("_t", "t_", "embodied", "avoided"),
    "length": ("_ft", "ft_", "depth", "facade", "band"),
}
AFTER_KIND = [
    (re.compile(r"^\s?(homes?|apartments?|units?)\b", re.I), "homes"),
    (re.compile(r"^\s?(sf|sq\.? ?ft|square feet)\b", re.I), "area"),
    (re.compile(r"^\s?(t|tonnes?|tons?)\b", re.I), "carbon"),
    (re.compile(r"^\s?(ft|feet|foot)\b", re.I), "length"),
]


def collect_values(obj, path: str = "") -> list[tuple[str, float]]:
    """Every numeric leaf as (key path, value). Negative values are also stored as positive (e.g. a gap)."""
    out = []
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)) and math.isfinite(obj):
        out.append((path, float(obj)))
        if obj < 0:
            out.append((path, abs(float(obj))))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            out.extend(collect_values(v, f"{path}.{k}".lower()))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out.extend(collect_values(v, path))
    return out


def number_kind(m: re.Match, after: str) -> str | None:
    if m.group("cur"):
        return "money"
    if m.group("pct"):
        return "share"
    for pattern, kind in AFTER_KIND:
        if pattern.match(after):
            return kind
    return None


def shown_precision(int_part: str, frac: str | None) -> int:
    """Decimal places to round to. Negative means it was rounded to tens / hundreds / thousands."""
    if frac:
        return len(frac) - 1
    digits = int_part.replace(",", "")
    trailing = len(digits) - len(digits.rstrip("0"))
    return -min(trailing, max(len(digits) - 1, 0))


def candidates(values, kind, pct):
    for path, x in values:
        if kind and not any(key in path for key in KIND_KEYS[kind]):
            continue
        yield path, x
        if pct:
            yield path, x * 100


def own_identifiers(work: dict) -> set[str]:
    """The building's own id and the numbers in its address ("1801" in "1801 Smith St"). Not facts to check."""
    b = work.get("building") or {}
    return {str(b.get("id", ""))} | set(re.findall(r"\d+", str(b.get("address", "")))) - {""}


def verify(text: str, work: dict) -> dict:
    values = collect_values(work)
    own = own_identifiers(work)
    passed, rejected, skipped = [], [], []
    for m in NUM_RE.finditer(text):
        raw = m.group(0)
        int_part, frac = m.group("int"), m.group("frac")
        shown = float(int_part.replace(",", "") + (frac or ""))
        if m.group("sign"):
            shown = -shown
        pct, mult = bool(m.group("pct")), m.group("mult")
        scale = MULT[mult] if mult else 1.0
        kind = number_kind(m, text[m.end(): m.end() + 14])

        if kind is None and not (frac or mult or pct or m.group("cur")) and int_part in own:
            skipped.append({"text": raw, "reason": "building id or street number"})
            continue
        if kind is None and not (frac or mult) and "," not in int_part and 1900 <= shown <= 2100:
            skipped.append({"text": raw, "reason": "year"})
            continue

        prec = shown_precision(int_part, frac)
        match = next((p for p, x in candidates(values, kind, pct) if round(x / scale, prec) == round(shown, prec)), None)
        if match:
            passed.append({"text": raw, "matched": match})
            continue

        nearest = min(candidates(values, kind, pct), key=lambda c: abs(c[1] - shown * scale), default=None)
        fix = None
        if nearest and abs(nearest[1] - shown * scale) <= 0.5 * max(abs(shown * scale), 1e-9):
            v = nearest[1] / scale
            fix = f"{'$' if m.group('cur') else ''}{v:,.{max(prec, 0)}f}{'%' if pct else ''}{mult or ''}"
        rejected.append({"text": raw, "kind": kind or "any",
                         "reason": "not found in this building's tool outputs" + (f" ({kind} fields)" if kind else ""),
                         "fix": f"use {fix}" if fix else "remove it or add the tool call that computes it"})

    return {
        "status": "success" if not rejected else "error",
        "summary": f"{len(passed)} numbers traced, {len(rejected)} rejected, {len(skipped)} skipped",
        "values": {"passed": passed, "rejected": rejected, "skipped": skipped},
        "source": "verifier(work/<id>)",
        "next_actions": ["writer: fix the rejected numbers, then verify again"] if rejected else ["approve"],
    }
