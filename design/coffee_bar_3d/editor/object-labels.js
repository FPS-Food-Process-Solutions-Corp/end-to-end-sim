import * as THREE from '../vendor/three.module.js';
import {wrapLabel, labelCanvas, objectLabelSettings} from './label-layout.js';

// Textures keep edited lettering exportable to GLB, including non-Latin names.
function lettering(text, maxWidth, textHeight, color) {
  const layout = wrapLabel(text, maxWidth, textHeight, 600);
  const {canvas, width, height} = labelCanvas(layout, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({map:texture, transparent:true, depthWrite:false,
      polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}));
  mesh.name = 'Editable label / ' + text;
  mesh.userData = {editable_object_label:true, text, lines:layout.lines, text_height_m:textHeight};
  return mesh;
}

export function disposeObjectLabel(record) {
  if (!record.displayLabel) return;
  record.displayLabel.traverse(part => {
    part.geometry?.dispose();
    part.material?.map?.dispose();
    part.material?.dispose();
  });
  record.displayLabel.removeFromParent();
  record.displayLabel = null;
}

export function syncObjectLabel(record, object) {
  if (!['machine','shelf','dispenser','vent'].includes(object.kind)) return;
  const custom = typeof object.display_label === 'string' || object.label_size_percent !== undefined || object.label_rotation_deg !== undefined;
  // Hide only the existing object-name lettering, keeping controls and branding.
  record.mesh.traverse(part => {
    if (part.userData.equipment_top_label ||
        /^(Equipment[ _]label|Shelf[ _]label|TEA[ _]top[ _]label)/.test(part.name)) {
      part.userData.original_label_visible ??= part.visible;
      part.visible = custom ? false : part.userData.original_label_visible;
    }
  });
  const signature = JSON.stringify([object.display_label,object.label_size_percent,object.label_rotation_deg,object.width,object.depth,object.height]);
  if (record.displayLabelSignature === signature) return;
  disposeObjectLabel(record);
  record.displayLabelSignature = signature;
  if (!custom) return;

  const root = new THREE.Group();
  root.name = 'Editable object lettering';
  root.userData.editable_object_labels = true;
  const {width:w, depth:d} = object, h = object.height || record.template.spec.height;
  const {scale,rotation} = objectLabelSettings(object), turnsSideways = rotation%180===90;
  const text = object.display_label ?? object.label;
  const topText = object.display_label ?? record.topImprints[0]?.userData.text ??
    ({ice:'ICE',tea:'TEA',coffee:'COFFEE',fridge:'MILK',lid_press:'LID PRESS'}[object.style] || text);
  const turnFront = front => {
    front.rotation.z = -rotation*Math.PI/180;
    const height = turnsSideways ? front.geometry.parameters.width : front.geometry.parameters.height;
    front.position.y = Math.min(front.position.y,h-.01-height/2);
  };
  // This group is a sibling of the scaled asset. Lettering uses final dimensions.
  root.scale.set(1/record.node.scale.x, 1/record.node.scale.y, 1/record.node.scale.z);
  if (object.kind === 'shelf') {
    const front = lettering(text,turnsSideways?h*.75:w*.86,.05*scale,'#26676b');
    front.position.set(0,h-.07,d/2+.009);
    turnFront(front);
    root.add(front);
  } else {
    const alongDepth = ['machine','vent'].includes(object.kind) && d > w;
    const top = lettering(topText,(turnsSideways?Math.min(w,d):Math.max(w,d))*.78,
      .048*scale,object.kind==='dispenser'?'#eef3ef':'#253e47');
    top.rotation.set(-Math.PI/2,0,(alongDepth?Math.PI/2:0)-rotation*Math.PI/180);
    top.position.set(0,h+.001,0);
    top.userData.long_axis = alongDepth !== turnsSideways ? 'depth' : 'width';
    top.userData.label_rotation_deg = rotation;
    root.add(top);
    if (object.kind === 'machine' || object.kind === 'vent') {
      const front = lettering(text,turnsSideways?h*.6:w*.82,.024*scale,'#253e47');
      front.position.set(0,h*.95,d/2+.018);
      turnFront(front);
      root.add(front);
    }
  }
  record.node.add(root);
  record.displayLabel = root;
}
