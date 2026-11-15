# Lights On

Which empty offices in downtown Houston can become homes, and at what price?

About a quarter of downtown Houston's office space is empty (25.5% in Q3 2026, CBRE Houston Office Figures). Turning offices into apartments adds housing and avoids the carbon of tearing buildings down, but the first physical test is daylight: bedrooms need windows, and a deep floor leaves a dark middle that no layout can fix. Lights On screens downtown office buildings, measures how much of each floor is close enough to a window, sketches the apartments that could fit, and estimates what's left to pay for the building after conversion costs. It's a screening tool: it tells a lender or owner which buildings deserve a professional conversion study, not what to bid. An agent writes the memo and the owner email, and a verifier rejects any number that didn't come from our tools.

Built at HackPrinceton Fall 2026 for the Sustainability track and the CoStar "Inside and Out" challenge.

## How it works

1. **Screen**: CoStar data, filtered by vacancy.
2. **Measure**: the floor plate comes from the best source we have: a Matterport scan of a full floor, else the Vexcel outline when it matches the typical floor, else a square stand-in that the app labels as one. We split it into a units band (within 30/36/42 ft of a window), a corridor, a dark zone and the core.
3. **Draw**: we cut the units band into studios, 1BRs and corner 2BRs and count homes per floor.
4. **Price**: value as housing minus conversion cost and developer margin = an indicative residual. Three scenarios (downside / base / upside), the two inputs that move it most, and the costs we don't model.
5. **Compare**: an illustrative embodied-carbon range for converting vs building new.
6. **Write and check**: a LangChain deep agent plans the job, hands it to sub-agents (screener, analyst, writer, verifier) and drafts the memo. The verifier checks every number against the saved tool outputs.

In the app, two buildings can be put side by side (homes, daylight, where each starts to pay for itself) to decide which one deserves the study. Marks under the incentive slider show the step at which the open building lights up.

More detail: [docs/how-it-works.md](docs/how-it-works.md). Plan and scope: [docs/spec.md](docs/spec.md).

## Run it

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env            # add keys
python -m uvicorn backend.main:app --reload
python -m pytest                # tests

# The python -m forms make sure the venv's own tools run, even when another Python (Anaconda) is first on the PATH

# Frontend (second terminal)
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Without CoStar data the app runs on four synthetic sample buildings (`backend/sample_buildings.json`). They are not real properties. A fresh clone also ships one recorded agent run (Sample A, Agent tab) and the four validation cases of the official run (Validation tab), in `backend/samples/`. Real data goes in `data/buildings.json`, which is git-ignored.

```bash
# Real data. Sponsor keys go in .env; CoStar's column names go in data/field_map.json (git-ignored)
python -m scripts.check_keys --index --kit   # checks the keys, downloads Matterport's model index, lists the CoStar kit
python -m scripts.build_dataset --costar data/raw/costar.csv --footprints data/raw/footprints.geojson --comps data/raw/mf_comps.csv
python -m scripts.cache_all          # pre-compute every building for the demo
python -m scripts.run_validation     # pre-registered checks -> work/proof.json (Proof tab)
```

The agent needs `LIGHTS_ON_MODEL` in `.env` plus the matching LangChain provider package (examples in `.env.example`). Without it, the Agent tab replays the last recorded run and says so. `python -m scripts.record_traces` records one run per building.

`python -m scripts.walk_scan "<building name>" --limit 5` walks a building's saved floor scan room by room: the model in `LIGHTS_ON_MODEL` looks at one panorama per room and names the room's type from a fixed list, and the app then shows the types and counts the amenities under "Every room, labeled". It sends panorama photos to that model, so it only runs with `COSTAR_LLM_OK=yes`, and it needs a model that reads images. Each such label says it was seen by a model and not confirmed by a person. Add `--again` to look at the same rooms once more after the list of room types or the question changes. In the app a person can mark each AI room type Right or Wrong; the panel then says how many were checked and how many were right, and a room marked wrong is left out of the amenity count.

## Sponsor data rules

The CoStar, Matterport and Vexcel data is licensed for the event only. It lives in `data/` and `work/`, which git ignores, and CoStar's schema (column names) stays out of the code. After the event ends (Sun Nov 15, 4:00 pm) every copy is deleted:

```bash
rm -rf data work
```

## Project layout

```
backend/
  main.py            API (FastAPI)
  pipeline.py        runs every tool on a building, saves results to work/<id>/
  agent.py           deep agent: orchestrator + screener, analyst, writer, verifier; streams its trace
  config.py          all model parameters in one place (frozen at H8)
  data_sources.py    CoStar dump + footprints + rent comps -> data/buildings.json
  matterport.py      finds a building's Matterport scans, pulls a floor's rooms and walls
  validation.py      pre-registered checks and the input-sensitivity table
  tools/
    geometry.py      units band / corridor / dark zone, depth checks
    layout.py        cuts the band into apartments, draws the SVG
    econ.py          price band, verdict, sensitivity
    carbon.py        convert vs demolish scenarios
    verifier.py      checks numbers in a draft against saved outputs
    geo.py           lon/lat <-> feet
scripts/             check_keys, build_dataset, cache_all, run_validation, record_traces
frontend/            React + MapLibre 3D map; Building, Agent, Compare and Validation tabs; an introduction at /about
tests/               pytest
docs/                spec, data notes, pre-registered tests
```

## Built with

- [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/)
- [Shapely](https://shapely.readthedocs.io/), [pyproj](https://pyproj4.github.io/pyproj/), [NumPy](https://numpy.org/)
- [LangChain Deep Agents](https://docs.langchain.com/oss/python/deepagents)
- [React](https://react.dev/), [Vite](https://vite.dev/), [MapLibre GL JS](https://maplibre.org/), [OpenFreeMap](https://openfreemap.org/) basemap (© OpenMapTiles, © OpenStreetMap contributors)
- Data: CoStar, Matterport and Vexcel via the HackPrinceton CoStar track (licensed for the event only, not included in this repo)

Everything outside these libraries was written during the hackathon.

## Team

Team Falcons, HackPrinceton Fall 2026.
