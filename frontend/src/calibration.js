// Confirm the SDK's Model API frame conversion against saved pano IDs before placing any label.
export function verifiedConversion(panos, sweeps, convert) {
  let matched = false;
  for (const pano of panos) {
    const target = sweeps.get(pano.id);
    if (!target) continue;
    const p = convert(pano.position);
    const error = Math.hypot(p.x-target.x, p.y-target.y, p.z-target.z);
    if (!Number.isFinite(error) || error > 0.1) return null;
    matched = true;
  }
  return matched ? convert : null;
}
