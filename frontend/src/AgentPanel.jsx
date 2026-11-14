import { useEffect, useRef, useState } from "react";
import { modelName, readable, when } from "./format.js";

// The raw event stream, grouped into what a reader follows: a plan, one step per sub-agent, a final check, the answer
function toSteps(events) {
  const out = { plan: null, steps: [], final: null, answer: null, notices: [] };
  let step = null;
  events.forEach((e, index) => {
    switch (e.type) {
      case "plan": out.plan = e.todos; break;
      case "delegate":
        step = { to: e.to, task: e.task, tools: [], reply: null, drafts: [], rejection: null, index };
        out.steps.push(step);
        break;
      case "tool_call":
        if (e.who !== "sub-agent" || !step) break;
        if (e.name === "verify_numbers" && e.args?.text) step.drafts.push(e.args.text);
        step.tools.push({ name: e.name, summary: null });
        break;
      case "tool_result":
        if (e.who === "sub-agent" && step) {
          const open = [...step.tools].reverse().find(t => t.name === e.name && t.summary == null);
          if (open) open.summary = e.summary; else step.tools.push({ name: e.name, summary: e.summary });
        }
        break;
      case "message":
        if (e.who === "sub-agent" && step) step.reply = e.text; else out.answer = e.text;
        break;
      case "verifier_rejection": if (step) step.rejection = e; break;
      case "final_check": out.final = e; break;
      case "replay": case "fallback": case "error": case "done": out.notices.push(e); break;
      default: break;
    }
  });
  return out;
}

function Clamp({ text, lines = 6 }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420;
  return <div className={`clamp ${long && !open ? "closed" : ""}`} style={{ "--lines": lines }}>
    <p>{text}</p>
    {long && <button className="text-button" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show all"}</button>}
  </div>;
}

function Run({ events, names }) {
  const r = toSteps(events);
  const say = (text) => readable(text, names);
  const toolCalls = r.steps.reduce((n, s) => n + s.tools.length, 0);
  return <>
    <ul className="agent-summary" aria-label="Run summary">
      <li><b>{r.steps.length}</b><span>sub-agent steps</span></li>
      <li><b>{toolCalls}</b><span>tool calls</span></li>
      {r.final && <li data-ok={r.final.status === "success"}><b>{r.final.status === "success" ? "Passed" : "Failed"}</b>
        <span>final check in code</span></li>}
    </ul>
    {r.plan && <section className="block plan">
      <h3>Plan</h3>
      <ol>{r.plan.map((t, i) => <li key={i} data-status={t.status}>{say(t.content)}</li>)}</ol>
    </section>}

    <ol className="timeline">{r.steps.map((s, i) => (
      <li key={i} className="step" style={{ "--i": i }}>
        <header><b>{s.to}</b></header>
        <p className="task">{say(s.task)}</p>
        {s.tools.length > 0 && <ul className="tools">{s.tools.map((t, j) =>
          <li key={j} data-bad={t.summary?.startsWith("error") || undefined}><code>{t.name}</code>
            {t.summary && <span>{say(t.summary)}</span>}</li>)}</ul>}
        {s.rejection && <div className="rejected"><b>Verifier rejected</b>{s.rejection.rejected.map((x, k) =>
          <p key={k}>{say(x.text)} · {x.reason}{x.fix ? ` · ${x.fix}` : ""}</p>)}</div>}
        {s.drafts.length > 1 && <p className="fine">Draft resubmitted after a rejection.</p>}
        {s.reply && <Clamp text={say(s.reply)} lines={3} />}
      </li>))}
    </ol>

    {r.final && <section className={`block final ${r.final.status === "success" ? "ok" : "bad"}`}>
      <h3>Final check in code</h3>
      <p><b>{r.final.status === "success" ? "Passed" : "Failed"}</b> · {r.final.summary}</p>
      {r.final.rejected?.map((x, i) => <p key={i} className="fine">{say(x.text)} · {x.reason}</p>)}
    </section>}

    {r.answer && <section className="block answer"><h3>Answer</h3><Clamp text={say(r.answer)} lines={12} /></section>}
    {r.notices.map((e, i) => <p key={i} className="fine">{e.type === "done" ? `Done${e.seconds ? ` in ${e.seconds}s` : ""}.`
      : e.type === "replay" ? `Recorded run from ${when(e.recorded_at)} (${modelName(e.model)})` : say(e.reason || e.text)}</p>)}
  </>;
}

export default function AgentPanel({ buildingId, names }) {
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

  const live = events.length > 0 || running;
  return (
    <article className="panel agent">
      <header>
        <p className="eyebrow">Agent</p>
        <h2>How the memo was made</h2>
        <p className="lede">Every number in the memo must trace back to a saved tool output. A final check in code
          repeats that test.</p>
      </header>
      {notice && <p role="status" className="notice">{notice} {record ? "Showing the saved recording." : "Recording unavailable."}</p>}

      {!live && (record ? <>
          <p className="recorded">Recorded run from {when(record.recorded_at)} · {modelName(record.model)}
            {record.tokens?.input ? ` · ${record.tokens.input.toLocaleString()} tokens in` : ""}</p>
          <Run events={record.events} names={names} />
        </> :
        <p className="muted">{record === undefined ? "Loading the recording…" : "No recorded run for this building yet."}</p>)}

      {live && <><p className="recorded live">{running ? "Live run in progress…" : "Live run"}</p><Run events={events} names={names} /></>}

      <div className="run-live">
        <button className="secondary" onClick={run} disabled={running || !buildingId}>{running ? "Running…" : "Run live"}</button>
        <span className="fine">Uses the free Gemini quota; the recording stays if the run fails.</span>
      </div>
    </article>
  );
}
