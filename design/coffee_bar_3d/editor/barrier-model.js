import {orderingConsoleLayout} from './ordering-console.js';
import * as THREE from '../vendor/three.module.js';
import {barrierSettings, barrierPanels, barrierSections, panelCells} from './barrier-parameters.js';

function faceTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 768;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = kind === 'tablet' ? '#eef7f2' : '#fcfbf5';
  ctx.fillRect(0, 0, 768, 768);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#16776d';
  ctx.fillRect(0, 0, 768, 130);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px Segoe UI, sans-serif';
  ctx.fillText(kind === 'tablet' ? 'ORDER & COLLECT' : 'HOW TO ORDER', 42, 83);
  ctx.fillStyle = '#36584e';
  ctx.font = 'bold 48px Segoe UI, sans-serif';
  const lines = kind === 'tablet'
    ? ['Fresh buns', 'Coffee & tea', 'Choose your favourites']
    : ['1  Choose your items', '2  Confirm at tablet', '3  Collect at side window'];
  lines.forEach((line, index) => {
    ctx.font = (index === 2 ? '34' : '42') + 'px Segoe UI, sans-serif';
    ctx.fillText(line, 42, 245 + index * 115);
  });
  ctx.fillStyle = '#16776d';
  ctx.fillRect(42, 610, 684, 102);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px Segoe UI, sans-serif';
  ctx.fillText(kind === 'tablet' ? 'Start order   →' : 'Speak into the intercom', 65, 676);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function label(text, width, height = .038) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fcfa'; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#216d63'; ctx.font = 'bold 64px Segoe UI, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide}));
}

