"""Run the pre-registered checks and the input-sensitivity table. Writes work/proof.json.

Usage:  python -m scripts.run_validation
"""
from backend.main import BUILDINGS
from backend.validation import run

result = run(BUILDINGS)
print(f"params {result['params_version']}  ran {result['ran_at']}")
for c in result["cases"]:
    print(f"  {c['case']:<22} {c['status']:<16} predicted={c.get('predicted')}  truth={c.get('truth')}  "
          f"error={c.get('error_pct', '-')}%  deep_plate={c.get('deep_plate', '-')}")
    if c.get("missed"):
        print(f"      missed: {', '.join(c['missed'])}")
    if c.get("inputs", "our data") != "our data":
        print(f"      inputs: {c['inputs']}")
print("input sensitivity (homes at 36 ft, CoStar only -> with footprint):")
for r in result["input_sensitivity"]:
    print(f"  {r['building_id']:<12} {r['homes_costar_only']:>5} -> {r['homes_with_footprint']:>5}   "
          f"rank {r['rank_costar_only']} -> {r['rank_with_footprint']}")
