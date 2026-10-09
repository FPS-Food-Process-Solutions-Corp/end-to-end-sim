import * as THREE from '../vendor/three.module.js';
import {coffeeSettings} from './coffee-geometry.js';
import {sceneKey} from './handoff-validation.js';
import {supportedVideoType} from './order-recorder.js';

const LAST_WORKING = 'layout-studio-last-working-preview-v1';
const ORDER_KIND = 'layout-studio-preview-order';
const kinds = {both:['bag','coffee'], bread:['bag'], drink:['coffee']};
const select = (key, label, value, options, disabled = false) =>
  `<label class="flow-field">${label}<select data-standard-setting="${key}" ${disabled?'disabled':''}>` +
  options.map(([id,name])=>`<option value="${id}" ${id===String(value)?'selected':''}>${name}</option>`).join('') + '</select></label>';

export class StandardPreview {
  constructor({store, view, order, panel, toast, exportFile, getMode, setMode}) {
    Object.assign(this, {store,view,order,panel,toast,exportFile,getMode,setMode});
    this.kind='both'; this.active=false; this.lastWorking=null; this.revision=0;
    try {
      const saved=localStorage.getItem(ORDER_KIND);
      if(kinds[saved])this.kind=saved;
      const working=JSON.parse(localStorage.getItem(LAST_WORKING)||'null');
      if(working?.scene?.objects&&working.scene.room&&kinds[working.kind])this.lastWorking=working;
    } catch {}
    panel.addEventListener('click', event=>this.click(event));
    panel.addEventListener('change', event=>this.change(event));
    panel.addEventListener('input', event=>{
      if(event.target.id==='standard-timeline'&&order.ready&&!order.recorder.active) {
        order.playing=false; order.seek(Number(event.target.value)); this.update();
      }
    });
    order.onChange=()=>this.render();
    store.on(type=>{
      if(['selection','option','workflow','camera'].includes(type))return;
      this.revision++; clearTimeout(this.timer);
      if(type==='preview')return;
      this.render();
      if(this.active&&this.getMode()==='standard')this.timer=setTimeout(()=>this.prepare(),650);
    });
    let previous=0;
    const tick=now=>{
      requestAnimationFrame(tick);
      if(now-previous<120)return;
      previous=now;
      if(this.active&&this.getMode()==='standard')this.update();
    };
    requestAnimationFrame(tick); this.render();
  }

  get valid() {return this.order.ready&&JSON.stringify(this.order.routeKinds)===JSON.stringify(kinds[this.kind]);}
  setActive(active) {
    this.active=active;
    clearTimeout(this.timer);
    this.order.setActive(active);
    // Standard owns motion preparation, including while arranging objects.
    if(this.getMode()==='standard')this.order.bag.suspended=this.order.coffee.suspended=true;
    if(active&&this.view.ready&&!this.valid&&!this.order.busy)this.timer=setTimeout(()=>this.prepare(),150);
    this.render();
  }
  loaded() {if(this.active)this.setActive(true);this.render();}

  async prepare(play=false) {
    clearTimeout(this.timer);
    if(this.order.recorder.active||!this.view.ready||!this.active||this.getMode()!=='standard')return;
    if(this.valid) {if(play)this.order.play();this.update();return;}
    const revision=this.revision, kind=this.kind, key=sceneKey(this.store.exportScene());
    await this.order.validate(false,kinds[kind]);
    if(revision!==this.revision||kind!==this.kind||key!==sceneKey(this.store.exportScene())||this.getMode()!=='standard')return;
    if(this.valid) {
      this.lastWorking={scene:this.store.exportScene(),kind,checkedAt:new Date().toISOString()};
      try {localStorage.setItem(LAST_WORKING,JSON.stringify(this.lastWorking));} catch {}
      if(play&&this.active)this.order.play();
    }
    this.render();
  }

