"""Build our building list from the CoStar data kit (the folder of JSON-lines files from the keys card).

CoStar's field names are part of their confidential schema (event terms, section 3.2), so this file never
names them. It asks data/costar_kit_map.json, which git ignores, where each value lives: a field name,
or a dotted path into a nested record such as "<object>.<field>".
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

from backend.data_sources import comps_rent, to_number

ROOT = Path(__file__).resolve().parent.parent
KIT_MAP_FILE = ROOT / "data" / "costar_kit_map.json"

DOWNTOWN = (29.745, 29.768, -95.378, -95.352)    # lat min, lat max, lon min, lon max
FEET_PER_DEGREE_LAT = 364_000


def get(record, path: str):
    """Follow a dotted path through nested dicts: get(r, "a.b") is r["a"]["b"]. Anything missing gives None."""
    for key in path.split("."):
        if not isinstance(record, dict):
            return None
        record = record.get(key)
    return record


def read_jsonl(path: Path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def load_kit_map(path: Path = KIT_MAP_FILE) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing: it tells the loader where each value lives in CoStar's records")
    return json.loads(path.read_text())


def square_footprint(lat: float, lon: float, floor_sf: float) -> dict:
    """A square with the typical floor's area, centred on the building. A stand-in until we have the real outline."""
    half_ft = math.sqrt(floor_sf) / 2
    dlat = half_ft / FEET_PER_DEGREE_LAT
    dlon = half_ft / (FEET_PER_DEGREE_LAT * math.cos(math.radians(lat)))
    ring = [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat],
            [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]
    return {"type": "Polygon", "coordinates": [ring]}


def occupied_sf(kit: Path, m: dict, ids: set) -> dict:
    """Square feet occupied today, per property: tenancies that have no end date."""
    o = m["occupancy"]
    totals = {}
    for r in read_jsonl(kit / m["files"]["occupancy"]):
        pid = get(r, o["property_id"])
        if pid in ids and get(r, o["end"]) is None:
            sf = sum(to_number(get(space, o["space_sf"])) or 0 for space in get(r, o["spaces"]) or [])
            totals[pid] = totals.get(pid, 0) + sf
    return totals


def listing_facts(kit: Path, m: dict, ids: set) -> dict:
    """From each property's active listings: space offered for lease, office asking rent ($/sf/yr), asking price."""
    L = m["listing"]
    facts = {}
    for r in read_jsonl(kit / m["files"]["listing"]):
        pid = get(r, L["property_id"])
        if pid not in ids or get(r, L["status"]) != m["active_status"]:
            continue
        f = facts.setdefault(pid, {"available_sf": 0.0, "rents": [], "asking_price": None})
        lease = get(r, L["lease"])
        if lease:
            f["available_sf"] += to_number(get(lease, L["available_sf"])) or 0
            low, high = to_number(get(lease, L["rate_low"])), to_number(get(lease, L["rate_high"]))
            if low and high:
                yearly = 12 if get(lease, L["rate_basis"]) == m["monthly_basis"] else 1
                f["rents"].append((low + high) / 2 * yearly)
        sale = get(r, L["sale"])
        if sale:
            price = (to_number(get(sale, L["price_high"])) or to_number(get(sale, L["price_low"]))
                     or to_number(get(r, L["deal_value"])))
            if price:
                f["asking_price"] = price
    return facts


def last_sales(kit: Path, m: dict, ids: set) -> dict:
    """Most recent single-building sale price per property (portfolio sales are skipped: their price isn't per building)."""
    S = m["sale"]
    latest = {}
    for r in read_jsonl(kit / m["files"]["sale"]):
        entities = get(r, S["entities"]) or []
        price, date = to_number(get(r, S["price"])), get(r, S["date"])
        if len(entities) != 1 or not price or not date:
            continue
        pid = get(entities[0], S["property_id"])
        if pid in ids and date > latest.get(pid, ("", 0))[0]:
            latest[pid] = (date, price)
    return {pid: price for pid, (date, price) in latest.items()}


