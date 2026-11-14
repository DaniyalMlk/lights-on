"""Build data/buildings.json from the CoStar dump, a footprint GeoJSON and (optionally) rent comps.

Example:
  python -m scripts.build_dataset --costar data/raw/costar.csv --footprints data/raw/footprints.geojson \
      --comps data/raw/mf_comps.csv
"""
import argparse
import json
from pathlib import Path

from backend.data_sources import build_buildings, load_footprints, read_rows, to_number

parser = argparse.ArgumentParser()
parser.add_argument("--costar", required=True)
parser.add_argument("--footprints", required=True)
parser.add_argument("--footprint-id", default="PropertyID", help="GeoJSON property that holds the CoStar id")
parser.add_argument("--comps", help="CSV/JSON with lat, lon, rent_psf_month")
parser.add_argument("--out", default="data/buildings.json")
args = parser.parse_args()

comps = []
if args.comps:
    for c in read_rows(args.comps):
        comps.append({"lat": to_number(c.get("lat")), "lon": to_number(c.get("lon")),
                      "rent_psf_month": to_number(c.get("rent_psf_month"))})

buildings, skipped = build_buildings(read_rows(args.costar), load_footprints(args.footprints, args.footprint_id), comps)
Path(args.out).parent.mkdir(parents=True, exist_ok=True)
Path(args.out).write_text(json.dumps({"source": "costar + vexcel", "buildings": buildings}, indent=1))

print(f"{len(buildings)} buildings written to {args.out}")
print(f"{sum(1 for b in buildings if b['mf_rent_psf_month'])} have rent comps")
print(f"{len(skipped)} skipped:")
for s in skipped[:20]:
    print(f"  {s['id']:<12} {s['name'] or '':<40} {', '.join(s['reasons'])}")
