import {loadCoffeeDefinition} from './coffee-robots.js';
import {attachCollisions} from './collision-scene.js';
import {collisionText} from './collision-core.js';
import * as THREE from '../vendor/three.module.js';
import {coffeeSettings,makeCoffeeRequest} from './coffee-geometry.js';
import {coffeeMarkup} from './coffee-ui.js';
import {coffeeDiagnostic} from './failure-preview.js';
import {CoffeePlayer} from './coffee-player.js';
import {poseSuctionRobot} from './suction-render.js';

export class CoffeeWorkflow {
  constructor(store,plan,view,panel,toast) {
    Object.assign(this,{store,plan,view,panel,toast,active:false,request:null,result:null,runId:0});
    this.message='Choose a drink, then place a demo order.';
    this.player=new CoffeePlayer(store,view,(time,state)=>this.updateTime(time,state));
    this.guides=new THREE.Group();this.guides.name='Beverage service points';view.scene.add(this.guides);
    panel.addEventListener('click',e=>this.click(e));
    panel.addEventListener('change',e=>this.change(e));
    panel.addEventListener('input',e=>{
      if(e.target.id==='coffee-scrub'){this.player.playing=false;if(this.result?.pathOK)this.player.seek(Number(e.target.value));else this.player.seekDiagnostic(Number(e.target.value));}
    });
    store.on(type=>{
      if(['selection','option','workflow','camera'].includes(type))return;
      this.invalidate();
      if(this.active&&type!=='preview')this.timer=setTimeout(()=>this.check(),400);
    });
    this.render();
  }
  async setActive(active) {
    this.active=active;this.guides.visible=active;
    if(!active){this.player.stop();return;}
    if(!this.result)await this.check();
    else this.drawGuides();
  }
  invalidate(){
    clearTimeout(this.timer);this.runId++;this.worker?.terminate();this.worker=null;
    this.player.stop();this.request=null;this.result=null;this.diagnostic=null;this.message='Layout changed — rebuild the preview.';
    this.drawGuides();this.render();
  }
  async check(play=false) {
    if(!this.view.ready || this.suspended)return;
    clearTimeout(this.timer);this.worker?.terminate();this.player.stop();this.result=null;this.diagnostic=null;
    const id=++this.runId;
    this.message='Preparing beverage service poses…';this.render();
    try {
      const definition = await loadCoffeeDefinition(this.store);
      if(id!==this.runId)return;
      this.definition = definition;
      this.request=attachCollisions(this.view,makeCoffeeRequest(this.store,this.definition));
      if(this.request.errors.length){this.message=this.request.errors.join(' ');this.drawGuides();this.render();return;}
      this.worker=new Worker(new URL('./coffee-worker.js',import.meta.url),{type:'module'});
      this.worker.onmessage=e=>{
        if(e.data.id!==this.runId)return;
        if(e.data.progress){
          const p=e.data.progress,el=this.panel.querySelector('#coffee-status');
          if(el)el.textContent='Preparing step '+p.completed+' / '+p.total;
          return;
        }
        if(e.data.error)this.message=e.data.error;
        else{
          this.result=e.data.result;this.player.configure(this.request,this.result,this.definition);
          this.diagnostic=coffeeDiagnostic(this.request,this.result,this.definition);
          this.message=this.result.pathOK?'Demo order ready · '+this.result.duration.toFixed(1)+' s illustration':
            (collisionText(this.result.failure)||'Stopped at '+this.result.failure.phase+' ('+this.result.failure.time.toFixed(2)+' s): '+(this.result.failure.reason==='joint_step_exceeded'?'joint continuity check failed':'IK did not converge for the required tool pose'))+'. See the reason and preview the accepted motion below.';
        }
        this.worker?.terminate();this.worker=null;this.drawGuides();this.render();
        if(play&&this.active&&this.result?.pathOK){this.frame();this.player.play();}
      };
      this.worker.onerror=e=>{this.message='Preview failed: '+e.message;this.worker?.terminate();this.worker=null;this.render();};
      this.worker.postMessage({id,definition:this.definition,request:this.request});
    }catch(error){if(id===this.runId){this.request=null;this.message=error.message;this.drawGuides();this.render();}}
  }
  render(){this.panel.innerHTML=coffeeMarkup(this.store,this.request,this.result,this.message,this.diagnostic);}
  change(e){
    const key=e.target.dataset.coffeeSetting;if(!key)return;
    const value=e.target.type==='number'?Number(e.target.value)/Number(e.target.dataset.factor||1):e.target.value;
    if(typeof value==='number'&&(!Number.isFinite(value)||value<=0)){this.render();return;}
    this.store.transact('Updated beverage order',()=>{this.store.scene.coffee_workflow={...coffeeSettings(this.store),[key]:value};});
  }
  click(e){
    const action=e.target.closest('[data-coffee-action]')?.dataset.coffeeAction;
    if(action==='order')this.check(true);
    if(action==='play')this.player.play();
    if(action==='partial'){this.frame();this.player.playPartial();}
    if(action==='stop')this.player.stop();
    if(action==='frame')this.frame();
    if(action==='failure')this.locateFailure();
    if(action==='report'&&this.result){
      const blob=new Blob([JSON.stringify({layout:this.store.exportScene(),request:this.request,result:this.result},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nova-beverage-sequence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }
  updateTime(time,state){
    const slider=this.panel.querySelector('#coffee-scrub');if(slider)slider.value=time;
    const text=(id,value)=>{const node=this.panel.querySelector('#'+id);if(node)node.textContent=value;};
    text('coffee-time',time.toFixed(1)+' s');text('coffee-phase',state?.phase||'Order preview');
    text('coffee-play',this.player?.playing&&!this.player.diagnostic?'Ⅱ Pause':'▶ Preview drink');
    text('coffee-partial-play',this.player?.playing&&this.player.diagnostic&&time<this.player.playbackEnd?'Ⅱ Pause inspection':'▶ Preview to failure');
    if(this.player.diagnostic&&time>=this.player.playbackEnd-1e-6)text('coffee-phase','Stopped at last accepted pose · inspect rejected target');
    text('coffee-signals',state?.events?.length?state.events.map(e=>{
      const device=this.store.object(e.device)?.label||e.device;
      return device+': '+e.command.replaceAll('_',' ')+(e.command==='dispense_drink'?
        ' · '+e.preferences.temperature+' · sugar '+e.preferences.sugar+' · '+e.preferences.milk+' milk':'');
    }).join('\n'):'Waiting for the demo order.');
  }
  drawGuides(){
    this.guides.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});this.guides.clear();this.guides.visible=this.active;
    if(!this.active)return;
    const markers=(this.request?.targets||[]).map(t=>({...t,ok:!!this.result?.pathOK}));
    if(this.result?.failure)markers.push({...this.result.failure.target,name:'Failed beverage pose',ok:false,failed:true});
    for(const t of markers){
      const dot=new THREE.Mesh(new THREE.SphereGeometry(.011,12,8),new THREE.MeshBasicMaterial({color:t.failed?0xd54e46:t.ok?0x348b83:0xdca65e}));
      dot.position.set(t.position[0],t.position[2],-t.position[1]);dot.name=t.name;this.guides.add(dot);
    }
    this.store.workflowOverlay=markers;this.store.emit('workflow');
  }
  frame(){
    const robot=this.store.object(coffeeSettings(this.store).robot_id);if(!robot)return;
    this.store.select(null);this.store.setOption('view','scene');
    this.view.controls.target.set(robot.x,this.store.z(robot)+.2,-robot.y);
    this.view.camera.position.set(robot.x+1.8,this.store.z(robot)+2,-robot.y+2.1);
    this.view.controls.update();
  }
  locateFailure(){
    const f=this.result?.failure;if(!f)return;
    if(f.reason==='world_collision'){this.player.stop();this.view.collisions.locate(f);return;}
    this.player.stop();this.frame();
    if(f.previous){
      this.player.record=this.view.instances.get(this.request.robot.id);
      poseSuctionRobot(this.player.record,f.previous.q);
    }
    this.view.controls.target.set(f.target.position[0],f.target.position[2],-f.target.position[1]);
    this.view.controls.update();
    this.toast('Red point: requested pose. Arm: last accepted pose.');
  }
}
