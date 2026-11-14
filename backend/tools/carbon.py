"""Leave empty / convert / demolish & rebuild: homes and upfront embodied carbon, always as ranges."""
from __future__ import annotations

from backend import config as C


def scenarios(gfa_sf: float, homes: int) -> dict:
    m2 = gfa_sf * C.SF_TO_M2
    ec = C.EC_NEW_KG_PER_M2
    rebuild_t = {k: m2 * v / 1000 for k, v in ec.items()}                   # tonnes CO2e
    avoided_low = m2 * ec["low"] * C.REUSE_SHARE["low"] / 1000
    avoided_high = m2 * ec["high"] * C.REUSE_SHARE["high"] / 1000
    avoided_base = m2 * ec["base"] * sum(C.REUSE_SHARE.values()) / 2 / 1000
    return {
        "gfa_m2": m2,
        "leave_empty": {"homes": 0, "new_embodied_t": 0.0},
        "convert": {"homes": homes,
                    "new_embodied_t_low": rebuild_t["low"] * (1 - C.REUSE_SHARE["high"]),
                    "new_embodied_t_high": rebuild_t["high"] * (1 - C.REUSE_SHARE["low"])},
        "demolish_rebuild": {"homes": homes, "new_embodied_t_low": rebuild_t["low"],
                             "new_embodied_t_high": rebuild_t["high"]},
        "avoided_t_low": avoided_low,
        "avoided_t_base": avoided_base,
        "avoided_t_high": avoided_high,
        "note": "Upfront embodied carbon only; demolition emissions excluded (makes 'avoided' conservative).",
    }
