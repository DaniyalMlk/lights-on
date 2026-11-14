import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key (CARTO's free tiles now answer "API KEY REQUIRED"). We drop its text labels,
// because the towers carry our own, and dim it so only our towers carry light. Without wifi: a plain background.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const NIGHT = "#0c0e11";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": NIGHT } }],
};

// Basemap colors by layer id: a quiet city at night, so the lit towers are the brightest thing on screen
const DIM = {
  background: { "background-color": NIGHT },
  water: { "fill-color": "#0d1319" },
  waterway: { "line-color": "#0d1319" },
  landuse_residential: { "fill-color": "#0e1013" },
  landcover_wood: { "fill-color": "#0f1316" },
  landuse_park: { "fill-color": "#0f1316" },
  building: { "fill-color": "#14171b" },
  highway_minor: { "line-color": "#15181c" },
  highway_major_casing: { "line-color": "#1b1f24" },
  highway_major_inner: { "line-color": "#171a1f" },
  highway_major_subtle: { "line-color": "#171a1f" },
  highway_motorway_casing: { "line-color": "#20252b" },
  highway_motorway_inner: { "line-color": "#262c33" },
  highway_motorway_subtle: { "line-color": "#191d22" },
  railway: { "line-color": "#191c20" },
  railway_transit: { "line-color": "#191c20" },
  railway_minor: { "line-color": "#191c20" },
};

async function loadNightStyle() {
  try {
    const res = await fetch(BASEMAP_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const style = await res.json();
      style.layers = style.layers.filter((layer) => layer.type !== "symbol");
      for (const layer of style.layers) {
        if (DIM[layer.id]) layer.paint = { ...layer.paint, ...DIM[layer.id] };
      }
      return style;
    }
  } catch {
    // offline or blocked: use the plain background
  }
  return OFFLINE_STYLE;
}

const FEET_TO_M = 0.3048;
const LAMP = "#f4bf5f";

// Window textures for the towers. One 16 x 16 tile holds four windows; a lit tower has most of them on,
// a dark tower has one faint one, so the city reads as "offices at night" rather than grey boxes.
const WINDOWS = {
  "win-lit":     { wall: "#3a2c14", panes: ["#f6c461", "#ffd98c", "#5b4521", "#eaa944"] },
  "win-lit-hi":  { wall: "#4d3a19", panes: ["#ffd27a", "#ffe4ad", "#8a6a33", "#ffc458"] },
  "win-dark":    { wall: "#272e37", panes: ["#38424e", "#38424e", "#4d4230", "#38424e"] },
  "win-dark-hi": { wall: "#3b4551", panes: ["#5c6878", "#5c6878", "#7d6c4b", "#5c6878"] },
  "win-off":     { wall: "#181c21", panes: ["#21272e", "#21272e", "#21272e", "#21272e"] },
};

function windowImage({ wall, panes }) {
  const scale = 2, size = 16 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, size, size);
  panes.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect((2 + (i % 2) * 8) * scale, (2 + Math.floor(i / 2) * 8) * scale, 5 * scale, 5 * scale);
  });
  return { image: ctx.getImageData(0, 0, size, size), pixelRatio: scale };
}

// Lit towers clear the financial screen; the hovered or selected one is a shade brighter
function towerPattern(activeIds) {
  const active = ["in", ["get", "id"], ["literal", activeIds.filter(Boolean)]];
  return [
    "case",
    ["boolean", ["get", "map_only"], false], "win-off",
    ["boolean", ["get", "gated_out"], false], ["case", active, "win-dark-hi", "win-off"],
    ["boolean", ["get", "lit"], false], ["case", active, "win-lit-hi", "win-lit"],
    ["case", active, "win-dark-hi", "win-dark"],
  ];
}

// One point per lit tower: a soft pool of light on the street around it
function glowPoints(data) {
  return {
    type: "FeatureCollection",
    features: data.features.filter(f => f.properties.lit).map(f => {
      const box = new LngLatBounds();
      for (const point of f.geometry.coordinates[0]) box.extend(point);
      return { type: "Feature", geometry: { type: "Point", coordinates: box.getCenter().toArray() }, properties: {} };
    }),
  };
}

const CAMERA = { pitch: 58, bearing: -24 };

