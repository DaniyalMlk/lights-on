import { useEffect, useRef, useState } from "react";

function EventRow({ e, afterRejection = false }) {
  switch (e.type) {
    case "verifier_rejection":
      return <section className="event rejection"><strong>Verifier rejected</strong>{e.rejected.map((r,i) =>
        <p key={i}>{r.text} · {r.reason}<br/>Verifier instruction: {r.fix}</p>)}</section>;
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
      if (e.name === "verify_numbers" && e.args?.text)
        return <details className="event"><summary>{afterRejection ? "Draft resubmitted after rejection" : "Draft submitted to verifier"}</summary>{e.args.text}</details>;
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
  const [record, setRecord] = useState(undefined);
  useEffect(() => {
    if (!buildingId) return;
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(buildingId)}/recording`, {signal: controller.signal})
      .then(r => r.ok ? r.json() : null).then(setRecord)
      .catch(() => { if (!controller.signal.aborted) setRecord(null); });
    return () => controller.abort();
  }, [buildingId]);
  const [running, setRunning] = useState(false);
  const source = useRef(null);

  const timer = useRef(null);
  const [notice, setNotice] = useState("");
  useEffect(() => () => { clearTimeout(timer.current); source.current?.close(); }, []);
  function fallback(reason) {
    clearTimeout(timer.current);
    source.current?.close();
    setRunning(false);
    setEvents([]);
    setNotice(reason);
  }

  function run() {
    source.current?.close();
    setEvents([]);
    setRunning(true);
    setNotice("");
    timer.current = setTimeout(() => fallback("Live run exceeded 90 seconds."), 90000);
    const query = buildingId ? `?building_id=${encodeURIComponent(buildingId)}` : "";
    source.current = new EventSource(`/api/agent/stream${query}`);
    source.current.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (["fallback","timeout","error"].includes(e.type)) {
        fallback("Live run unavailable.");
        return;
      }
      setEvents((prev) => [...prev, e]);
      if (e.type === "done" || e.type === "error") {
        clearTimeout(timer.current);
        source.current.close();
        setRunning(false);
      }
    };
    source.current.onerror = () => fallback("Connection interrupted.");
  }

  const rejectionIndex = record?.events.findIndex(row => row.type === "verifier_rejection") ?? -1;
  return (
    <div className="panel">
      <p className="eyebrow">Analysis workflow</p><h2>Agent run</h2>
      <p className="muted">
        The agent plans the job, hands it to the screener, analyst, writer and verifier, and every number it writes
        is checked against the saved tool outputs.
      </p>
      {notice && <p role="status">{notice} {record ? "Showing the saved recording." : "Recording unavailable."}</p>}
      {buildingId && !events.length && !running && (record ?
        <><p className="verdict">Recorded run from {record.recorded_at} · {record.model}</p>
          <div className="trace">{record.events.map((e,i) => <EventRow key={i} e={e} afterRejection={rejectionIndex >= 0 && i > rejectionIndex}/>)}</div></> :
        <p>{record === undefined ? "Loading recording…" : "No recorded run available for this building."}</p>)}
      <button className="primary" onClick={run} disabled={running || !buildingId}>
        {running ? "Running…" : "Run live"}
      </button>
      <div className="trace">{events.map((e, i) => <EventRow key={i} e={e} />)}</div>
    </div>
  );
}
