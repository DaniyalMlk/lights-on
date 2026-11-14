"""The agent never sees real CoStar buildings unless COSTAR_LLM_OK=yes. No API key needed."""
import json

import pytest

from backend import agent as A
from backend import main

REAL = {"999": {"id": "999", "name": "Real tower", "stories": 30, "vacancy": 0.5}}


@pytest.fixture
def real_data_loaded(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "BUILDINGS", REAL)
    monkeypatch.setattr(A, "WORK_DIR", tmp_path)
    monkeypatch.delenv("COSTAR_LLM_OK", raising=False)


def test_without_costars_ok_the_agent_only_sees_samples(real_data_loaded):
    ids = set(A._buildings())
    assert ids and "999" not in ids and all(i.startswith("SAMPLE") for i in ids)
    assert "999" not in json.loads(A.find_candidates.invoke({"min_vacancy": 0}))["summary"]


def test_real_buildings_are_refused_before_any_model_call(real_data_loaded):
    with pytest.raises(PermissionError):
        A.run_agent("anything", "999")
    with pytest.raises(PermissionError):
        next(A.stream_agent("anything", "999"))
    assert json.loads(A.verify_numbers.invoke({"building_id": "999", "text": "12 homes"}))["status"] == "error"


def test_file_tools_can_open_only_sample_folders(real_data_loaded):
    routes = A._work_routes()
    assert "/work/" not in routes and "/work/999/" not in routes
    assert all(route.startswith("/work/SAMPLE") for route in routes)


def test_costars_ok_opens_the_real_list(real_data_loaded, monkeypatch):
    monkeypatch.setenv("COSTAR_LLM_OK", "yes")
    assert A._buildings() is REAL
    assert "/work/" in A._work_routes()


def test_max_rpm_paces_the_model(monkeypatch):
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    monkeypatch.setattr(A, "init_chat_model", lambda name, **kw: GenericFakeChatModel(messages=iter([]), **kw))
    monkeypatch.setenv("LIGHTS_ON_MODEL", "google_genai:some-model")
    monkeypatch.setenv("LIGHTS_ON_MAX_RPM", "12")
    limiter = A._model().rate_limiter
    assert limiter is not None and abs(limiter.requests_per_second - 0.2) < 1e-9
    monkeypatch.delenv("LIGHTS_ON_MAX_RPM")
    assert A._model() == "google_genai:some-model"               # no pacing: the plain string, as before
