import { useEffect, useRef } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// OpenFreeMap needs no API key. Without wifi we fall back to a plain background, and the towers still draw.
const BASEMAP_URL = "https://tiles.openfreemap.org/styles/dark";
const OFFLINE_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#111318" } }],
};

async function loadBaseStyle() {
  try {
    const res = await fetch(BASEMAP_URL, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return await res.json();
  } catch {
    // offline or blocked: use the plain background
  }
  return OFFLINE_STYLE;
}

const FEET_TO_M = 0.3048;

export default function CityMap({ data, onSelect }) {
  const container = useRef(null);
  const map = useRef(null);
  const latestData = useRef(data);
  latestData.current = data;

  // Create the map once, after we know which basemap style we can load
  useEffect(() => {
    let cancelled = false;
    loadBaseStyle().then((style) => {
      if (cancelled) return;
      map.current = new MapLibreMap({
        container: container.current,
        style,
        center: [-95.366, 29.757],
        zoom: 15,
        pitch: 55,
        bearing: -20,
      });
      map.current.on("load", () => addBuildings(map.current, latestData.current, onSelect));
    });
    return () => {
      cancelled = true;
      map.current?.remove();
    };
  }, []);

  // Recolor when the slider changes
  useEffect(() => {
    const source = map.current?.getSource("buildings");
    if (source) source.setData(data);
  }, [data]);

  return <div ref={container} className="map" />;
}

// Our towers go on top of the basemap: height from the data, color from the verdict
function addBuildings(map, data, onSelect) {
  map.addSource("buildings", { type: "geojson", data });
  map.addLayer({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "buildings",
    paint: {
      "fill-extrusion-height": ["*", ["get", "height_ft"], FEET_TO_M],
      "fill-extrusion-color": [
        "case",
        ["get", "gated_out"], "#9aa0a6",
        ["get", "lit"], "#ffc857",
        "#2b2d42",
      ],
      "fill-extrusion-opacity": 0.9,
    },
  });
  map.on("click", "buildings-3d", (e) => onSelect(e.features[0].properties.id));
  map.on("mouseenter", "buildings-3d", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "buildings-3d", () => (map.getCanvas().style.cursor = ""));

  // Zoom to fit every building
  const lngs = [], lats = [];
  data.features.forEach((f) => f.geometry.coordinates[0].forEach(([x, y]) => { lngs.push(x); lats.push(y); }));
  if (lngs.length) {
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                  { padding: 120, pitch: 55, bearing: -20, duration: 0 });
  }
}
