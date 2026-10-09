import * as THREE from '../vendor/three.module.js';
import {fixtureBag, fixedContact, stackSettings, STACK_BASE} from './bag-fixture-parameters.js';

function materials() {
  return {
    metal: new THREE.MeshStandardMaterial({color: 0xb8c5c8, metalness: .75, roughness: .3}),
    black: new THREE.MeshStandardMaterial({color: 0x202b30, metalness: .25, roughness: .46}),
    rubber: new THREE.MeshStandardMaterial({color: 0x248f96, roughness: .65}),
    paper: new THREE.MeshStandardMaterial({color: 0xd9b77e, roughness: .9}),
    edge: new THREE.MeshStandardMaterial({color: 0xe9cca0, roughness: .94}),
  };
}
function box(parent, name, size, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name; mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(parent, name, radius, length, position, material, axis = 'y', topRadius = radius) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, radius, length, 32), material);
  mesh.name = name; mesh.position.set(...position);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

// Same 80 × 80 × 100 mm envelope as the Nova-5 tool; flange at Z=0, lips at Z=.10.
export function fourCupGripper(m) {
  const tool = new THREE.Group(); tool.name = 'Fixed four-cup suction gripper';
  tool.userData = {role: 'fixed_suction_tool', face_width_m: .08, face_height_m: .08, flange_to_contact_m: .10};
  cylinder(tool, 'Fixed suction flange', .031, .012, [0, 0, .006], m.metal, 'z');
  box(tool, 'Fixed suction head body', [.06, .06, .06], [0, 0, .042], m.black);
  box(tool, 'Fixed suction 80 mm face', [.08, .08, .006], [0, 0, .073], m.metal);
  for (const x of [-.025, .025]) for (const y of [-.025, .025]) {
    cylinder(tool, 'Fixed cup stem', .004, .012, [x, y, .082], m.metal, 'z');
    const cup = cylinder(tool, 'Fixed rear suction cup', .0045, .018, [x, y, .091], m.rubber, 'z', .010);
    cup.userData.vacuum_cup = true;
    cylinder(tool, 'Fixed rear suction cup lip', .010, .002, [x, y, .099], m.rubber, 'z');
  }
  return tool;
}

// A normalized bag shell, open at the mouth. FlowPlayer scales it to the chosen bag.
function paperBag(m) {
  const bag = new THREE.Group(); bag.name = 'Handled kraft bag'; bag.userData.role = 'moving_bag';
  for (const z of [0, -.09]) box(bag, 'Paper face', [.15, .28, .0007], [0, .14, z], m.paper);
  for (const x of [-.075, .075]) box(bag, 'Paper gusset', [.0007, .28, .09], [x, .14, -.045], m.paper);
  box(bag, 'Paper bottom', [.15, .0007, .09], [0, .00035, -.045], m.paper);
  return bag;
}

export function buildBagFixture(o) {
  const root = new THREE.Group(), m = materials(); root.name = o.label;
  if (o.layout_component === 'magazine') {
    const p = stackSettings(o), wall = .004;
    box(root, 'Stack holder base', [o.width, STACK_BASE, o.depth], [0, STACK_BASE / 2, 0], m.black);
    for (const x of [-1, 1]) {
      box(root, 'Stack holder side', [wall, o.height - STACK_BASE, o.depth], [x * (o.width - wall) / 2, (o.height + STACK_BASE) / 2, 0], m.black);
      const cheek = Math.max(.012, o.width * .16);
      box(root, 'Stack holder front cheek', [cheek, o.height - STACK_BASE, wall], [x * (o.width - cheek) / 2, (o.height + STACK_BASE) / 2, (o.depth - wall) / 2], m.black);
    }
    box(root, 'Stack holder back', [o.width, o.height - STACK_BASE, wall], [0, (o.height + STACK_BASE) / 2, -(o.depth - wall) / 2], m.black);
    box(root, 'Stack holder front sill', [o.width, Math.min(.025, o.height / 4), wall], [0, STACK_BASE + Math.min(.025, o.height / 4) / 2, (o.depth - wall) / 2], m.black);
    // Render at most 40 layers while keeping the true, configurable stack height.
    const layers = Math.min(40, p.bag_count), step = p.bag_count * p.bag_thickness / Math.max(1, layers);
    for (let i = 0; i < layers; i++) {
      const name = 'Stored_flat_bag_' + String(i + 1).padStart(2, '0');
      const top = STACK_BASE + (p.bag_count - i * p.bag_count / layers) * p.bag_thickness;
      box(root, name, [p.bag_width, step * .92, p.bag_height], [0, top - step / 2, 0], i % 2 ? m.paper : m.edge);
    }
    root.userData.stackTop = p.top;
  } else {
    const bag = fixtureBag(o), contact = fixedContact(o), flangeY = contact[1] + .10;
    box(root, 'Fixed station bolted base', [o.width, .008, o.depth], [0, .004, 0], m.metal);
    const plateHeight = Math.max(.10, o.height - .008);
    box(root, 'Fixed gripper backplate', [Math.min(o.width - .016, .16), plateHeight, .006], [0, .008 + plateHeight / 2, -flangeY - .003], m.metal);
    for (const x of [-.058, .058]) {
      box(root, 'Backplate mounting foot', [.024, .012, .045], [x, .014, -flangeY + .014], m.metal);
      cylinder(root, 'Backplate fixing bolt', .004, .005, [x, .0225, -flangeY + .024], m.black);
    }
    const tool = fourCupGripper(m); tool.position.set(0, contact[2], -flangeY); root.add(tool);
    for (const x of [-.022, .022]) for (const y of [-.022, .022])
      cylinder(root, 'Gripper flange bolt', .003, .006, [x, contact[2] + y, -flangeY - .008], m.black, 'z');
    box(root, 'Bag bottom support', [bag.width + .016, .004, bag.depth + .016], [0, bag.floor - .002, -contact[1] + bag.depth / 2], m.metal);
    const shell = paperBag(m);
    shell.scale.set(bag.width / .15, bag.height / .28, bag.depth / .09);
    shell.position.set(0, bag.floor, -contact[1] + bag.depth);
    shell.visible = o.bag_parameters?.show_bag !== false;
    root.add(shell);
  }
  return root;
}
