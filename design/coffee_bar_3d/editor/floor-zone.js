import * as THREE from '../vendor/three.module.js';
import {zoneLabelLayout, ZONE_FONT} from './zone-parameters.js';

export function buildFloorZone(object) {
  const group = new THREE.Group();
  group.name = 'Editable floor marking';
  const {settings, measured, width, height} = zoneLabelLayout(object);
  const w = object.width, d = object.depth, ink = '#498d88';

  // Preserve the editable footprint for framing even when both markings are off.
  // Invisible meshes are omitted from GLB exports.
  const footprint = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial());
  footprint.name = 'Zone editing footprint';
  footprint.rotation.x = -Math.PI / 2;
  footprint.visible = false;
  group.add(footprint);

  if (settings.show_outline) {
    const vertices = [];
    const thickness = Math.min(.004, w * .03, d * .03);
    const rectangle = (x0, z0, x1, z1) => {
      vertices.push(x0,.006,z0, x0,.006,z1, x1,.006,z1,
        x0,.006,z0, x1,.006,z1, x1,.006,z0);
    };
    const edge = (length, horizontal, fixed) => {
      const count = Math.max(1, Math.min(512, Math.ceil(length / .10)));
      const step = length / count;
      for (let index = 0; index < count; index++) {
        const start = -length / 2 + index * step;
        const end = start + step * .6;
        if (horizontal) rectangle(start, fixed - thickness / 2, end, fixed + thickness / 2);
        else rectangle(fixed - thickness / 2, start, fixed + thickness / 2, end);
      }
    };
    edge(w, true, -d / 2); edge(w, true, d / 2);
    edge(d, false, -w / 2); edge(d, false, w / 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: ink, side: THREE.DoubleSide}));
    outline.name = 'Floor zone outline';
    group.add(outline);
  }

  if (settings.show_text && settings.text.trim()) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(4096, Math.max(32, Math.ceil(measured + 20)));
    canvas.height = 140;
    const context = canvas.getContext('2d');
    context.font = ZONE_FONT;
    context.fillStyle = ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(settings.text, canvas.width / 2, 70, canvas.width - 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const text = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide}));
    text.name = 'Floor zone text';
    text.userData.zone_text = settings.text;
    text.rotation.x = -Math.PI / 2;
    text.position.y = .007;
    group.add(text);
  }
  return group;
}
