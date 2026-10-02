import * as THREE from '../vendor/three.module.js';

export function placementTemplate() {
  const model = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.BoxGeometry(1, .003, 1),
    new THREE.MeshStandardMaterial({color: 0x65bda3, transparent: true, opacity: .32, depthWrite: false, roughness: .8}));
  surface.position.y = .0015;
  model.add(surface);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, .003, 1)),
    new THREE.LineBasicMaterial({color: 0x228b73}));
  outline.position.y = .002;
  model.add(outline);
  return {model, spec: {kind: 'placement_zone', width: 1, depth: 1, height: .003}};
}

export function setupSuctionJoints(record) {
  if (record.joints) return record.joints;
  record.joints = [];
  record.mesh.traverse(node => {
    if (/^joint[1-6]$/.test(node.userData.urdf_joint || '')) {
      record.joints[Number(node.userData.urdf_joint.slice(-1)) - 1] = {
        node, rest: node.quaternion.clone(),
      };
    }
    if (node.userData.role === 'suction_tcp') record.tcp = node;
  });
  return record.joints;
}

export function poseSuctionRobot(record, angles) {
  if (!record) return;
  const axis = new THREE.Vector3(0, 1, 0); // URDF +Z in the glTF / Three convention.
  setupSuctionJoints(record).forEach((joint, index) => {
    joint.node.quaternion.copy(joint.rest).multiply(
      new THREE.Quaternion().setFromAxisAngle(axis, angles[index]));
  });
  record.node.updateMatrixWorld(true);
}