export default function CityMap({ data, selectedId, hoveredId, onSelect, onHover }) {
  const container = useRef(null);
  const map = useRef(null);
  const pins = useRef(new Map());
  const [ready, setReady] = useState(false);
  const latestData = useRef(data);
  latestData.current = data;
  const handlers = useRef({ onSelect, onHover });
  handlers.current = { onSelect, onHover };

  // Create the map once, after we know which basemap style we can load
  useEffect(() => {
    let instance = null;
    let cancelled = false;
    loadNightStyle().then((style) => {
      if (cancelled) return;
      instance = new MapLibreMap({
        container: container.current,
        style,
        center: [-95.366, 29.757],
        zoom: 15,
        ...CAMERA,
        attributionControl: { compact: true },
      });
      map.current = instance;
      instance.once("load", () => {
        addBuildings(instance, latestData.current, handlers, pins.current);
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      pins.current.clear();
    };
  }, []);

  // Recolor when a slider changes. Airbnb-style tiers: lit towers get a full pin with their home count,
  // the rest a mini-pin, so attention goes to the towers that work.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.getSource("buildings")?.setData(data);
    instance.getSource("glow")?.setData(glowPoints(data));
    for (const { properties: p } of data.features) {
      const pin = pins.current.get(p.id);
      if (!pin) continue;
      pin.dataset.lit = String(Boolean(p.lit));
      pin.dataset.off = String(Boolean(p.gated_out || p.map_only));
    }
  }, [data, ready]);

  // Hover and selection: brighter windows, and a pin that shows the name
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.setPaintProperty("buildings-3d", "fill-extrusion-pattern", towerPattern([selectedId, hoveredId]));
    for (const [id, pin] of pins.current) {
      const active = id === selectedId || id === hoveredId;
      pin.dataset.active = String(active);
      pin.setAttribute("aria-pressed", String(id === selectedId));
      pin.style.zIndex = active ? "3" : pin.dataset.lit === "true" ? "2" : "1";
    }
  }, [selectedId, hoveredId, ready]);

  // Fly to the selected building, or back to all of downtown
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!selectedId) {
      fitAll(instance, latestData.current, 700);
      return;
    }
    const feature = latestData.current.features.find(f => f.properties.id === selectedId);
    if (!feature) return;
    const bounds = new LngLatBounds();
    for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
    instance.flyTo({ center: bounds.getCenter(), zoom: 16.3, ...CAMERA, duration: 800, essential: true });
  }, [selectedId, ready]);

  return <div ref={container} className="map" />;
}

function fitAll(map, data, duration) {
  const bounds = new LngLatBounds();
  for (const feature of data.features)
    if (!feature.properties.map_only)
      for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
  if (!bounds.isEmpty())
    map.fitBounds(bounds, { padding: { top: 80, bottom: 200, left: 40, right: 40 }, maxZoom: 16.4, ...CAMERA, duration });
}

// Our towers go on top of the basemap: height from the data, texture from the verdict
function addBuildings(map, data, handlers, pins) {
  for (const [name, spec] of Object.entries(WINDOWS)) {
    const { image, pixelRatio } = windowImage(spec);
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio });
  }
  map.addSource("glow", { type: "geojson", data: glowPoints(data) });
  map.addLayer({
    id: "glow",
    type: "circle",
    source: "glow",
    paint: {
      "circle-color": LAMP,
      "circle-blur": 1,
      "circle-opacity": 0.45,
      "circle-pitch-alignment": "map",
      "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 13, 14, 17, 170],
    },
  });
  map.addSource("buildings", { type: "geojson", data });
  map.addLayer({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "buildings",
    paint: {
      "fill-extrusion-height": ["*", ["get", "height_ft"], FEET_TO_M],
      "fill-extrusion-pattern": towerPattern([]),
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  map.on("click", "buildings-3d", (e) => handlers.current.onSelect(e.features[0].properties.id));
  map.on("mousemove", "buildings-3d", (e) => {
    map.getCanvas().style.cursor = "pointer";
    handlers.current.onHover(e.features[0].properties.id);
  });
  map.on("mouseleave", "buildings-3d", () => {
    map.getCanvas().style.cursor = "";
    handlers.current.onHover(null);
  });

  for (const { geometry, properties: p } of data.features) {
    const footprint = new LngLatBounds();
    for (const position of geometry.coordinates[0]) footprint.extend(position);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "pin";
    pin.dataset.id = p.id;
    pin.dataset.lit = String(Boolean(p.lit));
    pin.dataset.off = String(Boolean(p.gated_out || p.map_only));
    pin.dataset.active = "false";
    pin.setAttribute("aria-label", `${p.name}${p.homes != null ? `, ${p.homes} homes at 36 ft` : ""}`);
    const name = document.createElement("span");
    name.className = "pin-name";
    name.textContent = p.name;
    const homes = document.createElement("span");
    homes.className = "pin-homes";
    homes.textContent = p.homes == null ? "" : `${p.homes.toLocaleString()} homes`;
    pin.append(name, homes);
    pin.onclick = () => handlers.current.onSelect(p.id);
    pin.onmouseenter = () => handlers.current.onHover(p.id);
    pin.onmouseleave = () => handlers.current.onHover(null);
    new Marker({ element: pin, anchor: "top", offset: [0, 8] }).setLngLat(footprint.getCenter()).addTo(map);
    pins.set(p.id, pin);
  }
  fitAll(map, data, 0);
}
