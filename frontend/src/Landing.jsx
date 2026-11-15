import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import AnimatedNumber from "./AnimatedNumber.jsx";
import Plate from "./Plate.jsx";
import { INCENTIVE_MAX, INCENTIVE_STEP, breakEven, firstStep, stepWords } from "./incentive.js";
import { screenBuildings } from "./screenBuildings.js";
import "./landing.css";

// The introduction at /about. The city behind the headline is the real map: the camera circles downtown
// while the incentive climbs by itself, and each tower lights up at the step where it starts to pay.
// Like the map, the page shows only our own results: no rents, vacancy, prices or dollar totals of a building.

const BackdropMap = lazy(() => import("./CityMap.jsx"));
const VACANCY_GATE = 35;                        // percent, the map's own starting filter
const STILL_INCENTIVE = 165;                    // $/SF, shown when the reader has motion turned off
const TICK_MS = 140;                            // the incentive moves one slider step per tick
const RISE = INCENTIVE_MAX / INCENTIVE_STEP;    // ticks from $0 to the top of the slider
const HOLD = 36;                                // ticks it stays at the top
const REST = 14;                                // ticks at $0 before it starts again
const PLATE_FROM = { matterport_scan: "Scanned floor", vexcel: "Vexcel outline" };
const SOURCES = [
  ["CoStar", "Building and market records for downtown Houston."],
  ["Vexcel", "Building outlines from aerial imagery, used where they match the floor."],
  ["Matterport", "Scanned floors, measured and labeled inside the 3D tour."],
];

const stillPage = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const buildingUrl = (id) => `/?demo=${encodeURIComponent(id)}`;
const paysFrom = (p) => { const step = firstStep(breakEven(p)); return step == null ? "No price to compare" : stepWords(step); };
// Where the playing incentive stands at a tick: a climb, a pause at the top, a rest at zero
const incentiveAt = (tick) => tick <= RISE ? tick * INCENTIVE_STEP : tick <= RISE + HOLD ? INCENTIVE_MAX : 0;

// True while the element is on screen. With once, it stays true after the first time
function useInView(ref, { once = false, threshold = 0.2 } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && once) observer.disconnect();
    }, { threshold });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return inView;
}

// A block whose parts rise into place the first time it scrolls into view. Children may be a function of "shown"
function Reveal({ as: Tag = "section", className, id, children }) {
  const ref = useRef(null);
  const shown = useInView(ref, { once: true });
  return <Tag ref={ref} id={id} className={`lp-reveal ${className}`} data-shown={shown}>
    {typeof children === "function" ? children(shown) : children}
  </Tag>;
}

function Button({ href, children }) {
  return <a className="lp-button" href={href}>{children}<span aria-hidden="true">↗</span></a>;
}
function TextLink({ href, children }) {
  return <a className="lp-link" href={href}>{children} <span aria-hidden="true">↗</span></a>;
}

