const KEY='coffee-layout-studio-snapshots-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const validScene=scene=>scene&&Array.isArray(scene.objects)&&scene.room&&scene.objects.every(o=>o&&typeof o.id==='string');
const cameraState=view=>({position:view.camera.position.toArray(),target:view.controls.target.toArray(),up:view.camera.up.toArray(),fov:view.camera.fov});

export class SceneSnapshots {
  constructor(store,view,{toast,getWorkflow,setWorkflow}) {
    Object.assign(this,{store,view,toast,getWorkflow,setWorkflow});
    this.items=[];this.lastDeleted=null;this.storageError=null;
    this.readLibrary();
    this.dialog=document.createElement('dialog');
    this.dialog.className='snapshots-dialog';this.dialog.setAttribute('aria-labelledby','snapshots-title');
    document.body.append(this.dialog);
    for(const type of ['keydown','copy','paste'])this.dialog.addEventListener(type,event=>event.stopPropagation());
    this.dialog.addEventListener('click',event=>this.click(event));
    this.dialog.addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.target;
      try{this.save(form.elements.name.value,form.elements.description.value);}
      catch(error){this.setMessage(error.message,true);}
    });
    this.dialog.addEventListener('change',event=>{
      if(event.target.id==='snapshots-import'&&event.target.files[0])this.importFile(event.target.files[0]);
    });
    this.render();
  }

  readLibrary() {
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||'null');
      if(saved&&(saved.version!==1||!Array.isArray(saved.snapshots)))throw new Error('Unrecognized snapshot library.');
      this.items=(saved?.snapshots||[]).filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&validScene(item.scene));
      this.storageError=null;
    }catch(error){this.storageError='Snapshot library could not be read: '+error.message;}
  }

  open() {
    this.readLibrary();
    this.render();this.dialog.showModal();
    this.dialog.querySelector('[name="name"]').focus();
  }

  persist(items) {
    if(this.storageError)throw new Error(this.storageError+' Export a backup before changing browser storage.');
    try{localStorage.setItem(KEY,JSON.stringify({version:1,snapshots:items}));}
    catch(error){throw new Error('Could not save snapshots in this browser. Storage may be full; export a backup and remove unneeded snapshots.');}
    this.items=items;
  }

  thumbnail() {
    this.view.renderer.render(this.view.scene,this.view.camera);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=160;
    const ctx=canvas.getContext('2d'),source=this.view.canvas;
    const scale=Math.min(256/source.width,160/source.height),w=source.width*scale,h=source.height*scale;
    ctx.fillStyle='#222e37';ctx.fillRect(0,0,256,160);
    ctx.drawImage(source,(256-w)/2,(160-h)/2,w,h);
    return canvas.toDataURL('image/jpeg',.7);
  }

  save(name,description='') {
    this.readLibrary();
    name=name.trim();description=description.trim();
    if(!name)throw new Error('Give the snapshot a name.');
    if(name.length>100||description.length>1000)throw new Error('Use a name under 100 characters and a description under 1,000.');
    if(!this.view.ready)throw new Error('Wait for the scene models to load.');
    const item={id:crypto.randomUUID(),name,description,createdAt:new Date().toISOString(),
      scene:this.store.exportScene(),camera:cameraState(this.view),workflow:this.getWorkflow(),
      selection:[...this.store.selected],thumbnail:this.thumbnail()};
    this.persist([item,...this.items]);
    this.render();
    this.setMessage('Saved “'+name+'”.');
    return item;
  }

  restore(id) {
    this.readLibrary();
    const item=this.items.find(item=>item.id===id);if(!item)return;
    this.store.importScene(clone(item.scene));
    this.store.selected=(item.selection||[]).filter(id=>this.store.item(id));
    this.store.emit('selection');
    this.setWorkflow(['bag','coffee','order'].includes(item.workflow)?item.workflow:'bag');
    const saved=item.camera,valid=key=>Array.isArray(saved?.[key])&&saved[key].length===3&&saved[key].every(Number.isFinite);
    if(valid('position')&&valid('target')){
      this.view.camera.position.fromArray(saved.position);this.view.controls.target.fromArray(saved.target);
      if(valid('up'))this.view.camera.up.fromArray(saved.up);
      if(Number.isFinite(saved.fov)&&saved.fov>0&&saved.fov<150)this.view.camera.fov=saved.fov;
      this.view.camera.lookAt(this.view.controls.target);this.view.camera.updateProjectionMatrix();this.view.controls.update();
    }
    this.dialog.close();
    this.toast('Restored “'+item.name+'”. Place the order again to check its routes.');
  }

  remove(id) {
    this.readLibrary();
    const item=this.items.find(item=>item.id===id);if(!item)return;
    this.persist(this.items.filter(item=>item.id!==id));this.lastDeleted=item;
    this.render();this.setMessage('Deleted “'+item.name+'”. You can undo this below.');
  }

  undoDelete() {
    if(!this.lastDeleted)return;
    this.readLibrary();
    this.persist([this.lastDeleted,...this.items]);
    this.lastDeleted=null;this.render();this.setMessage('Snapshot restored.');
  }

  export() {
    this.readLibrary();
    const blob=new Blob([JSON.stringify({version:1,snapshots:this.items},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='coffee-bar-scene-snapshots.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }

  async importFile(file) {
    try{
      const value=JSON.parse(await file.text());
      if(value.version!==1||!Array.isArray(value.snapshots)||value.snapshots.some(item=>
        !item||typeof item.name!=='string'||!item.name.trim()||!validScene(item.scene)))
        throw new Error('Choose an exported snapshot library.');
      const additions=value.snapshots.map(item=>({
        id:crypto.randomUUID(),name:item.name.trim().slice(0,100),
        description:String(item.description||'').slice(0,1000),
        createdAt:item.createdAt||new Date().toISOString(),scene:clone(item.scene),
        camera:clone(item.camera||{}),workflow:item.workflow,selection:Array.isArray(item.selection)?item.selection:[],
        thumbnail:typeof item.thumbnail==='string'&&/^data:image\/(jpeg|png);base64,[a-zA-Z0-9+/=]+$/.test(item.thumbnail)?item.thumbnail:null,
      }));
      this.readLibrary();
      this.persist([...additions,...this.items]);this.render();this.setMessage('Imported '+additions.length+' snapshots.');
    }catch(error){this.setMessage('Import failed: '+error.message,true);}
  }

  setMessage(text,error=false) {
    const node=this.dialog.querySelector('#snapshots-message');
    node.textContent=text;node.classList.toggle('error',error);
  }

  render() {
    const date=item=>{const d=new Date(item.createdAt);return Number.isNaN(d.getTime())?'Saved snapshot':d.toLocaleString();};
    this.dialog.innerHTML=[
      '<div class="snapshots-heading"><div><span class="flow-heading">SCENE LIBRARY</span><h2 id="snapshots-title">Saved snapshots</h2></div>',
      '<button data-snapshot-action="close" aria-label="Close snapshots">✕</button></div>',
      '<p class="snapshots-intro">Save the layout, workflow settings and current viewpoint. Restoring stops previews; routes are checked again before playback.</p>',
      '<div class="snapshots-content"><form class="snapshot-form">',
      '<label>Snapshot name<input name="name" placeholder="e.g. Wider counter · first layout" maxlength="100" required></label>',
      '<label>Description <span>optional</span><textarea name="description" rows="4" maxlength="1000" placeholder="What changed, or why keep this version?"></textarea></label>',
      '<button class="primary" type="submit" '+(this.storageError?'disabled':'')+'>Save current scene</button>',
      '<p>Saved in this browser. Export a backup to keep or transfer your snapshots.</p>',
      '<div class="flow-actions"><button type="button" data-snapshot-action="export" '+(!this.items.length?'disabled':'')+'>Export snapshots</button>',
      '<button type="button" data-snapshot-action="import">Import snapshots</button></div>',
      '<input id="snapshots-import" type="file" accept=".json" hidden>',
      '</form><div class="snapshot-list" aria-label="Saved scenes">',
      this.items.length?this.items.map(item=>'<article class="snapshot-card" data-snapshot-id="'+esc(item.id)+'">'+
        (item.thumbnail?'<img src="'+esc(item.thumbnail)+'" alt="Scene preview" loading="lazy">':'')+
        '<div class="snapshot-info"><h3>'+esc(item.name)+'</h3><time>'+esc(date(item))+'</time>'+
        (item.description?'<p>'+esc(item.description)+'</p>':'')+
        '<div class="flow-actions"><button class="primary" data-snapshot-action="restore" data-id="'+esc(item.id)+'">Restore</button>'+
        '<button data-snapshot-action="delete" data-id="'+esc(item.id)+'">Delete</button></div></div></article>').join(''):
        '<div class="snapshot-empty">No snapshots yet.<br>Save the current scene to keep your first version.</div>',
      '</div></div><div class="snapshots-footer"><span id="snapshots-message" role="status">'+esc(this.storageError||'')+'</span>',
      this.lastDeleted?'<button data-snapshot-action="undo">Undo deletion</button>':'','</div>'
    ].join('');
  }

  click(event) {
    const button=event.target.closest('[data-snapshot-action]');if(!button)return;
    try{
      const action=button.dataset.snapshotAction;
      if(action==='close')this.dialog.close();
      if(action==='restore')this.restore(button.dataset.id);
      if(action==='delete')this.remove(button.dataset.id);
      if(action==='undo')this.undoDelete();
      if(action==='export')this.export();
      if(action==='import')this.dialog.querySelector('#snapshots-import').click();
    }catch(error){this.setMessage(error.message,true);}
  }
}
