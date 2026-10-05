import {FLOOR_TEA_KEY, floorTeaTemplate} from './floor-tea-machine.js';
import {buildFloorZone} from './floor-zone.js';
import {zoneSettings} from './zone-parameters.js';
import {cupRestTemplate} from './coffee-player.js';
import {poseTongGrip} from './bread-render.js';
import {buildBarrier, disposeBarrier} from './barrier-model.js';
import {barrierSettings} from './barrier-parameters.js';
import {placementTemplate, poseSuctionRobot} from './suction-render.js';
import {buildShelf,disposeShelf} from './shelf-model.js';
import * as THREE from '../vendor/three.module.js';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {GLTFExporter} from '../vendor/GLTFExporter.js';
import {RoomEnvironment} from '../vendor/RoomEnvironment.js';

const UP=new THREE.Vector3(0,1,0);
export class Scene3D {
  constructor(canvas,store,onStatus=()=>{}){
    this.canvas=canvas;this.store=store;this.status=onStatus;this.ready=false;this.templates=new Map();this.instances=new Map();this.mode='orbit';this.pointerStart=null;this.drag=null;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#222e37');
    const env=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(this.renderer);this.scene.environment=pmrem.fromScene(env,.04).texture;this.scene.environmentIntensity=.6;env.dispose();pmrem.dispose();
    this.camera=new THREE.PerspectiveCamera(40,1,.01,100);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.screenSpacePanning=true;
    this.scene.add(new THREE.HemisphereLight(0xdceafa,0x8a7863,1.8));
    const key=new THREE.DirectionalLight(0xffefda,2.8);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.1,far:25});key.shadow.bias=-.00012;key.shadow.normalBias=.014;this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xd0e9ff,1.1);fill.position.set(4,5,-5);this.scene.add(fill);
    this.physical=new THREE.Group();this.physical.name='Editable scene';this.scene.add(this.physical);
    this.room=new THREE.Group();this.room.name='Room';this.scene.add(this.room);
    this.guides=new THREE.Group();this.guides.name='Measurement overlays';this.scene.add(this.guides);
    this.distanceLabels=[];this.outlines=new THREE.Group();this.scene.add(this.outlines);
    this.ray=new THREE.Raycaster();this.mouse=new THREE.Vector2();this.loader=new GLTFLoader();
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown',e=>this.down(e),true);window.addEventListener('pointermove',e=>this.move(e));window.addEventListener('pointerup',e=>this.up(e));
    store.on(type=>{if(this.ready && !['camera','workflow'].includes(type))this.sync();});this.overview();this.animate();
  }
  async load(){
    const [gltf,snapshot]=await Promise.all([this.loader.loadAsync('./output/coffee_bar.glb'),fetch('./output/built_config.json').then(r=>r.json())]);
    const config=new Map(snapshot.objects.map(o=>[o.id,o]));
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node=>{
      const id=node.userData?.layout_id;if(!id||!config.has(id))return;
      const spec=config.get(id),model=node.clone(true);model.position.set(0,0,0);
      const unyaw=new THREE.Quaternion().setFromAxisAngle(UP,-(spec.yaw_deg||0)*Math.PI/180);model.quaternion.premultiply(unyaw);
      this.templates.set(id,{model,spec});
    });
    await Promise.all(Object.keys(this.store.scene.robot_inventory).map(async key=>{
      const file=await this.loader.loadAsync('./robot-library/'+(key==='nova5'?'nova5_bread':key==='nova2'?'nova2_coffee':key)+'.glb');const model=file.scene;
      const inv=this.store.scene.robot_inventory[key];this.templates.set('robot:'+key,{model,spec:{width:inv.base_width_cm/100,depth:inv.base_depth_cm/100,height:1,kind:'robot'}});
    }));
    const [cartAsset, cartSpec] = await Promise.all([
      this.loader.loadAsync('./robot-library/nova5_cart.glb'),
      fetch('./robot-library/nova5_cart.json').then(response => response.json()),
    ]);
    this.templates.set('nova5_cart', {model: cartAsset.scene, spec: cartSpec});
    this.templates.set('placement_zone', placementTemplate());
    this.templates.set(FLOOR_TEA_KEY, floorTeaTemplate());
    // Keep previously copied ME6 stations usable when reopening older layouts.
    const legacyME6 = await this.loader.loadAsync('./me6-bag-station/layout-assets/me6_robot.glb');
    this.templates.set('me6_bag_robot', {
      model: legacyME6.scene,
      spec: {kind: 'robot', width: .19, depth: .15, layout_component: 'me6_robot'},
    });
    this.ready=true;this.sync();this.overview();this.status('Models ready');
  }
  template(object) {
    if (object.kind === 'zone') return {model:new THREE.Group(),spec:{width:1,depth:1,height:1}};
    if (object.kind === 'customer_barrier') return {model:new THREE.Group(),spec:{width:1,depth:1,height:1}};
    if (object.kind === 'placement_zone') return object.role === 'cup_rest' ? (this.restTemplate ||= cupRestTemplate()) : this.templates.get('placement_zone');
    const key = object.layout_component
      ? object.asset_key || object.id
      : object.kind === 'robot'
        ? 'robot:' + this.store.key(object)
        : object.asset_key || object.id;
    return this.templates.get(key) || this.templates.get(object.id);
  }
  makeInstance(o){
    const template=this.template(o);if(!template)throw new Error('No 3D asset is available for '+o.label);
    const container=new THREE.Group();container.name=o.label;container.userData.editorId=o.id;const mesh=template.model.clone(true);
    mesh.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}delete n.userData?.layout_id;});
    container.add(mesh);this.physical.add(container);const topImprints=[];mesh.traverse(n=>{if(n.userData.equipment_top_label&&n.geometry){n.geometry.computeBoundingBox();topImprints.push(n);}});const record={node:container,template,mesh,topImprints};this.instances.set(o.id,record);return record;
  }
  sync(){
    if(this.breadPrePickGuide){this.clear(this.breadPrePickGuide);this.breadPrePickGuide.removeFromParent();this.breadPrePickGuide=null;}
    const ids=new Set(this.store.scene.objects.map(o=>o.id));for(const [id,r] of this.instances)if(!ids.has(id)){this.physical.remove(r.node);if(r.isProceduralShelf)disposeShelf(r.mesh);if(r.isProceduralBarrier)disposeBarrier(r.mesh);if(r.isProceduralZone)this.clear(r.mesh);this.instances.delete(id);}
    for(const o of this.store.scene.objects){
      const r=this.instances.get(o.id)||this.makeInstance(o),node=r.node,base=r.template.spec;
      node.name=o.label;node.userData.editorId=o.id;node.userData.layout_id=o.id;node.userData.scene_parameters=JSON.stringify(o);
      node.position.set(o.x,this.store.z(o),-o.y);node.quaternion.setFromAxisAngle(UP,(o.yaw_deg||0)*Math.PI/180);
      if(o.kind==='customer_barrier') {
        const signature=JSON.stringify([o.width,o.depth,o.height,barrierSettings(o)]);
        if(r.barrierSignature!==signature) {
          node.remove(r.mesh);if(r.isProceduralBarrier)disposeBarrier(r.mesh);
          r.mesh=buildBarrier(o);node.add(r.mesh);r.barrierSignature=signature;r.isProceduralBarrier=true;
        }
        node.scale.set(1,1,1);
      }
      else if(o.kind==='zone') {
        const signature=JSON.stringify([o.width,o.depth,zoneSettings(o)]);
        if(r.zoneSignature!==signature) {
          node.remove(r.mesh);if(r.isProceduralZone)this.clear(r.mesh);
          r.mesh=buildFloorZone(o);node.add(r.mesh);r.zoneSignature=signature;r.isProceduralZone=true;
        }
        node.scale.set(1,1,1);
      }
      else if(o.kind==='shelf'){
        const signature=JSON.stringify([o.width,o.depth,o.height,this.store.shelfSettings(o)]);
        if(r.shelfSignature!==signature){
          node.remove(r.mesh);if(r.isProceduralShelf)disposeShelf(r.mesh);
          r.mesh=buildShelf(this.store.scene,o,r.template.model);node.add(r.mesh);
          r.shelfSignature=signature;r.isProceduralShelf=true;
        }
        node.scale.set(1,1,1);
      }
      else if(o.kind==='robot')node.scale.setScalar(o.robot_scale||1);
      else node.scale.set(o.width/base.width,(o.height||base.height||1)/(base.height||1),o.depth/base.depth);
      // Surface lettering keeps its proportions and follows the longer side after resizing.
      for(const imprint of r.topImprints){
        const alongDepth=o.kind==='machine'&&o.depth>o.width;
        const size=imprint.geometry.boundingBox.getSize(new THREE.Vector3());
        const factor=Math.min(1,Math.max(o.width,o.depth)*.78/Math.max(size.x,.0001),Math.min(o.width,o.depth)*.35/Math.max(size.z,.0001));
        imprint.quaternion.setFromAxisAngle(UP,alongDepth?-Math.PI/2:0);
        imprint.scale.set(factor/(alongDepth?node.scale.z:node.scale.x),1/node.scale.y,factor/(alongDepth?node.scale.x:node.scale.z));
        imprint.position.y=((o.height||base.height)+.0006)/node.scale.y;
        imprint.userData.long_axis=alongDepth?'depth':'width';
      }
      if (['nova5_suction','nova5','nova2','nova5_coffee'].includes(this.store.key(o))) {
        const angles = Array.from({length: 6}, (_, index) =>
          (o.joints_deg?.['joint' + (index + 1)] || 0) * Math.PI / 180);
        poseSuctionRobot(r, angles);
        if (this.store.key(o) === 'nova5') poseTongGrip(r,(o.joints_deg?.gripper_r_joint1||0)*Math.PI/180);
      }
      if (o.kind === 'counter') r.mesh.traverse(part => {
        if (/^(Ordering terminal|Order terminal screen|Terminal stand)/.test(part.name)) {
          part.visible = o.ordering_terminal !== false;
        }
      });
      node.visible=this.store.visible(o.id);
    }
    this.physical.updateMatrixWorld(true);this.updateRoom();this.updateGuides();this.updateOutline();this.resize();
  }
  clear(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.map?.dispose();m.dispose();}}});group.clear();}
  updateRoom(){
    const {width:w,depth:d,cropped_front_depth:crop}=this.store.scene.room,key=[w,d,crop].join();if(this.roomKey===key)return;this.roomKey=key;this.clear(this.room);
    const floor=new THREE.Mesh(new THREE.BoxGeometry(w,.03,d),new THREE.MeshStandardMaterial({color:0xc9cfcb,roughness:.88}));floor.position.set(w/2,-.017,-d/2);floor.receiveShadow=true;floor.name='Floor';this.room.add(floor);
    if(crop){const strip=new THREE.Mesh(new THREE.PlaneGeometry(w,crop),new THREE.MeshStandardMaterial({color:0xdbd9ce,roughness:1}));strip.rotation.x=-Math.PI/2;strip.position.set(w/2,.0003,-crop/2);strip.receiveShadow=true;this.room.add(strip);}
    const points=[];for(let x=.5;x<w;x+=.5)points.push(new THREE.Vector3(x,.001,0),new THREE.Vector3(x,.001,-d));for(let y=.5;y<d;y+=.5)points.push(new THREE.Vector3(0,.001,-y),new THREE.Vector3(w,.001,-y));
    const grid=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x9facad,transparent:true,opacity:.24}));this.room.add(grid);
  }
  polyline(points,color,dashed=false,depthTest=false){
    const geometry=new THREE.BufferGeometry().setFromPoints(points),material=dashed?new THREE.LineDashedMaterial({color,dashSize:.045,gapSize:.032,transparent:true,opacity:.78,depthTest,depthWrite:false}):new THREE.LineBasicMaterial({color,transparent:true,opacity:.83,depthTest,depthWrite:false});
    const line=new THREE.Line(geometry,material);if(dashed)line.computeLineDistances();line.renderOrder=800;this.guides.add(line);return line;
  }
  label(text,position,color='#235a65'){
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=96;const ctx=canvas.getContext('2d');ctx.font='500 32px Segoe UI';const textWidth=ctx.measureText(text).width;const w=Math.min(380,textWidth+40),left=(384-w)/2;
    ctx.fillStyle='rgba(250,253,253,0.96)';ctx.strokeStyle='rgba(94,131,142,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(left,12,w,68,15);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,192,48);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));sprite.position.copy(position);sprite.scale.set(.54,.135,1);sprite.renderOrder=1000;this.guides.add(sprite);
    const leader=this.polyline([position.clone(),position.clone()],0x6f9ca2);
    leader.visible=false;leader.material.opacity=.42;
    this.distanceLabels.push({sprite,anchor:position.clone(),leader,inkWidth:w/384});

  }
  reachSphere(robot,radius,center,color,kind){
    const sphere=new THREE.Group();sphere.name=kind==='effective'?'Maximum effective reach sphere':'Realistic placement reach sphere';
    sphere.position.copy(center);sphere.userData={reachOwner:robot.id,radius,reachType:kind,shape:'sphere'};
    // Only the spherical surface is drawn; lighting reveals its curvature.
    const material=new THREE.MeshPhongMaterial({color,transparent:true,opacity:kind==='effective'?.17:.20,side:THREE.DoubleSide,shininess:45,specular:0x888888,depthTest:true,depthWrite:false});
    const shell=new THREE.Mesh(new THREE.SphereGeometry(radius,64,32),material);
    shell.name='Translucent reach surface';shell.renderOrder=700;sphere.add(shell);this.guides.add(sphere);
    return sphere;
  }
  updateGuides(){
    this.clear(this.guides);this.distanceLabels=[];
    for(const robot of this.store.relevantRobots(this.store.options.showAllReach)){
      if(robot.show_reach===false)continue;const r=this.store.reach(robot),height=Math.max(.018,this.store.z(robot)+.018);
      const center=new THREE.Vector3(r.center[0],height,-r.center[1]);
      this.reachSphere(robot,r.effective,center,0xc97a42,'effective');
      this.reachSphere(robot,r.placement,center,0x218e98,'placement');
    }
    for(const d of this.store.distances()){
      const a=new THREE.Vector3(d.a[0],d.z,-d.a[1]),b=new THREE.Vector3(d.b[0],d.z,-d.b[1]);this.polyline([a,b],0x4b8b94);
      const v=b.clone().sub(a),length=v.length();if(length>.01){v.normalize();const side=new THREE.Vector3(-v.z,0,v.x);for(const [at,sign] of [[a,1],[b,-1]]){const tip=at.clone().addScaledVector(v,.055*sign);this.polyline([tip.clone().addScaledVector(side,.025),at,tip.clone().addScaledVector(side,-.025)],0x4b8b94);}}
      const mid=a.clone().lerp(b,.5);mid.y+=d.type==='edge'?.17:.095;this.label((d.type==='edge'?'Gap ':'')+this.store.format(d.distance),mid);
    }
  }
  layoutDistanceLabels(){
    if(!this.distanceLabels.length)return;
    this.camera.updateMatrixWorld();
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight,occupied=[];
    if(!width||!height)return;
    for(const label of this.distanceLabels){
      const {sprite,anchor,leader,inkWidth}=label,ndc=anchor.clone().project(this.camera),cameraPoint=anchor.clone().applyMatrix4(this.camera.matrixWorldInverse);
      const factor=height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*Math.max(.01,-cameraPoint.z));
      const w=sprite.scale.x*factor*inkWidth+6,h=sprite.scale.y*factor*.71+6;
      const px=(ndc.x+1)*width/2,py=(1-ndc.y)*height/2;
      let cy=py,rect;
      for(let attempt=0;attempt<30;attempt++){
        const offset=attempt===0?0:(attempt%2?-1:1)*Math.ceil(attempt/2)*(h+3);
        cy=py+offset;rect={x:px-w/2,y:cy-h/2,w,h};
        if(!occupied.some(r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y))break;
      }
      occupied.push(rect);
      sprite.position.set(ndc.x,1-2*cy/height,ndc.z).unproject(this.camera);
      leader.visible=Math.abs(cy-py)>1;
      if(leader.visible){const points=leader.geometry.attributes.position;points.setXYZ(0,anchor.x,anchor.y,anchor.z);points.setXYZ(1,sprite.position.x,sprite.position.y,sprite.position.z);points.needsUpdate=true;leader.geometry.computeBoundingSphere();}
    }
  }
  updateOutline(){
    this.clear(this.outlines);const box=new THREE.Box3();let found=false;
    for(const o of this.store.resolve()){const r=this.instances.get(o.id);if(r?.node.visible){box.expandByObject(r.node);found=true;}}
    if(found){const outline=new THREE.Box3Helper(box,0x56d6c2);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.75;outline.renderOrder=900;this.outlines.add(outline);}
  }
  resize(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  overview(){
    this.resize();const s=this.store.scene.room;
    const box=new THREE.Box3(new THREE.Vector3(0,0,-s.depth),new THREE.Vector3(s.width,1.8,0));
    if(this.ready)box.expandByObject(this.physical);
    const centre=box.getCenter(new THREE.Vector3());this.controls.target.copy(centre);this.camera.up.copy(UP);
    const direction=new THREE.Vector3(-.75,.73,1).normalize(),points=[];
    const addBox=b=>{for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new THREE.Vector3(x,y,z));};
    addBox(new THREE.Box3(new THREE.Vector3(0,0,-s.depth),new THREE.Vector3(s.width,0,0)));
    if(this.ready){for(const r of this.instances.values())if(r.node.visible)addBox(new THREE.Box3().setFromObject(r.node));}else addBox(box);
    let low=.5,high=Math.max(30,s.depth*10,s.width*10);
    for(let i=0;i<22;i++){const distance=(low+high)/2;this.camera.position.copy(centre).addScaledVector(direction,distance);this.camera.lookAt(centre);this.camera.updateMatrixWorld();const projected=points.map(p=>p.clone().project(this.camera));const fits=projected.every(p=>p.z>0&&p.z<1&&Math.abs(p.x)<.91&&Math.abs(p.y)<.85);if(fits)high=distance;else low=distance;}
    this.camera.position.copy(centre).addScaledVector(direction,high);this.camera.lookAt(centre);this.controls.update();
  }
  top(){const s=this.store.scene.room;this.controls.target.set(s.width/2,0,-s.depth/2);this.camera.position.set(s.width/2,Math.max(s.depth,s.width)*1.6,-s.depth/2+.01);this.camera.up.copy(UP);this.camera.lookAt(this.controls.target);this.controls.update();}
  focus(){const ids=this.store.resolve();if(!ids.length){this.overview();return;}const box=new THREE.Box3();for(const o of ids){const r=this.instances.get(o.id);if(r)box.expandByObject(r.node);}const selected=new Set(ids.map(o=>o.id));for(const guide of this.guides.children)if(selected.has(guide.userData.reachOwner))box.expandByObject(guide);if(box.isEmpty())return;const centre=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();this.controls.target.copy(centre);this.camera.position.copy(centre).add(new THREE.Vector3(-1,.85,1.15).normalize().multiplyScalar(Math.max(1.3,size*1.9)));this.controls.update();}
  rayAt(e){const rect=this.canvas.getBoundingClientRect();this.mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.mouse,this.camera);return this.ray;}
  hit(e){const hits=this.rayAt(e).intersectObject(this.physical,true);for(const hit of hits){let n=hit.object;while(n&&n!==this.physical){if(n.userData.editorId&&n.visible&&this.store.visible(n.userData.editorId))return n.userData.editorId;n=n.parent;}}return null;}
  down(e){
    if(e.button!==0)return;this.pointerStart={x:e.clientX,y:e.clientY,id:this.hit(e)};
    if(this.mode!=='move'||!this.pointerStart.id)return;const id=this.pointerStart.id;
    if(!this.store.resolve().some(o=>o.id===id))this.store.select(id,e.shiftKey);
    if(this.store.resolve().some(o=>this.store.locked(o.id)))return;
    const plane=new THREE.Plane(UP,-this.store.z(this.store.object(id))),point=new THREE.Vector3();this.rayAt(e).ray.intersectPlane(plane,point);
    this.drag={plane,point,ids:[...this.store.selected]};this.controls.enabled=false;this.store.begin();e.preventDefault();e.stopImmediatePropagation();
  }
  move(e){if(!this.drag)return;const point=new THREE.Vector3();if(!this.rayAt(e).ray.intersectPlane(this.drag.plane,point))return;let dx=point.x-this.drag.point.x,dy=-(point.z-this.drag.point.z);if(this.store.options.snap&&!e.altKey){dx=Math.round(dx/.01)*.01;dy=Math.round(dy/.01)*.01;}this.store.preview(()=>this.store.move(this.drag.ids,dx,dy));}
  up(e){
    if(this.drag){this.store.commit('Moved in 3D');this.drag=null;this.controls.enabled=true;this.pointerStart=null;return;}
    if(this.pointerStart&&Math.hypot(e.clientX-this.pointerStart.x,e.clientY-this.pointerStart.y)<5&&this.pointerStart.id)this.store.select(this.pointerStart.id,e.shiftKey);
    this.pointerStart=null;
  }
  animate(){requestAnimationFrame(()=>this.animate());if(!this.canvas.clientWidth||!this.canvas.clientHeight)return;this.controls.update();this.layoutDistanceLabels();this.renderer.render(this.scene,this.camera);}
  png(){this.layoutDistanceLabels();this.renderer.render(this.scene,this.camera);return this.canvas.toDataURL('image/png');}
  async glb(){
    const output=new THREE.Scene();output.name='Coffee bar edited scene';output.userData.sceneConfig=this.store.exportScene();output.add(this.room.clone(true));output.add(this.physical.clone(true));output.updateMatrixWorld(true);
    return new GLTFExporter().parseAsync(output,{binary:true,onlyVisible:true,trs:false});
  }
  inspect(id){const r=this.instances.get(id);if(!r)return null;return {position:r.node.position.toArray(),scale:r.node.scale.toArray(),quaternion:r.node.quaternion.toArray(),visible:r.node.visible,children:r.node.children.length};}
}
