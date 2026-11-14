"""Build data/buildings.json from the CoStar kit: downtown Houston office buildings.

    python -m scripts.build_from_kit
    python -m scripts.build_from_kit --kit data/raw/costar-hackathon-kit --out data/buildings.json

Needs data/costar_kit_map.json (git-ignored), which says where each value lives in CoStar's records.
"""
import argparse
import json
from pathlib import Path

from backend.costar_kit import buildings_from_kit, load_kit_map

parser = argparse.ArgumentParser()
parser.add_argument("--kit", default="data/raw/costar-hackathon-kit")
parser.add_argument("--out", default="data/buildings.json")
args = parser.parse_args()

buildings, skipped = buildings_from_kit(Path(args.kit), load_kit_map())
Path(args.out).parent.mkdir(parents=True, exist_ok=True)
Path(args.out).write_text(json.dumps({"source": "CoStar kit (event licence: delete after Sun 4 pm)",
                                      "buildings": buildings}, indent=1))

print(f"{len(buildings)} buildings written to {args.out}\n")
print(f"{'id':<10} {'name':<34} {'stories':>7} {'vacancy':>8} {'avail.':>7} {'rent/sf/mo':>10} {'reference':>14}")
for b in buildings:
    rent = f"{b['mf_rent_psf_month']:.2f}" if b["mf_rent_psf_month"] else "-"
    ref = f"{b['assessed_value']:,.0f}" if b["assessed_value"] else "-"
    print(f"{b['id']:<10} {b['name'][:34]:<34} {b['stories']:>7} {b['vacancy']:>8.0%} {b['availability']:>7.0%} {rent:>10} {ref:>14}")
for s in skipped:
    print(f"skipped {s['id']} {s['name']}: {', '.join(s['reasons'])}")
