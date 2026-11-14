// Small display helpers shared by the panels. Nothing here computes a number: it only words or formats one.

export const VERDICT_WORDS = {
  negative_residual: "Loses money even if the building were free",
  no_reference: "No price to compare with",
  supports_reference_all_cases: "Covers the price in every scenario",
  supports_reference_base_only: "Covers the price in the base case only",
  gap_vs_reference: "Falls short of the price",
  no_rent_data: "No rent data",
};

export function verdictWords(code) {
  return VERDICT_WORDS[code] ?? code;
}

// "2026-11-14T09:19:44+00:00" -> "Sat, 4:19 AM" in the viewer's own time zone
export function when(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// "google_genai:gemini-3.1-flash-lite" -> "Gemini 3.1 Flash Lite"
export function modelName(id) {
  if (!id) return "";
  const name = id.split(":").pop();
  return name.split("-").map(part => /^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)).join(" ");
}

// Agent text names buildings by id; readers know them by name. Internal codes become words.
export function readable(text, names) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [code, words] of Object.entries(VERDICT_WORDS)) out = out.replaceAll(code, words.toLowerCase());
  // ids inside file paths (/work/<id>/econ.json) stay as they are
  for (const [id, name] of names ?? []) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w/-])${safe}(?![\\w/-])`, "g"), name);
  }
  return out;
}

export const money = (x) => (x == null ? "n/a" : `${x < 0 ? "−" : ""}$${Math.abs(x / 1e6).toFixed(1)}M`);
export const tonnes = (x) => `${Math.round(x).toLocaleString()} t`;
export const perSf = (x) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}/SF`;
