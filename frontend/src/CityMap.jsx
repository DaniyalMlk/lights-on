import { useEffect, useRef } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Let Vite bundle MapLibre's web worker so it works in dev and in the production build
setWorkerUrl(workerUrl);

// Inline style with a raster basemap: the map still loads (and draws our buildings) if tiles are offline.
const STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#111318" } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.85 } },
  ],
};
const FEET_TO_M = 0.3048;

export default function CityMap({ data, onSelect }) {
  const container = useRef(null);
  const map = useRef(null);

  // Create the map once
  useEffect(() => {
    map.current = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: [-95.366, 29.757],
      zoom: 15,
      pitch: 55,
      bearing: -20,
    });

    map.current.on("load", () => {
      map.current.addSource("buildings", { type: "geojson", data });
      map.current.addLayer({
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
      map.current.on("click", "buildings-3d", (e) => onSelect(e.features[0].properties.id));

      // Zoom to fit every building
      const lngs = [], lats = [];
      data.features.forEach((f) => f.geometry.coordinates[0].forEach(([x, y]) => { lngs.push(x); lats.push(y); }));
      if (lngs.length) {
        map.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                              { padding: 120, pitch: 55, bearing: -20, duration: 0 });
      }
      map.current.on("mouseenter", "buildings-3d", () => (map.current.getCanvas().style.cursor = "pointer"));
      map.current.on("mouseleave", "buildings-3d", () => (map.current.getCanvas().style.cursor = ""));
    });

    return () => map.current.remove();
  }, []);

  // Recolor when the slider changes
  useEffect(() => {
    const source = map.current?.getSource("buildings");
    if (source) source.setData(data);
  }, [data]);

  return <div ref={container} className="map" />;
}
