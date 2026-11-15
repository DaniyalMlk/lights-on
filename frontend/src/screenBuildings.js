// Does the residual cover the price at this incentive? gap is $/SF still missing (for sorting); null = no price
function evaluate(p, incentive) {
  if (p.residual_base == null || p.residual_worst == null || !p.assessed_value || !p.gfa_sf)
    return { label: "No price to compare with", short: "No price to compare", covers: false, gap: null };
  const credit = incentive * p.gfa_sf;
  if (p.residual_worst + credit >= p.assessed_value)
    return { label: "Pencils at today's basis", short: "Pencils at today's basis", covers: true, gap: -Infinity };
  const gap = (p.assessed_value - p.residual_base - credit) / p.gfa_sf;
  if (gap <= 0) return { label: "Pencils at a distressed basis", short: "Pencils at a distressed basis", covers: true, gap };
  return { label: `Needs $${Math.ceil(gap)}/SF of basis or incentives`, short: `Needs $${Math.ceil(gap)}/SF more`, covers: false, gap };
}

export function screenBuildings(buildings, incentive, vacancyGate) {
    if (!buildings) return null;
    const features = buildings.features.map((f) => {
      const p = f.properties;
      const gated = (p.vacancy ?? 0) * 100 < vacancyGate;
      const verdict = evaluate(p, incentive);
      return { ...f, properties: { ...p, label: verdict.label, short: verdict.short, gap: verdict.gap,
                                   gated_out: gated, lit: !gated && verdict.covers } };
    });
    return { ...buildings, features };
}
