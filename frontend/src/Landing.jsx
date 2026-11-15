import { lazy, Suspense, useEffect, useRef, useState } from "react";
import CityDrawing from "./CityDrawing.jsx";
import { INCENTIVE_MAX, breakEven, firstStep, stepWords } from "./incentive.js";
import { screenBuildings } from "./screenBuildings.js";
import "./landing.css";

// The introduction at /about: what Lights On does, shown on the same data as the map.
// Like the map, it shows only our own results: no rents, vacancy, prices or dollar totals of a building.

const PreviewMap = lazy(() => import("./CityMap.jsx"));
const PREVIEW_INCENTIVE = 165;   // $/SF, hypothetical: the map at the top shows which towers light up at this setting
const VACANCY_GATE = 35;         // percent, the map's own starting filter
const buildingUrl = (id) => `/?demo=${encodeURIComponent(id)}`;
const plateUrl = (id) => `/api/buildings/${encodeURIComponent(id)}/plate.svg?depth=36`;
const paysFrom = (p) => { const step = firstStep(breakEven(p)); return step == null ? "No price to compare" : stepWords(step); };

const STEPS = [
  ["Find a building", "Pick an office building on the downtown Houston map. A vacancy filter decides which ones are in play."],
  ["See the homes that fit", "Bedrooms need windows. We lay out the apartments that fit within 30, 36 and 42 ft of one."],
  ["Compare two", "Put two buildings side by side: homes, daylight, and the hypothetical incentive at which each starts to pay for itself."],
];
const ASSUMPTIONS = [
  ["Building data", "CoStar records supply the building and market inputs. The floor plate comes from a Matterport scan of a full floor where we have one, else a Vexcel outline that matches the typical floor, else a square stand-in that the app labels as one."],
  ["Floor depth", "The 30, 36 and 42 ft layouts test how much of the floor can hold apartments near a window. Home counts are indicative."],
  ["Does it pay", "Value as housing minus conversion cost and developer margin gives an indicative residual, not an offer price. The incentive is hypothetical: a building may be eligible, verify with the program."],
];

function Button({ href, children }) {
  return <a className="lp-button" href={href}>{children} <span aria-hidden="true">↗</span></a>;
}

