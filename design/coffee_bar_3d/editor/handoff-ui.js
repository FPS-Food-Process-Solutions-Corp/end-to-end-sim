import {buildHandoffBundle} from './handoff-bundle.js';

export class HandoffExport {
  constructor(store,view,download,players=[]) {
    Object.assign(this,{store,view,download,players});
    this.dialog=document.createElement('dialog');
    this.dialog.className='handoff-dialog';this.dialog.setAttribute('aria-labelledby','handoff-title');
    this.dialog.innerHTML=`<form>
      <div class="handoff-heading"><h2 id="handoff-title">AI handoff bundle</h2><button type="button" data-handoff-close aria-label="Close AI handoff">×</button></div>
      <p>Give another AI the current scene, reading brief, numbered top-down and 3D views, resolved positions, workflow service points and dated check results.</p>
      <label class="handoff-note">Question or context for the reviewer <span>(optional)</span><textarea name="note" rows="3" maxlength="4000" placeholder="e.g. Evaluate the tea-machine location and the beverage robot's reach."></textarea></label>
      <label class="checkline"><input type="checkbox" name="analysis" checked> Include kinematics, collision proxies and analysis source</label>
      <label class="checkline"><input type="checkbox" name="glb"> Include 3D model (GLB · larger download)</label>
      <p class="hint">Uses the saved scene poses. Export does not run IK. Only completed checks recorded in this browser session are included; checks for older layouts are marked stale.</p>
      <div class="handoff-actions"><button class="primary" type="submit">Download ZIP</button><button type="button" data-handoff-close>Close</button></div>
      <p data-handoff-status role="status" aria-live="polite"></p>
    </form>`;
    document.body.append(this.dialog);
    for(const type of ['keydown','copy','paste'])this.dialog.addEventListener(type,event=>event.stopPropagation());
    this.dialog.addEventListener('click',event=>{if(event.target.closest('[data-handoff-close]')&&!this.busy)this.dialog.close();});
    this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();});
    this.dialog.addEventListener('submit',event=>{event.preventDefault();this.export();});
  }
  open(){this.dialog.querySelector('[data-handoff-status]').textContent='';this.dialog.showModal();}
  async export() {
    if(this.busy)return;
    const form=this.dialog.querySelector('form'),status=form.querySelector('[data-handoff-status]');
    this.busy=true;for(const button of form.querySelectorAll('button'))button.disabled=true;
    try {
      const result=await buildHandoffBundle({store:this.store,view:this.view,
        players:this.players,includeAnalysis:form.elements.analysis.checked,includeGLB:form.elements.glb.checked,note:form.elements.note.value,
        progress:message=>status.textContent=message});
      this.download(result.blob,result.filename,'application/zip');
      status.textContent='ZIP downloaded. Start with START_HERE.md. '+(result.manifest.warnings.length?result.manifest.warnings.length+' limitation(s) listed in manifest.json.':'');
    }catch(error){status.textContent='Export failed: '+error.message;console.error(error);}
    finally{this.busy=false;for(const button of form.querySelectorAll('button'))button.disabled=false;}
  }
}
