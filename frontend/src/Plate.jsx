import { useEffect, useRef } from "react";
import { readPlate } from "./plan3d.js";

// Apartment fills in the plate drawing (backend/tools/layout.py): 2BR, 1BR, studio
const UNIT_FILLS = 'path[fill="#FFC857"], path[fill="#FFD98A"], path[fill="#FFE8B5"]';

// The floor plate, drawn into the page so its apartments can switch on one after another around the floor.
// With onPlate, the same drawing is handed to the map, which builds it in 3D on top of the tower.
export default function Plate({ buildingId, depth, onPlate }) {
  const box = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/buildings/${encodeURIComponent(buildingId)}/plate.svg?depth=${depth}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(text => {
        const svg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
        if (svg.nodeName !== "svg") throw new Error();
        svg.setAttribute("aria-label", `Indicative floor plate at ${depth} ft unit depth`);
        svg.querySelectorAll(UNIT_FILLS).forEach((unit, i) => {
          unit.classList.add("unit");
          unit.style.setProperty("--i", i);
        });
        box.current?.replaceChildren(document.importNode(svg, true));
        onPlate?.({ id: buildingId, key: `${buildingId}:${depth}`, ...readPlate(svg) });
      })
      .catch(() => { if (!controller.signal.aborted && box.current) box.current.textContent = "Floor plate unavailable."; });
    return () => controller.abort();
  }, [buildingId, depth]);
  return <div ref={box} className="plate" />;
}
