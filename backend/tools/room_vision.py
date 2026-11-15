"""A walk through a scanned floor, room by room: a vision model looks at one panorama in each room and
names the room's type from a fixed list. This is the only part of our labels that is seen by a model
rather than measured, and every label built from it says so.

The panoramas are sponsor data and a hosted model is a third party, so the walk only runs once CoStar has
cleared it (COSTAR_LLM_OK=yes in .env): the same switch the agent uses. What the model answers is saved
next to the scan in data/ (git-ignored, deleted after the event). The photos themselves are never saved.

    python -m scripts.walk_scan "<building name>"
"""
from __future__ import annotations

import base64
import json
import re

import httpx
from shapely.geometry import Point

from backend import matterport
from backend.matterport import FLOORS_DIR
from backend.tools.matterport_plan import FT_PER_M, rooms_to_label

# The only answers we accept. Anything else the model says becomes "Unclear" and gets no label.
ROOM_TYPES = ("Open office", "Private office", "Meeting room", "Reception or lobby", "Corridor",
              "Kitchen or break room", "Lounge", "Gym", "Laundry", "Pool", "Restroom", "Storage",
              "Mechanical or server room", "Elevator lobby", "Stair", "Empty shell space", "Unclear")
AMENITIES = ("Kitchen or break room", "Lounge", "Gym", "Laundry", "Pool")
EVIDENCE_CHARS = 80

PANO_QUERY = """query Panos($id: ID!) { model(id: $id) {
  panoLocations { id skybox(resolution: "2k") { status children } }
} }"""

PROMPT = ("These four photos are the four sides of one panorama taken inside a room on a floor of an office "
          "building. Name the type of room the camera is standing in. Answer with JSON only, like "
          '{"type": "...", "evidence": "..."}. "type" must be exactly one of: ' + ", ".join(ROOM_TYPES) + ". "
          '"evidence" is what you can see that tells you, in at most ten words. '
          'Go only by what is in the photos. If you cannot tell, answer "Unclear".')


def pano_for_each_room(model: dict) -> dict[str, str]:
    """{room id: pano id}: for every room with a camera position inside it, the one nearest the room's middle."""
    panos = [(p["id"], Point(p["position"]["x"] * FT_PER_M, p["position"]["y"] * FT_PER_M))
             for p in model.get("panoLocations") or [] if p.get("id") and p.get("position")]
    chosen = {}
    for room_id, _, room in rooms_to_label(model):
        inside = [(spot.distance(room.representative_point()), pano_id) for pano_id, spot in panos if room.contains(spot)]
        if room_id and inside:
            chosen[room_id] = min(inside)[1]
    return chosen


def load(model_id: str) -> dict:
    """What the walk saved for this scan: {room id: {"type", "evidence", "pano_id"}}. Empty if it never ran."""
    path = FLOORS_DIR / f"{model_id}.rooms.json"
    return json.loads(path.read_text()) if path.exists() else {}


def read_answer(text: str) -> dict:
    """The model's reply as {"type", "evidence"}. A type that is not on our list, or no JSON at all, is "Unclear"."""
    found = re.search(r"\{.*?\}", text, re.DOTALL)
    try:
        reply = json.loads(found.group(0)) if found else {}
    except json.JSONDecodeError:
        reply = {}
    said = str(reply.get("type", "")).strip().lower()
    room_type = next((name for name in ROOM_TYPES if name.lower() == said), "Unclear")
    evidence = str(reply.get("evidence", "")).strip()[:EVIDENCE_CHARS] if room_type != "Unclear" else ""
    return {"type": room_type, "evidence": evidence}


def _download(url: str) -> bytes:
    response = httpx.get(url, timeout=120)
    response.raise_for_status()
    return response.content


def model_look():
    """A function that shows four photos to the model in LIGHTS_ON_MODEL (the agent's model) and reads its answer."""
    from langchain.chat_models import init_chat_model
    from langchain_core.messages import HumanMessage

    from backend.agent import _model, _text
    model = _model()
    chat = init_chat_model(model) if isinstance(model, str) else model

    def look(photos: list[bytes]) -> dict:
        content = [{"type": "text", "text": PROMPT}]
        content += [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(photo).decode()}}
                    for photo in photos]
        return read_answer(_text(chat.invoke([HumanMessage(content=content)]).content))
    return look


def walk(model_id: str, model: dict, look=None, limit: int | None = None, say=print) -> dict:
    """Look at every room that has a panorama and has not been looked at yet. Saves after each room, so a walk
    that stops (rate limit, wifi) carries on from there next time. Returns everything seen so far."""
    from backend.agent import real_data_allowed
    if not real_data_allowed():
        raise PermissionError("The panoramas are sponsor data: the vision walk only runs once CoStar has cleared "
                              "sending them to a hosted model (COSTAR_LLM_OK=yes in .env)")
    seen = load(model_id)
    todo = [(room_id, pano_id) for room_id, pano_id in pano_for_each_room(model).items() if room_id not in seen][:limit]
    if not todo:
        return seen
    # The photo links expire, so they are asked for fresh on every walk and never saved
    links = {p["id"]: (p.get("skybox") or {}).get("children") or []
             for p in matterport.graph(PANO_QUERY, {"id": model_id})["model"]["panoLocations"]}
    look = look or model_look()
    for n, (room_id, pano_id) in enumerate(todo, 1):
        sides = links.get(pano_id, [])[1:5]                 # of the six photos, 0 looks up and 5 looks down
        if len(sides) < 4:
            say(f"room {n} of {len(todo)}: no photos for it")
            continue
        try:
            answer = look([_download(url) for url in sides])
        except Exception as error:                          # a slow model or a dropped connection: try this room next time
            say(f"room {n} of {len(todo)}: skipped ({type(error).__name__})")
            continue
        seen[room_id] = {**answer, "pano_id": pano_id}
        FLOORS_DIR.mkdir(parents=True, exist_ok=True)
        (FLOORS_DIR / f"{model_id}.rooms.json").write_text(json.dumps(seen, indent=1))
        say(f"room {n} of {len(todo)}: {answer['type']}")
    return seen
