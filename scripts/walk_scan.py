"""Walk a building's saved floor scan room by room and let the vision model name each room's type.

    python -m scripts.walk_scan "<part of the building's name>" --limit 5     a first try on five rooms
    python -m scripts.walk_scan "<part of the building's name>"               every room not looked at yet

Needs LIGHTS_ON_MODEL (a model that reads images) and COSTAR_LLM_OK=yes in .env. Run it again after a rate
limit or a dropped connection: it carries on with the rooms that are left. The app shows what was seen under
"Every room, labeled" the next time the building is opened.
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter

from dotenv import load_dotenv

load_dotenv()

from backend import matterport                      # noqa: E402  (after load_dotenv, like the app)
from backend.annotations import floor_labels        # noqa: E402
from backend.main import BUILDINGS                  # noqa: E402
from backend.tools import room_vision               # noqa: E402


def measured_scan(building: dict) -> tuple[str, dict] | None:
    """The scan the app labels for this building: the first saved full floor that passes the same checks."""
    for scan in matterport.scans_for(building, matterport.load_index()):
        model = matterport.load_floor(scan["model_id"]) if scan["full_floor"] else None
        if model and floor_labels(model, building.get("typical_floor_sf"))["labels"]:
            return scan["model_id"], model
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Let the vision model name the rooms of a building's saved floor scan")
    parser.add_argument("name", help="part of the building's name, as in the app's list")
    parser.add_argument("--limit", type=int, help="look at no more than this many rooms this time")
    parser.add_argument("--again", action="store_true", help="look once more at rooms already looked at")
    args = parser.parse_args()

    matches = [b for b in BUILDINGS.values() if args.name.lower() in b["name"].lower() and not b.get("synthetic")]
    if len(matches) != 1:
        sys.exit(f"{len(matches)} buildings match that name: " + ", ".join(b["name"] for b in matches))
    found = measured_scan(matches[0])
    if not found:
        sys.exit(f"{matches[0]['name']} has no saved full-floor scan with labels, so there are no rooms to walk")
    model_id, model = found

    rooms = room_vision.pano_for_each_room(model)
    print(f"{matches[0]['name']}: {len(rooms)} rooms have a panorama inside; {len(room_vision.load(model_id))} already looked at")
    try:
        seen = room_vision.walk(model_id, model, limit=args.limit, again=args.again)
    except PermissionError as error:
        sys.exit(str(error))
    types = Counter(look["type"] for look in seen.values())
    print(f"Looked at so far: {len(seen)} rooms | " + ", ".join(f"{name}: {count}" for name, count in types.most_common()))


if __name__ == "__main__":
    main()