export default function Landing() {
  const [preview, setPreview] = useState(null);       // every building with its verdict at the preview setting
  const [pair, setPair] = useState([]);               // the example building and one to compare it with
  const [detail, setDetail] = useState(null);         // the example building's full analysis
  const [mapOn, setMapOn] = useState(true);
  const page = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const get = async (url) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error();
      return response.json();
    };
    (async () => {
      const collection = await get("/api/buildings");
      setPreview(screenBuildings(collection, PREVIEW_INCENTIVE, VACANCY_GATE));
      const towers = collection.features.map(f => f.properties).filter(p => !p.map_only);
      const priced = towers.filter(p => breakEven(p) !== null).sort((a, b) => breakEven(a) - breakEven(b));
      // The example is 800 Bell when the data has it (its floor is scanned), else the building closest to paying
      const first = priced.find(p => p.name === "800 Bell") ?? priced[0] ?? towers[0];
      if (!first) return;
      // Next to it, one that needs a higher incentive, so the comparison shows a difference
      const second = priced.find(p => p.id !== first.id && firstStep(breakEven(p)) > firstStep(breakEven(first)))
        ?? towers.find(p => p.id !== first.id);
      setPair([first, second].filter(Boolean));
      setDetail(await get(`/api/buildings/${encodeURIComponent(first.id)}`));
    })().catch(() => {});
    return () => controller.abort();
  }, []);

  // Sections rise into place the first time they scroll into view
  useEffect(() => {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("shown"); observer.unobserve(entry.target); }
    }), { threshold: 0.13 });
    page.current.querySelectorAll(".lp-step, .lp-study").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // A page kept in the browser's back cache should not hold a live map
  useEffect(() => {
    const hide = () => setMapOn(false), show = () => setMapOn(true);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); };
  }, []);

  const [a, b] = pair;
  const setting = a ? firstStep(breakEven(a)) : null;      // the first step at which the example pays
  const daylight = detail?.geometry?.by_depth?.["36"]?.daylight_share;
  const facts = a ? [
    ["Potential homes", a.homes?.toLocaleString() ?? "–"],
    ["Near a window", daylight == null ? "…" : `${Math.round(daylight * 100)}%`],
    ["Pays for itself from", paysFrom(a)],
  ] : [];
  const visuals = [
    <CityDrawing />,
    a && <img src={plateUrl(a.id)} alt="Indicative apartment layout" />,
    <div className="lp-bars">{pair.map(p => {
      const step = firstStep(breakEven(p));
      return <div key={p.id}>{p.name}<b>{paysFrom(p)}</b>
        <i style={{ width: `${step == null ? 0 : Math.min(100, 100 * step / INCENTIVE_MAX)}%` }} /></div>;
    })}</div>,
  ];

  return <main className="landing" ref={page}>
    <header className="lp-nav"><a className="brand" href="/"><img src="/favicon.svg" width="23" alt="" />Lights On</a></header>

    <section className="lp-hero">
      <div className="lp-intro">
        <p className="lp-kicker">Office-to-housing screening</p>
        <h1>Find the offices that can become <em>homes.</em></h1>
        <p>Lights On screens downtown Houston's office buildings: how many homes fit near the windows, and what it would
          take for a conversion to pay for itself. It tells a lender or owner which buildings deserve a professional
          study, not what to bid.</p>
        <Button href="/">Open the map</Button>
      </div>
      <div className="hero-map" role="img"
           aria-label={`Downtown Houston: office buildings that would pay for themselves at a hypothetical $${PREVIEW_INCENTIVE} per square foot incentive are lit`}>
        <div aria-hidden="true" className="hero-map-scene"><Suspense fallback={null}>
          {mapOn && preview && <PreviewMap preview data={preview} />}
        </Suspense></div>
        <small className="hero-note">Lit: pays for itself at a hypothetical ${PREVIEW_INCENTIVE}/SF incentive</small>
        <small className="hero-credit">OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</small>
      </div>
    </section>

    <section id="method" className="lp-section">
      <p className="lp-kicker">How Lights On works</p>
      <h2>From empty offices to potential homes.</h2>
      <p className="lp-desc">For a lender or owner, vacancy is only the starting point. Lights On screens the floor plate
        and the finances together, to decide which building deserves a closer study.</p>
      <div className="lp-steps">{STEPS.map(([title, text], i) =>
        <article key={title} className="lp-step">
          <div className="lp-mini">{visuals[i]}</div>
          <small>0{i + 1}</small>
          <h3>{title}</h3>
          <p>{text}</p>
        </article>)}</div>
    </section>

    <section className="lp-section" id="study">
      <div className="lp-study">
        <figure>{a && <img src={plateUrl(a.id)} alt="Indicative apartment layout at 36 ft" />}
          <figcaption>Typical floor · indicative layout at 36 ft</figcaption></figure>
        <div>
          <p className="lp-kicker">One building</p>
          <h2>{a?.name ?? "Building overview"}</h2>
          {detail?.building?.synthetic && <p className="tag">Sample data, not a real building</p>}
          <p className="lp-desc">{detail?.building?.address}</p>
          <dl>{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
          <p className="fine">The incentive is hypothetical, in the base case.</p>
          {a && <Button href={buildingUrl(a.id)}>Open this building</Button>}
        </div>
      </div>
    </section>

    <section className="lp-section">
      <p className="lp-kicker">Compare two buildings</p>
      <h2>Which one deserves the study?</h2>
      {b && setting !== null ? <>
        <p className="lp-desc">At a hypothetical ${setting}/SF incentive, in the base case:</p>
        <div className="lp-pair">{pair.map(p => {
          const step = firstStep(breakEven(p));
          const pays = step !== null && step <= setting;
          return <article key={p.id}>
            <h3>{p.name}</h3>
            <p>Pays for itself from</p>
            <strong>{paysFrom(p)}</strong>
            <small data-lit={pays}>{pays ? "Pays for itself at this setting" : "Not yet at this setting"}</small>
          </article>;
        })}</div>
      </> : <p className="lp-desc">Comparison unavailable.</p>}
    </section>

    <section className="lp-section">
      <p className="lp-kicker">Data and assumptions</p>
      <h2>What goes into a screening?</h2>
      <div className="lp-assumptions">{ASSUMPTIONS.map(([title, text], i) =>
        <article key={title}>
          <span className="lp-card-number" aria-hidden="true">0{i + 1}</span>
          <h3>{title}</h3>
          <p>{text}</p>
        </article>)}</div>
      <p className="lp-desc lp-check">We wrote the expected answers down before the official run and tested on two Houston
        projects. The results, including the miss, are on the <a href="/?tab=Validation">Validation tab</a>.</p>
    </section>

    <footer className="lp-section">
      <h2>Which empty offices deserve a closer look?</h2>
      <p className="lp-desc">Choose a building on the map to see how many homes could fit and what it would take to pay for itself.</p>
      <Button href="/">Open the map</Button>
    </footer>
  </main>;
}
