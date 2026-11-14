# How the code works

Read this before judging. Each of us should be able to explain any part.

## The data flow

```
CoStar building (footprint, stories, vacancy, rent, assessed value)
   -> pipeline.analyze()
        geometry.analyze_plate()   floor plate -> units / corridor / dark zone at 30, 36, 42 ft
        layout.layout_units()      units band -> apartments, homes per floor
        econ.econ()                homes' net SF + rent -> value, cost, breakeven price
        carbon.scenarios()         gross SF -> carbon for convert vs demolish
        score()                    0-100
   -> work/<id>/*.json + plate.svg
   -> API (main.py) -> map + building panel
   -> agent (agent.py) reads the same files; verifier checks its drafts against them
```

## geometry.py

- Coordinates are converted to feet (Texas South Central projection) so every distance is in feet.
- **Units band**: everything within D feet of a window: `plate - plate.buffer(-D)`. A negative buffer shrinks the shape inward by D, so the difference is a ring along the facade.
- **Corridor**: a 6 ft ring right behind the units.
- **Core**: from the Matterport scan when the scan shows one (see `matterport_plan.py`). Otherwise we assume a centered core covering 18% of the floor (a guess, adjustable in `config.py`).
- **Dark zone**: whatever is left between the corridor and the core. In a real conversion it becomes storage, gym or coworking. 1801 Smith (Elev8) did exactly this.
- **Narrow floors**: if the floor is narrower than two unit depths plus a corridor, the depth is capped at half the width minus half a corridor (units on both sides of a central corridor). Uses the largest circle that fits in the floor.
- **Deep floor**: if the average window-to-core distance leaves more than 12 ft of dark band behind the corridor, the agent considers a light well or a mixed program (hotel or amenity floors, like One City Centre).

## matterport_plan.py

