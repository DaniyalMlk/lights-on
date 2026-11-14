"""Check the sponsor keys and pull the raw pieces we need, one layer at a time.

    python -m scripts.check_keys                       # Matterport and Vexcel key checks
    python -m scripts.check_keys --index               # download Matterport's public models_index.csv
    python -m scripts.check_keys --floor MODEL_ID      # save that floor's rooms and walls
    python -m scripts.check_keys --kit                 # list the CoStar kit and print its CSV columns

Everything it saves goes to data/ (git-ignored). Sponsor data has to be deleted after the event.
"""
from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

from backend import matterport

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

VEXCEL_ORTHO_URL = "https://api.vexcelgroup.com/v2/ortho/extract"
CITY_HALL = (29.7604, -95.3698)      # a public landmark downtown, used for the Vexcel check

COUNT_QUERY = "{ rootFolder { name modelCountSummary(includeModelsInSubfolders: true) } }"


def check_matterport() -> None:
    folder = matterport.graph(COUNT_QUERY)["rootFolder"]
    print(f"Matterport OK: '{folder['name']}' has {folder['modelCountSummary']:,} models")


def download_index() -> None:
    """The index is a public file next to the Matterport quickstart; no key needed."""
    response = httpx.get(matterport.INDEX_URL, timeout=60)
    response.raise_for_status()
    matterport.INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    matterport.INDEX_PATH.write_bytes(response.content)
    rows = matterport.load_index()
    print(f"saved {matterport.INDEX_PATH.relative_to(ROOT)}: {len(rows):,} models")


def save_floor(model_id: str) -> None:
    """Save one model's rooms and wall graph to data/matterport/<id>.json and print the rooms by size."""
    model = matterport.fetch_floor(model_id)
    print(f"saved data/matterport/{model_id}.json: {model['name']}")
    rooms = matterport.room_table(model)
    for room in rooms:
        print(f"  {room['label']:<28} {room['area_sf']:>9,} sf")
    print(f"  {len(rooms)} rooms, {sum(r['area_sf'] for r in rooms):,} sf labelled")


def check_vexcel(lat: float, lon: float) -> None:
    """Clip Vexcel's latest orthophoto to a small square around a point and save it as a JPEG."""
    d = 0.0007     # about 70 m each way
    ring = [(lon - d, lat - d), (lon + d, lat - d), (lon + d, lat + d), (lon - d, lat + d), (lon - d, lat - d)]
    wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in ring) + "))"
    body = {"wkt": wkt, "srid": 4326, "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box",
            "image-format": "jpeg", "destination-dimensions": "1024,1024", "attribution": "false"}
    response = httpx.post(VEXCEL_ORTHO_URL, json=body, headers={"X-API-KEY": os.environ["VEXCEL_API_KEY"]},
                          timeout=60)
    response.raise_for_status()
    path = DATA / "vexcel" / f"ortho_{lat:.4f}_{lon:.4f}.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    print(f"Vexcel OK: saved {path.relative_to(ROOT)} ({len(response.content):,} bytes)")


def check_kit() -> None:
    """List the files in the CoStar kit and print each CSV's header row.

    The headers only go to the terminal: CoStar's schema is confidential, so it must not end up in git.
    """
    path = Path(os.environ.get("COSTAR_KIT_ZIP") or "data/raw/costar-kit.zip")
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        print(f"CoStar kit not found at {path}. Download it (link on your keys card) into data/raw/.")
        return
    password = os.environ.get("COSTAR_ZIP_PASSWORD", "").encode()
    with zipfile.ZipFile(path) as kit:
        for info in kit.infolist():
            print(f"  {info.filename:<55} {info.file_size / 1e6:8.1f} MB")
            if not info.filename.endswith(".csv"):
                continue
            try:
                with kit.open(info, pwd=password) as f:
                    header = f.readline().decode("utf-8-sig").strip()
                print(f"      columns: {header}")
            except NotImplementedError:
                print("      AES-encrypted zip: extract it with 7-Zip (brew install p7zip; "
                      "7z x data/raw/costar-kit.zip -odata/raw/costar) and read the CSVs from there")
                return


def main() -> None:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Check the sponsor keys and pull raw data into data/.")
    parser.add_argument("--index", action="store_true", help="download Matterport's public models_index.csv")
    parser.add_argument("--floor", action="append", default=[], metavar="MODEL_ID",
                        help="save this Matterport model's rooms and wall graph (repeatable)")
    parser.add_argument("--at", nargs=2, type=float, default=CITY_HALL, metavar=("LAT", "LON"),
                        help="point for the Vexcel check (default: Houston City Hall)")
    parser.add_argument("--kit", action="store_true", help="list the CoStar kit and its CSV columns")
    args = parser.parse_args()

    if args.index:
        download_index()

    if os.environ.get("MATTERPORT_API_KEY") and os.environ.get("MATTERPORT_API_TOKEN"):
        check_matterport()
        for model_id in args.floor:
            save_floor(model_id)
    else:
        print("Matterport skipped: set MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in .env")

    if os.environ.get("VEXCEL_API_KEY"):
        check_vexcel(*args.at)
    else:
        print("Vexcel skipped: set VEXCEL_API_KEY in .env")

    if args.kit:
        check_kit()


if __name__ == "__main__":
    main()
