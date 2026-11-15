// The typical floor of the selected tower, drawn in 3D on its roof as if the roof were lifted off:
// the floor slab, its corridor, core and dark zone, the apartments, and one beacon per floor label.
// Everything here works in the floor plate drawing's own units: feet, x to the right, y down.

const FEET_TO_M = 0.3048;
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// Keyed by the fill the backend's drawing uses (backend/tools/layout.py). top = height above the roof, metres.
const PARTS = {
  "#1B1B1F": { color: "#0f1828", top: 0.3 },               // the floor slab
  "#3A3A40": { color: "#33415f", top: 0.5 },               // corridor
  "#111114": { color: "#05080f", top: 0.7 },               // dark zone
  "#5A5A5A": { color: "#5b6884", top: 2 },                 // storage
  "#26262B": { color: "#1b2640", top: 5 },                 // core
  "#FFC857": { color: "#ffc857", top: 3.4, home: true },   // apartments: 2BR, 1BR, studio
  "#FFD98A": { color: "#ffd98a", top: 3.4, home: true },
  "#FFE8B5": { color: "#ffe8b5", top: 3.4, home: true },
};
const SLAB = "#1B1B1F";
// One per kind of label, the same colors as the bars beside the labels in the panel (styles.css)
const BEACON = { measured: "#f4bf5f", checked: "#7ed3a7", assumed: "#8fa0bd", estimate: "#eef2f9" };
const BEACON_HALF_FT = 5;       // a label's beacon is a 10 ft square column
const BEACON_M = 20;            // its height; the one in focus stands taller
const BEACON_FOCUS_M = 40;
const UNIT_WAIT_MS = 300;       // let the camera start moving first
const UNIT_STAGGER_MS = 34;     // apartments switch on one after another around the floor
const UNIT_RISE_MS = 380;
const BEACON_STAGGER_MS = 120;
const BEACON_RISE_MS = 500;

// Is the point inside the ring? (ray casting)
function inside([x, y], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function area(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum) / 2;
}

// Read the floor plate drawing into shapes the map can extrude: [{fill, polygons: [[outer, hole, ...], ...]}].
// A ring that starts inside a bigger ring of the same path is a hole in it (the corridor is a ring like that).
export function readPlate(svg) {
  const [, , w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  const shapes = [...svg.querySelectorAll("path")].map((path) => {
    const rings = path.getAttribute("d").split("Z")
      .map(part => (part.match(/-?[\d.]+,-?[\d.]+/g) ?? []).map(pair => pair.split(",").map(Number)))
      .filter(ring => ring.length >= 3)
      .sort((a, b) => area(b) - area(a));
    const polygons = [];
    for (const ring of rings) {
      const outer = polygons.find(polygon => inside(ring[0], polygon[0]));
      if (outer) outer.push(ring); else polygons.push([ring]);
    }
    return { fill: path.getAttribute("fill"), polygons };
  }).filter(shape => PARTS[shape.fill] && shape.polygons.length);
  return { w, h, shapes };
}

// Drawing feet -> map position: the drawing's middle sits on the tower's middle, turned by `turn` degrees.
function placer(plate, origin, turn) {
  const perLat = 110540, perLon = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const cos = Math.cos((turn * Math.PI) / 180), sin = Math.sin((turn * Math.PI) / 180);
  return ([x, y]) => {
    const east = (x - plate.w / 2) * FEET_TO_M, north = (plate.h / 2 - y) * FEET_TO_M;
    return [origin.lng + (east * cos - north * sin) / perLon, origin.lat + (east * sin + north * cos) / perLat];
  };
}

// A scanned floor has no compass, so its drawing can point any way. Turn it in 2° steps and keep the turn
// that puts the most of its outline inside the building's footprint; with equal scores the smallest turn wins,
// so a floor drawn from the footprint itself is left alone. Which way round a symmetric floor sits stays indicative.
export function bestTurn(plate, footprint, origin) {
  const outline = plate.shapes.find(shape => shape.fill === SLAB)?.polygons[0][0];
  if (!outline) return 0;
  // Pull the outline in a little, so a floor that fits exactly counts as inside
  const pulled = outline.map(([x, y]) => [plate.w / 2 + (x - plate.w / 2) * 0.9, plate.h / 2 + (y - plate.h / 2) * 0.9]);
  let best = 0, bestScore = -1;
  for (let step = 0; step <= 90; step++) {
    for (const turn of step === 0 || step === 90 ? [step * 2] : [step * 2, -step * 2]) {
      const place = placer(plate, origin, turn);
      const score = pulled.filter(point => inside(place(point), footprint)).length;
      if (score > bestScore) { best = turn; bestScore = score; }
    }
  }
  return best;
}

function block(rings, place, properties) {
  const coordinates = rings.map(ring => { const points = ring.map(place); points.push(points[0]); return points; });
  return { type: "Feature", geometry: { type: "Polygon", coordinates }, properties };
}

// The floor's outline on the map, for redrawing the tower under it. Null when the drawing has no slab.
export function planOutline(plate, origin, turn) {
  const outline = plate.shapes.find(shape => shape.fill === SLAB)?.polygons[0];
  return outline ? block(outline, placer(plate, origin, turn), {}).geometry : null;
}

// How long until the last apartment has finished rising, ms
export function planDuration(plate) {
  const homes = plate.shapes.filter(shape => PARTS[shape.fill].home).reduce((n, shape) => n + shape.polygons.length, 0);
  return { plate: UNIT_WAIT_MS + homes * UNIT_STAGGER_MS + UNIT_RISE_MS };
}

// Everything on the roof right now. plateAge / marksAge: ms since the floor / its labels appeared; now drives
// the beacons' slow breathing. scene = { plate, marks: [{kind, x, y}], focus: index or null, origin, turn, roof (metres) }
export function planFeatures({ plate, marks, focus, origin, turn, roof }, plateAge, marksAge, now) {
  const place = placer(plate, origin, turn);
  const features = [];
  let home = 0;
  for (const shape of plate.shapes) {
    const part = PARTS[shape.fill];
    for (const polygon of shape.polygons) {
      const grow = part.home ? easeOut(clamp01((plateAge - UNIT_WAIT_MS - home++ * UNIT_STAGGER_MS) / UNIT_RISE_MS)) : 1;
      if (grow > 0) features.push(block(polygon, place, { color: part.color, base: roof, top: roof + part.top * grow }));
    }
  }
  marks.forEach((mark, index) => {
    const grow = easeOut(clamp01((marksAge - index * BEACON_STAGGER_MS) / BEACON_RISE_MS));
    if (grow <= 0) return;
    const r = BEACON_HALF_FT, { x, y } = mark;
    if (x == null || y == null) return;
    const tall = (focus === index ? BEACON_FOCUS_M : BEACON_M) * (1 + 0.07 * Math.sin(now / 420 + index));
    features.push(block([[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]], place,
                        { color: BEACON[mark.kind] ?? "#ffffff", base: roof, top: roof + tall * grow, mark: index }));
  });
  return { type: "FeatureCollection", features };
}
