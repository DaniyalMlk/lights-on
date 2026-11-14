# Pre-registered tests

Written down before the official validation run. Parameters are frozen Sat 02:25 am, moved up from 10:00 am (`backend/config.py`, see the change log). After the freeze, every change gets a line in the change log below, with the reason, before re-running anything. Misses get shown, not tuned away.

**Not fully blind:** on Sat 00:30, before this file was committed, we ran every downtown building in our data once and printed some results (see the change log). Cases marked *seen* below were written after that run.

## Parameters at freeze

Parameter hash at freeze (`backend.validation.params_version()`): `6ba9f5da` when this file was committed (main at `6c5b4ad`; `config.py` unchanged since the first commit). Confirmed again at the freeze, in the change log

| Parameter | Value | Source |
|---|---|---|
| Unit depths | 30 / 36 / 42 ft, headline 36 | Daylight limit of roughly 30–35 ft (spec §3, plate-depth source); the three-step band and the 36 ft headline are our guess |
| Corridor | 6 ft | Guess |
| Core share | 18%, centered, same shape as the plate | Guess. The first full-floor scan we pulled doesn't show its core (one open room; the voids are column-sized), so the share can't be measured from it. A scan that does show core walls replaces the assumption for that building |
| Unit sizes | studio 590, 1BR 735, 2BR 1,100 SF | Studio and 1BR: Elev8 listings (589 / 733 SF). 2BR: guess. CoStar's floor-plan data for Elev8 gives somewhat different averages (private notes). **Not adopted:** we had already seen a result, so a change that can move home counts would be post-hoc. Corner homes are drawn as depth x depth squares, so the 2BR value mostly only labels them; leftover pieces larger than 2.2 x the 2BR size are split into several homes (`layout.py`), so on irregular plates it can change the count |
| Smallest home | 85% of a studio (about 502 SF) | Guess |
| Non-residential floors | 1 (ground floor) | Guess |
| Podium trigger | typical floor / footprint < 0.8 | Guess |
| Deep-plate trigger | dark band > 12 ft | Guess (see change log) |
| Full-floor scan rule | scan covers at least 85% of the typical floor | Guess. Below that the scan is a suite and is not used as the plate |
| Vexcel outline rule | outline area within 15% of the typical floor | Guess. Outside that, the outline is the base of the building, an attached garage or a whole complex, not an office floor, and the square stand-in stays |
| Conversion hard cost, $/SF by daylight share | 200 / 300 / 375 | Inside the published $150–400/SF range (spec Sources, costs). Compared hard cost with hard cost: AECOM's three Houston concepts are $200–220 per gross SF (study p. 116), so our 200 matches AECOM's lowest and **our 300 and 375 are above anything AECOM estimated**. AECOM's $233–285 on the same page is the total with soft costs and contingency, not comparable to these. The split by daylight share is our guess |
| Soft costs + financing | x 1.15, on top of the hard cost | Guess |
| Developer margin | 10% of conversion cost | Guess |
| Cap / opex / free weeks (base) | 6.0% / 35% / 6 | Free weeks: Elev8 listing (6 weeks free). Cap rate and opex: guess |
| Vacancy gate | 35% | Guess. A filter, never part of the score |
| Score weights | geometry 45 / economics 30 / market 15 / context 10 | Guess, shown next to Gensler's published weights |
| Pass tolerance for home counts | ±15% | Set in spec v3 |

## Outside sources (written before running)

AECOM, *Downtown Houston Office Conversion Study*, November 2023 (link in `docs/spec.md` Sources). It tested a residential concept for each of three buildings and ranks them: 708 Main most feasible, then 1021 Main, with 1415 Louisiana less feasible (p. 11). The facts below were checked against the PDF.

- **708 Main:** convert to residential, 54 homes on a small plate (about 8,600 SF, 45 ft minimum depth) (pp. 68–69).
- **1021 Main (One City Centre):** convert to residential, 310 homes in AECOM's concept, 29 stories, on large uniform plates (about 21,000 SF, 90 ft minimum depth); the deep interior becomes amenity and tenant storage (pp. 81–83). Our ground truth for this building is the later filed program (460 apartments), not AECOM's concept.
- **1415 Louisiana:** convert to residential, 186 homes, on large irregular plates (12,000–18,000 SF, 90 ft minimum depth) that need an atrium to bring light in (pp. 73–75).

**No negative case.** We looked for a downtown building that a published study calls a poor conversion candidate. The closest is Brookings Metro with Gensler, "Adapting office use to build housing resilience in Houston" (2025), https://www.brookings.edu/articles/adapting-office-use-to-build-housing-resilience-in-houston/ (a web article, so no page number). Under "Future conversion potential" it says the wedge-shaped form of 1000 Louisiana St and 1600 Smith St hurt their conversion scores. But its Figure 14 gives only an overall score (80% across 22 developments) and a map of unlabelled dots: no score per building. The rule we set beforehand was to use a building only if the study puts it under 70%, the line below which it expects major compromises. Nothing shows that for any building in our data, so we have no negative case, rather than picking one from our own scores.

## Cases

