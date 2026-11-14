"""Pre-compute every building so the demo reads from work/ instead of waiting on a live run.

Usage:  python -m scripts.cache_all
"""
import time

from backend.main import BUILDINGS
from backend.pipeline import analyze

start = time.time()
for i, b in enumerate(BUILDINGS.values(), 1):
    r = analyze(b)
    print(f"{i:>4}/{len(BUILDINGS)}  {b['id']:<14} homes@36ft={r['geometry']['by_depth']['36']['homes']:>5}  score={r['score']['total']}")
print(f"done in {time.time() - start:.1f}s")
