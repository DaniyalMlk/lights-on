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
from langchain.chat_models import init_chat_model
from langchain_core.rate_limiters import InMemoryRateLimiter
from langchain_core.tools import tool

from backend import config as C
from backend import matterport
from backend.pipeline import WORK_DIR, analyze, load_result
from backend.tools.verifier import verify


# CoStar's terms (section 2.2) forbid sharing their data with third parties, and a hosted model is one.
# Until CoStar says yes, the agent only sees the synthetic sample buildings. Once they do: COSTAR_LLM_OK=yes in .env.
def real_data_allowed() -> bool:
    return os.environ.get("COSTAR_LLM_OK", "").strip().lower() == "yes"


def _buildings() -> dict:
    """The buildings the agent may see: the real list only if CoStar cleared it, otherwise the samples."""
    from backend.main import BUILDINGS, SAMPLE_FILE
    if real_data_allowed():
        return BUILDINGS
    return {b["id"]: b for b in json.loads(SAMPLE_FILE.read_text())["buildings"]}


def _check_building(building_id: str | None) -> None:
    if building_id and building_id not in _buildings():
        raise PermissionError(f"{building_id} is real CoStar data: the agent only runs on sample buildings "
                              "until CoStar clears it (COSTAR_LLM_OK=yes in .env)")


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
                   "verdict": ((r["econ"] or {}).get("verdict") or {}).get("text"), "score": r["score"]},
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
def get_results(building_id: str) -> str:
    """Every number a memo about this building may use, from its saved tool outputs. Call analyze_building first."""
    if building_id not in _buildings():
        return json.dumps({"status": "error", "summary": f"unknown building {building_id}",
                           "next_actions": ["pass the building id from the task (like SAMPLE-1), not its name"]})
    r = load_result(building_id)
    if not r:
        return json.dumps({"status": "error", "summary": f"no saved results for {building_id}",
                           "next_actions": ["the analyst must call analyze_building first"]})
    g, e, b = r["geometry"], r.get("econ") or {}, r["building"]
    base = g["by_depth"][str(C.BASE_DEPTH_FT)]
    cases = e.get("cases", {})
    # Only our own results and public facts. Raw CoStar values (vacancy, rents, prices, floor areas) stay out:
    # CoStar's terms keep them off anything we show, so the writer never gets them.
    measured_plate = g.get("plate_source") == "matterport_scan" or b.get("footprint_origin") == "vexcel"
    values = {
        "building": {k: b.get(k) for k in ("id", "name", "address", "stories")},
        "homes_by_depth_ft": {d: v["homes"] for d, v in g["by_depth"].items()},
        "homes_per_floor_at_36_ft": base["homes_per_floor"], "residential_floors": g["residential_floors"],
        "daylight_share_at_36_ft": base["daylight_share"], "deep_plate": g["deep_plate"],
        "plate_sf": g["plate_sf"] if measured_plate else None, "plate_from": b.get("footprint_source"),
        "core": g["core_source"],
        "verdict": (e.get("verdict") or {}).get("text"),
        "residual_by_case": {c: v["residual"] for c, v in cases.items()},
        "base_case": {k: cases.get("base", {}).get(k) for k in ("value", "cost", "residual_per_gsf")},
        "score": r["score"]["total"],
    }
    return json.dumps({"status": "success", "summary": f"saved results for {building_id}", "values": values,
                       "source": f"/work/{building_id}/",
                       "next_actions": ["write only from these values; round for a reader, change nothing else"]})


@tool
def verify_numbers(building_id: str, text: str) -> str:
    """Check that every number in a draft comes from /work/<building_id>/. Returns rejected numbers with fixes."""
    if building_id not in _buildings():
        return json.dumps({"status": "error", "summary": f"unknown building {building_id}",
                           "next_actions": ["pass the building id from the task (like SAMPLE-1), not its name"]})
    work = load_result(building_id) or {}
    return json.dumps(verify(text, work))


