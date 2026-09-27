/** Unreported or partial cost is not evidence that a run was free. */
export function formatCost(value, known) {
  return known === true && Number.isFinite(value) && value >= 0
    ? `$${value.toFixed(3)}`
    : 'unknown';
}
