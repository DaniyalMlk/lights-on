import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { verifiedConversion } from "./calibration.js";

// Tag colors in the tour, by how we know the fact
const colors = {measured:[1,.78,.25], checked:[.35,.85,.55], assumed:[.65,.68,.72], estimate:[1,1,1]};
let sdkLoad;
function loadSdk(key) {
  if (!sdkLoad) sdkLoad = new Promise((resolve,reject) => {
    const script = document.createElement("script");
    script.src = "https://static.matterport.com/showcase-sdk/bootstrap/3.1.0-0-g1cd7e0997a/sdk.js?applicationKey=" + encodeURIComponent(key);
    script.onload = () => resolve(window.MP_SDK);
    script.onerror = () => { sdkLoad = null; script.remove(); reject(new Error()); };
    document.head.append(script);
  });
  return sdkLoad;
}

// Three ways to look at a scan. The 3D model turns, zooms and pans freely, like the city map. Whoever owns
// a scan can switch the 3D model and floor plan off (these buildings' scans have them off): then we only walk.
const VIEWS = [["DOLLHOUSE","3D model"],["INSIDE","Walk inside"],["FLOORPLAN","Floor plan"]];
// Walking with the arrow keys or the buttons: forward and back go to the next scan position, left and right turn
const STEPS = [["ArrowLeft","Turn left","M12 5l-5 5 5 5"],["ArrowUp","Walk forward","M5 12l5-5 5 5"],
               ["ArrowDown","Walk back","M5 8l5 5 5-5"],["ArrowRight","Turn right","M8 5l5 5-5 5"]];