- A saved scan is a wall graph: points and wall edges, in metres, in the scan's own frame (not north-aligned).
- **Plate**: the outer outline of all the walls, converted to feet.
- **Core**: the parts of the plate that no scanned room covers (elevators and stairs usually aren't scanned), plus rooms labelled void, elevator, stair or restroom. Each room's polygon is built from its own wall edges.
- Columns are tiny voids too. Pieces under 100 sf are dropped, and what's left only counts as a core if it adds up to 5-40% of the floor. Otherwise there is no scan core and we keep the assumed one.
- The plate and the core always come from the same scan, because the scan can't be lined up with a map footprint.
- The plate is `matterport.floor_outline()`, the same outline the 3D labels use, so the labels and the analysis can't disagree. A test checks it.
- `pipeline.scan_plate()` uses the scan as the building's plate only if it's a full floor: at least 85% of the typical floor (the same rule as the 3D labels). A smaller scan is a suite and the footprint stays. The result says which plate was used (`plate_source`, `footprint_source`).

## vexcel.py

- One call per building to Vexcel's property endpoint, at the building's lat/lon. The answer is saved to `data/vexcel/`, so rebuilding the data never calls Vexcel twice.
- Vexcel returns the parcel and the buildings on it. We take the one marked primary and read its outline (`footprint.wkt`, lon/lat) and its area (`footprint.area`, sq ft).
- The outline is the building at ground level. A tower with a podium, an attached garage or a shared wall looks much bigger from the air than one office floor. So the outline becomes the plate only if its area is within 15% of CoStar's typical floor. Otherwise the square stand-in stays and the result says so (`footprint_source`).
- Order of preference for the plate: a saved full-floor scan, then a matching Vexcel outline, then the square stand-in.

## layout.py

- Walk around the facade. Keep a D x D square at each corner (a 2BR).
- Between corners, cut the band perpendicular to the facade. Each unit's width = its area / the depth available at that spot, alternating 1BR (735 SF) and studio (590 SF). Elev8's smallest studio is 589 SF.
- All cut lines are applied at once with `polygonize`, then each piece is typed by area. Pieces too small to be a home become storage.
- If the cutter fails, fall back to: facade length / average unit width.

## econ.py

- Effective rent = asking rent x (1 - free weeks / 52). Downtown buildings give 6-8 weeks free.
- Value = effective rent x 12 x net SF x (1 - opex) / cap rate.
- Cost = conversion $/SF x gross SF x 1.15 (soft costs and financing).
- Developer margin = 10% of conversion cost (a guess, in `config.py`).
- **Indicative residual = value - cost - developer margin.** Roughly what's left to pay for the building. A screening number, not an offer price or appraisal. Lease-up, transaction costs, carry and tenant buyouts are not included, and the UI says so.
- Three scenarios: downside (every pessimistic input at once, a stress case), base, upside.
- The verdict compares the residual with a reference value (the assessed value, which is not a purchase price): covers it in every scenario / base case only / a gap of $X per SF / negative even if the building were free.
- Tornado: move one input at a time and keep the two that swing the price most.
- Sanity check (tested): Elev8's $2,003 / 733 SF 1BR with 6 weeks free and a 6% cap is about $314 per net SF.

## carbon.py

Converting reuses the structure, so it avoids 50-75% of the embodied carbon of a new building (450 kg CO2e per m², literature range 366-615). Always shown as a range.

## verifier.py

- Finds every number in a draft with a regex.
- It only looks at values saved for **this** building, so the right number from another building fails.
- It checks the kind of number: "$" numbers can only match money fields, "%" only shares, "... homes" only home counts, "... SF" only areas, "... t" only carbon.
- Rounding the way it's shown is fine: "$2.42" matches 2.4167, "6,000" matches 5,987, "25.6%" matches 0.256, "$52M" matches 52,000,000.
- Only years and IDs are skipped. Floor counts are checked like any other number.
- A failure comes back with the nearest real value of the right kind as a suggested fix.
- Limit: it checks that a number exists, not that the sentence around it is true. The UI fills numbers straight from the saved results; only the memo prose goes through the verifier.

## agent.py

- Built with LangChain Deep Agents: a planning todo list, a file system and sub-agents.
- The orchestrator plans, then hands work to four sub-agents: screener, analyst, writer, verifier.
- `/work/` in the agent's file system points to the real `work/` folder, so the writer reads the actual tool outputs.
- Tools return the same shape every time: `status`, `summary`, `values`, `source`, `next_actions`. `next_actions` is how the analyst gets told to check Matterport, or to try the deep-plate or podium branch.
- `check_matterport` finds a building's scans in Matterport's public `models_index.csv` (same CoStar property ID, or within 75 m), pulls the first full office floor if it isn't saved yet, and saves a summary to `work/<id>/matterport.json`, so the verifier can check those numbers too. It never claims scans for the synthetic sample buildings. Code: `backend/matterport.py`.

## data_sources.py

- `FIELD_MAP` maps our field names to CoStar's column names. Fill it in once we see the dump.
- `to_number` cleans "$1,234", "62%" and empty cells. Vacancy above 1 is treated as a percent.
- Footprints come from a GeoJSON keyed by the CoStar id. Buildings without a footprint or story count are skipped and listed, not guessed.
- Rent = the median monthly rent per SF of at least 3 multifamily comps within 0.75 miles. Fewer than 3: no rent, and the economics section says so.

## validation.py

- The cases and their ground truth are written in the file before running.
- Buildings are matched by address. Missing ones show "no data" instead of a guess.
- Every run is appended to `work/proof_history.jsonl`, so the first result is never lost, along with a short hash of the parameters that produced it.
- A building that isn't in our data can be checked on published dimensions (a `public_plate` on the case). Its row carries the case's label ("AECOM, public numbers, not CoStar") with the source, and it is never saved to `work/`.
- A case can also expect the deep-plate flag (`expect_deep_plate`). If the flag is wrong the case is a miss, and the row lists what missed.
- Input sensitivity: each building is run again with a square floor of CoStar's typical floor area, to show how much the real plate (a scanned floor, or the footprint) changes the answer. That's sensitivity, not accuracy.

## Agent trace (agent.py + AgentPanel.jsx)

- `/api/agent/stream` streams server-sent events: plan, hand-off to a sub-agent, tool call, tool result, message.
- A finished live run is saved to `work/<id>/trace.json` with its time and model.
- With no model configured, a failure or a run over 90 seconds, the panel replays the saved run and labels it "Recorded run from <time>". A replay is never shown as live.
