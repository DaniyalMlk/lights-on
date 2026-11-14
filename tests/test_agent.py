"""Smoke test: the agent graph builds and a scripted model can call our tools. No API key needed."""
import json
from pathlib import Path

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from backend import agent as A
from backend import pipeline

SAMPLE_FILE = Path(__file__).resolve().parent.parent / "backend" / "sample_buildings.json"
SAMPLES = {b["id"]: b for b in json.loads(SAMPLE_FILE.read_text())["buildings"]}


@pytest.fixture(autouse=True)
def sample_buildings(monkeypatch, tmp_path):
    """Always test on the synthetic samples, even on a laptop that has real CoStar data in data/."""
    monkeypatch.setattr(A, "_buildings", lambda: SAMPLES)
    monkeypatch.setattr(A, "WORK_DIR", tmp_path)
    monkeypatch.setattr(pipeline, "WORK_DIR", tmp_path)


class ScriptedModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def test_orchestrator_delegates_and_the_analyst_runs_the_tool(monkeypatch, tmp_path):
    """The orchestrator has no analysis tools: it hands SAMPLE-1 to the analyst, who calls analyze_building."""
    script = iter([
        AIMessage(content="", tool_calls=[{"name": "task", "id": "call_1", "args": {
            "subagent_type": "analyst", "description": "Analyze SAMPLE-1"}}]),                        # orchestrator
        AIMessage(content="", tool_calls=[{"name": "analyze_building", "args": {"building_id": "SAMPLE-1"},
                                           "id": "call_2"}]),                                          # analyst
        AIMessage(content="Analyst: 190 homes."),                                                      # analyst
        AIMessage(content="Done."),                                                                    # orchestrator
    ])
    monkeypatch.setattr(A.os, "environ", {"LIGHTS_ON_MODEL": ScriptedModel(messages=script)})
    out = A.run_agent("Analyze SAMPLE-1")
    tool_msgs = [m for m in out["trace"] if m["type"] == "tool"]
    assert tool_msgs and "Analyst: 190 homes." in tool_msgs[0]["content"]
    assert (tmp_path / "SAMPLE-1" / "geometry.json").exists()          # the analyst's tool really ran
    assert out["answer"] == "Done."


def test_orchestrator_has_no_analysis_tools(monkeypatch):
    monkeypatch.setattr(A.os, "environ", {"LIGHTS_ON_MODEL": ScriptedModel(messages=iter([]))})
    names = {n for n in A.build_agent().get_graph().nodes}
    assert "tools" in names                                             # deepagents' own tools (todos, files, task)
    assert "analyze_building" not in str(A.build_agent().nodes["tools"].bound.tools_by_name)


def test_stream_records_a_trace_and_replays_it(monkeypatch, tmp_path):
    script = iter([
        AIMessage(content="", tool_calls=[{"name": "write_todos", "id": "c0",
                                           "args": {"todos": [{"content": "Analyze SAMPLE-2", "status": "in_progress"}]}}]),
        AIMessage(content="", tool_calls=[{"name": "analyze_building", "args": {"building_id": "SAMPLE-2"}, "id": "c1"}]),
        AIMessage(content="SAMPLE-2 needs a closer look."),
    ])
    monkeypatch.setattr(A.os, "environ", {"LIGHTS_ON_MODEL": ScriptedModel(messages=script)})
    monkeypatch.setattr(A, "WORK_DIR", tmp_path)

    live = list(A.stream_agent("Analyze", "SAMPLE-2"))
    kinds = [e["type"] for e in live]
    assert kinds[0] == "plan" and "tool_result" in kinds and kinds[-1] == "done"

    replay = list(A.replay_trace("SAMPLE-2"))
    assert replay[0]["type"] == "replay" and replay[0]["recorded_at"]
    assert [e["type"] for e in replay[1:-1]] == kinds[:-1]


def test_replay_without_recording_says_so(monkeypatch, tmp_path):
    monkeypatch.setattr(A, "WORK_DIR", tmp_path)
    assert list(A.replay_trace("NOPE"))[0]["type"] == "error"


def test_text_from_a_list_of_parts():
    """Gemini 3 sends content as parts with a signature; the trace should keep only the words."""
    parts = [{"type": "text", "text": "Memo: ", "extras": {"signature": "abc"}}, {"type": "text", "text": "12 homes."}]
    assert A._text(parts) == "Memo: 12 homes."
    assert A._text("plain") == "plain"
    events = A._events_from_update((), {"messages": [AIMessage(content=parts)]})
    assert events == [{"type": "message", "who": "orchestrator", "text": "Memo: 12 homes."}]


def test_verifier_error_without_rejected_numbers_does_not_crash_the_trace():
    from langchain_core.messages import ToolMessage
    unknown = ToolMessage(content=json.dumps({"status": "error", "summary": "unknown building Sample A"}),
                          name="verify_numbers", tool_call_id="c1")
    events = A._events_from_update((), {"messages": [unknown]})
    assert [e["type"] for e in events] == ["tool_result"]
    rejected = ToolMessage(content=json.dumps({"status": "error", "summary": "1 rejected",
                                               "values": {"rejected": [{"text": "$9"}]}}),
                           name="verify_numbers", tool_call_id="c2")
    assert A._events_from_update((), {"messages": [rejected]})[0] == {"type": "verifier_rejection", "rejected": [{"text": "$9"}]}