export default function Landing() {
  const [collection, setCollection] = useState(null);   // every building, as the map gets them
  const [detail, setDetail] = useState(null);           // the example building's full analysis
  const [proof, setProof] = useState(null);             // the validation cases
  const [incentive, setIncentive] = useState(() => stillPage() ? STILL_INCENTIVE : 0);
  const [inset, setInset] = useState(0);                // room the hero text takes on the left, px
  const [mapOn, setMapOn] = useState(true);
  const hero = useRef(null);
  const heroInView = useInView(hero, { threshold: 0.05 });

  useEffect(() => {
    const controller = new AbortController();
    const get = async (url) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error();
      return response.json();
    };
    get("/api/buildings").then(setCollection).catch(() => {});
    get("/api/proof").then(setProof).catch(() => {});
    return () => controller.abort();
  }, []);

  // The incentive plays by itself while the hero is on screen, like a hand dragging the slider
  useEffect(() => {
    if (!collection || !heroInView || stillPage()) return;
    let tick = 0;
    const timer = setInterval(() => {
      tick = (tick + 1) % (RISE + HOLD + REST + 1);
      setIncentive(incentiveAt(tick));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [collection, heroInView]);

  // On a wide screen the text sits on the left, so the map aims at the middle of what is left
  useEffect(() => {
    const measure = () => setInset(window.innerWidth >= 900 ? Math.round(window.innerWidth * 0.36) : 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // A page kept in the browser's back cache should not hold a live map
  useEffect(() => {
    const hide = () => setMapOn(false), show = () => setMapOn(true);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); };
  }, []);

  const scene = useMemo(() => screenBuildings(collection, incentive, VACANCY_GATE), [collection, incentive]);
  const towers = scene?.features.map(f => f.properties).filter(p => !p.map_only) ?? [];
  const lit = towers.filter(p => p.lit);
  const litHomes = lit.reduce((sum, p) => sum + (p.homes ?? 0), 0);

  // The example is 800 Bell when the data has it (its floor is scanned), else the building closest to paying.
  // Next to it, one that needs a higher incentive, so the comparison shows a difference.
  const [a, b] = useMemo(() => {
    const all = (collection?.features ?? []).map(f => f.properties).filter(p => !p.map_only);
    const priced = all.filter(p => breakEven(p) !== null).sort((x, y) => breakEven(x) - breakEven(y));
    const first = priced.find(p => p.name === "800 Bell") ?? priced[0] ?? all[0];
    if (!first) return [];
    const second = priced.find(p => p.id !== first.id && firstStep(breakEven(p)) > firstStep(breakEven(first)))
      ?? all.find(p => p.id !== first.id);
    return [first, second];
  }, [collection]);

  useEffect(() => {
    if (!a) return;
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(a.id)}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(setDetail).catch(() => {});
    return () => controller.abort();
  }, [a?.id]);

  const daylight = detail?.geometry?.by_depth?.["36"]?.daylight_share;
  const plateFrom = detail && (PLATE_FROM[detail.geometry.plate_source] ?? PLATE_FROM[detail.building.footprint_origin] ?? "Square stand-in");
  const scored = (proof?.cases ?? []).filter(c => c.status === "pass" || c.status === "miss");
  const passed = scored.filter(c => c.status === "pass").length;

  return <main className="landing">
    <header className="island lp-nav">
      <a className="brand" href="/"><img src="/favicon.svg" width="14" height="18" alt="" />Lights On</a>
      <nav className="topnav" aria-label="On this page">
        <a href="#measure">Measure</a>
        <a href="#price">Price</a>
        <a href="#check">Check</a>
        <a className="lp-nav-open" href="/">Open the map</a>
      </nav>
    </header>

    <section className="lp-hero" ref={hero}>
      <div className="lp-backdrop" aria-hidden="true">
        <Suspense fallback={null}>
          {mapOn && scene && <BackdropMap preview data={scene} drift={heroInView} leftInset={inset} />}
        </Suspense>
      </div>
      <div className="lp-hero-text">
        <p className="lp-eyebrow">Downtown Houston · Office to housing</p>
        <h1>Find the offices that can become <em>homes.</em></h1>
        <p className="lp-lede">Lights On screens every downtown office building: the homes that fit near a window,
          and the incentive at which converting pays for itself.</p>
        <div className="lp-actions">
          <Button href="/">Open the map</Button>
          <TextLink href="#check">How it was checked</TextLink>
        </div>
      </div>
      <div className="lp-hero-foot">
        <div className="lp-readout">
          <div className="lp-readout-row">
            <span>Hypothetical incentive</span>
            <output>${incentive}<small>/SF</small></output>
          </div>
          <div className="lp-meter"><i style={{ transform: `scaleX(${incentive / INCENTIVE_MAX})` }} /></div>
          <p><b><AnimatedNumber value={litHomes} /></b> homes pay for themselves
            <small>{lit.length} of {towers.length || "–"} buildings</small></p>
        </div>
        <small className="lp-credit">OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors</small>
      </div>
    </section>

    <Reveal className="lp-section lp-split" id="measure">{shown => <>
      <figure className="lp-figure">
        <div className="plate-frame">
          {shown && a ? <Plate buildingId={a.id} depth={36} /> : <div className="lp-plate-wait" />}
        </div>
        <figcaption>{a ? `${a.name} · indicative layout at 36 ft` : "Indicative layout at 36 ft"}</figcaption>
      </figure>
      <div className="lp-copy">
        <p className="lp-eyebrow"><b>01</b>Measure</p>
        <h2>Bedrooms need windows.</h2>
        <p className="lp-body">We lay out the apartments that fit within 36 ft of a window. The middle of a deep floor stays dark.</p>
        {detail?.building?.synthetic && <p className="tag">Sample data, not a real building</p>}
        <dl className="lp-facts">
          <div><dt>Potential homes</dt><dd>{a?.homes?.toLocaleString() ?? "–"}</dd></div>
          <div><dt>Near a window</dt><dd>{daylight == null ? "–" : `${Math.round(daylight * 100)}%`}</dd></div>
          <div><dt>Floor plate from</dt><dd className="words">{plateFrom ?? "–"}</dd></div>
        </dl>
        {a && <TextLink href={buildingUrl(a.id)}>Open {a.name}</TextLink>}
      </div>
    </>}</Reveal>

    <Reveal className="lp-section lp-split copy-first" id="price">
      <div className="lp-copy">
        <p className="lp-eyebrow"><b>02</b>Price</p>
        <h2>Which one deserves the study?</h2>
        <p className="lp-body">Value as homes minus the cost to convert, for every building. The lower the incentive
          a building needs, the closer it is to paying for itself.</p>
        <p className="fine">Indicative, not an offer price. The incentive is hypothetical: a building may be eligible,
          verify with the program.</p>
        <TextLink href="/">Compare two on the map</TextLink>
      </div>
      <div className="lp-bars">
        <p className="lp-eyebrow">Pays for itself from</p>
        {[a, b].filter(Boolean).map(p => {
          const step = firstStep(breakEven(p));
          return <div className="lp-bar" key={p.id}>
            <div><span>{p.name}</span><b>{paysFrom(p)}</b></div>
            <i style={{ "--w": step == null ? 0 : Math.min(1, step / INCENTIVE_MAX) }} />
          </div>;
        })}
      </div>
    </Reveal>

    <Reveal className="lp-section lp-split" id="check">
      <ol className="lp-cases" hidden={!scored.length}>{scored.map(c =>
        <li key={c.case} data-status={c.status}>
          <header>
            <h3>{c.case}</h3>
            <span className="lp-chip">{c.status === "pass" ? "Pass" : "Miss"}{c.error_pct != null ? ` · ${c.error_pct > 0 ? "+" : ""}${c.error_pct}%` : ""}</span>
          </header>
          <dl>
            <div><dt>Ours</dt><dd>{c.predicted?.toLocaleString() ?? "–"}</dd></div>
            <div><dt>Actual</dt><dd>{c.truth?.toLocaleString() ?? "–"}</dd></div>
          </dl>
          <p className="fine">{c.role}</p>
        </li>)}
      </ol>
      <div className="lp-copy">
        <p className="lp-eyebrow"><b>03</b>Check</p>
        <h2>Checked against real projects.</h2>
        <p className="lp-body">Expected answers were written down before the official run.
          {scored.length > 0 && ` ${passed} of ${scored.length} scored cases passed, and the miss is shown.`}</p>
        <p className="lp-body">The agent's memo passes only if every number traces to a saved tool output.</p>
        <TextLink href="/?tab=Validation">Open Validation</TextLink>
      </div>
    </Reveal>

    <Reveal className="lp-sources">
      <p className="lp-eyebrow">Three data layers</p>
      <ul>{SOURCES.map(([name, text]) => <li key={name}><h3>{name}</h3><p>{text}</p></li>)}</ul>
    </Reveal>

    <Reveal as="footer" className="lp-end">
      <h2>Which empty offices deserve a closer look?</h2>
      <Button href="/">Open the map</Button>
      <div className="lp-foot">
        <span>Lights On · Team Falcons · HackPrinceton Fall 2026</span>
        <span>Screening figures, not an offer price.</span>
      </div>
    </Reveal>
  </main>;
}
