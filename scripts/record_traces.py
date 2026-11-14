"""Record one live agent run per building, so the demo can replay it if the model or the wifi fails.

Usage:  python -m scripts.record_traces [BUILDING_ID ...]     (default: every building)

Needs LIGHTS_ON_MODEL in .env. Each run is saved to work/<id>/trace.json (git-ignored);
the Agent tab replays it and labels it as a replay with the time it was recorded.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv()

import json  # noqa: E402

from backend.agent import _buildings, real_data_allowed, stream_agent, trace_path   # noqa: E402  (needs the .env loaded first)
from backend.main import AgentRequest  # noqa: E402

if not os.environ.get("LIGHTS_ON_MODEL"):
    sys.exit("Set LIGHTS_ON_MODEL in .env first (see .env.example).")

goal = AgentRequest().goal          # the same question the UI asks
ids = sys.argv[1:] or list(_buildings())     # the samples, unless CoStar cleared real data
if not real_data_allowed():
    print("Sample buildings only: CoStar hasn't cleared sending their data to a hosted model.")
for building_id in ids:
    print(f"== {building_id}")
    for event in stream_agent(goal, building_id, limit_s=600):   # recording can take longer than the live demo
        if event["type"] == "tool_call":
            print(f"   {event['who']}: {event['name']}")
        elif event["type"] == "delegate":
            print(f"   -> {event['to']}")
        elif event["type"] == "timeout":
            print(f"   timeout ({event.get('seconds')} s)")
        elif event["type"] == "done":
            verdict = "complete, saved as the replay" if event.get("complete") else \
                "INCOMPLETE (a step was skipped or the verifier didn't pass): kept the previous replay"
            print(f"   done ({event.get('seconds')} s): {verdict}")
    runs = sorted(trace_path(building_id).parent.glob("trace_*.json"))
    if runs:
        tokens = json.loads(runs[-1].read_text()).get("tokens", {})
        saved = runs[-1]
        print(f"   tokens: {tokens.get('input', 0):,} in, {tokens.get('output', 0):,} out -> {saved}")
