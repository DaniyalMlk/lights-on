"""Model parameters.

Frozen at H8 (see docs/preregistration.md). After the freeze, a change here
must be logged in the pre-registration doc with the reason, BEFORE any test is re-run.
Values marked 'guess' are placeholders until we have CoStar data or a source for them.
"""

# --- Geometry -------------------------------------------------------------
DEPTHS_FT = (30, 36, 42)          # unit depth, facade -> corridor wall
BASE_DEPTH_FT = 36                # headline depth (used for score and the 1801 Smith test)
CORRIDOR_FT = 6                   # corridor ring behind the units
CORE_SHARE = 0.18                 # centered core as a share of the plate when no Matterport core (guess)
DARK_BAND_BRANCH_FT = 12.0        # mean core-to-window minus (unit depth + corridor) > 12 ft -> deep-plate branch
                                  # (pre-freeze change: a '25% of plate' trigger almost never fires with an 18% core)
PODIUM_RATIO = 0.80               # typical_floor_sf / footprint < 0.8 -> podium/setback branch
NON_RESIDENTIAL_FLOORS = 1        # ground floor = lobby / retail
F2F_RED_FT = 11.0                 # floor-to-floor flags (a flag, never a score input)
F2F_AMBER_FT = 12.0

# Unit sizes (area-based; width = area / depth)
UNIT_SF = {"studio": 590, "1br": 735, "2br": 1100}   # Elev8 listings: smallest studio 589 SF, 1BR 733 SF
MIN_HOME_SF = 0.85 * 590                             # smaller pieces become storage / amenity
NET_TO_GROSS_BAND = (0.72, 0.82)

# --- Economics ------------------------------------------------------------
# Three scenarios. Downside uses every pessimistic input at once: a stress case, not a probability.
ECON_CASES = {
    "downside": {"rent_mult": 0.90, "free_weeks": 8, "cap": 0.065, "opex": 0.40, "cost_mult": 1.25},
    "base":     {"rent_mult": 1.00, "free_weeks": 6, "cap": 0.060, "opex": 0.35, "cost_mult": 1.00},
    "upside":   {"rent_mult": 1.10, "free_weeks": 0, "cap": 0.055, "opex": 0.30, "cost_mult": 0.80},
}
SOFT_COST_MULT = 1.15             # soft costs + financing on top of hard conversion cost (guess)
DEVELOPER_MARGIN = 0.10           # required developer profit, as a share of conversion cost (guess)
# Not modeled (shown in the UI as excluded): lease-up, transaction costs, carry before construction, tenant buyouts.
# Base conversion cost by daylight share, picked inside the published $150-$400/SF range (guess)
CONVERSION_PSF_BY_DAYLIGHT = [(0.75, 200.0), (0.55, 300.0), (0.0, 375.0)]

# --- Carbon ---------------------------------------------------------------
SF_TO_M2 = 0.09290304
EC_NEW_KG_PER_M2 = {"low": 366.0, "base": 450.0, "high": 615.0}   # mid-rise residential, upfront
REUSE_SHARE = {"low": 0.50, "high": 0.75}                          # share of new-build carbon avoided by reuse

# --- Gate and score -------------------------------------------------------
VACANCY_GATE = 0.35               # occupancy is a filter, never part of the score (guess)
SCORE_WEIGHTS = {"geometry": 45, "economics": 30, "market": 15, "context": 10}  # guess, frozen at H8
MATTERPORT_BORDERLINE = 0.05      # pull Matterport only if daylight share is within +/- this of a threshold
DAYLIGHT_THRESHOLDS = (0.55, 0.75)
