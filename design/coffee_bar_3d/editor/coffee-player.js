import * as THREE from '../vendor/three.module.js';
import {coffeeDiagnostic} from './failure-preview.js';
import {poseSuctionRobot,setupSuctionJoints} from './suction-render.js';
const UP=new THREE.Vector3(0,1,0);
const CUP_FROM_TOOL=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
const point=p=>new THREE.Vector3(p[0],p[2],-p[1]);

export function cupRestTemplate() {
  const model=new THREE.Group();model.name='Cup stamping rest';
  const steel=new THREE.MeshStandardMaterial({color:0x8da2a4,metalness:.7,roughness:.35});
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.0525,.0525,.012,48),steel);
  base.name='Cup rest base';base.position.y=.006;model.add(base);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.034,.003,10,48),steel);
  ring.name='Cup rest rim';ring.rotation.x=Math.PI/2;ring.position.y=.014;model.add(ring);
  return {model,spec:{kind:'placement_zone',width:.105,depth:.105,height:.012}};
}

function makeCup(cold,drink) {
  const root=new THREE.Group();root.name=cold?'Plastic beverage cup':'Paper beverage cup';
  const profile=[[.027,.004],[.0405,.11],[.0425,.11],[.030,0],[0,0],[0,.004]];
  const material=new THREE.MeshStandardMaterial({color:cold?0xc8e0e5:0xf0e6cd,
    roughness:cold?.2:.8,transparent:cold,opacity:cold?.42:1,side:THREE.DoubleSide,depthWrite:!cold});
  const shell=new THREE.Mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),48),material);
  shell.name='Cup shell / 85 mm rim';root.add(shell);
  const liquid=new THREE.Mesh(new THREE.CylinderGeometry(.036,.028,1,48),
    new THREE.MeshStandardMaterial({color:drink==='coffee'?0x542b18:0xc59a68,roughness:.3}));
  liquid.name=drink==='coffee'?'Coffee fill':'Milk tea fill';root.add(liquid);
  const lid=new THREE.Group();lid.name=cold?'Applied plastic lid':'Paper lid';root.add(lid);
  const cap=new THREE.Mesh(cold?new THREE.SphereGeometry(.045,40,18,0,Math.PI*2,0,Math.PI/2):
    new THREE.CylinderGeometry(.045,.045,.009,48),new THREE.MeshStandardMaterial({
      color:cold?0xe4f2f3:0xf4ead5,roughness:.4,transparent:cold,opacity:cold?.65:1}));
  if(cold)cap.scale.y=.27;
  lid.add(cap);
  const ice=new THREE.Group();ice.name='Ice pieces';
  for(let i=0;i<5;i++){
    const cube=new THREE.Mesh(new THREE.BoxGeometry(.016,.016,.016),
      new THREE.MeshStandardMaterial({color:0xb3e2ec,transparent:true,opacity:.7,roughness:.1}));
    cube.position.set(Math.cos(i*2.4)*.018,.083+(i%2)*.004,Math.sin(i*2.4)*.018);
    cube.rotation.set(i*.5,i*.8,i*.2);ice.add(cube);
  }
  root.add(ice);
  const stream=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,.09,16),
    new THREE.MeshBasicMaterial({color:drink==='coffee'?0x9b6938:0xdbb77e,transparent:true,opacity:.75}));
  stream.name='Illustrative drink stream';stream.position.y=.155;root.add(stream);
  return {root,liquid,lid,ice,stream};
}