SUBAGENTS = [
    {
        "name": "screener",
        "description": "Finds office buildings that pass the vacancy gate.",
        "system_prompt": ("You shortlist buildings. Call find_candidates and return only the ids and vacancies. "
                          "Do not read files, analyze or judge: that is the analyst's job."),
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
            "Call get_results once with the building id, then write a 200-word memo and a short owner email about "
            "that one building. Use only facts and numbers from get_results, rounded for a reader: money like $38.6M "
            "or $107 per SF, shares like 62%, areas like 359,962 SF, whole homes. Call each number by its label in "
            "get_results (vacancy is vacancy, daylight share is daylight share). No dates, years, names or numbers "
            "that aren't there. Return the full memo and email text."
        ),
        "tools": [get_results],
    },
    {
        "name": "verifier",
        "description": "Rejects any number in a draft that isn't in the saved tool outputs.",
        "system_prompt": ("Call verify_numbers with the building id from your task (like SAMPLE-1, not the building's "
                          "name) and the full draft text. Return the rejected numbers and their fixes, or 'approved'."),
        "tools": [verify_numbers],
    },
]

INSTRUCTIONS = """You help a credit analyst decide which empty downtown Houston offices can become apartments.
Plan with your todo list. Then: screener -> analyst (top buildings) -> writer -> verifier.
You have no analysis tools yourself: hand each step to its sub-agent with the task tool, and give it the building id.
Always run all four steps, in order, for every building you are asked about, even when the numbers look bad:
a building that doesn't work still gets a memo that says why, checked by the verifier.
Ask sub-agents only for what the tools compute (homes, daylight share, deep plate, verdict, residual, cost, score).
Never ask for prices per unit, dates or anything else the tools don't return.
Give the verifier the writer's full draft, word for word. Your final answer is the approved memo and email.
Never quote vacancy, rents, prices or floor areas from the data: CoStar's terms keep raw values out of what we show.
If the verifier rejects a number, send the draft back to the writer once with the fixes, then verify again.
Never state a number that isn't in a tool output. Ask before writing if data is missing."""


class ReadOnlyFiles(FilesystemBackend):
    """The agent may read the saved tool outputs but never change them."""

    def write(self, file_path: str, content: str):
        from deepagents.backends.protocol import WriteResult
        return WriteResult(error="/work/ is read-only: keep drafts in your reply, or write them under /drafts/")

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False):
        from deepagents.backends.protocol import EditResult
        return EditResult(error="/work/ is read-only: keep drafts in your reply, or write them under /drafts/")


def _work_routes() -> dict:
    """The model reads tool outputs through /work/. Without CoStar's OK it can open only the sample folders."""
    if real_data_allowed():
        return {"/work/": ReadOnlyFiles(root_dir=str(WORK_DIR), virtual_mode=True)}
    routes = {}
    for building_id in _buildings():
        folder = WORK_DIR / building_id
        folder.mkdir(parents=True, exist_ok=True)
        routes[f"/work/{building_id}/"] = ReadOnlyFiles(root_dir=str(folder), virtual_mode=True)
    return routes


def _model():
    """The model from LIGHTS_ON_MODEL. LIGHTS_ON_MAX_RPM paces requests to stay under a free tier's per-minute limit."""
    model = os.environ["LIGHTS_ON_MODEL"]
    max_rpm = os.environ.get("LIGHTS_ON_MAX_RPM")
    if isinstance(model, str) and max_rpm:
        limiter = InMemoryRateLimiter(requests_per_second=float(max_rpm) / 60, check_every_n_seconds=0.1)
        return init_chat_model(model, rate_limiter=limiter)
    return model


def build_agent():
    backend = CompositeBackend(default=StateBackend(), routes=_work_routes())
    return create_deep_agent(
        model=_model(),
        tools=[],                      # the orchestrator plans and delegates; each sub-agent has its own tools
        system_prompt=INSTRUCTIONS,
        subagents=SUBAGENTS,
        backend=backend,
        middleware=[TodoListMiddleware()],     # the plan checklist (write_todos) the UI shows
    )


def run_agent(goal: str, building_id: str | None = None) -> dict:
    _check_building(building_id)
    agent = build_agent()
    prompt = goal if not building_id else f"{goal}\nFocus on building {building_id}."
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    trace = [{"type": m.type, "content": _text(m.content),
              "tool_calls": getattr(m, "tool_calls", None)} for m in result["messages"]]
    return {"answer": trace[-1]["content"] if trace else "", "trace": trace, "todos": result.get("todos", [])}