  failedRoute() {return Object.entries(this.order.routes).find(([,route])=>route.error);}
  status() {
    if(!this.view.ready)return 'Loading scene…';
    if(this.order.recorder.active)return 'Recording your preview…';
    if(this.order.busy)return 'Preparing your preview…';
    if(this.valid)return this.order.playing?'Order in progress':this.order.time>=this.order.duration?'Ready for pickup':'Ready to preview';
    if(this.order.failed)return 'This arrangement needs attention';
    return 'Ready to prepare your order';
  }
  render() {
    const s=coffeeSettings(this.store), o=this.order, locked=o.busy||o.recorder.active;
    const failed=this.failedRoute(), restore=this.lastWorking&&sceneKey(this.lastWorking.scene)!==sceneKey(this.store.exportScene());
    this.panel.innerHTML=`
      <div class="flow-heading">ORDER PREVIEW</div><h2>See it in motion.</h2>
      <p class="flow-intro">Choose an order. We will prepare the robot movements for this layout.</p>
      ${select('kind','Include',this.kind,[['both','Bread + drink'],['bread','Bread only'],['drink','Drink only']],locked)}
      ${this.kind!=='bread'?select('drink','Drink',s.drink,[['coffee','Coffee'],['milk_tea','Milk tea']],locked)+
        select('temperature','Temperature',s.temperature,[['hot','Hot'],['cold','Cold']],locked)+
        `<details class="standard-options"><summary>Drink preferences</summary><div class="field-grid">`+
        select('sugar','Sugar',s.sugar,[['100%','100%'],['50%','50%'],['0%','No sugar']],locked)+
        select('milk','Milk',s.milk,[['regular','Regular'],['oat','Oat'],['none','No milk']],locked)+`</div>`+
        (s.temperature==='cold'?select('ice','Ice',s.ice,[['regular','Regular'],['light','Light'],['none','No ice']],locked):'')+`</details>`:''}
      <div id="standard-status" class="standard-status ${o.failed?'needs-attention':''}" role="status">${this.status()}</div>
      ${o.busy?'<button class="flow-wide" data-standard-action="cancel">Cancel preparation</button>':''}
      ${o.failed?`<p class="standard-problem">${failed?.[0]==='coffee'?'The drink station could not complete this order.':'The bread and bag station could not complete this order.'} Check its position or ask for an Advanced review.</p>
        <div class="flow-actions"><button data-standard-action="locate">Show station</button><button data-standard-action="advanced">Advanced details</button></div>`:''}
      ${restore?'<button class="flow-wide" data-standard-action="restore" '+(locked?'disabled':'')+'>Restore last working layout</button>':''}
      <div class="flow-actions standard-playback"><button class="primary" data-standard-action="play" ${locked||!this.view.ready?'disabled':''}>${o.playing?'Pause':this.valid?'Play order':'Prepare & play'}</button>
        <button data-standard-action="restart" ${!this.valid||locked?'disabled':''}>Restart</button></div>
      <input id="standard-timeline" class="standard-timeline" type="range" min="0" max="${o.duration||1}" step=".02" value="${o.time}" aria-label="Order timeline" ${!this.valid||locked?'disabled':''}>
      <div class="flow-time"><span id="standard-stage">${this.valid?'Order preview':'Waiting'}</span><span id="standard-time"></span></div>
      <p class="standard-check-note" id="standard-check-note"></p>
      <section class="standard-camera"><h3>Camera & video</h3>
        ${select('camera','Viewpoint','current',[['current','Current view'],['overview','Overview'],['customer','Customer'],['coffee','Coffee station'],['bread','Bread station'],['top','Top']],o.recorder.active)}
        <div class="flow-actions"><button data-standard-action="save-camera" ${o.recorder.active?'disabled':''}>Save viewpoint</button><button data-standard-action="restore-camera" ${!this.store.scene.order_camera||o.recorder.active?'disabled':''}>Restore viewpoint</button></div>
        ${select('resolution','Video resolution',o.videoHeight,[[720,'720p'],[1080,'1080p']],o.recorder.active)}
        <div class="flow-actions"><button data-standard-action="image" ${!this.view.ready?'disabled':''}>Save image</button>
          <button data-standard-action="record" ${!this.valid||locked||!o.recorder.mimeType?'disabled':''}>Record video</button></div>
        ${o.recorder.active?'<button class="flow-wide danger" data-standard-action="stop-record">Stop recording</button>':''}
        ${o.recorder.url?'<button class="primary flow-wide" data-standard-action="save-video">Save video</button>':''}
        <p class="flow-hint" id="standard-video-status"></p>
      </section>
      <details class="standard-options"><summary>Try a demo layout</summary><p>Open a prepared example with smaller bread pieces. Your current layout can be recovered with Undo.</p>
        <button class="flow-wide" data-standard-action="demo" ${locked?'disabled':''}>Open demo project</button></details>`;
    this.update();
  }

