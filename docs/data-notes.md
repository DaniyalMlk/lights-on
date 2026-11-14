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
| Can Matterport replace the assumed core? | Likely, for scanned floors: rooms carry labels and areas, and the wall graph gives the plan. To check on the first real pull. |
| CoStar fields (stories, RBA, floor SF, vacancy, rent, value) | Pending: the kit needs the zip password. |
| Vexcel footprint polygon + height | Pending: the building/parcel endpoint is in Vexcel's own quickstart. |
| What can appear in the public repo / video / Devpost? | Asked CoStar (terms section 3.2 forbids sponsor data and schemas in public demos and open-source repos). |

## H2 decision

Matterport layer: **GO**. CoStar and Vexcel: decided once the keys work and CoStar answers the terms questions.
