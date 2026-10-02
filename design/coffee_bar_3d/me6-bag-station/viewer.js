import * as THREE from '../vendor/three.module.js';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {RoomEnvironment} from '../vendor/RoomEnvironment.js';
const $=id=>document.getElementById(id),capture=new URLSearchParams(location.search).has('capture');
if(capture)document.body.classList.add('capture');
const renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(capture?1:Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e8eee9');
const env=new RoomEnvironment(),pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(env,.04).texture;env.dispose();pm.dispose();scene.environmentIntensity=.7;
scene.add(new THREE.HemisphereLight(0xeaf6fa,0x7d8d7e,1.4));
const light=new THREE.DirectionalLight(0xfff2dd,2.4);light.position.set(-1.3,3,1);light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-1,right:1,top:1,bottom:-1,near:.1,far:7});light.shadow.bias=-.0002;scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xd9e0d9,roughness:.9}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.002;floor.receiveShadow=true;scene.add(floor);
const persp=new THREE.PerspectiveCamera(36,1,.01,50),ortho=new THREE.OrthographicCamera(-.7,.7,.6,-.6,.01,50);
let camera=persp,controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;
let data,P,root,bag,tcp,joints=[],time=0,playing=false,last=0,view='iso',guideLine;
const framesInfo=[
 {until:2.7,step:0,title:'Approach the magazine',detail:'The suction head approaches the exposed face of one flat bag.'},
 {until:5.55,step:1,title:'Grip one bag',detail:'Robot vacuum turns on while the bag is registered in the magazine.'},
 {until:7.8,step:1,title:'Withdraw from the magazine',detail:'The head pulls the bag clear and lifts it above the bottom guides.'},
 {until:11.7,step:2,title:'Carry the bag upright',detail:'The ME6 carries the bag across to the fixed opening station.'},
 {until:14.1,step:3,title:'Present to the opposing suction',detail:'The rear paper face approaches the fixed cups above the support tray.'},
 {until:15.6,step:3,title:'Confirm the fixed grip',detail:'Both vacuum circuits hold opposite faces before opening begins.'},
 {until:18.75,step:4,title:'Pull the mouth open',detail:'The ME6 retreats while the rear face remains at the fixed cups.'},
 {until:Infinity,step:4,title:'Hold for loading',detail:'The tray supports the bag; the ME6 holds its front face.'}
];
function resize(){
 const w=$('stage').clientWidth,h=$('stage').clientHeight;renderer.setSize(w,h,false);persp.aspect=w/h;persp.updateProjectionMatrix();
 const width=Math.max(1.22,1.02*w/h);ortho.left=-width/2;ortho.right=width/2;ortho.top=width/(w/h)/2;ortho.bottom=-ortho.top;ortho.updateProjectionMatrix();
}
function setView(mode){
 view=mode;camera=mode==='top'?ortho:persp;controls.dispose();controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;
 const height=P?.table.height||.9;controls.target.set(0,height+.12,0);
 if(mode==='top'){camera.position.set(0,height+2.5,0);camera.up.set(0,0,-1);controls.enableRotate=false;}
 else{camera.position.set(1.08,height+1.02,1.3);camera.up.set(0,1,0);controls.enableRotate=true;}
 camera.lookAt(controls.target);controls.update();resize();
 $('top').setAttribute('aria-pressed',mode==='top');$('iso').setAttribute('aria-pressed',mode==='iso');
}
function labelAt(id,position){
 const v=position.clone().project(camera),el=$(id),w=$('stage').clientWidth,h=$('stage').clientHeight;
 el.style.left=((v.x+1)*w/2)+'px';el.style.top=((1-v.y)*h/2)+'px';
}
function render(){
 if(!P)return;controls.update();const z=P.table.height;
 labelAt('label-mag',new THREE.Vector3(P.magazine.x,z+P.magazine.height+.025,-P.magazine.front_y-.09));
 labelAt('label-fixed',new THREE.Vector3(P.station.x+.015,z+.355,-P.station.rear_face_y-.06));
 labelAt('label-bag',bag.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(view==='top'?.28:.15,P.bag.height+.015,0)));
 renderer.render(scene,camera);
}
function seek(value){
 if(!data)return;time=Math.max(0,Math.min(P.motion.duration,value));
 const f=time*P.motion.fps,i=Math.min(data.frames.length-1,Math.floor(f)),a=data.frames[i],b=data.frames[Math.min(i+1,data.frames.length-1)],u=f-i;
 joints.forEach((j,k)=>j.node.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromAxisAngle(j.axis,a.q[k]+(b.q[k]-a.q[k])*u)));
 const v=a.bag_position.map((x,k)=>x+(b.bag_position[k]-x)*u),depth=a.bag_depth+(b.bag_depth-a.bag_depth)*u;
 bag.position.set(v[0],P.table.height+v[2],-v[1]);bag.scale.set(1,1,depth/P.bag.depth);
 root.updateMatrixWorld(true);
 const state=framesInfo.find(p=>time*24/P.motion.duration<p.until)||framesInfo.at(-1);
 $('phase').textContent=state.title;$('detail').textContent=state.detail;
 $('robot-vac').classList.toggle('on',a.robot_vacuum);$('fixed-vac').classList.toggle('on',a.fixed_vacuum);
 $('label-bag').style.display=$('guides').checked&&a.robot_vacuum?'block':'none';$('label-bag').textContent=a.fixed_vacuum?'Both faces held':'Bag attached';
 $('time').textContent=time.toFixed(1)+' / '+P.motion.duration.toFixed(1)+' s';$('scrub').value=time;
 document.querySelectorAll('.steps button').forEach((b,k)=>b.classList.toggle('active',k===state.step));render();
}
function pause(){playing=false;$('play').textContent=time>=P.motion.duration?'↻ Replay sequence':'▶ Play sequence';}
$('play').onclick=()=>{if(playing){pause();return;}if(time>=P.motion.duration)seek(0);playing=true;last=performance.now();$('play').textContent='Ⅱ Pause';};
$('reset').onclick=()=>{pause();seek(0);};
$('scrub').oninput=e=>{pause();seek(Number(e.target.value));};
document.querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{pause();seek(Number(b.dataset.time)*P.motion.duration/24);});
$('top').onclick=()=>setView('top');$('iso').onclick=()=>setView('iso');
$('guides').onchange=()=>{for(const id of ['label-mag','label-fixed'])$(id).style.display=$('guides').checked?'block':'none';if(guideLine)guideLine.visible=$('guides').checked;seek(time);};
new ResizeObserver(()=>{resize();render();}).observe($('stage'));
try{
 const results=await Promise.all([fetch('motion.json').then(r=>{if(!r.ok)throw new Error('Motion file unavailable');return r.json();}),new GLTFLoader().loadAsync('output/me6-station-rig.glb')]);
 data=results[0];P=data.parameters;root=results[1].scene;scene.add(root);
 root.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}if(n.userData.role==='moving_bag')bag=n;if(n.userData.role==='tcp')tcp=n;});
 joints=data.joints.map(j=>{let node;root.traverse(n=>{if(n.userData.motion_joint===j.name)node=n;});if(!node)throw new Error('Missing articulated joint '+j.name);return {node,rest:node.quaternion.clone(),axis:new THREE.Vector3(j.axis[0],j.axis[2],-j.axis[1]).normalize()};});
 if(!bag||!tcp)throw new Error('Missing bag or tool contact marker');
 const points=[new THREE.Vector3(P.magazine.x,P.table.height+.025,-P.magazine.front_y),new THREE.Vector3(P.magazine.x,P.table.height+.025,-P.motion.retreat_y),new THREE.Vector3(P.station.x,P.table.height+.025,-P.motion.retreat_y),new THREE.Vector3(P.station.x,P.table.height+.025,-P.station.rear_face_y)];
 guideLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0x48897c,dashSize:.012,gapSize:.008,transparent:true,opacity:.5}));guideLine.computeLineDistances();scene.add(guideLine);
 $('badge').textContent='ME6 · 15 × 9 × 28 cm bag · proposed station';$('scrub').max=P.motion.duration;
 setView(capture?'top':'iso');seek(capture?0:P.motion.duration);pause();
 window.me6Proposal={ready:true,seek,setView,pause,render,get time(){return time;},inspect:()=>({time,tcp:tcp.getWorldPosition(new THREE.Vector3()).toArray(),bag:bag.position.toArray(),jointCount:joints.length,view})};
 function tick(now){requestAnimationFrame(tick);if(playing){const dt=Math.min(.1,(now-last)/1000);last=now;seek(time+dt);if(time>=P.motion.duration)pause();}else render();}requestAnimationFrame(tick);
}catch(e){$('error').style.display='block';$('error').textContent=e.message;$('badge').textContent='Could not load model';console.error(e);}
