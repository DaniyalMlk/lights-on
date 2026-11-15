// Where on the incentive slider a building starts to pay for itself.
// The residuals and the reference price come from the tools; this file only finds the slider step and words it.

export const INCENTIVE_MAX = 250;   // $/SF, the right end of the slider
export const INCENTIVE_STEP = 5;

// $/SF of hypothetical incentive at which the base case covers the reference price. null = no price to compare with
export function breakEven(p) {
  if (!p || p.residual_base == null || p.residual_worst == null || !p.assessed_value || !p.gfa_sf) return null;
  return Math.max(0, (p.assessed_value - p.residual_base) / p.gfa_sf);
}

// The first slider step at or above it: the position where the tower lights up
export function firstStep(need) {
  return need == null ? null : Math.ceil(need / INCENTIVE_STEP) * INCENTIVE_STEP;
}

export function stepWords(step) {
  if (step === 0) return "No incentive needed";
  if (step > INCENTIVE_MAX) return `More than $${INCENTIVE_MAX}/SF`;
  return `$${step}/SF`;
}
