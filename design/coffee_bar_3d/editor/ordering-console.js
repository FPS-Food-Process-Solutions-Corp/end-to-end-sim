// Panel coordinates: X runs along the wall, Y up, Z outward toward the customer.
export function orderingConsoleLayout(parameters, features) {
  if (!parameters.console_enabled) return null;
  const controls = features.filter(feature => ['tablet', 'intercom'].includes(feature.kind));
  if (!controls.length) return null;
  const left = Math.min(...controls.map(feature => feature.center - feature.width / 2)) - .035;
  const right = Math.max(...controls.map(feature => feature.center + feature.width / 2)) + .035;
  const angle = parameters.console_incline_deg * Math.PI / 180;
  return {
    left, right, width: right - left, center: (left + right) / 2,
    depth: parameters.console_projection, base: parameters.console_base,
    frontHeight: parameters.console_base + parameters.console_lip_height,
    backHeight: parameters.console_base + parameters.console_lip_height + parameters.console_projection * Math.tan(angle),
    faceLength: parameters.console_projection / Math.cos(angle),
    rotationX: angle - Math.PI / 2, cosine: Math.cos(angle), sine: Math.sin(angle),
  };
}
