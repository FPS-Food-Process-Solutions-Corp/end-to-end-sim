import * as THREE from '../vendor/three.module.js';
import {GLTFExporter} from '../vendor/GLTFExporter.js';
import {poseSuctionRobot} from './suction-render.js';
import {poseTongGrip} from './bread-render.js';
import {PlanView} from './plan.js';

const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const png = canvas => new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?blob.arrayBuffer().then(b=>resolve(new Uint8Array(b))):reject(new Error('Image capture failed')),'image/png'));

export function captureGeometry(view, store, players = []) {
  const visibility = new Map();
  for (const player of players) {
    for (const entry of player?.hidden || []) visibility.set(entry.node, entry.visible);
    if (player?.breadPlayer?.source) visibility.set(player.breadPlayer.source, player.breadPlayer.originalVisible);
  }
  function restoreVisibility(source, copy) {
    if (visibility.has(source)) copy.visible = visibility.get(source);
    source.children.forEach((child,index) => restoreVisibility(child,copy.children[index]));
  }
  const physical = new THREE.Group(), instances = new Map();
  for (const object of store.scene.objects) {
    const original = view.instances.get(object.id);
    if (!original) throw new Error('Model missing: '+object.id);
    const node = original.node.clone(false);
    const nova = object.kind === 'robot' && ['nova5','nova5_suction','nova2','nova5_coffee'].includes(store.key(object));
    const mesh = (nova ? original.template.model : original.mesh).clone(true);
    if (!nova) restoreVisibility(original.mesh,mesh);
    node.add(mesh);
    if (original.displayLabel) node.add(original.displayLabel.clone(true));
    node.position.set(object.x,store.z(object),-object.y);
    node.visible = store.visible(object.id);
    const record = {node,mesh,template:original.template};
    if (nova) {
      poseSuctionRobot(record,Array.from({length:6},(_,i)=>(object.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180));
      if (store.key(object)==='nova5') poseTongGrip(record,(object.joints_deg?.gripper_r_joint1||0)*Math.PI/180);
    }
    physical.add(node);instances.set(object.id,record);
  }
  physical.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e6edec');
  scene.environment = view.scene.environment;
  scene.environmentIntensity = .7;
  scene.add(new THREE.HemisphereLight(0xeaf5ff,0xa28e71,2));
  const light = new THREE.DirectionalLight(0xfff2dc,3);light.position.set(-4,8,6);scene.add(light);
  const room = view.room.clone(true);scene.add(room,physical);
  return {store,physical,room,scene,instances,ready:true};
}

function legendSVG(components,x,y) {
  return components.map((c,i)=>`<g transform="translate(${x} ${y+i*37})"><circle r="10" fill="#176f69"/><text y="4" text-anchor="middle" font-size="11" fill="white">${c.number}</text><text x="18" y="0" font-size="13" fill="#183e46">${esc(c.label||c.id)}</text><text x="18" y="15" font-size="10" fill="#607b80">${esc(c.id)}</text></g>`).join('');
}

export function topDownSVG(store, resolved) {
  const active=resolved.components.filter(c=>c.active);
  const points=active.flatMap(c=>c.footprint_world_xy_m);
  const left=Math.min(0,...points.map(p=>p[0]))*200-45;
  const right=Math.max(store.scene.room.width,...points.map(p=>p[0]))*200+45;
  const bottom=Math.min(0,...points.map(p=>p[1]))*200-45;
  const top=Math.max(store.scene.room.depth,...points.map(p=>p[1]))*200+45;
  const planWidth=right-left,planHeight=top-bottom,legendWidth=Math.max(400,...active.map(c=>Math.max(String(c.label||c.id).length*7,String(c.id).length*6)+60));
  const width=planWidth+legendWidth+70,height=Math.max(planHeight+120,active.length*37+130);
  const layout={store};
  const items=active.map(c=>{
    const o=store.object(c.id),x=o.x*200-left,y=top-o.y*200;
    const shape=PlanView.prototype.geometry.call(layout,o);
    return `<g transform="translate(${x} ${y}) rotate(${-(o.yaw_deg||0)})">${shape}</g>`;
  }).join('');
  // Number labels form a separate top layer so furniture cannot cover them.
  const occupied=[];
  const numbers=active.map(c=>{
    const x=c.world_base_m[0]*200-left,baseY=top-c.world_base_m[1]*200;
    let y=baseY;
    while(occupied.some(p=>Math.hypot(p.x-x,p.y-y)<25))y-=26;
    occupied.push({x,y});
    return `<line x1="${x}" y1="${baseY}" x2="${x}" y2="${y}" stroke="#688e86"/><g transform="translate(${x} ${y})"><circle r="10" fill="#176f69" stroke="white" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="11" fill="white">${c.number}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI,Arial,sans-serif"><rect width="100%" height="100%" fill="white"/><text x="28" y="30" font-size="20" fill="#183e46">Robot café · numbered top-down layout</text><text x="28" y="52" font-size="12" fill="#607b80">2 px = 1 cm · world +Y rear / up this page · front at bottom · footprints are not solid collision volumes</text><g transform="translate(25 80)"><rect x="${-left}" y="${top-store.scene.room.depth*200}" width="${store.scene.room.width*200}" height="${store.scene.room.depth*200}" fill="#f4f7f5" stroke="#97ada9"/>${items}${numbers}<path d="M ${-left} ${top} h 70 m -70 0 v -70" fill="none" stroke="#bc6b35" stroke-width="2"/><text x="${-left+73}" y="${top+4}" font-size="12">+X</text><text x="${-left+5}" y="${top-72}" font-size="12">+Y</text></g>${legendSVG(active,planWidth+55,110)}</svg>`;
}

export async function svgPNG(svg) {
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try {
    const image = new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas'),scale=Math.min(1,2600/image.width,2600/image.height);
    canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    return await png(canvas);
  } finally {URL.revokeObjectURL(url);}
}

export async function angledPNG(capture,resolved) {
  const active=resolved.components.filter(c=>c.active),renderWidth=1500,renderHeight=1200;
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(renderWidth,renderHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  try {
    const bounds=new THREE.Box3().setFromObject(capture.room);
    for(const record of capture.instances.values())if(record.node.visible)bounds.expandByObject(record.node);
    const centre=bounds.getCenter(new THREE.Vector3());
    const camera=new THREE.PerspectiveCamera(40,renderWidth/renderHeight,.01,1000);
    const direction=new THREE.Vector3(-1,1.2,1.35).normalize();
    camera.position.copy(centre).add(direction);camera.lookAt(centre);
    const inverse=camera.quaternion.clone().invert(),tan=Math.tan(camera.fov*Math.PI/360);
    let distance=1;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const p=new THREE.Vector3(x,y,z).sub(centre).applyQuaternion(inverse);
      distance=Math.max(distance,p.z+Math.abs(p.x)/(tan*camera.aspect),p.z+Math.abs(p.y)/tan);
    }
    camera.position.copy(centre).addScaledVector(direction,distance*1.12);
    camera.updateMatrixWorld(true);renderer.render(capture.scene,camera);
    const canvas=document.createElement('canvas'),columns=Math.max(1,Math.ceil(active.length/30));
    canvas.width=renderWidth+Math.min(columns,4)*390;
    canvas.height=Math.max(renderHeight+100,Math.ceil(active.length/Math.min(columns,4))*38+100);
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(renderer.domElement,0,70);
    context.fillStyle='#183e46';context.font='26px Segoe UI';context.fillText('Robot café · saved scene geometry',30,36);
    context.font='15px Segoe UI';context.fillStyle='#607b80';context.fillText('Saved joint poses · reference labels match top-down view and resolved-layout.json · not a validated motion frame',30,60);
    const occupied=[];
    for(let i=0;i<active.length;i++) {
      const c=active[i],p=new THREE.Vector3(c.world_base_m[0],c.world_base_m[2]+(c.local_size_m.height||.2)*.6,-c.world_base_m[1]).project(camera);
      const x=(p.x+1)*renderWidth/2,originY=(1-p.y)*renderHeight/2+70;
      let y=originY;
      while(occupied.some(a=>Math.abs(a.x-x)<30&&Math.abs(a.y-y)<28))y-=29;
      occupied.push({x,y});
      context.strokeStyle='#527d79';context.beginPath();context.moveTo(x,originY);context.lineTo(x,y);context.stroke();
      context.fillStyle='#176f69';context.beginPath();context.arc(x,y,13,0,Math.PI*2);context.fill();
      context.fillStyle='#fff';context.font='bold 14px Segoe UI';context.textAlign='center';context.fillText(String(c.number),x,y+5);context.textAlign='left';
      const rows=Math.ceil(active.length/Math.min(columns,4)),lx=renderWidth+20+Math.floor(i/rows)*390,ly=100+(i%rows)*38;
      context.fillStyle='#176f69';context.font='bold 14px Segoe UI';context.fillText(c.number+'.',lx,ly);
      context.fillStyle='#183e46';context.font='15px Segoe UI';context.fillText(c.label||c.id,lx+30,ly,345);
      context.fillStyle='#607b80';context.font='12px Segoe UI';context.fillText(c.id,lx+30,ly+16,345);
    }
    return await png(canvas);
  } finally {renderer.dispose();}
}

export async function capturedGLB(capture,scene) {
  const output=new THREE.Scene();output.name='AI handoff saved scene';
  output.userData.sceneConfig=scene;output.add(capture.room.clone(true),capture.physical.clone(true));
  output.updateMatrixWorld(true);
  return new Uint8Array(await new GLTFExporter().parseAsync(output,{binary:true,onlyVisible:true}));
}
