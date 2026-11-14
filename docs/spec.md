# Lights On: which empty offices can become homes, and at what price

**HackPrinceton Fall 2026 · Nov 13–15 · Team Falcons · spec v3.2 — FROZEN (Fri Nov 13, 20:50)**

*v3.2 = teammate's v3 + review patches (§0b, marked **(v3.1)**) + carbon card moved to Must (marked **(v3.2)**). This is the last spec version. Read §0c before proposing any change.*

> One line: pick any office tower in downtown Houston. Instantly (pre-computed, with the agent's full trace) Lights On shows how many apartments fit on its real floor plate, draws them, tells you the price at which the conversion works, and refuses to show any number it can't trace to a tool.

Tags: **[Certain]** = sourced (see Sources) · **[Likely]** = strong inference · **[Guess]** = placeholder, replace with CoStar data.

---

## 0. What changed from v2.1 (read this first)

| v2.1 | v3 | Why |
|---|---|---|
| ~12 features, all "in scope" | **3 tiers: Must / Should / Won't**, with an hour budget | 4 people can't build 12 things well in 36 h. Judges remember 2 screens |
| One breakeven price | **A price band** (low / base / high) + what it's most sensitive to | 0.5 pt of cap rate moves value ≈ $25/NSF, about half the residual. One number flips when a judge drags a slider |
| Matterport in the ablation | **Matterport = tour embed + ceiling/core override where a scan exists.** Not in the ablation claim unless scans exist for test buildings | Property Intelligence is Enterprise-only; target buildings may have no scans. Don't promise a layer that may change nothing |
| Pass if 372 is inside the 30–42 ft range or within 15% of an end | **Pass if the 36 ft base case is within ±15% of 372** | The old test was almost impossible to fail |
| One City Centre counted twice (own test + AECOM trio) | **4 distinct cases**, scored once each | Honest n |
| 8-beat demo, 3 demo cuts | **4 beats, one demo**, only the first 15 s change per judge | Simpler to rehearse, easier to remember |
| Watchlist, "simulate next month", feedback loop | **Won't** | Costs ~6 h, adds little in a 2-min demo |
| — | **"How many homes fit?" judge game** (Should tier) | Makes the judge play instead of watch; the reveal is our best screen |

Everything else from v2.1 stands: stay with Lights On, Sustainability as main track, CoStar + Amazon + LangChain special tracks, H2 data checkpoint, Rule #1, Rule #2.

## 0b. v3.1 patches (team review, Fri 20:45)

| # | Patch | Why |
|---|---|---|
| 1 | **The judge's reveal comes from the pre-computed run, instantly.** The live run is offered in Q&A ("want to watch it do this one live?"), never on the demo's critical path | v3 needed a live run with a 90 s cap to finish by 1:15 (75 s), which is impossible. One wifi stall turns "does it function?" into a 3 |
| 2 | **Game scoring fixed:** clamp at 0, show the crowd median only after 10+ plays | v3's formula goes negative when a guess is off by more than 100%. A median of 3 judges is noise |
| 3 | **Should #6 swapped:** live LLM follow-up questions → **incentive / rent slider over cached results** (front end only). The city relights as more buildings pencil | Same "what if" as a follow-up question, but deterministic and can't crash. Shows the city-scale charity story |
| 4 | **The agent decides when to pull Matterport:** only for borderline buildings (daylight share within ±0.05 of a threshold), and it says why in the trace | One conditional tool call. It is exactly what CoStar's 30% "agentic depth" rewards |
| 5 | **Safety items:** no raw CoStar/Vexcel/Matterport data or caches in the public repo (`.gitignore` `data/`, `work/`) · ask CoStar what can be shown in the video · ask batch quotas at the workshop · backup video by Sat midnight · **one narrator**, everyone takes Q&A · pitch to a stranger Sat evening | Proprietary data + public-repo rule; a repeated ritual for 5–6 judges; uncalibrated self-scores |
| 6 | **H16–22 load:** the game is front end over cached results (C), with A spending ~1 h on its endpoint | v3 put the game, branches, memo/email and approval all on A in the same block |
| 7 | **Low case renamed "worst case"** | It stacks 5 pessimistic assumptions at once, so "pencils at today's basis" will almost never fire. That's fine, but name it honestly |
| 8 | **(v3.2) Scenario / carbon card moved from Should to Must** (~30 min) | Our main track is Sustainability. Without a CO₂ number, the Sustainability judges have nothing to score on charity |

## 0c. Freeze rule (read before proposing any change)

**This spec is frozen. No more "judge the idea" rounds and no new spec versions.** Doc revisions now buy ~1 point at most and cost the team 30+ minutes each. The realistic ceiling is ~34–35/40 **[Guess]**. What's left to win is execution, not ideas.

The spec changes **only at three checkpoints, and only on new information**:

| Checkpoint | What can change it |
|---|---|
| **H2** (~10:30 pm Fri) | Workshop answers + data spike → GO / LITE / NO-GO (§9) |
| **H8** (~4:30 am Sat, **moved to 10:00 am Sat**: the CoStar data only arrived Fri 10 pm; **frozen early, Sat 02:25 am**) | Parameters frozen in `docs/preregistration.md` (a separate doc, not a spec version) |
| **H16** (~12:30 pm Sat) | Are all Must items working? If not, cut from Should, never from Must |

Anything else goes into a GitHub issue, not this file.

**Instead of guessing scores, measure three things:**
1. **Does the demo run end to end without a stall?** Rehearse it 3× from the cache.
2. **Does the 1801 Smith test pass?** The 36 ft base case must be 316–428 units.
3. **Can a stranger repeat our one sentence after the pitch?** Test it Saturday evening on another team or a mentor.

---

## 1. Tracks and hard times

| | |
|---|---|
| **Main track** | Best Sustainability Hack (only one allowed) |
| **Special tracks (stack)** | CoStar "Inside and Out" · Amazon Best Practical AI · LangChain deepagents |
| **Skip** | Capital One (Nessie, no fit), Peri, Arlequin, Physical AI, Photon (unless everything is done by H28), MLH prizes except Gemini if Gemini is our LLM |
| **Times** | Hacking 8:30 pm Fri · CoStar workshop 8:45 pm (whole team) · deepagents workshop 9:45 pm (A) · **our submit deadline 7:30 am Sun** · judging 9:30 am–2:30 pm, 2-min live demos |
| **Rule #1** | Every number comes from a deterministic tool, never from the LLM. The verifier rejects any number it can't trace to `/work/*.json` |
| **Rule #2** | New public repo created after 8:30 pm. No old code |

---

## 2. Scope: Must / Should / Won't

**Must** (the demo doesn't exist without it; done by H16):
1. Downtown map + vacancy gate (slider, filters, doesn't score)
2. `geometry()`: core-to-window depth, units band / corridor / dark zone at 30 / 36 / 42 ft, homes per depth
3. Floor plate SVG with apartments drawn (layout generator, **3 h timebox**, fallback = façade length ÷ average unit width)
4. `econ()`: value as housing, cost, **breakeven price band**
5. Orchestrator + screener + analyst + writer + **verifier with one visible rejection** · **(v3.1)** analyst pulls Matterport only for borderline buildings and says why
6. Cached results for all downtown buildings (**the demo reads from these**) + a live run (90 s cap) shown in Q&A only **(v3.1)**
7. Proof tab: 4 pre-registered cases + CoStar-only vs +Vexcel ablation
8. **(v3.2)** Scenario card: leave empty / convert / demolish, homes + carbon ranges (§6.5)

**Should** (H16–28, in this order):
1. "How many homes fit?" judge game (§8)
2. Podium branch (typical floor ÷ footprint < 0.8) and deep-plate branch (light well vs mixed program)
3. Memo + owner email draft, with human approval
4. Eligibility checklist (§6.4)
5. **(v3.1)** Incentive / rent slider over cached results: the city relights as buildings pencil (front end only; replaces live LLM follow-up questions)

**Won't** (final, don't reopen): watchlist, "simulate next month", preference-learning loop, portfolio upload, PDF export, LA mode, vision context score, Photon channel (unless H28 with everything green), more than one demo script.

---

## 3. The problem (only sourced lines go on slides)

- **"A quarter of Houston's office space is empty."** 25.6% vacancy, Q3 2026 (Newmark via CRE Daily). Vacancy is a share of space, not buildings.
- **6.7M SF of Houston office is slated for conversion**, 3rd most in the US (CBRE via Bisnow).
- **Geometry is the binding constraint.** Mid-century floors run 60–70 ft from window to core; apartments lose light past ~30–35 ft. Gensler finds about 30% of the buildings it analyzes make sense for conversion **[Certain]**.
- **Real downtown proof:**
  - **1801 Smith / Elev8:** 372 units. Chosen for narrow, rectangular floor plates; the dark interior became storage, coworking and amenities **[Certain]**. That is our daylight-band model.
  - **One City Centre (1021 Main):** 460 apartments on levels 7–29 + 93 hotel apartments on levels 2–6 **[Certain]**. That is our mixed-program branch.
- **Why now in Houston:** distressed pricing. 1021 Main's assessed value fell from $115M to $52M since 2014 (AECOM) and it was bought from the special servicer **[Certain]**. An Office Conversion Program is being shaped by Downtown Houston+ **[Certain]**. SB 840 / SB 2477 help Texas conversions but do little in Houston, which has no zoning: use them as the scale-out line only.
- **The gap:** Gensler's Conversions+ scores buildings in "a matter of days" each, as a paid service **[Certain]**. We screen a whole downtown in minutes from data a CoStar subscriber already has. **We pick which buildings deserve the Gensler study.**

---

## 4. Users

Demo persona: **a credit analyst at a lender** holding downtown office loans. Question: "Which of these buildings has a housing exit, and at what basis?"

Other users (same screens): owner of a mostly vacant Class B tower, the Downtown Redevelopment Authority, developers and brokers.

---

## 5. Data

| Layer | Use | If missing |
|---|---|---|
| **CoStar** | Gate (vacancy), RBA, typical floor SF, stories, rents, owner, sale/assessed value, downtown multifamily comps | No build without it |
| **Vexcel** | Footprint polygon → core-to-window depth, daylight share; roof height ÷ stories → floor-to-floor flag; aerial image under the floor plate | Lite mode (§9) |
| **Matterport** | Tour embed; where Property Intelligence returns rooms/ceilings, override core location and ceiling height | Centered core at 18% of plate **[Guess]**, slider |

The CoStar track requires **at least 2 of the 3 layers**. A CoStar-only build is not eligible. Never ship it.

---

## 6. The model (plain Python, unit-tested, every number links to its formula)

### 6.1 Geometry
```
plate  = Vexcel footprint, checked against CoStar typical floor SF
ratio  = typical_floor_sf / plate.area          # < 0.8 → podium branch
core   = Matterport core if present, else centered core (18% of plate) [Guess]
for D in (30, 36, 42):                          # unit depth, façade → corridor wall
    units_band = plate − plate.buffer(−D)
    corridor   = plate.buffer(−D) − plate.buffer(−(D+6))
    dark_zone  = plate.buffer(−(D+6)) − core    # storage / coworking / amenity, like Elev8
    homes[D]   = layout_units(units_band, D) × residential_floors
```
- `daylight_share` at 36 ft feeds the score; all three depths are shown.
- `dark_zone > 25%` of the plate → deep-plate branch.
- Floor-to-floor = roof height ÷ stories: under 11 ft red, 11–12 ft amber. A flag, not a score.

Unit sizes: studio 590 SF (Elev8's smallest is 589 **[Certain]**), 1BR 735 SF (Elev8's is 733 **[Certain]**), 2BR 1,100 SF at corners. Width = area ÷ D. Net-to-gross shown against a 72–82% band.

### 6.2 Economics: a band, not a point
```
effective     = rent_psf × (1 − free_weeks/52)
NOI           = effective × 12 × NSF × (1 − opex_vacancy)
value         = NOI / cap_rate
cost          = conversion_psf × GFA × 1.15          # soft + financing
breakeven_acq = value − cost
```
Run three cases and show all of them:

| Input | Worst (v3.1) | Base | High |
|---|---|---|---|
| Rent | CoStar comp −10% | CoStar comp | +10% |
| Concession | 8 weeks | 6 weeks | none |
| Cap rate | 6.5% | 6.0% | 5.5% |
| Opex + vacancy | 40% | 35% | 30% |
| Conversion cost | high end of cited range | mid | low end |

**Verdict rule:**
- "Pencils at today's basis" only if the **worst** case beats the CoStar sale/assessed value.
- "Pencils at a distressed basis" if only the base case does.
- Otherwise: "Needs $X/SF of basis or incentives", using the base case.

Show the top 2 sensitivities as a tiny tornado ("cap rate ±0.5 pt moves breakeven by $__/SF"). This turns the weakest point (assumptions) into a credibility point.

Sanity check from Elev8 listings (1BR from $2,003/mo, 6 weeks free **[Certain]**): $2.42/SF effective, 35% opex, 6% cap → ≈ $314 per net SF of value. At 5.5% ≈ $343, at 6.5% ≈ $290.

### 6.3 Score (0–100, after the gate)
Geometry 45 · Economics 30 · Market 15 · Context 10. Our weights **[Guess]**, frozen at H8 and shown next to Gensler's published ones (form 30 / plate 30 / servicing 20 / envelope 10 / context 10 **[Certain]**). Each component gets one "why" sentence written from the computed values.

### 6.4 Eligibility (Should tier)
DRA reimbursement (active) · Office Conversion Program (in development, "would likely qualify if enacted") · historic credits 20% federal + 25% Texas for listed/eligible income-producing buildings, with a façade-change warning **[Certain]** · SB 840/2477 (limited effect in Houston). The memo says "may be eligible, verify with the program", never an amount.

### 6.5 Carbon (Must tier, v3.2)
Convert vs demolish & rebuild: reuse avoids 50–75% of new-build embodied carbon; EC_new = 450 kgCO2e/m² (literature 366–615). Always a range.

---

## 7. Agent (LangChain deepagents)

```
goal ─▶ Orchestrator: plan (todos streamed to UI) · delegate · branch · re-plan
          ├─ Screener  : CoStar tools, vacancy gate, shortlist
          ├─ Analyst   : geometry + econ tools; branch → podium | deep plate | mixed program
          ├─ Writer    : memo, owner email
          └─ Verifier  : every number in a draft must match /work/<bldg>/*.json → reject + reason → writer revises → human approves
```

**Tools:** `get_candidates` · `get_footprint` · `floor_check` · `geometry` · `layout_units` · `econ` · `eligibility` · `render_memo` · `draft_email` · `verify`.

**Verifier rules (so it doesn't reject everything):**
- Extract every number with its unit from the draft.
- A number passes if a value in `/work/` rounds to it at the precision shown (e.g. 2.4167 → "$2.42").
- Ranges pass if both ends pass. Years, floor counts and IDs are whitelisted.
- Every rejection is logged with the number, the reason and the fix. The demo shows one real one.

**Missing data:** the agent states the assumption it used and asks before writing.

**Demo safety (v3.1):** everything downtown pre-computed and cached, **and the demo reads from the cache**. The live run (hard cap 90 s) is shown in Q&A only.

---

## 8. The judge game: "How many homes fit?" (Should tier, C + A, ~4 h)

1. The judge sees the building: Vexcel aerial, stories, typical floor SF.
2. They type a guess: how many apartments fit?
3. **(v3.1)** **Reveal, instantly from the pre-computed run:** apartments drawn on the floor plate, the count at 36 ft, the guess vs the answer, and the agent's trace for that building.
4. Booth leaderboard. Scoring borrows Krillion's idea: **being right where most people were wrong is worth more.**
   **(v3.1)** `rel_err = |guess − N| / N` · `points = round(100 × max(0, 1 − rel_err) × (1 + min(crowd_median_err, 1)))`. The crowd term only switches on after 10+ plays: let hackers play on Saturday to seed it. Nailing a building everyone misjudged still scores highest, and points can't go negative.

Why it matters: Amazon asks "would you open it a second time"; this gives a reason. It turns our best screen (the drawn floor plate) into a reveal, and a judge who guesses remembers the project.

---

## 9. Build plan

Roles: **A** agent/backend · **B** data + geometry · **C** frontend · **D** pitch, validation, fact check.

| Hours | A | B | C | D |
|---|---|---|---|---|
| H0–2 | Repo, FastAPI + deepagents hello-world | **Data spike** on 1801 Smith, 1021 Main, 1415 Louisiana (§10) | Vite + MapLibre map | CoStar workshop notes · write pre-registration draft |
| **H2** | **GO / LITE / NO-GO** (below) | | | |
| H2–8 | CoStar tools, orchestrator, screener, gate | `geometry()` + `floor_check` on all buildings | Building page, static SVG | Pick the negative case from CoStar data |
| **H8** | **Walking skeleton end to end · parameters frozen in `docs/preregistration.md`** | | | |
| H8–16 | Analyst, writer, **verifier** | `econ()` band + tornado · layout generator (3 h cap) · ablation · **(v3.2)** carbon/scenario numbers | Map by score, live plan/trace panel | Run the 4 tests once, record results |
| **H16** | **All Must items working** | | | |
| H16–22 | Branches, memo/email, approval, **(v3.1)** game endpoint ~1 h | Eligibility, edge cases | **Judge game** (front end over cache), economics card, **(v3.1)** incentive slider | Demo script, first rehearsal |
| H22–24 | Sleep in shifts | | | |
| H24–28 | Cache downtown, timeouts, follow-ups | Headline number, final numbers sheet | Proof tab, polish | Devpost draft, video script |
| **H28** | **Feature freeze** (moved up 2 h from v2.1) | | | |
| H28–35 | Deploy, smoke tests | Fix only | Demo mode | **Fact check every slide number**, video, rehearse ×3, **submit 7:30 am** |

**H2 decision:**

| Finding | Decision |
|---|---|
| Footprints + heights + a join key work | Full plan |
| No usable footprints or no join key | **Lite:** plate from CoStar typical floor SF; second layer = Vexcel aerial + roof attributes, or Matterport where a scan exists. Keep economics, verifier, game, validation |
| No downtown multifamily rents | Cited listings + sliders, labeled |
| No CoStar access by H3 | Team call: Lite on public data, or drop the CoStar track |

---

## 10. Data spike checklist (H0–2)

For 1801 Smith, 1021 Main, 1415 Louisiana:
1. CoStar: class, year, stories, **RBA, typical floor SF**, vacancy, rent, owner, sale/assessed value, multifamily comps + concessions?
2. Vexcel: footprint polygon + roof height by lat/lon or ID?
3. Matterport: which have scans? Does Property Intelligence return anything?
4. Join key across the three layers
5. Quotas and MCP URLs
6. **(v3.1) Ask at the CoStar workshop (8:45 pm, Friend 101):**
   - Are Vexcel footprints available, and what links them to CoStar buildings?
   - What are the request limits for batch-running all of downtown?
   - What CoStar data can appear in a public repo, the video and Devpost?

Write answers to `docs/data-notes.md`.

---

## 11. Validation (pre-registered, run once)

Parameters frozen at H8. Expected results written down before any test runs. Misses are shown, not tuned.

| # | Case | Ground truth | Pass if |
|---|---|---|---|
| 1 | 1801 Smith | 372 units, dark core → amenity **[Certain]** | **36 ft base case within ±15% of 372** (316–428) and the agent picks "units + amenity core" |
| 2 | One City Centre (1021 Main) | Ranked #1 by Downtown Houston+; 460 apts + 93 hotel apts **[Certain]** | Ranks top 3 of downtown, and the deep-plate branch picks a mixed program |
| 3 | 708 Main + 1415 Louisiana | AECOM deep-dive verdicts **[Certain]** | Our verdict matches AECOM's direction on each; disagreements explained |
| 4 | Negative case | Deep plate, low vacancy, picked from CoStar at H2–8 | Gated out or scored in the bottom third, reason shown |

**Ablation:** downtown ranking with CoStar only vs + Vexcel. Report how cases 1 and 2 move in rank and home count. Add + Matterport only if scans exist for test buildings. If a layer changes nothing, say so.

Slide headline: **"We wrote the answers down before we ran the tests. X of 4 passed."** Report the real X.

---

## 12. Demo (2 minutes, 4 beats)

| Time | Screen | Say |
|---|---|---|
| 0:00 | Map. Judge clicks a tower and guesses how many homes fit **(v3.1: no live run on the critical path)** | "A quarter of Houston's office space is empty. Pick any tower downtown and guess how many apartments fit in it." |
| 0:15 | Cached top building: floor plate, apartments drawn, depth switch | "The test is light. Apartments can be 30 to 42 feet deep; the dark core becomes storage and amenities. That's exactly what Elev8 did at 1801 Smith." |
| 0:45 | Economics band + verifier rejection in the trace | "As housing it's worth $V. It works if you buy under $B to $B'. It's assessed at $A. Every number comes from a tool; here the verifier caught one the writer couldn't source and sent it back." |
| 1:15 | Judge's building: **instant** reveal vs their guess (v3.1) | "Your building: N homes. You guessed G. Here's why." |
| 1:40 | Proof tab | "We wrote the answers down before running the tests on real Houston conversions. X of 4 passed, and each CoStar layer changes the ranking." |
| 1:55 | Logo | "Lights On: which empty offices can become homes, and at what price." |

**(v3.1) One narrator for the 2 minutes; everyone takes questions.** Offer the live run in Q&A: "Want to watch the agent do yours live?"

**Only the first 15 seconds change by judge:**
- Sustainability: homes + carbon.
- CoStar: "three data layers on one building."
- Amazon / LangChain: "watch the agent plan, branch and get caught by its own verifier."

**Prepared answers:**
- **"Gensler already does this."** "Gensler's Conversions+ is the benchmark: 1,300+ buildings, days per building, done by architects. We're the step before: a whole downtown in minutes from CoStar data, ending in a memo and outreach. We tell you which buildings deserve a Gensler study."
- **"Does this pencil?"** "Mostly no, and the tool says so. That's why it shows the price at which it does."
- **"Your price depends on assumptions."** "Yes. That's why it's a band, and the tornado shows which assumption matters most."
- **"Plumbing, structure, egress?"** "Flagged as risks. Next step: columns and stacks from Matterport point clouds."
- **"SB 840?"** "It helps across Texas. In Houston, with no zoning, the bigger driver is distressed pricing."
- **(v3.1) "Traceable isn't the same as correct."** "Right. So every coefficient (CO₂ factor, rents, cap rate) has a source line, and the price is a band."
- **(v3.1) "Didn't the LLM already know 1801 Smith's answer?"** "The LLM never computes or sees the unit count. Geometry tools do, from the footprint; the ground truth was written down before we ran.

---

## 13. Devpost

- **Name:** Lights On · **Tagline:** Which empty offices can become homes, and at what price.
- **Tracks:** Best Sustainability Hack · CoStar · Amazon · LangChain.
- **What it does:** screens downtown Houston on CoStar + Vexcel (+ Matterport), measures core-to-window depth, draws apartments on the real floor plate, prices the building as housing as a band, branches on podiums and deep plates, verifies every number, drafts the memo and owner email. Judges can guess first.
- **Accomplishments:** pre-registered tests on real Houston conversions; an ablation; a verifier that rejects untraceable numbers.
- **Next:** point clouds for columns and plumbing, portfolio mode for lenders, other Texas cities under SB 840.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| No footprints / no join key | Lite mode at H2 |
| Live run slow or flaky | 90 s cap + cached fallback |
| Economics flip on a slider | Band + verdict rule + tornado |
| Fails One City Centre | Show it and explain it; fix branch logic only after the test, and say so |
| Wrong fact on a slide | D fact-checks every number against Sources at H28 |
| Scope creep | Won't list is final |
| Verifier rejects everything | Rounding + whitelist rules (§7) |
| **(v3.1)** Proprietary data in the public repo | `.gitignore` `data/` and `work/`; ask CoStar what can appear in the video and Devpost |
| **(v3.1)** Batch run hits API quotas | Ask quotas at the workshop; run the downtown batch early Saturday night, not at 4 am |
| **(v3.1)** Live run stalls on stage | Not on the critical path; reveal comes from the cache |

---

## Sources

- 1801 Smith ~458,000 SF with parking: https://skyscraperpage.com/forum/showthread.php?p=10148049 · narrow plates, dark interior → storage/coworking/amenity: https://www.pressreader.com/usa/houston-chronicle-sunday/20240225/281638195142764 · 372 units: https://www.har.com/elev8/apartment_3710C
- Elev8 unit sizes, rents, concessions: https://www.apartments.com/elev8-downtown-houston-tx/6r6g7lt
- DRA programs, DLI completed, Office Conversion Program in development: https://centralhouston.org/downtown-redevelopment-authority/programs · https://preview-prod.w.houstonchronicle.com/news/houston-texas/article/downtown-houston-population-growth-20345899.php
- Gensler Conversions+: https://www.gensler.com/building-conversions · https://gensler.com/office-to-residential-services · https://therealdeal.com/magazine/september-2024/how-genslers-algorithm-got-the-firm-to-compete-in-office-to-resi-niche · Gensler/SPUR: https://spur.org/sites/default/files/2023-10/Gensler_Building%20Suitability_Analysis_Sept_2023.pdf
- One City Centre: https://therealdeal.com/texas/houston/2025/08/15/3l-real-estate-plans-office-to-residential-for-houston-tower · permit: https://www.tdlr.texas.gov/TABS/Search/Print/TABS2025025699 · ranked #1: https://www.connectcre.com/stories/3l-provides-update-on-conversion-of-houston-highrise/ · loan, 919 Milam: https://www.multihousingnews.com/?p=1005107924
- AECOM study: https://centercityphila.org/uploads/attachments/cm5vpxmcw24izdtqdzc8e3hkk-bid-class-downtown-houston-office-conversion-study-optimized-11302023.pdf
- SB 840 / SB 2477: https://www.foley.com/?p=116251 · https://www.billtrack50.com/billdetail/1791026
- Historic credits: https://thc.texas.gov/preserve/grants-tax-credits-and-funding/historic-preservation-tax-credits · https://www.thc.texas.gov/sites/default/files/2023-12/THPTC_tax_credits_comparison.pdf
- Houston vacancy: https://www.credaily.com/?p=224274 · https://www.credaily.com/?p=219743 · pipeline: https://www.bisnow.com/news/houston/office/more-than-3-of-houstons-office-market-is-slated-for-conversion-130201
- Plate depth: https://commercialobserver.com/2026/06/analysis-when-converting-new-york-office-building/ · costs: https://apers.app/learn/deal-structures/conversions/office-to-residential-conversion-economics · floor-to-floor: https://trerc.tamu.edu/wp-content/uploads/2023/06/2374.pdf
- Embodied carbon: https://kleinmanenergy.upenn.edu/commentary/blog/designing-for-degrowth-energy-policy-and-the-architecture-of-enough/ · https://www.bdp.com/ca/ideas/making-embodied-carbon-part-of-the-decision-making-process-in-building-design
- Vexcel: https://vexceldata.com/products/elements/building-attributes/ · Matterport PI: https://matterport.github.io/developer-docs/api/property-intelligence/
- deepagents: https://docs.langchain.com/oss/python/deepagents · Krillion (game mechanic reference): https://krillion.io/
- HackPrinceton, sponsor page and Discord: carried from v2.1
