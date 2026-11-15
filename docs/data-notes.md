# Data notes

Public notes only. Anything that names CoStar columns, record IDs or values stays out of this repo
(CoStar event terms, section 3.2) and lives in the team's private notes.

## What the three layers are (from the public Matterport quickstart page)

| Layer | What we get | How |
|---|---|---|
| CoStar | a 160 MB "kit": property and listing records as CSVs | download link + zip password from `/costar-keys` |
| Matterport | scanned spaces in Houston and Los Angeles: rooms with areas, the wall graph per floor (2D points in metres), floor-plan images | GraphQL at `api.matterport.com/api/models/graph`, key as user name and token as password |
| Vexcel | aerial orthophotos (7.5 cm/px) clipped to a polygon; parcels and roof attributes in Vexcel's own quickstart | `POST api.vexcelgroup.com/v2/ortho/extract`, key in the `X-API-KEY` header; Houston and LA only |

- The Model API has no geographic search. The quickstart ships `models_index.csv` (one row per model, with lat/lon, address and the CoStar property ID where known), which is how the layers join.
- Join keys: a Matterport model carries a CoStar property ID for some commercial spaces; Vexcel joins by lat/lon.
- `python -m scripts.check_keys` tests each key and saves raw pulls to `data/`.

## Data check (Fri Nov 13, 10 pm)

| Question | Answer |
|---|---|
| Do scans of downtown office floors exist? | **Yes.** Several full office floors in at least three downtown towers, plus scans of apartments in an already-converted tower (useful for validation). |
| Do our validation buildings have scans? | Elev8 (1801 Smith): yes, converted units. 1415 Louisiana: a few rooms, no full floor. One City Centre (1021 Main) and 708 Main: no. |
| Can Matterport replace the assumed core? | **Not on the first full floor we pulled.** The walls close into a clean outline that matches the typical floor, so the scan gives the real **plate**. The core isn't in it: the floor is one open room and its voids are column-sized. We keep the assumed centered core (18%) unless another scan shows core walls (`backend/tools/matterport_plan.py` decides). **On the second one it does** (pulled Sun 04:30, a floor divided into rooms): the part no scanned room covers is 13% of the floor, and the tool uses that as the core and labels it "found in the scan". |
| CoStar fields (stories, RBA, floor SF, vacancy, rent, value) | **Yes** for stories, rentable area and typical floor size. Vacancy is derived from current tenancies and availability from lease listings. Apartment rents come from apartment listings near the building. The reference value is an asking price, else the last recorded sale; there is no assessed value. |
| Are all four validation buildings in the data? | **No.** 1801 Smith and 1415 Louisiana are. One City Centre (1021 Main) and 708 Main are not: see the change log in `docs/preregistration.md`. |
| Real footprints | **For 5 of the 18 downtown office buildings.** Vexcel's outline is the whole building at ground level, so we use it as the plate only when its area is within 15% of the typical floor (`backend/vexcel.py`). The other 13 outlines are much bigger: the base of the building, an attached garage, or a whole complex counted as one building. Those keep a square stand-in sized to the typical floor. A building with a saved full-floor scan uses the scanned plate instead of either. |
| Vexcel footprint polygon + height | **Footprint: yes**, from the property endpoint (one call per building, saved to `data/vexcel/`). **Height: no**: the roof-height fields came back empty for every downtown building we tried. |
| What can appear in the public repo / video / Devpost? | Asked CoStar (terms section 3.2 forbids sponsor data and schemas in public demos and open-source repos). |

## H2 decision

Matterport layer: **GO**. CoStar and Vexcel: decided once the keys work and CoStar answers the terms questions.
