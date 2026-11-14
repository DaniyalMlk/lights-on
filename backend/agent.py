"""The Lights On agent (LangChain deepagents).

Orchestrator plans with a todo list and hands work to four sub-agents:
    screener -> analyst -> writer -> verifier
The tools do all the math. The model plans, explains and writes; it never invents a number.
The /work/ folder is real: tool outputs land there and the agent can read them with its file tools.
"""
from __future__ import annotations

import json
import os

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, StateBackend
from langchain.agents.middleware import TodoListMiddleware
from langchain_core.tools import tool

from backend import config as C
from backend import matterport
from backend.pipeline import WORK_DIR, analyze, load_result
from backend.tools.verifier import verify


def _buildings() -> dict:
    from backend.main import BUILDINGS   # same building list the API uses
    return BUILDINGS


@tool
def find_candidates(min_vacancy: float = C.VACANCY_GATE) -> str:
    """List office buildings whose vacancy is at least min_vacancy (0-1). Returns id, name, stories, vacancy."""
    rows = [
        {"id": b["id"], "name": b.get("name"), "stories": b["stories"], "vacancy": b.get("vacancy")}
        for b in _buildings().values()
        if (b.get("vacancy") or 0) >= min_vacancy
    ]
    return json.dumps({"status": "success", "summary": f"{len(rows)} buildings pass the vacancy gate",
                       "values": rows, "source": "costar.vacancy",
                       "next_actions": ["analyze_building for each candidate"]})


@tool
def analyze_building(building_id: str) -> str:
    """Run geometry, layout, economics and carbon for one building. Saves everything to /work/<id>/."""
    b = _buildings().get(building_id)
    if not b:
        return json.dumps({"status": "error", "summary": f"unknown building {building_id}",
                           "next_actions": ["call find_candidates to get valid ids"]})
    r = analyze(b)
    g = r["geometry"]
    base = g["by_depth"][str(C.BASE_DEPTH_FT)]
    next_actions = ["writer: draft the memo from /work/%s/*.json" % building_id]
    if g["matterport_worth_pulling"]:
        next_actions.insert(0, "daylight share is borderline: call check_matterport before deciding")
    if g["deep_plate"]:
        next_actions.insert(0, "deep plate: compare a light well vs a mixed program (hotel or amenity floors)")
    if g["floor_check"]["branch"] == "podium":
        next_actions.insert(0, "podium: analyze the tower floor and the podium separately")
    return json.dumps({
        "status": "success",
        "summary": f"{base['homes']} homes at {C.BASE_DEPTH_FT} ft; score {r['score']['total']}",
        "values": {"homes_by_depth": {d: v["homes"] for d, v in g["by_depth"].items()},
                   "daylight_share": base["daylight_share"], "deep_plate": g["deep_plate"],
                   "verdict": (r["econ"] or {}).get("verdict"), "score": r["score"]},
        "source": f"/work/{building_id}/",
        "next_actions": next_actions,
    })