  update() {
    const o=this.order, set=(id,text)=>{const node=this.panel.querySelector('#'+id);if(node&&node.textContent!==text)node.textContent=text;};
    set('standard-status',this.status());
    set('standard-time',`${o.time.toFixed(1)} / ${o.duration.toFixed(1)} s`);
    const slider=this.panel.querySelector('#standard-timeline');if(slider&&!slider.matches(':active'))slider.value=o.time;
    const button=this.panel.querySelector('[data-standard-action="play"]');
    if(button)button.textContent=o.playing?'Pause':this.valid?'Play order':'Prepare & play';
    set('standard-stage',o.playing?(this.kind==='bread'?'Preparing bread':this.kind==='drink'?'Preparing drink':'Preparing bread and drink'):this.valid&&o.time>=o.duration?'Ready for pickup':this.valid?'Order preview':'Waiting');
    const off=this.valid&&Object.values(o.routes).some(route=>!route.request?.collision?.enabled||route.request?.breadTask&&!route.request.breadTask.collision?.enabled);
    set('standard-check-note',this.valid?(off?'Motion preview ready. Obstacle checks are off for part of this preview.':'Preview passed the configured motion checks.'):'Simulation for layout review.');
    const r=o.recorder;
    const size=r.blob?.size>=1048576?(r.blob.size/1048576).toFixed(1)+' MB':Math.max(1,Math.round((r.blob?.size||0)/1024))+' KB';
    set('standard-video-status',r.active?'Recording your preview…':r.url?(r.reason==='Complete order'?'Video ready to save':'Partial video ready to save')+' · '+size+' · '+(r.mimeType.startsWith('video/mp4')?'MP4':'WebM'):'Video uses your current viewpoint. MP4 when supported, otherwise WebM.');
    document.getElementById('studio-mode').disabled=!!this.view.activeRecorder?.active;
  }

  change(event) {
    const key=event.target.dataset.standardSetting;if(!key)return;
    const value=event.target.value;
    if(key==='camera'){this.camera(value);return;}
    if(key==='resolution') {
      this.store.scene.order_workflow={...this.store.scene.order_workflow,video_height:Number(value)};
      this.store.emit('camera');return;
    }
    if(key==='kind') {
      this.kind=kinds[value]?value:'both';try{localStorage.setItem(ORDER_KIND,this.kind);}catch{}
      this.revision++;this.order.invalidate();this.render();this.timer=setTimeout(()=>this.prepare(),250);return;
    }
    if(['drink','temperature','sugar','milk','ice'].includes(key))this.store.transact('Changed order',()=>{
      this.store.scene.coffee_workflow={...coffeeSettings(this.store),[key]:value};
    });
  }
  camera(kind) {
    if(this.order.recorder.active)return;
    if(kind==='overview')this.view.overview();
    if(kind==='top')this.view.top();
    if(kind==='coffee'||kind==='bread') {
      const id=kind==='coffee'?coffeeSettings(this.store).robot_id:this.order.breadSettings().shared_table_id;
      if(this.store.object(id)){const saved=this.store.selected;this.store.selected=[id];this.view.focus();this.store.selected=saved;}
    }
    if(kind==='customer') {
      const counter=this.store.object('left_counter')||this.store.object('coffee_station');
      const target=counter?new THREE.Vector3(counter.x,1.25,-counter.y):this.view.controls.target.clone();
      this.view.controls.target.copy(target);this.view.camera.position.copy(target).add(new THREE.Vector3(-2.8,.45,1.2));
      this.view.camera.lookAt(target);this.view.controls.update();
    }
  }
  async click(event) {
    const action=event.target.closest('[data-standard-action]')?.dataset.standardAction;if(!action)return;
    const o=this.order;
    try {
      if(action==='cancel') {this.revision++;clearTimeout(this.timer);o.cancelChecks();o.reset();o.ready=false;o.failed=false;this.render();}
      if(action==='play') {if(this.valid){o.play();this.update();}else await this.prepare(true);}
      if(action==='restart'){o.playing=false;o.seek(0);o.play();this.update();}
      if(action==='image')await this.exportFile('png');
      if(action==='record') {o.recorder.mimeType=supportedVideoType(true);await o.record();this.render();}
      if(action==='stop-record'){o.playing=false;clearTimeout(o.finishTimer);o.recorder.stop('Stopped early');}
      if(action==='save-video')o.recorder.save();
      if(action==='save-camera')o.saveCamera();
      if(action==='restore-camera')o.restoreCamera();
      if(action==='locate') {
        const route=this.failedRoute()?.[1],robot=route?.request?.robot;
        if(robot){this.store.select(robot.id);this.view.focus();}
      }
      if(action==='advanced') {
        const failed=this.failedRoute()?.[0];this.setMode('advanced');
        document.querySelector('[data-panel="flow"]').click();
        if(failed&&o.routes[failed]?.result)o.inspectRoute(failed);
      }
      if(action==='restore'&&this.lastWorking){this.kind=this.lastWorking.kind;try{localStorage.setItem(ORDER_KIND,this.kind);}catch{}this.store.importScene(this.lastWorking.scene);this.toast('Working layout restored. Undo can recover your edits.');}
      if(action==='demo') {
        const response=await fetch('./layouts/standard-demo.json');if(!response.ok)throw new Error('Could not open the demo project.');
        this.kind='both';try{localStorage.setItem(ORDER_KIND,this.kind);}catch{}this.store.importScene(await response.json());this.view.overview();
        await this.prepare();
      }
    } catch(error){this.toast(error.message);}
  }
}
