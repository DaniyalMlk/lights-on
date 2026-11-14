import { useEffect, useRef, useState } from "react";

function EventRow({ e }) {
  switch (e.type) {
    case "plan":
      return (
        <div className="event plan">
          <b>Plan</b>
          <ul>{e.todos.map((t, i) => <li key={i} className={t.status}>{t.content}</li>)}</ul>
        </div>
      );
    case "delegate":
      return <div className="event">→ <b>{e.to}</b>: {e.task}</div>;
    case "tool_call":
      return <div className="event muted">{e.who} calls <code>{e.name}</code></div>;
    case "tool_result":
      return <div className={`event ${e.summary.startsWith("error") ? "bad" : ""}`}><code>{e.name}</code> {e.summary}</div>;
    case "message":
      return <div className="event message">{e.text}</div>;
    case "replay":
      return <div className="event notice">Recorded run from {e.recorded_at} (model: {e.model})</div>;
    case "fallback":
      return <div className="event notice">Live run unavailable ({e.reason}).</div>;
    case "error":
      return <div className="event bad">{e.text}</div>;
    case "done":
      return <div className="event muted">Done{e.seconds ? ` in ${e.seconds}s` : ""}.</div>;
    default:
      return null;
  }
}

export default function AgentPanel({ buildingId }) {
  const [events, setEvents] = useState([]);
  const [running, setRunning] = useState(false);
  const source = useRef(null);

  useEffect(() => () => source.current?.close(), []);

  function run() {
    source.current?.close();
    setEvents([]);
    setRunning(true);
    const query = buildingId ? `?building_id=${encodeURIComponent(buildingId)}` : "";
    source.current = new EventSource(`/api/agent/stream${query}`);
    source.current.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      setEvents((prev) => [...prev, e]);
      if (e.type === "done" || e.type === "error") {
        source.current.close();
        setRunning(false);
      }
    };
    source.current.onerror = () => {
      source.current.close();
      setRunning(false);
    };
  }

  return (
    <div className="panel">
      <p className="muted">
        The agent plans the job, hands it to the screener, analyst, writer and verifier, and every number it writes
        is checked against the saved tool outputs.
      </p>
      <button className="primary" onClick={run} disabled={running}>
        {running ? "Running…" : buildingId ? `Run on ${buildingId}` : "Run on downtown"}
      </button>
      <div className="trace">{events.map((e, i) => <EventRow key={i} e={e} />)}</div>
    </div>
  );
}
