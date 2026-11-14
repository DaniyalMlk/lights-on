"""Smoke test: the agent graph builds and a scripted model can call our tools. No API key needed."""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from backend import agent as A


class ScriptedModel(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def test_agent_calls_analyze_building(monkeypatch):
    script = iter([
        AIMessage(content="", tool_calls=[{"name": "analyze_building", "args": {"building_id": "SAMPLE-1"}, "id": "call_1"}]),
        AIMessage(content="Done."),
    ])
    monkeypatch.setenv("LIGHTS_ON_MODEL", "unused")
    monkeypatch.setattr(A.os, "environ", {"LIGHTS_ON_MODEL": ScriptedModel(messages=script)})
    out = A.run_agent("Analyze SAMPLE-1")
    tool_msgs = [m for m in out["trace"] if m["type"] == "tool"]
    assert tool_msgs and '"status": "success"' in tool_msgs[0]["content"]
    assert out["answer"] == "Done."


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
