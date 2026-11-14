# Lights On

Which empty offices in downtown Houston can become homes, and at what price?

A quarter of Houston's office space is empty. Turning offices into apartments adds housing and avoids the carbon of tearing buildings down, but most towers can't convert: their floors are too deep, and bedrooms need windows. Lights On screens downtown office buildings, measures how much of each floor is close enough to a window, sketches the apartments that could fit, and estimates what's left to pay for the building after conversion costs. It's a screening tool: it tells a lender or owner which buildings deserve a professional conversion study, not what to bid. An agent writes the memo and the owner email, and a verifier rejects any number that didn't come from our tools.

Built at HackPrinceton Fall 2026 for the Sustainability track and the CoStar "Inside and Out" challenge.

## How it works

1. **Screen**: CoStar data, filtered by vacancy.
2. **Measure**: the Vexcel footprint gives the floor plate. We split it into a units band (within 30/36/42 ft of a window), a corridor, a dark zone and the core.
3. **Draw**: we cut the units band into studios, 1BRs and corner 2BRs and count homes per floor.
4. **Price**: value as housing minus conversion cost and developer margin = an indicative residual. Three scenarios (downside / base / upside), the two inputs that move it most, and the costs we don't model.
5. **Compare**: an illustrative embodied-carbon range for converting vs building new.
6. **Write and check**: a LangChain deep agent plans the job, hands it to sub-agents (screener, analyst, writer, verifier) and drafts the memo. The verifier checks every number against the saved tool outputs.

More detail: [docs/how-it-works.md](docs/how-it-works.md). Plan and scope: [docs/spec.md](docs/spec.md).

## Run it

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add keys
uvicorn backend.main:app --reload
pytest                          # tests

# Frontend (second terminal)
cd frontend && npm install && npm run dev    # http://localhost:5173
```

Without CoStar data the app runs on four synthetic sample buildings (`backend/sample_buildings.json`). They are not real properties. Real data goes in `data/buildings.json`, which is git-ignored.

```bash
# Real data. Sponsor keys go in .env; CoStar's column names go in data/field_map.json (git-ignored)
python -m scripts.check_keys --index --kit   # checks the keys, downloads Matterport's model index, lists the CoStar kit
python -m scripts.build_dataset --costar data/raw/costar.csv --footprints data/raw/footprints.geojson --comps data/raw/mf_comps.csv
python -m scripts.cache_all          # pre-compute every building for the demo
python -m scripts.run_validation     # pre-registered checks -> work/proof.json (Proof tab)
```

The agent needs `LIGHTS_ON_MODEL` in `.env` plus the matching LangChain provider package (examples in `.env.example`). Without it, the Agent tab replays the last recorded run and says so. `python -m scripts.record_traces` records one run per building.

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
frontend/            React + MapLibre 3D map; Building, Agent and Proof tabs
tests/               pytest
docs/                spec, data notes, pre-registered tests
```

## Built with

- [FastAPI](https://fastapi.tiangolo.com/), [Pydantic](https://docs.pydantic.dev/)
- [Shapely](https://shapely.readthedocs.io/), [pyproj](https://pyproj4.github.io/pyproj/), [NumPy](https://numpy.org/)
- [LangChain Deep Agents](https://docs.langchain.com/oss/python/deepagents)
- [React](https://react.dev/), [Vite](https://vite.dev/), [MapLibre GL JS](https://maplibre.org/) with a local map style and building labels
- Data: CoStar, Matterport and Vexcel via the HackPrinceton CoStar track (licensed for the event only, not included in this repo)

Everything outside these libraries was written during the hackathon.

## Team

Team Falcons, HackPrinceton Fall 2026.
