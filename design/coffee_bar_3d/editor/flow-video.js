import {OrderRecorder} from './order-recorder.js';

const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const ignored=new Set(['selection','option','workflow','camera']);

export class FlowVideo {
  constructor(flow,kind) {
    this.flow=flow;this.kind=kind;this.time=0;this.token=0;this.preparing=false;
    this.recorder=new OrderRecorder(flow.view,()=>{
      if(!this.recorder.active)this.restoreControls();
      if(this.recorder.error)this.flow.player.playing=false;
      this.flow.render();
    });
    flow.panel.addEventListener('click',event=>{
      const button=event.target.closest('[data-video-action]');
      if(!button||!button.closest('[data-flow-video]'))return;
      const action=button.dataset.videoAction;
      if(action==='record')this.record();
      if(action==='stop')this.stop('Stopped early');
      if(action==='save')this.recorder.save();
      if(action==='frame'&&!this.locked)flow.frame();
      if(action==='save-camera')this.saveCamera();
      if(action==='restore-camera')this.restoreCamera();
    });
    flow.panel.addEventListener('change',event=>{
      const input=event.target;if(!input.closest('[data-flow-video]')||this.locked)return;
      if(input.dataset.videoSetting==='height')this.updateSettings({height:Number(input.value)});
      if(input.dataset.videoSetting==='segment')this.updateSettings({segment:input.value});
    });
    flow.store.on(type=>{
      if(!ignored.has(type)){this.stop('Layout or order changed');return;}
      if(this.recorder.state==='recording'&&['selection','option'].includes(type))
        queueMicrotask(()=>{if(this.recorder.state==='recording')flow.player.seek(this.time);});
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden)this.stop('Interrupted when the app was hidden');
    });
    this.last=performance.now();
    const tick=now=>{
      requestAnimationFrame(tick);
      if(this.recorder.state==='recording'){
        try{
          if(!this.finished){
            this.time=Math.min(this.end,this.time+Math.min(.1,(now-this.last)/1000));
            flow.player.playing=false;flow.player.seek(this.time);
            if(this.time>=this.end){
              this.finished=true;
              this.finishTimer=setTimeout(()=>this.recorder.stop(this.recorder.completeReason),180);
            }
          }
          this.recorder.capture();this.updateStatus();
        }catch(error){this.stop('Recording interrupted');flow.toast(error.message);}
      }
      this.last=now;
    };
    requestAnimationFrame(tick);
  }

  get settings(){return this.flow.store.scene.flow_video?.[this.kind]||{};}
  get height(){return this.settings.height===1080?1080:720;}
  get segment(){return this.kind==='coffee'?'coffee':this.settings.segment==='pastry'?'pastry':'packing';}
  get locked(){return this.preparing||this.recorder.active;}
  get range(){
    const {request,result}=this.flow;
    if(!request||!result?.pathOK||request.errors?.length||this.flow.worker)return null;
    if(this.kind==='bag'&&request.breadTask&&!result.bread?.pathOK)return null;
    let start=0,end=result.route?.duration||result.duration||request.duration;
    if(this.segment==='pastry'){
      if(!request.breadTask||!result.bread?.pathOK)return null;
      start=result.bread.startTime??result.coordination?.breadStartTime??0;
      end=result.bread.endTime??start+result.bread.duration;
    }
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start?{start,end}:null;
  }
  get title(){return this.segment==='coffee'?'coffee flow':this.segment==='pastry'?'pastry pick':'bread & bag flow';}

  updateSettings(patch){
    const scene=this.flow.store.scene;
    scene.flow_video={...scene.flow_video,[this.kind]:{...this.settings,...patch}};
    this.flow.store.emit('camera');this.mount();
  }

  mount(){
    this.flow.panel.querySelector('[data-flow-video]')?.remove();
    const host=document.createElement('details');host.className='flow-settings';host.open=true;
    host.dataset.flowVideo=this.kind;
    const locked=this.locked?'disabled':'',range=this.range;
    const available=!!range&&this.flow.active&&!this.flow.suspended&&!this.locked&&
      (!this.flow.view.activeRecorder?.active||this.flow.view.activeRecorder===this.recorder);
    host.innerHTML='<summary>Camera &amp; video</summary>'+
      '<p class="flow-hint">Record this flow independently. Orbit and zoom to choose the camera view.</p>'+
      (this.kind==='bag'?'<label class="flow-field">Recording segment<select data-video-setting="segment" aria-label="Recording segment" '+locked+'>'+
        '<option value="packing" '+(this.segment==='packing'?'selected':'')+'>Whole bread &amp; bag flow</option>'+
        '<option value="pastry" '+(this.segment==='pastry'?'selected':'')+'>Pastry pick &amp; place only</option></select></label>':'')+
      (this.segment==='pastry'?'<p class="flow-hint">From the pastry robot’s first movement through placement and withdrawal. Bag support motion stays synchronized; the earlier bag setup and later delivery are omitted.</p>':'')+
      '<div class="flow-actions"><button data-video-action="frame" '+locked+'>Frame flow</button>'+
        '<button data-video-action="save-camera" '+locked+'>Save this POV</button></div>'+
      '<button class="flow-wide" data-video-action="restore-camera" '+(!this.settings.camera||this.locked?'disabled':'')+'>Restore saved POV</button>'+
      '<label class="flow-field">Video resolution<select data-video-setting="height" aria-label="Video resolution" '+locked+'>'+
        [720,1080].map(h=>'<option value="'+h+'" '+(this.height===h?'selected':'')+'>'+h+'p · 30 fps</option>').join('')+'</select></label>'+
      '<button class="primary flow-wide" data-video-action="record" '+(!available||!this.recorder.mimeType?'disabled':'')+'>Record '+this.title+' from this view</button>'+
      (!range?'<p class="flow-hint">'+(this.segment==='pastry'&&!this.flow.request?.breadTask?'Choose Nova pastry pickup under Bread loading, then run Check IK.':'Check this flow successfully before recording. The other flow does not need to pass.')+'</p>':'')+
      (this.recorder.active?'<button class="flow-wide danger" data-video-action="stop" '+(this.recorder.state==='stopping'?'disabled':'')+'>Stop recording</button>':'')+
      '<p data-video-status class="flow-hint" role="status"></p>'+
      (this.recorder.url?'<button class="primary flow-wide" data-video-action="save">Save video · '+(this.recorder.mimeType.startsWith('video/mp4')?'MP4':'WebM')+'</button>':'');
    this.flow.panel.querySelector('.flow-player')?.after(host);
    if(!host.isConnected)this.flow.panel.append(host);
    if(this.locked)for(const input of this.flow.panel.querySelectorAll('button,input,select,textarea'))
      if(!host.contains(input))input.disabled=true;
    this.updateStatus();
  }

  updateStatus(){
    const node=this.flow.panel.querySelector('[data-video-status]');if(!node)return;
    const r=this.recorder;
    node.textContent=r.state==='recording'?'● Recording · '+Math.max(0,this.time-this.start).toFixed(1)+' / '+(this.end-this.start).toFixed(1)+' s · fixed camera':
      r.state==='stopping'?'Finishing video…':r.state==='ready'?r.reason+' · '+(r.blob.size/1048576).toFixed(1)+' MB':
      r.error||(!r.mimeType?'Canvas video recording is unavailable in this browser.':'Records the 3D scene without audio. Other equipment remains visible but its flow does not play.');
  }

  saveCamera(){
    if(this.locked)return;
    const {camera,controls}=this.flow.view;
    this.updateSettings({camera:{position:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),fov:camera.fov}});
    this.flow.toast('Camera viewpoint saved for this flow.');
  }

  restoreCamera(){
    const saved=this.settings.camera;if(!saved||this.locked)return;
    const valid=key=>Array.isArray(saved[key])&&saved[key].length===3&&saved[key].every(Number.isFinite);
    if(!valid('position')||!valid('target')){this.flow.toast('Save a new camera viewpoint.');return;}
    const {camera,controls}=this.flow.view;
    this.flow.store.setOption('view','scene');camera.position.fromArray(saved.position);
    controls.target.fromArray(saved.target);if(valid('up'))camera.up.fromArray(saved.up);
    if(Number.isFinite(saved.fov)&&saved.fov>0&&saved.fov<150)camera.fov=saved.fov;
    camera.lookAt(controls.target);camera.updateProjectionMatrix();controls.update();
  }

  restoreControls(){
    if(this.cameraControls===undefined)return;
    this.flow.view.controls.enabled=this.cameraControls;this.cameraControls=undefined;
  }

  stop(reason='Stopped early'){
    this.token++;this.preparing=false;clearTimeout(this.finishTimer);
    if(this.recorder.active){this.flow.player.playing=false;this.recorder.stop(reason);}
  }

  async record(){
    const range=this.range;
    if(!range||this.locked||!this.flow.active||this.flow.suspended)return;
    const token=++this.token,request=this.flow.request,result=this.flow.result;
    this.preparing=true;this.mount();
    this.flow.store.setOption('view','scene');this.flow.store.select(null);
    await nextFrame();
    if(token!==this.token||!this.flow.active||this.flow.request!==request||this.flow.result!==result){
      this.preparing=false;this.flow.render();return;
    }
    try{
      this.flow.player.configure(request,result,this.flow.definition);
      this.start=range.start;this.end=range.end;this.time=range.start;this.finished=false;
      this.flow.player.seek(this.start);this.flow.player.playing=false;
      this.cameraControls=this.flow.view.controls.enabled;this.flow.view.controls.enabled=false;
      this.preparing=false;this.last=performance.now();
      const filename=this.segment==='coffee'?'coffee-flow':this.segment==='pastry'?'pastry-pick':'bread-bag-flow';
      this.recorder.start(this.height,{filename,completeReason:'Complete '+this.title});
    }catch(error){
      this.preparing=false;this.restoreControls();this.flow.toast(error.message);this.flow.render();
    }
  }
}
