import * as THREE from '../vendor/three.module.js';

// The hatched 风井 in the supplied floor plan is a building shaft. Its internal
// ducts, openings and finish are unknown, so reserve its complete outer volume.
export function ventilationShaftTemplate() {
  const width=2.55,depth=.74,height=3;
  const model=new THREE.Group();
  model.name='Ventilation shaft enclosure / provisional height';
  const concrete=new THREE.MeshStandardMaterial({color:'#b4b7b1',roughness:.9});
  const cap=new THREE.MeshStandardMaterial({color:'#83938f',roughness:.85});
  const body=new THREE.Mesh(new THREE.BoxGeometry(width,height-.01,depth),concrete);
  body.position.y=(height-.01)/2;
  body.name='Ventilation shaft enclosure / reserved volume';
  body.castShadow=true;body.receiveShadow=true;model.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(width,.01,depth),cap);
  top.position.y=height-.005;top.name='Shaft top boundary';model.add(top);
  model.userData.geometry_note='Shaft envelope only; 3 m initial height is unconfirmed.';
  return {model,spec:{kind:'vent',width,depth,height}};
}