// The Matterport tour, opened large over the map, with our labels placed inside it as tags.
// focus = {index, n}: fly the tour to that label (n changes on every click, so the same label can be clicked twice).
// A scan without labels (scan.labels is empty) opens the same way, just with nothing placed in it.
function Tour({scan, sdkKey, focus, onPlaced, onClose}) {
  const frame = useRef(null);
  const tags = useRef(null);                       // {sdk, ids} once the labels are in the tour
  const tour = useRef(null);                       // the connected SDK, for the view buttons
  const [status,setStatus] = useState("Opening the 3D tour…");
  const [view,setView] = useState(null);           // which of VIEWS the tour is showing, once it plays
  const [free,setFree] = useState(false);          // true when this scan lets us leave the walk for the 3D model
  function show(name) {
    const sdk = tour.current;
    if (sdk) sdk.Mode.moveTo(sdk.Mode.Mode[name]).catch(() => {});
  }
  function step(key) {
    const sdk = tour.current;
    if (!sdk) return;
    const way = {ArrowUp: sdk.Camera.Direction.FORWARD, ArrowDown: sdk.Camera.Direction.BACK}[key];
    // No scan position that way, or a move still running: the tour stays where it is
    if (way) sdk.Camera.moveInDirection(way).catch(() => {});
    else sdk.Camera.rotate(key === "ArrowLeft" ? -40 : 40, 0, {speed: 3}).catch(() => {});
  }
  // Start outside if the scan allows it: every label is in view there and the model turns freely
  async function startOutside(sdk) {
    try { await sdk.Mode.moveTo(sdk.Mode.Mode.DOLLHOUSE); setFree(true); } catch { /* walk only */ }
  }
  useEffect(() => {
    let active = true;
    // The tour can take a while to load on conference wifi: say so, but keep waiting
    const slow = setTimeout(() => { if (active && !tags.current) setStatus("Still loading the tour. The floor labels are in the panel meanwhile."); }, 20000);
    async function connect() {
      try {
        const api = await loadSdk(sdkKey);
        if (!active) return;
        const sdk = await api.connect(frame.current,sdkKey);
        // Tags can only be added once the tour is playing
        await sdk.App.state.waitUntil(state => state.phase === sdk.App.Phase.PLAYING);
        if (!active) return;
        tour.current = sdk;
        sdk.Mode.current.subscribe(mode => { if (active) setView(VIEWS.find(([name]) => sdk.Mode.Mode[name] === mode)?.[0] ?? null); });
        if (!scan.labels.length) {
          setStatus("A scan filed under this building. It is not a measured full floor, so it has no labels.");
          startOutside(sdk);
          return;
        }
        const model = await sdk.Model.getData();
        const sweeps = new Map(model.sweeps.map(s => [s.uuid ?? s.id,s.position]));
        const ids = await sdk.Sweep.Conversion.createIdMap();
        for (const [current, legacy] of Object.entries(ids)) {
          const position = sweeps.get(current) ?? sweeps.get(legacy);
          if (position) { sweeps.set(current,position); sweeps.set(legacy,position); }
        }
        // Our positions are in the Model API frame; the tour uses the SDK frame. We only place labels if the
        // conversion puts every saved scan position on top of the tour's own (within 10 cm).
        const place = verifiedConversion(scan.panos ?? [], sweeps,
          p => sdk.Conversion.basisChange(p, sdk.Conversion.TransformType.Coordinates.TO_SDK));
        if (!active) return;
        if (!place) { setStatus("3D placement unavailable: scan positions did not match. The floor labels are in the panel."); return; }
        const placed = await sdk.Mattertag.add(scan.labels.map(label => {
          const [r,g,b] = colors[label.kind];
          return {label: label.kind + " · " + label.title, description: label.detail,
            anchorPosition:place(label.position),stemVector:{x:0,y:0.15,z:0},color:{r,g,b}};
        }));
        if (!active) return;
        tags.current = {sdk, ids: placed};
        setStatus(`${placed.length} labels placed by matching ${scan.panos?.length ?? 0} scan positions. Click one in the panel to fly to it.`);
        onPlaced(true);
        startOutside(sdk);
      } catch {
        if (active) setStatus(scan.labels.length ? "3D placement unavailable. The floor labels are in the panel." : "The 3D tour did not load.");
      } finally { clearTimeout(slow); }
    }
    const node = frame.current;
    node.addEventListener("load",connect);
    return () => { active=false; tour.current=null; clearTimeout(slow); node.removeEventListener("load",connect); onPlaced(false); };
  }, [scan,sdkKey]);

  useEffect(() => {
    if (!focus || !tags.current) return;
    const {sdk, ids} = tags.current;
    try { sdk.Mattertag.navigateToTag(ids[focus.index], sdk.Mattertag.Transition.FLY).catch(() => {}); } catch { /* tour closed */ }
  }, [focus]);

  // The arrow keys walk the tour even while the keyboard is on our page (after clicking a label, say).
  // Sliders keep their own arrow keys.
  useEffect(() => {
    function onKey(e) {
      if (!tour.current || view !== "INSIDE" || !STEPS.some(([key]) => key === e.key) || e.target.closest?.("input, textarea, select")) return;
      e.preventDefault();
      step(e.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // title=0 and brand=0 keep Matterport's own caption and About card (which name the floor area) off the screen
  const query = new URLSearchParams({m:scan.model_id,play:"1",title:"0",brand:"0",qs:"1",applicationKey:sdkKey});
  const root = document.getElementById("tour-root");
  if (!root) return null;
  return createPortal(<div className="tour">
    <iframe ref={frame} title="Matterport floor tour" allow="fullscreen; xr-spatial-tracking" allowFullScreen src={"https://my.matterport.com/show/?"+query}/>
    <div className="tour-bar">
      <div className="tour-top">
        {free && view && <div className="segmented" role="group" aria-label="How to look at the scan">{VIEWS.map(([name,label]) =>
          <button key={name} aria-pressed={view === name} onClick={() => show(name)}>{label}</button>)}</div>}
        <button className="pill" onClick={onClose}>Close tour<span className="pill-icon" aria-hidden="true">×</span></button>
      </div>
      <div className="tour-foot">
        {view === "INSIDE" && <div className="tour-steps" role="group" aria-label="Walk through the scan">{STEPS.map(([key,label,path]) =>
          <button key={key} onClick={() => step(key)} aria-label={label} title={label}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d={path}/></svg></button>)}</div>}
        {view && <p className="fine">{view === "INSIDE" ? "Arrow keys walk and turn · click the floor to jump there · drag to look around"
          : "Drag to turn · right-drag to move · scroll to zoom"}</p>}
        <p role="status">{status}</p>
      </div>
    </div>
  </div>, root);
}

// focus = {index, n} lives in App, because the same label can be picked in the panel or on the 3D tower.
// onMarks tells the map where each label sits on the floor plate, so it can stand a beacon there.
export default function ScanPanel({building, focus, onFocus, onMarks}) {
  const [scan,setScan] = useState(null);
  const [key,setKey] = useState("");
  const [open,setOpen] = useState(false);
  const [placed,setPlaced] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/buildings/"+encodeURIComponent(building.id)+"/labels",{signal:controller.signal});
        if (!response.ok) throw new Error();
        const record = await response.json();
        setScan(record);
        onMarks(record.labels.map(l => ({kind:l.kind, x:l.plan?.x, y:l.plan?.y})));
        if (record.model_id || record.tour_model_id) {
          const config = await fetch("/api/config",{signal:controller.signal});
          if (config.ok) setKey((await config.json()).matterport_sdk_key || "");
        }
      } catch { if (!controller.signal.aborted) setScan(current => current || {labels:[],reason:"Scan data unavailable."}); }
    }
    read();
    return () => controller.abort();
  },[building.id]);
  // The label picked last scrolls into view (it may have been picked on the tower, with the list off screen)
  const list = useRef(null);
  useEffect(() => {
    if (focus) list.current?.children[focus.index]?.scrollIntoView({block:"nearest", behavior:"smooth"});
  },[focus,scan]);

  // No measured floor, but a scan filed under this building: offer it as a plain walk-through
  if (scan && !scan.labels.length && scan.tour_model_id && key) return <section className="block scan">
    <header className="scan-head">
      <div>
        <h3>3D tour</h3>
        <p className="fine">{scan.tour_full_floor ? "A scanned floor of this building. It is not saved for measuring yet, so nothing is labeled."
          : "A scan of part of a floor: enough to look around, too small to measure the floor from."}</p>
      </div>
      <button className="pill" onClick={() => setOpen(!open)}>
        {open ? "Close tour" : "Open 3D tour"}<span className="pill-icon" aria-hidden="true">{open ? "×" : "↗"}</span></button>
    </header>
    {open && <Tour scan={{model_id:scan.tour_model_id, labels:[], panos:[]}} sdkKey={key} focus={null} onPlaced={() => {}} onClose={() => setOpen(false)}/>}
  </section>;
  if (!scan?.labels?.length) return null;          // no scan of this building: the geometry line above already says so
  const canFly = open && placed;
  return <section className="block scan">
    <header className="scan-head">
      <div>
        <h3>Labeled in 3D, automatically</h3>
        <p className="fine">{scan.labels.length} labels stand on the tower's floor and inside the tour. Each says how we know it.</p>
      </div>
      {key && <button className="pill" onClick={() => setOpen(!open)}>
        {open ? "Close tour" : "Open 3D tour"}<span className="pill-icon" aria-hidden="true">{open ? "×" : "↗"}</span></button>}
    </header>
    {!key && <p className="fine">Tour unavailable. The saved floor labels are below.</p>}
    {open && <Tour scan={scan} sdkKey={key} focus={focus} onPlaced={setPlaced} onClose={() => setOpen(false)}/>}
    <ul className="scan-labels" ref={list}>{scan.labels.map((l,i) => <li key={i}>
      <button className={"scan-label "+l.kind} aria-expanded={focus?.index === i}
              title={canFly ? "Fly to this label in the tour" : "Show how we know"}
              onClick={() => onFocus(i)}>
        <span className="kind">{l.kind}</span><strong>{l.title}</strong><small>{l.detail}</small></button></li>)}</ul>
  </section>;
}
