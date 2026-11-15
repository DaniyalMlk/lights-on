export const incentiveMax = 250;
export const incentiveStep = 5;
export const perFoot = n => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}/SF`;

// The map requires both case results. The downside case refines the verdict
// once the base case can support the reference price.
export function requiredIncentive(p) {
  if (!p || ![p.residual_base, p.residual_worst, p.assessed_value, p.gfa_sf].every(Number.isFinite)
      || p.gfa_sf <= 0 || p.assessed_value <= 0) return null;
  return Math.max(0, (p.assessed_value - p.residual_base) / p.gfa_sf);
}

export function sliderThreshold(required) {
  return required === null ? null : Math.ceil(required / incentiveStep) * incentiveStep;
}

export function supportStatus(required, current) {
  if (required === null) return "Unavailable";
  return current >= required ? "Meets assessed value" : "Below assessed value";
}

export function thresholdNote(required) {
  if (required === 0) return "No incentive required";
  if (required > incentiveMax) return "Above slider range";
  return null;
}
