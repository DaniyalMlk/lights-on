"""Record one live agent run per building, so the demo can replay it if the model or the wifi fails.

Usage:  python -m scripts.record_traces [BUILDING_ID ...]     (default: every building)

Needs LIGHTS_ON_MODEL in .env. Each run is saved to work/<id>/trace.json (git-ignored);
the Agent tab replays it and labels it as a replay with the time it was recorded.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from backend.agent import stream_agent        # noqa: E402  (needs the .env loaded first)
from backend.main import BUILDINGS, AgentRequest  # noqa: E402

if not os.environ.get("LIGHTS_ON_MODEL"):
    sys.exit("Set LIGHTS_ON_MODEL in .env first (see .env.example).")

goal = AgentRequest().goal          # the same question the UI asks
ids = sys.argv[1:] or list(BUILDINGS)
for building_id in ids:
    print(f"== {building_id}")
    for event in stream_agent(goal, building_id):
        if event["type"] == "tool_call":
            print(f"   {event['who']}: {event['name']}")
        elif event["type"] == "delegate":
            print(f"   -> {event['to']}")
        elif event["type"] in ("timeout", "done"):
            print(f"   {event['type']} ({event.get('seconds')} s)")
