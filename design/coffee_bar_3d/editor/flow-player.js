import {BreadPlayback} from './bread-render.js';
import {packingDiagnostic} from './failure-preview.js';
import * as THREE from '../vendor/three.module.js';
import {poseSuctionRobot, setupSuctionJoints} from './suction-render.js';

const BASIS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const BAG_FROM_TOOL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const worldVector = position => new THREE.Vector3(position[0], position[2], -position[1]);

export class FlowPlayer {
  constructor(store, view, onTime) {
    this.store = store;
    this.view = view;
    this.onTime = onTime;
    this.playing = false;
    this.time = 0;
    this.hidden = [];
    this.overlay = null;
    this.record = null;
    this.last = performance.now();
    const tick = now => {
      requestAnimationFrame(tick);
      if (this.playing) {
        this.seek(Math.min(this.playbackEnd, this.time + Math.min(.1, (now - this.last) / 1000)));
        if (this.time >= this.playbackEnd) this.playing = false;
      }
      this.last = now;
    };
    requestAnimationFrame(tick);
  }

  configure(request, result) {
    this.stop();
    this.sourceRequest=request;this.sourceResult=result;
    this.request = result.route
      ? {...request, knots: result.route.knots, duration: result.route.duration}
      : request;
    this.result = result;
  }

  get playbackEnd(){return this.diagnostic?this.partialEnd:this.request.duration;}
  activateDiagnostic(){
    const preview=packingDiagnostic(this.sourceRequest,this.sourceResult);if(!preview)return false;
    this.stop();this.diagnostic=true;this.partialEnd=preview.end;this.result=preview.result;
    this.request={...this.sourceRequest,knots:this.result.route.knots,duration:this.result.route.duration};return true;
  }
  playPartial(){if(!this.diagnostic&&!this.activateDiagnostic())return;if(this.time>=this.playbackEnd)this.time=0;this.seek(this.time);this.playing=!this.playing;}
  seekDiagnostic(time){if(!this.diagnostic&&!this.activateDiagnostic())return;this.playing=false;this.seek(time);}

  prepare() {
    if (this.overlay) return;
    this.record = this.view.instances.get(this.request.robot.id);
    if (!this.record) throw new Error('The suction robot model is not loaded.');
    setupSuctionJoints(this.record);
    let sourceBag;
    this.view.instances.get(this.request.fixture.id)?.mesh.traverse(node => {
      if (node.userData.role === 'moving_bag') sourceBag = node;
    });
    if (!sourceBag) throw new Error('No paper-bag mesh was found.');
    this.overlay = new THREE.Group();
    this.overlay.name = 'Bag workflow preview';
    this.overlay.userData.flow_preview = true;
    this.bag = sourceBag.clone(true);
    this.bag.visible = true;
    this.overlay.add(this.bag);
    this.hidden.push({node: sourceBag, visible: sourceBag.visible});
    sourceBag.visible = false;
    const magazine = this.view.instances.get(this.request.settings.magazine_id);
    magazine?.mesh.traverse(node => {
      if (/^Stored_(flat_bag|bottom_fold)_01/.test(node.name)) {
        this.hidden.push({node, visible: node.visible});
        node.visible = false;
      }
    });
    this.bread = new THREE.Mesh(new THREE.SphereGeometry(.5, 28, 18),
      new THREE.MeshStandardMaterial({color: 0xd8a865, roughness: .84}));
    this.bread.name = 'Illustrative bun loading';
    this.bread.scale.set(this.request.breadSize[0], this.request.breadSize[2], this.request.breadSize[1]);
    this.overlay.add(this.bread);
    this.view.physical.add(this.overlay);
    if (this.request.breadTask && (this.result.bread?.pathOK||(this.diagnostic&&this.result.bread?.frames.length))) this.breadPlayer = new BreadPlayback(this);
  }

  stop() {
    this.view.collisions?.resetInspection();
    this.playing = false;
    this.breadPlayer?.stop();
    this.breadPlayer = null;
    for (const {node, visible} of this.hidden) node.visible = visible;
    this.hidden = [];
    if (this.overlay) {
      this.overlay.removeFromParent();
      this.bread.geometry.dispose();
      this.bread.material.dispose();
      this.overlay = null;
    }
    if (this.record) {
      const object = this.store.object(this.request?.robot.id);
      if (object) poseSuctionRobot(this.record, Array.from({length: 6}, (_, index) =>
        (object.joints_deg?.['joint' + (index + 1)] || 0) * Math.PI / 180));
    }
    if (this.poseBreadRecord) {
      const robot = this.store.object(this.request?.breadTask?.robot.id);
      if (robot) poseSuctionRobot(this.poseBreadRecord, Array.from({length:6},(_,i)=>(robot.joints_deg?.['joint'+(i+1)]||0)*Math.PI/180));
      this.poseBreadRecord = null;
    }
    this.record = null;
    this.time = 0;this.diagnostic=false;
    if(this.sourceResult){this.result=this.sourceResult;this.request=this.result.route?{...this.sourceRequest,knots:this.result.route.knots,duration:this.result.route.duration}:this.sourceRequest;}
    this.onTime?.(0, null);
  }