@tool
def check_matterport(building_id: str) -> str:
    """Find Matterport scans of a building and summarize its scanned office floors (rooms, scanned area).
    Worth it when the daylight share is borderline or the plate looks deep. Saves to /work/<id>/matterport.json."""
    b = _buildings().get(building_id)
    if not b:
        return json.dumps({"status": "error", "summary": f"unknown building {building_id}",
                           "next_actions": ["call find_candidates to get valid ids"]})
    if b.get("synthetic"):
        return json.dumps({"status": "warning", "summary": "sample building: it has no real scans",
                           "values": {}, "source": "matterport", "next_actions": ["continue with the assumed core"]})
    index = matterport.load_index()
    if not index:
        return json.dumps({"status": "warning", "summary": "Matterport index not downloaded; the core stays assumed",
                           "values": {}, "source": "matterport",
                           "next_actions": ["tell the team: python -m scripts.check_keys --index"]})

    scans = matterport.scans_for(b, index)
    to_pull = next((s for s in scans if s["full_floor"] and not s["saved"]), None)
    if to_pull and os.environ.get("MATTERPORT_API_KEY"):
        try:
            matterport.fetch_floor(to_pull["model_id"])
            to_pull["saved"] = True
        except Exception as e:      # a failed pull shouldn't stop the run
            to_pull["error"] = str(e)[:200]

    floors = []
    for s in scans:
        model = matterport.load_floor(s["model_id"]) if s["full_floor"] else None
        if model:
            rooms = matterport.room_table(model)
            floors.append({"model_id": s["model_id"], "name": s["name"], "room_count": len(rooms),
                           "scanned_area_sf": sum(r["area_sf"] for r in rooms), "largest_rooms": rooms[:5]})
    result = {"scans": scans, "floors": floors}
    folder = WORK_DIR / building_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "matterport.json").write_text(json.dumps(result, indent=2))

    if floors:
        summary = f"{len(scans)} scans; {len(floors)} office floor(s) pulled with rooms and walls"
        next_actions = ["compare scanned_area_sf with the typical floor SF before treating a scan as the whole floor",
                        "the core in the results is still the assumed one unless geometry says core_source=matterport"]
    elif scans:
        summary = f"{len(scans)} scans, but no full office floor pulled (rooms or suites only)"
        next_actions = ["say the core is assumed; a suite scan doesn't show the core"]
    else:
        summary = "no Matterport scans of this building"
        next_actions = ["continue with the assumed core and say so in the memo"]
    return json.dumps({"status": "success", "summary": summary, "values": result,
                       "source": f"/work/{building_id}/matterport.json", "next_actions": next_actions})


@tool
def verify_numbers(building_id: str, text: str) -> str:
    """Check that every number in a draft comes from /work/<building_id>/. Returns rejected numbers with fixes."""
    work = load_result(building_id) or {}
    return json.dumps(verify(text, work))


SUBAGENTS = [
    {
        "name": "screener",
        "description": "Finds office buildings that pass the vacancy gate.",
        "system_prompt": "You shortlist buildings. Call find_candidates and return the ids. Do not analyze.",
        "tools": [find_candidates],
    },
    {
        "name": "analyst",
        "description": "Runs the feasibility tools on one building and decides which branch applies.",
        "system_prompt": (
            "You analyze one building. Call analyze_building. Follow its next_actions. Call check_matterport when "
            "the daylight share is borderline or the plate is deep, and say whether the core is measured or assumed. "
            "Report the numbers exactly as the tools returned them."
        ),
        "tools": [analyze_building, check_matterport],
    },
    {
        "name": "writer",
        "description": "Writes a short memo and an owner email from the saved results.",
        "system_prompt": (
            "Read /work/<id>/*.json with your file tools and write a 200-word memo and a short owner email. "
            "Every number must be copied from those files. Never round to a different precision than shown."
        ),
        "tools": [],
    },
    {
        "name": "verifier",
        "description": "Rejects any number in a draft that isn't in the saved tool outputs.",
        "system_prompt": "Call verify_numbers on the draft. Return the rejected numbers and their fixes, or 'approved'.",
        "tools": [verify_numbers],
    },
]

INSTRUCTIONS = """You help a credit analyst decide which empty downtown Houston offices can become apartments.
Plan with your todo list. Then: screener -> analyst (top buildings) -> writer -> verifier.
If the verifier rejects a number, send the draft back to the writer once with the fixes.
Never state a number that isn't in a tool output. Ask before writing if data is missing."""


def build_agent():
    backend = CompositeBackend(
        default=StateBackend(),
        routes={"/work/": FilesystemBackend(root_dir=str(WORK_DIR), virtual_mode=True)},
    )
    return create_deep_agent(
        model=os.environ["LIGHTS_ON_MODEL"],
        tools=[find_candidates, analyze_building, check_matterport, verify_numbers],
        system_prompt=INSTRUCTIONS,
        subagents=SUBAGENTS,
        backend=backend,
        middleware=[TodoListMiddleware()],     # the plan checklist (write_todos) the UI shows
    )


