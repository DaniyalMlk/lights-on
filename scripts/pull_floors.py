"""Pull the full-floor scans of the real buildings that are not saved yet, into a folder the app does not read.

    python -m scripts.pull_floors

They go to data/matterport_new/ so nothing in the app changes while we look at them. A floor only counts once
it is moved into data/matterport/ and the building is analyzed again, and that is written down in
docs/preregistration.md first. Everything in data/ is git-ignored and deleted after the event.
"""
from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

from backend import matterport                      # noqa: E402  (after load_dotenv, like the app)
from backend.main import BUILDINGS                  # noqa: E402

NEW_DIR = matterport.FLOORS_DIR.parent / "matterport_new"


def main() -> None:
    index = matterport.load_index()
    NEW_DIR.mkdir(parents=True, exist_ok=True)
    for building in BUILDINGS.values():
        if building.get("synthetic"):
            continue
        todo = [s for s in matterport.scans_for(building, index)
                if s["full_floor"] and not s["saved"] and not (NEW_DIR / f"{s['model_id']}.json").exists()]
        for n, scan in enumerate(todo, 1):
            try:
                model = matterport.graph(matterport.FLOOR_QUERY, {"id": scan["model_id"]})["model"]
            except Exception as error:              # one scan we may not read should not stop the rest
                print(f"{building['name']}: scan {n} of {len(todo)} not pulled ({type(error).__name__}: {str(error)[:200]})")
                continue
            (NEW_DIR / f"{scan['model_id']}.json").write_text(json.dumps(model, indent=1))
            print(f"{building['name']}: scan {n} of {len(todo)} pulled, matched by {scan['matched_by']}: "
                  f"{len(model.get('floors') or [])} levels, {len(model.get('rooms') or [])} rooms")
    print("Done. Nothing in the app has changed.")


if __name__ == "__main__":
    main()
