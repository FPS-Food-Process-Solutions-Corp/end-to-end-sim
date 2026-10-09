import * as THREE from 'three';
import {dimensions} from './catalog.js';
import {isPastry, pastryType} from './pastries.js';

function panel(points, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export function makeObject(o, xray = false) {
  const root = new THREE.Group();
  root.name = o.name; root.userData = {objectId: o.id, dimensions_cm: dimensions(o), kind: o.kind};
  if (o.kind === 'bag') {
    const w = o.width / 2, d = o.depth / 2, h = o.height;
    const paper = new THREE.MeshStandardMaterial({color: '#cfac77', roughness: .91, side: THREE.DoubleSide, transparent: xray, opacity: xray ? .18 : 1, depthWrite: !xray});
    const side = paper.clone(); side.color.set('#bb975f');
    const faces = [
      [[-w, 0, d], [w, 0, d], [w, h, d], [-w, h, d]],
      [[w, 0, -d], [-w, 0, -d], [-w, h, -d], [w, h, -d]],
      [[-w, 0, -d], [-w, 0, d], [-w, h, d], [-w, h, -d]],
      [[w, 0, d], [w, 0, -d], [w, h, -d], [w, h, d]],
      [[-w, .015, -d], [w, .015, -d], [w, .015, d], [-w, .015, d]],
    ];
    faces.forEach((face, i) => {const p = panel(face, i > 1 ? side : paper); p.name = ['Front paper wall', 'Back paper wall', 'Left gusset', 'Right gusset', 'Bag bottom'][i]; root.add(p);});
    const points = [];
    const segment = (a, b) => points.push(...a, ...b);
    for (const x of [-w, w]) {
      segment([x, 0, -d], [x, h, -d]); segment([x, 0, d], [x, h, d]);
      segment([x, h, -d], [x, h, d]);
      segment([x, h, 0], [x, Math.min(d * 1.5, h / 3), 0]);
      segment([x, Math.min(d * 1.5, h / 3), 0], [x, .05, d]);
      segment([x, Math.min(d * 1.5, h / 3), 0], [x, .05, -d]);
    }
    for (const z of [-d, d]) segment([-w, h, z], [w, h, z]);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), new THREE.LineBasicMaterial({color: '#99774a', transparent: true, opacity: xray ? .5 : .4}));
    lines.name = 'Open rim and gusset folds'; root.add(lines);
  } else if (isPastry(o)) {
    const mesh = pastryType(o).makeVisual(o);
    mesh.rotation.x = o.upright ? Math.PI / 2 : 0;
    mesh.position.y = dimensions(o).height / 2;
    root.add(mesh);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.width, o.height, o.depth), new THREE.MeshStandardMaterial({color: '#86afa0', roughness: .65}));
    mesh.position.y = o.height / 2; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

export function dispose(root) {
  const geometries = new Set(), materials = new Set();
  root.traverse(n => {if (n.geometry) geometries.add(n.geometry); for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) materials.add(m);});
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