def run_agent(goal: str, building_id: str | None = None) -> dict:
    agent = build_agent()
    prompt = goal if not building_id else f"{goal}\nFocus on building {building_id}."
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    trace = [{"type": m.type, "content": m.content if isinstance(m.content, str) else str(m.content),
              "tool_calls": getattr(m, "tool_calls", None)} for m in result["messages"]]
    return {"answer": trace[-1]["content"] if trace else "", "trace": trace, "todos": result.get("todos", [])}


# ---- Streaming the trace to the UI ---------------------------------------------------------

TRACE_LIMIT_S = 90


def _messages(update: dict) -> list:
    msgs = update.get("messages", [])
    if not isinstance(msgs, list):
        msgs = getattr(msgs, "value", [msgs])
    return msgs


def _events_from_update(namespace: tuple, update: dict) -> list[dict]:
    """Turn one LangGraph update into small UI events: plan, delegate, tool_call, tool_result, message."""
    who = "orchestrator" if not namespace else "sub-agent"
    events = []
    for m in _messages(update):
        if m.type == "ai":
            for call in getattr(m, "tool_calls", []) or []:
                if call["name"] == "write_todos":
                    events.append({"type": "plan", "who": who, "todos": call["args"].get("todos", [])})
                elif call["name"] == "task":
                    events.append({"type": "delegate", "who": who, "to": call["args"].get("subagent_type"),
                                   "task": call["args"].get("description", "")})
                else:
                    events.append({"type": "tool_call", "who": who, "name": call["name"], "args": call["args"]})
            if isinstance(m.content, str) and m.content.strip():
                events.append({"type": "message", "who": who, "text": m.content})
        elif m.type == "tool":
            summary = m.content if isinstance(m.content, str) else str(m.content)
            try:
                parsed = json.loads(summary)
                if m.name == "verify_numbers" and parsed.get("status") == "error":
                    events.append({"type": "verifier_rejection", "rejected": parsed["values"]["rejected"]})
                summary = f"{parsed.get('status', '')}: {parsed.get('summary', '')}"
            except (ValueError, AttributeError):
                summary = summary[:300]
            events.append({"type": "tool_result", "who": who, "name": m.name, "summary": summary})
    return events


def trace_path(building_id: str | None):
    return WORK_DIR / (building_id or "_all") / "trace.json"


def stream_agent(goal: str, building_id: str | None = None):
    """Yield events from a live run and save them, so the same run can be replayed later."""
    import time
    from datetime import datetime, timezone

    started = time.time()
    events = []
    prompt = goal if not building_id else f"{goal}\nFocus on building {building_id}."
    for namespace, update in build_agent().stream({"messages": [{"role": "user", "content": prompt}]},
                                                  stream_mode="updates", subgraphs=True):
        for node_update in (update or {}).values():
            if not isinstance(node_update, dict):
                continue
            for event in _events_from_update(namespace, node_update):
                events.append(event)
                yield event
        if time.time() - started > TRACE_LIMIT_S:
            yield {"type": "timeout", "seconds": TRACE_LIMIT_S}
            return

    record = {"recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "model": str(os.environ.get("LIGHTS_ON_MODEL")), "goal": prompt, "events": events}
    path = trace_path(building_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1))
    yield {"type": "done", "seconds": round(time.time() - started, 1)}


def replay_trace(building_id: str | None):
    """Replay a saved run. Every event is marked as a replay with the time it was recorded."""
    path = trace_path(building_id)
    if not path.exists():
        yield {"type": "error", "text": "No live model configured and no recorded run for this building yet."}
        return
    record = json.loads(path.read_text())
    yield {"type": "replay", "recorded_at": record["recorded_at"], "model": record["model"]}
    yield from record["events"]
    yield {"type": "done", "replay": True}