function consoleHousing(layout, material) {
  const {left:l, right:r, base:b, frontHeight:f, backHeight:h, depth:d} = layout;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    l,b,0, r,b,0, r,b,d, l,b,d, l,h,0, r,h,0, r,f,d, l,f,d,
  ], 3));
  geometry.setIndex([0,1,2,0,2,3, 0,4,5,0,5,1, 3,2,6,3,6,7,
    0,3,7,0,7,4, 1,5,6,1,6,2, 4,7,6,4,6,5]);
  const faces = geometry.toNonIndexed();
  geometry.dispose();
  faces.computeVertexNormals();
  const mesh = new THREE.Mesh(faces, material);
  mesh.name = 'Projecting sloped ordering console';
  mesh.userData.barrierRole = 'ordering-console';
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export function buildBarrier(object) {
  const p = barrierSettings(object);
  const sections = barrierSections(object);
  const model = new THREE.Group();
  model.name = 'Customer barrier';
  const clear = new THREE.MeshPhysicalMaterial({
    color: 0xb8e6ed, transparent: true, opacity: p.opacity, roughness: .12,
    metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  const steel = new THREE.MeshStandardMaterial({color: 0xcbd4d7, metalness: .7, roughness: .28});
  const white = new THREE.MeshStandardMaterial({color: 0xf1f4f1, metalness: .18, roughness: .38});
  const dark = new THREE.MeshStandardMaterial({color: 0x202c30, roughness: .6});
  const teal = new THREE.MeshStandardMaterial({color: 0x227e70, roughness: .45});
  const box = (parent, name, x, y, z, width, height, depth, material, role) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z); mesh.name = name;
    mesh.userData.barrierRole = role || name;
    mesh.castShadow = material !== clear; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  };
  for (const side of barrierPanels(object)) {
    const panel = new THREE.Group();
    panel.name = side === 'front' ? 'Front barrier panel' : 'Side barrier panel';
    panel.userData.barrierPanel = side;
    if (side === 'front') panel.position.z = object.depth / 2;
    else { panel.position.x = object.width / 2; panel.rotation.y = Math.PI / 2; }
    model.add(panel);
    const span = side === 'front' ? object.width : object.depth;
    const features = sections.filter(section => section.side === side);
    const consoleLayout = orderingConsoleLayout(p, features);
    let consoleSurface;
    if (consoleLayout) {
      panel.add(consoleHousing(consoleLayout, white));
      consoleSurface = new THREE.Group();
      consoleSurface.name = 'Inclined control surface';
      consoleSurface.userData = {barrierRole:'console-surface', inclineDegrees:p.console_incline_deg};
      consoleSurface.position.set(0, consoleLayout.frontHeight, consoleLayout.depth);
      consoleSurface.rotation.x = consoleLayout.rotationX;
      panel.add(consoleSurface);
    }
    const holes = features.filter(section => section.kind !== 'instructions' &&
      !(consoleLayout && ['tablet', 'intercom'].includes(section.kind)));
    for (const cell of panelCells(span, object.height, holes)) {
      box(panel, 'Clear plastic pane', cell.center, cell.middle, 0,
        cell.width, cell.height, p.thickness, clear, 'plastic');
    }
    for (const x of [-span / 2, span / 2]) {
      box(panel, 'Vertical perimeter rail', x, object.height / 2, 0,
        p.frame, object.height, p.frame, steel, 'frame');
    }
    box(panel, 'Top perimeter rail', 0, object.height - p.frame / 2, 0, span, p.frame, p.frame, steel, 'frame');
    const pickup = features.find(section => section.kind === 'pickup');
    // Leave the sill flush with the table; do not bridge the open pickup aperture.
    const bottomPieces = pickup && pickup.bottom < p.frame
      ? [[-span / 2, pickup.center - pickup.width / 2],
        [pickup.center + pickup.width / 2, span / 2]] : [[-span / 2, span / 2]];
    for (const [from, to] of bottomPieces) {
      if (to > from) box(panel, 'Bottom rail', (from + to) / 2, 0, 0, to - from, p.frame, p.frame, steel, 'frame');
    }
    for (const feature of features) {
      const {kind, center, bottom, width, height} = feature;
      if (kind === 'pickup') {
        for (const x of [center - width / 2 - p.frame / 2, center + width / 2 + p.frame / 2]) {
          box(panel, 'Pickup side jamb', x, bottom + height / 2, 0,
            p.frame, height + 2 * p.frame, p.frame * 1.4, white, 'pickup-frame');
        }
        for (const y of [bottom - p.frame / 2, bottom + height + p.frame / 2]) {
          box(panel, 'Pickup opening rail', center, y, 0, width, p.frame, p.frame * 1.4, white, 'pickup-frame');
        }
        const sign = label('COLLECT HERE', Math.min(width, .36), .045);
        sign.position.set(center, Math.min(object.height - .04, bottom + height + .065), p.frame / 2 + .001);
        panel.add(sign);
        const aperture = new THREE.Object3D();
        aperture.name = 'Pickup clear opening';
        aperture.position.set(center, bottom + height / 2, 0);
        aperture.userData = {barrierRole: 'pickup-opening', clearWidth: width, clearHeight: height, bottom};
        panel.add(aperture);
      } else if (kind === 'tablet') {
        const mount = consoleSurface || panel;
        box(mount, 'Tablet bezel', center, bottom + height / 2, 0, width + .014, height + .014, .035, dark, 'tablet');
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(width - .018, height - .018),
          new THREE.MeshBasicMaterial({map: faceTexture('tablet')}));
        screen.name = 'Ordering touchscreen'; screen.position.set(center, bottom + height / 2, .018);
        mount.add(screen);
      } else if (kind === 'intercom') {
        const mount = consoleSurface || panel;
        box(mount, 'Intercom mounting plate', center, bottom + height / 2, 0,
          width + .018, height + .018, .028, white, 'intercom');
        const speaker = new THREE.Mesh(new THREE.CylinderGeometry(width * .45, width * .45, .014, 40), dark);
        speaker.rotation.x = Math.PI / 2;
        speaker.position.set(center, bottom + height / 2, .02);
        speaker.name = 'Combined microphone and speaker';
        mount.add(speaker);
        for (let row = -3; row <= 3; row++) for (let column = -3; column <= 3; column++) {
          if (row * row + column * column > 10) continue;
          const dot = new THREE.Mesh(new THREE.CircleGeometry(width * .015, 8), steel);
          dot.position.set(center + column * width * .10, bottom + height / 2 + row * width * .10, .028);
          dot.name = 'Intercom grille perforation'; mount.add(dot);
        }
        const indicator = new THREE.Mesh(new THREE.CircleGeometry(.003, 12), teal);
        indicator.position.set(center, bottom + .008, .029); mount.add(indicator);
        const sign = label('MIC + SPEAKER', .17, .028);
        sign.position.set(center, Math.max(.035, bottom - .035), .02);
        mount.add(sign);
      } else {
        box(panel, 'Instruction flyer holder', center, bottom + height / 2, p.thickness / 2 + .005,
          width + .012, height + .012, .010, white, 'instructions');
        const flyer = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
          new THREE.MeshBasicMaterial({map: faceTexture('instructions')}));
        flyer.name = 'Customer instructions';
        flyer.position.set(center, bottom + height / 2, p.thickness / 2 + .011);
        panel.add(flyer);
      }
    }
  }
  return model;
}

export function disposeBarrier(model) {
  const materials = new Set(), textures = new Set();
  model.traverse(node => {
    node.geometry?.dispose();
    const list = node.material ? Array.isArray(node.material) ? node.material : [node.material] : [];
    for (const material of list) {
      if (material.map) textures.add(material.map);
      materials.add(material);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
