import * as THREE from 'three';

// Each pastry type supplies a centred visual in cm and convex collision parts
// in metres, plus validation fields and a mass estimate. The drop world and
// queue only consume this contract; they do not branch on pastry kind.
const types = new Map();
export function registerPastryType(kind, definition) {
  if (types.has(kind)) throw Error('Pastry type already registered: ' + kind);
  types.set(kind, definition);
}
export function pastryType(pastry) {
  const definition = types.get(pastry.kind);
  if (!definition) throw Error('Unsupported pastry type: ' + pastry.kind);
  return definition;
}
export const isPastry = object => !!object && types.has(object.kind);
export function pastrySnapshot(object) {
  const type = pastryType(object);
  return {kind: object.kind, name: object.name, ...Object.fromEntries(type.fields.map(({key}) => [key, object[key]]))};
}
export function validatePastry(pastry) {
  const type = pastryType(pastry);
  if (typeof pastry.name !== 'string' || !pastry.name.trim() || pastry.name.length > 80) throw Error('Pastries need a name of 1–80 characters.');
  for (const {key} of type.fields) if (!Number.isFinite(pastry[key]) || pastry[key] < .1 || pastry[key] > 200) throw Error('Pastry dimensions must be 0.1–200 cm.');
}

export function torusParts(donut) {
  const segments = 32, tubeSegments = 16;
  const radius = donut.diameter * .325 / 100, tube = donut.diameter * .175 / 100, halfHeight = donut.height / 200;
  const parts = [], samples = [];
  for (let i = 0; i < segments; i++) {
    const vertices = [];
    for (let edge = 0; edge <= 1; edge++) for (let j = 0; j < tubeSegments; j++) {
      const u = (i + edge) * Math.PI * 2 / segments, v = j * Math.PI * 2 / tubeSegments;
      const r = radius + tube * Math.cos(v), p = [r * Math.cos(u), halfHeight * Math.sin(v), r * Math.sin(u)];
      vertices.push(...p);
      if (!edge) samples.push(new THREE.Vector3(...p));
    }
    parts.push(new Float32Array(vertices));
  }
  return {parts, samples};
}

function donutVisual(donut) {
  const tube = donut.diameter * .175;
  const geometry = new THREE.TorusGeometry(donut.diameter * .325, tube, 40, 100);
  geometry.scale(1, 1, donut.height / (2 * tube));
  const positions = geometry.attributes.position, colors = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const shade = .96 + .045 * Math.sin(x * 10 + y * 12) * Math.cos(y * 9 + z * 18);
    const color = new THREE.Color('#c38942').multiplyScalar(shade + .055 * Math.cos(z * Math.PI / donut.height));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({vertexColors: true, roughness: .68}));
  mesh.name = 'Donut / exact outer dimensions';
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

registerPastryType('donut', {
  label: 'Donut',
  fields: [{key: 'diameter', label: 'Outer diameter'}, {key: 'height', label: 'Thickness'}],
  dimensions: pastry => ({width: pastry.diameter, depth: pastry.diameter, height: pastry.height}),
  makeVisual: donutVisual,
  collisionGeometry: torusParts,
  // Same illustrative density for different sizes; 60 g at 10 × 3.3 cm.
  massKg: pastry => .06 * (pastry.diameter / 10) ** 2 * pastry.height / 3.3,
});
