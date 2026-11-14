# Pre-registered tests

Written down before any test runs. Parameters are frozen at H8 (`backend/config.py`). After the freeze, every change gets a line in the change log below, with the reason, before re-running anything. Misses get shown, not tuned away.

## Parameters at freeze

Fill in at H8 from `backend/config.py`, with a source for each:

| Parameter | Value | Source |
|---|---|---|
| Unit depths | 30 / 36 / 42 ft, headline 36 | |
| Corridor | 6 ft | |
| Core share (no Matterport) | 18% | |
| Unit sizes | studio 590, 1BR 735, 2BR 1,100 SF | Elev8 listings (589 / 733 SF) |
| Conversion $/SF by daylight share | 200 / 300 / 375 | |
| Cap / opex / free weeks (base) | 6.0% / 35% / 6 | |
| Deep-plate trigger | dark band > 12 ft | |

## Cases

| # | Case | Ground truth | Pass if | Expected (write before running) | Result |
|---|---|---|---|---|---|
| 1 | 1801 Smith (Elev8), **development check, not a holdout** (its unit sizes shaped our parameters) | 372 units; dark core became amenity | 36 ft base case within ±15% of 372 (317–427 homes) | | |
| 2 | One City Centre (1021 Main), **planned program, not built yet** | 460 apartments on levels 7–29 (the 93 hotel apartments are not homes, don't add them) | Within ±15% of 460 for the residential floors, and the deep-plate branch picks a mixed program | | |
| 3a | 708 Main | AECOM 2023 deep-dive conclusion (write it down before running) | Same direction as AECOM, or the disagreement explained | | |
| 3b | 1415 Louisiana | AECOM 2023 deep-dive conclusion | Same direction as AECOM, or the disagreement explained | | |
| 4 | Negative case, **picked from an outside label** (a building a published study called unsuitable), not from our own score or the vacancy gate | Outside verdict | We also call it weak, with the reason shown | | |

Report results per building ("4 of 5 buildings"), not as an accuracy percentage. It's a case study.

**Input sensitivity (not accuracy):** downtown ranking with CoStar only vs + Vexcel (+ Matterport only if the test buildings have scans). This shows each layer changes the answer. It does not show the answer got more accurate unless we have an independent reference.

**Verifier fault tests** (in `tests/test_verifier.py`): the right number from another building fails; a home count written as dollars fails; a correctly rounded value passes. In the demo, call these injected fault tests.

## Change log

- Before freeze: deep-plate trigger changed from "dark zone > 25% of the plate" to "dark band > 12 ft". With an 18% core, the 25% rule almost never fires, even on a 200 x 200 ft floor.