def rent_comps(kit: Path, m: dict) -> list[dict]:
    """Asking apartment rent per sf per month for each community in the kit, with its location."""
    A = m["apartment"]
    comps = []
    for r in read_jsonl(kit / m["files"]["apartment"]):
        lat, lon = to_number(get(r, A["lat"])), to_number(get(r, A["lon"]))
        rent_total = sf_total = 0.0
        for plan in get(r, A["plans"]) or []:
            units = to_number(get(plan, A["units"])) or 1
            rents = [x for x in (to_number(get(plan, A["rent_min"])), to_number(get(plan, A["rent_max"]))) if x]
            sizes = [x for x in (to_number(get(plan, A["sf_min"])), to_number(get(plan, A["sf_max"]))) if x]
            if rents and sizes:
                rent_total += units * statistics.mean(rents)
                sf_total += units * statistics.mean(sizes)
        if lat is not None and lon is not None and sf_total:
            comps.append({"lat": lat, "lon": lon, "rent_psf_month": rent_total / sf_total})
    return comps


def buildings_from_kit(kit: Path, m: dict, box: tuple = DOWNTOWN) -> tuple[list[dict], list[dict]]:
    """Office buildings inside the box, in the same shape as backend/sample_buildings.json.
    Returns (buildings, skipped with reasons)."""
    P = m["property"]
    picked = []
    for r in read_jsonl(kit / m["files"]["property"]):
        lat, lon = to_number(get(r, P["lat"])), to_number(get(r, P["lon"]))
        inside = lat is not None and lon is not None and box[0] < lat < box[1] and box[2] < lon < box[3]
        if inside and get(r, P["property_type"]) == m["office_type"]:
            picked.append(r)

    ids = {get(r, P["id"]) for r in picked}
    occupied = occupied_sf(kit, m, ids)
    facts = listing_facts(kit, m, ids)
    sales = last_sales(kit, m, ids)
    comps = rent_comps(kit, m)

    buildings, skipped = [], []
    for r in picked:
        pid = get(r, P["id"])
        address = " ".join(str(x) for x in (get(r, P[k]) for k in ("street_number", "street_name", "street_type")) if x)
        stories = to_number(get(r, P["stories"]))
        rba = to_number(get(r, P["rba"]))
        floor_sf = to_number(get(r, P["typical_floor_sf"]))
        missing = [label for label, value in (("stories", stories), ("rentable area", rba), ("typical floor size", floor_sf))
                   if not value]
        if missing:
            skipped.append({"id": str(pid), "name": address, "reasons": [f"no {label}" for label in missing]})
            continue

        lat, lon = to_number(get(r, P["lat"])), to_number(get(r, P["lon"]))
        f = facts.get(pid, {})
        built = next((get(e, P["event_year"]) for e in get(r, P["events"]) or []
                      if get(e, P["event_type"]) == m["built_event"]), None)
        if f.get("asking_price"):
            reference, reference_source = f["asking_price"], "listing asking price"
        elif pid in sales:
            reference, reference_source = sales[pid], "last recorded sale price"
        else:
            reference, reference_source = None, None
        rent, n_comps = comps_rent({"lat": lat, "lon": lon}, comps)

        buildings.append({
            "id": str(pid),
            "name": get(r, P["name"]) or address,
            "address": address,
            "lat": lat,
            "lon": lon,
            "stories": int(stories),
            "height_ft": to_number(get(r, P["height_ft"])),
            "rba": rba,
            "typical_floor_sf": floor_sf,
            "year_built": built,
            "vacancy": round(max(0.0, 1 - occupied.get(pid, 0) / rba), 3),
            "availability": round(f.get("available_sf", 0) / rba, 3),
            "mf_rent_psf_month": round(rent, 2) if rent else None,
            "rent_comps": n_comps,
            "office_rent_psf_year": round(statistics.mean(f["rents"]), 2) if f.get("rents") else None,
            "assessed_value": reference,
            "reference_source": reference_source,
            "footprint": square_footprint(lat, lon, floor_sf),
            "footprint_source": "a square stand-in sized to the typical floor",
            "footprint_origin": "square",
        })
    return buildings, skipped
