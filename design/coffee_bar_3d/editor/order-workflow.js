import {loadCoffeeDefinition} from './coffee-robots.js';
import * as THREE from '../vendor/three.module.js';
import {handleBreadPoseAction} from './bread-ui.js';
import {attachCollisions} from './collision-scene.js';
import {collisionText} from './collision-core.js';
import {makeWorkflowRequest} from './flow-geometry.js';
import {makeCoffeeRequest} from './coffee-geometry.js';
import {OrderRecorder} from './order-recorder.js';
import {orderMarkup} from './order-ui.js';
import {coffeeDiagnostic} from './failure-preview.js';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const ignored = ['selection','option','workflow','camera'];

export class OrderWorkflow {
  constructor(store, view, bag, coffee, panel, toast) {
    Object.assign(this,{store,view,bag,coffee,panel,toast});
    this.active=false;this.busy=false;this.ready=false;this.playing=false;
    this.time=0;this.duration=0;this.runId=0;this.jobs=new Set();this.routes={};this.states={};
    this.message='Choose the order, then check and play both routes.';
    this.recorder=new OrderRecorder(view,()=>{
      if(!this.recorder.active && this.cameraControls!==undefined){
        view.controls.enabled=this.cameraControls;
        this.cameraControls=undefined;
      }
      if(this.recorder.error)this.playing=false;
      this.render();
    });
    for(const [kind,flow] of [['bag',bag],['coffee',coffee]]) {
      const original=flow.player.onTime;
      flow.player.onTime=(time,state)=>{original?.(time,state);this.states[kind]=state;};
    }
    panel.addEventListener('click',event=>this.click(event));
    panel.addEventListener('change',event=>this.change(event));
    panel.addEventListener('input',event=>{
      if(event.target.id==='order-scrub'&&!this.recorder.active){
        this.playing=false;this.seek(Number(event.target.value));this.updateProgress();
      }
    });
    store.on(type=>{
      if(ignored.includes(type)){
        if(this.active&&this.ready&&['selection','option'].includes(type))
          queueMicrotask(()=>{if(this.active&&this.ready)this.seek(this.time);});
        return;
      }
      this.invalidate();
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden&&this.recorder.active){
        this.playing=false;this.recorder.stop('Interrupted when the app was hidden');
      }
    });
    let last=performance.now();
    const tick=now=>{
      requestAnimationFrame(tick);
      try {
        if(this.playing&&this.ready){
          this.seek(Math.min(this.duration,this.time+Math.min(.1,(now-last)/1000)));
          if(this.time>=this.duration){
            this.playing=false;
            this.message='Order complete · bread and drink are ready for pickup.';
            if(this.recorder.state==='recording')
              this.finishTimer=setTimeout(()=>this.recorder.stop('Complete order'),180);
            this.render();
          }
        }
        if(this.recorder.state==='recording')this.recorder.capture();
      } catch(error) {
        this.playing=false;
        this.recorder.stop('Recording interrupted');
        this.message='Preview stopped: '+error.message;this.failed=true;this.render();
      }
      last=now;
    };
    requestAnimationFrame(tick);
    this.render();
  }

  get videoHeight(){return this.store.scene.order_workflow?.video_height===1080?1080:720;}
  breadSettings(){
    return {...this.bag.settings(),bread_mode:'nova',...this.store.scene.order_workflow?.bread};
  }

  cancelSoloChecks() {
    for(const flow of [this.bag,this.coffee]){
      clearTimeout(flow.timer);
      flow.runId++;
      flow.worker?.terminate();flow.worker=null;
    }
  }

  cancelChecks() {
    this.runId++;
    for(const job of this.jobs)job.cancel();
    this.jobs.clear();
    this.busy=false;
  }

  setActive(active) {
    if(this.active===active)return;
    this.active=active;
    this.bag.suspended=active;this.coffee.suspended=active;
    this.cancelSoloChecks();
    if(!active){
      this.cancelChecks();this.reset();
      for(const flow of [this.bag,this.coffee])
        if(flow.request&&flow.result)flow.player.configure(flow.request,flow.result);
    }else{
      this.bag.player.stop();this.coffee.player.stop();
      if(this.ready)this.configurePlayers();
    }
    this.render();
  }

  invalidate() {
    this.cancelChecks();this.reset();this.ready=false;this.failed=false;this.routes={};
    this.message='Order or layout changed. Place the order again to check both routes.';
    if(this.active)this.cancelSoloChecks();
    this.render();
  }

  render(){this.panel.innerHTML=orderMarkup(this);this.updateProgress();}

  async validate(play=true) {
    if(!this.view.ready||this.recorder.active)return;
    this.cancelChecks();this.reset();this.cancelSoloChecks();
    const id=this.runId;
    this.ready=false;this.failed=false;this.busy=true;this.routes={};
    this.message='Checking the bread, bag and beverage paths…';this.render();
    try {
      const definition = await loadCoffeeDefinition(this.store);
      if(id!==this.runId)return;
      this.definition = definition;
      for(const kind of ['bag','coffee']){
        try {
          const request=kind==='bag'?makeWorkflowRequest(this.store,this.breadSettings()):
            makeCoffeeRequest(this.store,this.definition);
          attachCollisions(this.view,request);
          const errors=[...request.errors];
          if(kind==='bag'&&!request.breadFits&&!errors.length)
            errors.push('The bread does not fit the bag. Select Nova pickup or adjust the bread/bag dimensions.');
          this.routes[kind]={request,errors,message:errors.length?errors.join(' '):'Checking route…',error:!!errors.length};
        }catch(error){this.routes[kind]={error:true,message:error.message};}
      }
      this.render();
      await Promise.all(['bag','coffee'].map(async kind=>{
        const route=this.routes[kind];
        if(route.error)return;
        const data=await this.runWorker(kind,{id,request:route.request,...(kind==='coffee'?{definition:this.definition}:{})});
        if(id!==this.runId||data.cancelled)return;
        if(data.error){route.error=true;route.message=data.error;return;}
        route.result=data.result;
        route.ok=data.result.pathOK&&(kind!=='bag'||!route.request.breadTask||data.result.bread?.pathOK);
        route.error=!route.ok;
        const failure=data.result.bread?.failure||data.result.failure;
        route.message=route.ok?'Route passed · '+(data.result.route?.duration||route.request.duration).toFixed(1)+' s':
          data.result.bread?.errors?.join(' ')||
          (failure?failure.phase+' at '+failure.time.toFixed(2)+' s · '+
            (collisionText(failure)||(failure.positionError*1000).toFixed(1)+' mm position error'):'Route did not pass. Check this flow for details.');
      }));
      if(id!==this.runId)return;
      this.ready=['bag','coffee'].every(kind=>this.routes[kind]?.ok);
      this.failed=!this.ready;
      this.message=this.ready?'Both routes passed · ready to start together.':'Order blocked. Both routes must pass before either starts.';
      if(this.ready)this.configurePlayers();
    }catch(error){if(id===this.runId){this.failed=true;this.message=error.message;}}
    if(id!==this.runId)return;
    this.busy=false;this.render();
    if(play&&this.ready&&this.active){
      this.store.setOption('view','scene');
      await nextFrame();
      if(id===this.runId&&this.ready&&this.active)this.play();
    }
  }

  runWorker(kind,payload) {
    return new Promise(resolve=>{
      const worker=new Worker(new URL(kind==='bag'?'./ik-worker.js':'./coffee-worker.js',import.meta.url),{type:'module'});
      let settled=false,timer;
      const job={cancel:()=>finish({cancelled:true})};
      const finish=data=>{
        if(settled)return;settled=true;clearTimeout(timer);worker.terminate();this.jobs.delete(job);resolve(data);
      };
      this.jobs.add(job);
      timer=setTimeout(()=>finish({error:'Route check timed out. Retry or adjust the layout.'}),180000);
      worker.onmessage=event=>{
        if(event.data.id!==payload.id)return;
        if(event.data.progress){
          const p=event.data.progress;
          const text='Checking '+(p.phase||'poses')+' · '+p.completed+' / '+p.total;
          const node=this.panel.querySelector('#order-route-'+kind);
          if(node)node.textContent=text;
        }else finish(event.data);
      };
      worker.onerror=event=>finish({error:event.message||'Route worker failed.'});
      worker.postMessage(payload);
    });
  }

  configurePlayers() {
    for(const [kind,flow] of [['bag',this.bag],['coffee',this.coffee]])
      flow.player.configure(this.routes[kind].request,this.routes[kind].result,this.definition);
    this.duration=Math.max(this.bag.player.request.duration,this.coffee.player.request.duration);
    this.time=0;
  }

  seek(time) {
    if(!this.ready)return;
    this.time=Math.max(0,Math.min(this.duration,time));
    for(const flow of [this.bag,this.coffee]){
      flow.player.playing=false;
      flow.player.seek(Math.min(this.time,flow.player.request.duration));
    }
    this.updateProgress();
  }

  play() {
    if(!this.ready||this.busy||this.recorder.active)return;
    if(this.time>=this.duration)this.time=0;
    this.seek(this.time);this.playing=!this.playing;
    this.updateProgress();
  }

  reset() {
    clearTimeout(this.finishTimer);
    if(this.recorder.active)this.recorder.stop('Stopped early');
    this.playing=false;this.time=0;
    this.bag.player.stop();this.coffee.player.stop();
    this.updateProgress();
  }

  updateProgress() {
    const set=(id,text)=>{const node=this.panel.querySelector('#'+id);if(node)node.textContent=text;};
    set('order-time',this.time.toFixed(1)+' / '+this.duration.toFixed(1)+' s');
    set('order-play',this.playing?'Ⅱ Pause':'▶ Play together');
    set('order-phase',this.time>=this.duration&&this.ready?'Order complete':this.playing?'Both flows running':'Shared timeline');
    const slider=this.panel.querySelector('#order-scrub');if(slider)slider.value=this.time;
    for(const [kind,flow] of [['bag',this.bag],['coffee',this.coffee]]){
      const duration=this.routes[kind]?.result?.route?.duration||this.routes[kind]?.request?.duration||1;
      const progress=this.panel.querySelector('#order-'+kind+'-progress');if(progress)progress.value=this.ready?Math.min(1,this.time/duration):0;
      set('order-'+kind+'-phase',!this.ready?'Waiting':this.time>=duration?'Ready for pickup':this.states[kind]?.phase||'Ready');
    }
  }

  frame() {
    if(this.recorder.active)return;
    this.store.setOption('view','scene');this.store.select(null);
    const settings=this.breadSettings();
    const objects=[settings.shared_table_id,this.coffee.request?.robot.support||'coffee_station',settings.bread_shelf_id]
      .map(id=>this.store.object(id)).filter(Boolean);
    const box=new THREE.Box3();
    for(const o of objects){
      box.expandByPoint(new THREE.Vector3(o.x-o.width/2,this.store.z(o),-o.y-o.depth/2));
      box.expandByPoint(new THREE.Vector3(o.x+o.width/2,this.store.z(o)+(o.height||1),-o.y+o.depth/2));
    }
    if(box.isEmpty()){this.view.overview();return;}
    const centre=box.getCenter(new THREE.Vector3());
    const distance=Math.max(2.5,box.getSize(new THREE.Vector3()).length());
    this.view.controls.target.copy(centre);
    this.view.camera.position.copy(centre).add(new THREE.Vector3(-.9,.85,1).multiplyScalar(distance));
    this.view.camera.lookAt(centre);this.view.controls.update();
  }

  saveCamera() {
    if(this.recorder.active)return;
    const {camera,controls}=this.view;
    this.store.scene.order_camera={position:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),fov:camera.fov};
    this.store.emit('camera');this.render();this.toast('Order camera viewpoint saved.');
  }

  restoreCamera() {
    const saved=this.store.scene.order_camera;if(!saved||this.recorder.active)return;
    const valid=key=>Array.isArray(saved[key])&&saved[key].length===3&&saved[key].every(Number.isFinite);
    if(!valid('position')||!valid('target')){this.toast('The saved camera is invalid. Save a new viewpoint.');return;}
    this.store.setOption('view','scene');
    this.view.camera.position.fromArray(saved.position);
    this.view.controls.target.fromArray(saved.target);
    if(valid('up'))this.view.camera.up.fromArray(saved.up);
    if(Number.isFinite(saved.fov)&&saved.fov>0&&saved.fov<150)this.view.camera.fov=saved.fov;
    this.view.camera.lookAt(this.view.controls.target);this.view.camera.updateProjectionMatrix();this.view.controls.update();
  }

  async record() {
    if(!this.ready||this.recorder.active)return;
    this.playing=false;this.store.setOption('view','scene');this.store.select(null);
    await nextFrame();
    if(!this.ready||!this.active||this.recorder.active)return;
    try {
      this.seek(0);
      this.cameraControls=this.view.controls.enabled;this.view.controls.enabled=false;
      this.recorder.start(this.videoHeight);
      this.playing=true;this.updateProgress();
    }catch(error){
      this.view.controls.enabled=this.cameraControls??true;this.cameraControls=undefined;
      this.message=error.message;this.render();
    }
  }

  inspectRoute(kind) {
    if(this.recorder.active||this.busy)return;
    const route=this.routes[kind],flow=kind==='bag'?this.bag:this.coffee;
    if(!route?.result||route.ok)return;
    this.reset();this.cancelSoloChecks();
    flow.request=route.request;flow.result=route.result;
    flow.message='Inspecting the failed combined-order route. '+route.message;
    if(kind==='coffee') {
      flow.definition=this.definition;
      flow.diagnostic=coffeeDiagnostic(route.request,route.result,this.definition);
    } else flow.failureKind=route.result.bread?.failure?'bread':'bag';
    flow.player.configure(route.request,route.result,this.definition);
    flow.render();
    document.querySelector('[data-workflow="'+kind+'"]').click();
    flow.drawGuides();flow.frame();flow.player.playPartial();
  }

  click(event) {
    if(event.target.closest('[data-bread-action]'))this.playing=false;
    if(handleBreadPoseAction(event,this.store,this.view,this.breadSettings(),this.toast,patch=>this.store.transact('Changed bread pre-pick pose',()=>{const previous=this.store.scene.order_workflow||{};this.store.scene.order_workflow={...previous,bread:{...previous.bread,...patch}};})))return;
    const action=event.target.closest('[data-order-action]')?.dataset.orderAction;
    if(action?.startsWith('collision-')){const route=this.routes[action.slice(10)];const failure=route?.result?.bread?.failure||route?.result?.failure;if(failure)this.view.collisions.locate(failure);}
    if(action?.startsWith('inspect-'))this.inspectRoute(action.slice(8));
    if(action==='place')this.validate(true);
    if(action==='play')this.play();
    if(action==='reset'){this.cancelChecks();this.reset();this.message=this.ready?'Both routes passed · ready to start together.':'Preview reset. Place the order to check both routes.';this.render();}
    if(action==='frame')this.frame();
    if(action==='save-camera')this.saveCamera();
    if(action==='restore-camera')this.restoreCamera();
    if(action==='record')this.record();
    if(action==='stop-record'){this.playing=false;clearTimeout(this.finishTimer);this.recorder.stop('Stopped early');}
    if(action==='save-video')this.recorder.save();
    if(action==='edit-bag'||action==='edit-coffee'){
      const kind=action==='edit-bag'?'bag':'coffee';
      document.querySelector('[data-workflow="'+kind+'"]').click();
    }
  }

  change(event) {
    if(this.recorder.active||this.busy)return;
    const input=event.target;
    if(input.id==='order-video-height'){
      this.store.scene.order_workflow={...this.store.scene.order_workflow,video_height:Number(input.value)};
      this.store.emit('camera');return;
    }
    if(input.dataset.orderCoffee){
      const value=input.type==='number'?Number(input.value):input.value;
      if(input.type==='number'&&(!Number.isFinite(value)||value<=0)){this.render();return;}
      this.store.transact('Changed combined drink order',()=>{
        this.store.scene.coffee_workflow={...this.store.scene.coffee_workflow,[input.dataset.orderCoffee]:value};
      });
    }
    if(input.dataset.orderBread){
      const value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value)/100:input.value;
      if(input.type==='number'&&(!Number.isFinite(value)||(!input.dataset.orderBread.startsWith('bread_pre_pick_')&&value<=0))){this.render();return;}
      this.store.transact('Changed combined bread order',()=>{
        const previous=this.store.scene.order_workflow||{};
        this.store.scene.order_workflow={...previous,bread:{...previous.bread,[input.dataset.orderBread]:value}};
      });
    }
  }
}