| # | Case | Ground truth | Pass if | Expected (written before running) | Result |
|---|---|---|---|---|---|
| 1 | 1801 Smith (Elev8), **development check, not a holdout** (its unit sizes shaped our parameters). Run on the office record from before the conversion | 372 units (the published number; CoStar's own count differs slightly, see private notes); dark core became amenity | 36 ft base case within ±15% of 372 (317–427 homes) | 317–427 homes. ***Seen*** before this was written: the Sat 00:30 run put it inside this range, on a square stand-in plate of the typical floor with the assumed centered core. If a real footprint arrives later, both results get reported | |
| 2 | One City Centre (1021 Main), **planned program, not built yet**. **Not in our CoStar data: every input is "AECOM, public numbers, not CoStar"** | 460 apartments on levels 7–29 (the 93 hotel apartments are not homes, don't add them) | Within ±15% of 460 for the residential floors (391–529 homes on 23 floors), and the deep-plate flag fires | **How the plate is built:** a 90 x 233 ft rectangle (AECOM: 21,000 SF typical floor, 90 ft minimum depth, read as facade to facade), with our assumed centered core of 18%. Homes per floor at 36 ft x 23 residential floors (levels 7–29 as filed), not the building's 29 stories. Not run yet, so this case is blind. **Count:** 391–529 homes. **Deep-plate flag: likely a miss.** Our dark band is the average facade-to-core distance minus the 36 ft homes and the 6 ft corridor (`core_to_window` in `geometry.py`). With a centered 18% core on a 90 x 233 ft floor, the core sits about 26 ft from the long facades, so the facade-to-core distance is far under what the 12 ft trigger needs. We expect the flag not to fire, while AECOM treats the interior as deep. We predict that miss here and will show it | |
| 3a | 708 Main | AECOM: the most feasible of its three buildings | **Dropped:** not in our CoStar data, so it has no rents, vacancy or value and can't be scored | None | Dropped |
| 3b | 1415 Louisiana, **described, not scored** | AECOM: the least feasible of its three; large irregular plates that need an atrium | Not counted in "X of N". AECOM's verdict is a ranking against 708 Main and 1021 Main; comparing it with a building run on hand-typed AECOM numbers would mix two kinds of input | We report what our tool says next to AECOM's conclusion. ***Seen*** (Sat 00:30): not flagged as a deep plate on the square stand-in plate, and its base-case verdict was printed. Its score has not been seen | |
| 4 | Negative case | None: no outside source puts a building in our data under its own "unsuitable" line (see Outside sources) | **Dropped.** We don't pick a negative case from our own scores | None | Dropped |

Report results per building, not as an accuracy percentage, in these words: "X of 2 scored cases (case 1 is a development check, not a holdout); 1 dropped for lack of data; 1 described, not scored; no negative case found". It's a case study.

**Input sensitivity (not accuracy):** downtown ranking with CoStar only (a square of the typical floor) vs with the real plate (a scanned full floor where we have one, a Vexcel footprint if they arrive). This shows each layer changes the answer. It does not show the answer got more accurate unless we have an independent reference.

**Verifier fault tests** (in `tests/test_verifier.py`): the right number from another building fails; a home count written as dollars fails; a correctly rounded value passes. In the demo, call these injected fault tests.

## Change log

- Before freeze: deep-plate trigger changed from "dark zone > 25% of the plate" to "dark band > 12 ft". With an 18% core, the 25% rule almost never fires, even on a 200 x 200 ft floor.
- Sat 00:30, before this file was committed: first run on real data, every downtown office building in the CoStar data, `config.py` as committed in `99fd0c5` and unchanged since the first commit (params `6ba9f5da`). Footprints were stand-in squares of each building's typical floor; the core was the assumed centered one. Printed per building: homes at 36 ft, daylight share, dark band, verdict, base-case residual. **Not printed: scores or rankings.** This makes cases 1 and 3b not blind.
- Sat 01:00: One City Centre (1021 Main) and 708 Main are not in the CoStar data. Decided Sat 01:35: One City Centre is run on published dimensions only (the plate described in case 2, 23 residential floors as filed), and its result is labelled "AECOM, public numbers, not CoStar". 708 Main is dropped. 1415 Louisiana is described rather than scored, because AECOM's verdict on it is a ranking against those two.
- Sat 01:00: unit sizes left unchanged. A better source for the 2BR size turned up after the 00:30 run; adopting it now would be a post-hoc change.
- Logged in this commit, **before the code change goes in:** a building with a saved full-floor Matterport scan (at least 85% of its typical floor) now uses the scanned outline as its plate instead of the square stand-in. No value in `config.py` changes (params stay `6ba9f5da`). It changes the homes per floor of one demo building (800 Bell), which is not a validation case; before and after are in the private notes. Neither 1801 Smith nor 1415 Louisiana has a full-floor office scan, so cases 1 and 3b don't change. The scanned plate is the same outline the 3D labels use. Every result records which plate it used (`plate_source`).
- Also before the official run: the checker now counts case 2's deep-plate condition toward pass or miss (it was in the pass condition from the start; the code only checked the home count).
- Sat 01:55: no negative case. Figure 14 of the Brookings / Gensler study has no score per building, so no outside source calls a building in our data unsuitable. Case 4 is dropped. Scores and rankings had still not been printed or looked at.
- Sat 02:20, logged before the code change goes in: a building whose Vexcel outline is within 15% of its typical floor uses that outline as its plate instead of the square stand-in. That is 5 of the 18 downtown office buildings. The other 13 outlines are much bigger than the typical floor (the base of the building, an attached garage, or a whole complex counted as one building), so they keep the square. A saved full-floor scan still comes first. No value in `config.py` changes (params stay `6ba9f5da`). None of the five is a validation case: 1801 Smith and 1415 Louisiana fail the 15% rule and keep the square, so cases 1 and 3b don't change, and case 2 runs on AECOM's numbers. Scores and rankings had still not been printed or looked at.
- Sat 02:25: **freeze moved up from 10:00 am to now.** Every planned change is in (scanned plates, One City Centre on AECOM's numbers, the deep-plate check, Vexcel outlines). Parameter hash confirmed at the freeze: `6ba9f5da` (`config.py` unchanged since the first commit). The official run follows this commit. Any change after it gets a line here first, and the official result stays the one we report.