  play() {
    if ((!this.result?.pathOK || this.request.errors.length)&&!this.diagnostic) return;
    if (this.time >= this.playbackEnd) this.time = 0;
    this.seek(this.time);
    this.playing = !this.playing;
    this.last = performance.now();
  }

  seek(time) {
    if ((!this.result?.pathOK&&!this.diagnostic) || !this.result.frames.length) return;
    this.prepare();
    this.time = Math.max(0, Math.min(this.playbackEnd, time));
    const frames = this.result.frames;
    let index = frames.findIndex(frame => frame.time >= this.time);
    if (index < 0) index = frames.length - 1;
    const b = frames[index];
    const a = frames[Math.max(0, index - 1)];
    const fraction = b.time === a.time ? 0 : (this.time - a.time) / (b.time - a.time);
    const angles = a.q.map((value, joint) => value + (b.q[joint] - value) * fraction);
    poseSuctionRobot(this.record, angles);
    const state = fraction < 1 ? a : b;
    const targetRotation = new THREE.Quaternion(...a.target.quaternion)
      .slerp(new THREE.Quaternion(...b.target.quaternion), fraction);
    let contact = this.record.tcp.getWorldPosition(new THREE.Vector3());
    let rotation = targetRotation;
    if (state.bagState === 'magazine' || state.bagState === 'placed') {
      const fixed = this.request.targets.find(target => target.id === (state.bagState === 'magazine' ? 'magazine' : 'placement'));
      contact = worldVector(fixed.position);
      rotation = new THREE.Quaternion(...fixed.quaternion);
    }
    const upright = rotation.clone().multiply(BAG_FROM_TOOL);
    this.bag.quaternion.copy(BASIS).multiply(upright).multiply(BASIS.clone().invert());
    if (state.bagState === 'carried') {
      this.bag.quaternion.copy(this.record.tcp.getWorldQuaternion(new THREE.Quaternion())).multiply(BAG_FROM_TOOL);
    }
    this.bag.position.copy(contact).add(
      new THREE.Vector3(0, -this.request.bag.contactHeight, 0).applyQuaternion(this.bag.quaternion));
    const depth = a.bagDepth + (b.bagDepth - a.bagDepth) * fraction;
    this.bag.scale.set(this.request.bag.width / .15, this.request.bag.height / .28, depth / .09);
    const bagCentre = new THREE.Vector3(0, 0, -depth / 2).applyQuaternion(this.bag.quaternion);
    this.bread.quaternion.copy(this.bag.quaternion);
    const loadingStart = this.request.knots.find(knot => knot.phase === 'Pull the bag open').time;
    const loadingEnd = this.request.knots.find(knot => knot.phase === 'Wait for bun loading').time;
    const loading = this.time >= loadingStart && this.time <= loadingEnd;
    this.bread.visible = !this.request.breadTask&&(loading || (state.loaded && this.request.breadFits));
    const drop = this.request.breadFits
      ? Math.min(1, Math.max(0, (this.time - loadingStart - .5) / Math.max(.1, loadingEnd - loadingStart - .5)))
      : 0;
    const breadHeight = (this.request.bag.height + .12) * (1 - drop) +
      (this.request.breadSize[2] / 2 + .002) * drop;
    this.bread.position.copy(this.bag.position).add(bagCentre).add(new THREE.Vector3(0, breadHeight, 0));
    const breadPhase = this.breadPlayer?.seek(this.time,this.bag,bagCentre);
    this.overlay.updateMatrixWorld(true);
    this.onTime?.(this.time, {
      phase: (breadPhase && this.result.coordination?.parallel ? b.phase+' · '+breadPhase : breadPhase) || (!this.request.breadFits && b.phase === 'Lift the loaded bag' ? 'Lift bag — bread fit unresolved' : b.phase),
      robotVacuum: state.robotVacuum,
      fixedVacuum: state.fixedVacuum,
      breadFits: this.request.breadFits,
    });
  }

  showPose(target) {
    this.stop();
    const record = this.view.instances.get(target.robotId || this.request.robot.id);
    if (target.robotId && target.robotId !== this.request.robot.id) this.poseBreadRecord = record;
    else this.record = record;
    poseSuctionRobot(record, target.q);
    this.onTime?.(0, {phase: target.name, robotVacuum: false, fixedVacuum: false});
  }
}