# ---- Streaming the trace to the UI ---------------------------------------------------------

TRACE_LIMIT_S = 90


def _messages(update: dict) -> list:
    msgs = update.get("messages", [])
    if not isinstance(msgs, list):
        msgs = getattr(msgs, "value", [msgs])
    return msgs


def _text(content) -> str:
    """A message's text. Some models (Gemini 3) send a list of parts instead of one string."""
    if isinstance(content, str):
        return content
    parts = content if isinstance(content, list) else [content]
    return "".join(p if isinstance(p, str) else p.get("text", "") for p in parts if isinstance(p, (str, dict)))


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
            text = _text(m.content)
            if text.strip():
                events.append({"type": "message", "who": who, "text": text})
        elif m.type == "tool":
            summary = _text(m.content)
            try:
                parsed = json.loads(summary)
                rejected = (parsed.get("values") or {}).get("rejected") if m.name == "verify_numbers" else None
                if rejected:                         # an "unknown building" error has no rejected numbers
                    events.append({"type": "verifier_rejection", "rejected": rejected})
                summary = f"{parsed.get('status', '')}: {parsed.get('summary', '')}"
            except (ValueError, AttributeError):
                summary = summary[:300]
            events.append({"type": "tool_result", "who": who, "name": m.name, "summary": summary})
    return events


def trace_path(building_id: str | None):
    return WORK_DIR / (building_id or "_all") / "trace.json"


def stream_agent(goal: str, building_id: str | None = None, limit_s: int = TRACE_LIMIT_S):
    """Yield events from a live run and save them, so the same run can be replayed later."""
    import time
    from datetime import datetime, timezone

    _check_building(building_id)
    started = time.time()
    events = []
    tokens = {"input": 0, "output": 0}
    prompt = goal if not building_id else f"{goal}\nFocus on building {building_id}."
    for namespace, update in build_agent().stream({"messages": [{"role": "user", "content": prompt}]},
                                                  stream_mode="updates", subgraphs=True):
        for node_update in (update or {}).values():
            if not isinstance(node_update, dict):
                continue
            for m in _messages(node_update):         # count tokens, so we know what a run costs
                usage = getattr(m, "usage_metadata", None) or {}
                tokens["input"] += usage.get("input_tokens", 0)
                tokens["output"] += usage.get("output_tokens", 0)
            for event in _events_from_update(namespace, node_update):
                events.append(event)
                yield event
        if time.time() - started > limit_s:
            yield {"type": "timeout", "seconds": limit_s}
            return

    final = next((e["text"] for e in reversed(events) if e["type"] == "message" and e["who"] == "orchestrator"), "")
    if building_id and final:
        # The answer the user sees is checked by code, not by a model: same verifier, on the final text.
        check = verify(final, load_result(building_id) or {})
        event = {"type": "final_check", "status": check["status"], "summary": check["summary"],
                 "rejected": check["values"]["rejected"]}
        events.append(event)
        yield event

    now = datetime.now(timezone.utc)
    record = {"recorded_at": now.isoformat(timespec="seconds"), "model": str(os.environ.get("LIGHTS_ON_MODEL")),
              "goal": prompt, "tokens": tokens, "complete": is_complete(events), "events": events}
    path = trace_path(building_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    (path.parent / f"trace_{now:%Y%m%d-%H%M%S}.json").write_text(json.dumps(record, indent=1))   # every run is kept
    if record["complete"] or not path.exists():
        path.write_text(json.dumps(record, indent=1))      # the replay only gets replaced by a complete run
    yield {"type": "done", "seconds": round(time.time() - started, 1), "complete": record["complete"]}


def is_complete(events: list[dict]) -> bool:
    """A run worth replaying: all four sub-agents were used and the final answer passed the check in code
    (or, for a run without one building, the verifier passed the draft)."""
    delegated = {e.get("to") for e in events if e["type"] == "delegate"}
    final = [e for e in events if e["type"] == "final_check"]
    if final:
        checked = final[-1]["status"] == "success"
    else:
        checked = any(e["type"] == "tool_result" and e["name"] == "verify_numbers" and e["summary"].startswith("success")
                      for e in events)
    return {"screener", "analyst", "writer", "verifier"} <= delegated and checked


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