export class CoffeePlayer {
  constructor(store,view,onTime) {
    this.store=store;this.view=view;this.onTime=onTime;this.time=0;this.playing=false;
    let last=performance.now();
    const tick=now=>{
      if(this.playing){
        this.seek(Math.min(this.playbackEnd,this.time+Math.min(.1,(now-last)/1000)));
        if(this.time>=this.playbackEnd)this.playing=false;
      }
      last=now;requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  configure(request,result,definition){this.stop();this.sourceRequest=request;this.sourceResult=result;this.definition=definition||this.definition;this.request=result.route?{...request,...result.route}:request;this.result=result;}
  get playbackEnd(){return this.diagnostic?this.partialEnd:this.request.duration;}
  activateDiagnostic(){
    const preview=coffeeDiagnostic(this.sourceRequest,this.sourceResult,this.definition);if(!preview)return false;
    this.stop();this.diagnostic=true;this.partialEnd=preview.end;this.request=preview.request;this.result=preview.result;return true;
  }
  playPartial(){if(!this.diagnostic&&!this.activateDiagnostic())return;if(this.time>=this.playbackEnd)this.time=0;this.seek(this.time);this.playing=!this.playing;}
  seekDiagnostic(time){if(!this.diagnostic&&!this.activateDiagnostic())return;this.playing=false;this.seek(time);}
  prepare(){
    if(this.overlay)return;
    this.record=this.view.instances.get(this.request.robot.id);setupSuctionJoints(this.record);
    if(!this.record.tcp||!this.record.stampTcp)throw new Error('Nova-2 tool model is missing.');
    this.cup=makeCup(this.request.settings.temperature==='cold',this.request.settings.drink);
    this.overlay=new THREE.Group();this.overlay.name='Coffee flow preview';this.overlay.userData.flow_preview=true;
    this.overlay.add(this.cup.root);this.view.physical.add(this.overlay);
  }
  stop(){
    this.view.collisions?.resetInspection();
    this.playing=false;this.time=0;
    if(this.record){
      const o=this.store.object(this.request?.robot.id);
      if(o)poseSuctionRobot(this.record,Array.from({length:6},(_,i)=>(o.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180));
    }
    if(this.overlay){
      this.overlay.removeFromParent();
      this.overlay.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});
    }
    this.overlay=null;this.record=null;this.diagnostic=false;
    if(this.sourceResult){this.result=this.sourceResult;this.request=this.result.route?{...this.sourceRequest,...this.result.route}:this.sourceRequest;}
    this.onTime?.(0,null);
  }
  play(){
    if((!this.result?.pathOK||this.request.errors.length)&&!this.diagnostic)return;
    if(this.time>=this.playbackEnd)this.time=0;
    this.seek(this.time);this.playing=!this.playing;
  }
  seek(time){
    if((!this.result?.pathOK||this.request.errors.length)&&!this.diagnostic)return;
    this.prepare();this.time=Math.max(0,Math.min(this.playbackEnd,time));
    const frames=this.result.frames;let i=frames.findIndex(f=>f.time>=this.time);if(i<0)i=frames.length-1;
    const b=frames[i],a=frames[Math.max(0,i-1)],f=b.time===a.time?0:(this.time-a.time)/(b.time-a.time);
    poseSuctionRobot(this.record,a.q.map((q,j)=>q+(b.q[j]-q)*f));
    const knots=this.request.knots;let k=knots.findIndex(n=>n.time>=this.time);if(k<0)k=knots.length-1;
    const next=knots[k],previous=knots[Math.max(0,k-1)];
    const fraction=next.time===previous.time?0:(this.time-previous.time)/(next.time-previous.time);
    const state=fraction<1?previous:next,mesh=this.cup.root;
    const dropping=previous.cup==='none'&&next.cup==='held';
    mesh.visible=state.cup!=='none'||dropping;
    if(state.cup==='held'||dropping){
      mesh.quaternion.copy(this.record.tcp.getWorldQuaternion(new THREE.Quaternion())).multiply(CUP_FROM_TOOL);
      mesh.position.copy(this.record.tcp.getWorldPosition(new THREE.Vector3()))
        .add(new THREE.Vector3(0,-this.request.cupSpec.gripHeight,0).applyQuaternion(mesh.quaternion));
      if(dropping)mesh.position.y+=.14*(1-fraction);
    }else if(state.cup==='parked'||state.cup==='delivered'){
      const target=state.cup==='parked'?this.request.park:this.request.delivery;
      mesh.position.set(target.position[0],target.floor,-target.position[1]);
      mesh.quaternion.setFromAxisAngle(UP,0);
    }
    const amount=previous.fill+(next.fill-previous.fill)*fraction;
    this.cup.liquid.visible=amount>.001;
    this.cup.liquid.scale.y=.10*Math.max(.001,amount);
    this.cup.liquid.position.y=.005+.05*amount;
    this.cup.ice.visible=state.ice>0 || (next.ice>previous.ice&&fraction>.15);
    this.cup.lid.visible=state.lid!=='none'||(next.lid!=='none'&&fraction>.1);
    const arriving=previous.lid==='none'&&next.lid!=='none';
    const pressing=next.phase==='Press paper lid';
    const loose=state.lid==='paper'&&!state.sealed;
    this.cup.lid.position.y=.1145+(arriving?.08*(1-fraction):0)+(loose?.004*(pressing?1-fraction:1):0);
    this.cup.stream.visible=next.fill>previous.fill&&fraction>0&&fraction<1;
    this.overlay.updateMatrixWorld(true);
    this.onTime?.(this.time,{phase:next.phase,state,events:this.request.events.filter(e=>e.time<=this.time)});
  }
}
