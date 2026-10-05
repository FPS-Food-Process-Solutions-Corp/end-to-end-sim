import * as THREE from '../vendor/three.module.js';

export const FLOOR_TEA_KEY = 'tea_machine_hz_d01';
export const FLOOR_TEA_SPEC = {
  id: FLOOR_TEA_KEY, asset_key: FLOOR_TEA_KEY, kind: 'machine',
  label: 'Tea machine / HZ-D01 floor-standing', style: 'tea',
  machine_type: FLOOR_TEA_KEY, width: .60, depth: .70, height: 1.52,
  support: null, z: 0, yaw_deg: 0, equipment_group: 'coffee',
  // Cup-rim target as fractions of the body dimensions: X/Y from its centre,
  // Z from the floor. Bay details are estimated from the supplied photograph.
  service_point: {x: 0, y: -.25 / .70, z: 1.12 / 1.52},
};

export function floorTeaTemplate() {
  const root = new THREE.Group();
  root.name = 'HZ-D01 / floor-standing tea dispenser';
  const steel = new THREE.MeshStandardMaterial({color: '#bdc5c9', metalness: .75, roughness: .28});
  const lightSteel = new THREE.MeshStandardMaterial({color: '#e4e8e8', metalness: .5, roughness: .32});
  const black = new THREE.MeshStandardMaterial({color: '#171a1f', metalness: .1, roughness: .55});
  const rubber = new THREE.MeshStandardMaterial({color: '#24292b', roughness: .75});
  const white = new THREE.MeshStandardMaterial({color: '#e5ecf0', roughness: .27, metalness: .05});
  const interior = new THREE.MeshStandardMaterial({color: '#354475', metalness: .3, roughness: .4, emissive: '#183cff', emissiveIntensity: .15});
  const blue = new THREE.MeshStandardMaterial({color: '#a2baff', emissive: '#405cff', emissiveIntensity: 1.4});
  const glass = new THREE.MeshPhysicalMaterial({color: '#304cdb', transparent: true, opacity: .32,
    metalness: .1, roughness: .1, depthWrite: false, side: THREE.DoubleSide});
  const hopper = new THREE.MeshPhysicalMaterial({color: '#e1ecff', transparent: true, opacity: .82, roughness: .25, emissive: '#203bc2', emissiveIntensity: .15});
  function box(name, size, position, material = steel) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position); mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  function cylinder(name, radius, height, position, material = steel) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), material);
    mesh.position.set(...position); mesh.name = name;
    mesh.castShadow = true; root.add(mesh); return mesh;
  }
  function textPlate(name, text, width, height, position, color = '#edf4fa', bg = null) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (bg) {ctx.fillStyle = bg; ctx.fillRect(0,0,1024,160);}
    ctx.font = '600 88px "Segoe UI", sans-serif'; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text,512,80,980);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),
      new THREE.MeshBasicMaterial({map:texture,transparent:!bg,depthWrite:!!bg}));
    mesh.name = name; mesh.position.set(...position); root.add(mesh); return mesh;
  }

  // Lower cabinet: 900 mm from the feet to the dispenser deck.
  for (const x of [-.245,.245]) for (const z of [-.285,.285]) {
    cylinder('Adjustable rubber foot',.026,.022,[x,.011,z],rubber);
    cylinder('Foot stem',.011,.035,[x,.034,z]);
  }
  box('Cabinet bottom pan',[.58,.025,.67],[0,.062,0]);
  box('Refrigerated cabinet rear',[.58,.82,.022],[0,.477,-.339]);
  for (const x of [-.289,.289]) box('Stainless cabinet side',[.022,.83,.70],[x,.475,0]);
  box('Cabinet inner back',[.55,.71,.012],[0,.49,-.303],interior);
  box('Cabinet lower fascia',[.558,.070,.024],[0,.106,.332],lightSteel);
  box('Cabinet top crossmember',[.60,.035,.70],[0,.8825,0]);
  box('Blue cabinet floor',[.55,.012,.57],[0,.154,0],interior);

  // Seven simplified ingredient reservoirs visible through the blue door.
  const rows = [[.737,[-.177,0,.177]],[.507,[-.13,.13]],[.277,[-.13,.13]]];
  let index = 0;
  for (const [y, xs] of rows) {
    box('Ingredient shelf',[.55,.010,.56],[0,y-.090,-.015],lightSteel);
    for (const x of xs) {
      index++;
      box('Ingredient reservoir '+index,[.136,.145,.18],[x,y,.035],hopper);
      box('Reservoir lid '+index,[.143,.013,.19],[x,y+.079,.035],white);
      box('Reservoir mounting shoe '+index,[.148,.020,.195],[x,y-.083,.035],interior);
      const cap = cylinder('Reservoir outlet '+index,.012,.022,[x,y-.045,.138],white);
      cap.rotation.x = Math.PI/2;
      const points = [[x,y-.045,.150],[x,y-.045,.188],[x+.035,y-.085,.194],[x+.035,y-.089,.10]]
        .map(p=>new THREE.Vector3(...p));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),16,.0045,8,false),white);
      tube.name = 'Reservoir silicone tube '+index; root.add(tube);
    }
  }
  for (const x of [-.262,.262]) box('Blue internal LED strip',[.008,.66,.008],[x,.505,.258],blue);
  for (const x of [-.274,.274]) box('Glass door upright',[.023,.728,.021],[x,.509,.337],lightSteel);
  for (const y of [.151,.867]) box('Glass door rail',[.57,.025,.021],[0,y,.337],lightSteel);
  box('Blue glass cabinet door',[.525,.691,.004],[0,.509,.341],glass);
  box('Door handle',[.013,.145,.013],[.249,.561,.341],steel);
  for (let i=0;i<16;i++) {
    const slot=box('Grille perforation / lower vent',[.008,.029,.001],[ -.24+i*.014,.106,.345],black);
    slot.rotation.z=-.25;
  }
  textPlate('Cabinet model label','HZ-D01',.115,.026,[.16,.108,.345],'#e6edf2','#151a20');
  for (let row=0;row<4;row++) for(let col=0;col<8;col++)
    box('Grille perforation / side vent',[.001,.006,.013],[.2995,.18+row*.015,-.255+col*.025],black);

  // Solid drain deck, open bay and stainless backsplash.
  box('Dispensing deck',[.60,.025,.70],[0,.9125,0],lightSteel);
  box('Bay backsplash',[.555,.315,.020],[0,1.085,-.296],lightSteel);
  for (const x of [-.287,.287]) box('Bay side wall',[.026,.32,.66],[x,1.085,-.02]);
  box('Drip tray rim',[.526,.014,.275],[0,.932,.188],steel);
  box('Recessed tray grate',[.501,.004,.251],[0,.941,.188],lightSteel);
  for (let i=0;i<12;i++)
    box('Grille perforation / drain slot',[.013,.0007,.185],[-.225+i*.041,.943,.188],black);
  const power=cylinder('Ready indicator',.007,.004,[-.236,1.155,-.283],
    new THREE.MeshStandardMaterial({color:'#72cb46',emissive:'#4b9b29',emissiveIntensity:.5}));
  power.rotation.x=Math.PI/2;

  // Sloping black controller head. Front is local +Z, or plan local -Y.
  const low=1.245, high=1.512, frontLow=.341, frontHigh=.289, back=-.35;
  const v=[[-.3,low,back],[.3,low,back],[.3,high,back],[-.3,high,back],
    [-.3,low,frontLow],[.3,low,frontLow],[.3,high,frontHigh],[-.3,high,frontHigh]];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(v.flat(),3));
  geometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,3,7,6,3,6,2,0,1,5,0,5,4]);
  const flatGeometry=geometry.toNonIndexed();geometry.dispose();flatGeometry.computeVertexNormals();
  const head=new THREE.Mesh(flatGeometry,black);head.name='Sloped black control head';head.castShadow=true;root.add(head);
  const tilt=-Math.atan((frontLow-frontHigh)/(high-low));
  const faceZ=y=>frontLow+(y-low)*(frontHigh-frontLow)/(high-low);
  const bezel=box('Touchscreen bezel',[.221,.165,.008],[-.073,1.369,faceZ(1.369)+.006],rubber);
  bezel.rotation.x=tilt;
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#f0f6f8';ctx.fillRect(0,0,640,480);
  ctx.fillStyle='#15486e';ctx.fillRect(0,0,640,75);ctx.font='600 34px Segoe UI';ctx.fillStyle='#ffffff';ctx.fillText('TEA DISPENSER',24,51);
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    ctx.fillStyle=['#c2e4ee','#e1e7ec','#dcead7'][(col+row)%3];
    ctx.fillRect(24+col*205,100+row*111,179,91);
    ctx.fillStyle='#284f64';ctx.font='24px Segoe UI';ctx.fillText('Tea '+(row*3+col+1),42+col*205,158+row*111);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.202,.148),new THREE.MeshBasicMaterial({map:texture}));
  screen.name='Tea touchscreen label';screen.position.set(-.073,1.369,faceZ(1.369)+.011);screen.rotation.x=tilt;root.add(screen);
  const reader=box('Reader inset',[.040,.035,.004],[.202,1.32,faceZ(1.32)+.004],rubber);reader.rotation.x=tilt;
  const brand=textPlate('Head model label','HZ-D01  /  TEA',.171,.025,[.145,1.47,faceZ(1.47)+.003]);brand.rotation.x=tilt;
  box('Stainless top cap',[.599,.007,.698],[0,1.5155,0]);
  for(const x of [-.155,.035]) {
    box('Top ingredient access lid',[.155,.001,.178],[x,1.5195,-.06],lightSteel);
    box('Lid recessed grip',[.054,.0005,.009],[x,1.52,-.075],rubber);
  }
  const topLabel=textPlate('TEA top label','TEA',.19,.05,[.239,1.5203,-.025],'#24343d');
  topLabel.rotation.set(-Math.PI/2,0,Math.PI/2);
  box('Nozzle manifold',[.111,.036,.071],[0,1.225,.235],steel);
  for(const x of [-.029,0,.029]){
    cylinder('Beverage outlet tube',.010,.057,[x,1.1825,.25],steel);
    cylinder('Nozzle tip',.009,.012,[x,1.151,.25],rubber);
  }
  root.userData.reference_dimensions = '600 x 700 x 1520 mm; cabinet 900 mm; upper dispenser 620 mm';
  root.userData.geometry_note = 'Visual approximation of supplied HZ-D01 reference; bay and nozzle details estimated';
  return {model:root,spec:{...FLOOR_TEA_SPEC}};
}
