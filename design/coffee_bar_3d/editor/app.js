import {studioMode, installStudioMode} from './studio-mode.js';
import {StandardPreview} from './standard-preview.js';
import {installLanguageSelector} from './i18n.js';
import {ventProperties} from './vent-layout.js';
import {fixtureBag, stackSettings} from './bag-fixture-parameters.js';
import {labelProperties, changeLabelAppearance} from './label-ui.js';
import {HandoffExport} from './handoff-ui.js';
import {installResizeSettings} from './resize-settings.js';
import {resizeDimension} from './resize-geometry.js';
import {resizeControls, changeResizeControl} from './resize-ui.js';
import {floorTeaProperties} from './floor-machine-fit.js';
import {FLOOR_TEA_KEY} from './floor-tea-machine.js';
import {zoneProperties, changeZone} from './zone-ui.js';
import {installFullscreenView} from './fullscreen-view.js';
import {CollisionControls} from './collision-ui.js';
import {barrierProperties, changeBarrier, alignBarrierOpening} from './barrier-ui.js';
import {ComponentLibrary} from './component-library.js';
import {CoffeeWorkflow} from './coffee-workflow.js';
import {OrderWorkflow} from './order-workflow.js';
import {SceneSnapshots} from './scene-snapshots.js';
import {BagWorkflow} from './bag-workflow.js';
import {installComponentClipboard} from './clipboard.js';
import {SceneStore,bounds,cleanAngle,rotate} from './store.js';
import {PlanView} from './plan.js';
import {Scene3D} from './scene3d.js';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE='coffee-layout-studio-v2';let toastTimer,saveTimer;
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);}
function download(value,name,type){const blob=value instanceof Blob?value:new Blob([value],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const seed=await fetch('./scene_config.json').then(r=>{if(!r.ok)throw new Error('Cannot load scene configuration');return r.json();});
const store=new SceneStore(seed);let restored=false,standard,modeUI;
store.presentationMode=studioMode()==='standard';
const languageUI=installLanguageSelector({projectObject:id=>store.item(id)});
try{const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');if(saved){store.importScene(saved);store.undoStack=[];store.selected=saved.editor_selection?.filter(id=>store.item(id))||['nova5'];restored=true;}}catch(e){console.warn('Saved layout could not be restored',e);}
const plan=new PlanView($('plan'),store),three=new Scene3D($('scene'),store,message=>{$('model-status').textContent=message;});
installResizeSettings(store);
installFullscreenView($('studio-view'), $('fullscreen-view'));
const collapsed=new Set(['area_left','area_right','area_upper','area_people']);
const icons={vent:'▧',customer_barrier:'▯',robot:'◇',shelf:'▤',table:'▱',counter:'▱',cart:'▱',machine:'▣',dispenser:'○',human:'♙',charger:'▥',window:'▯'};
function renderLayers(){
  const render=(parent,level)=>store.children(parent).map(item=>{
    const group=store.isGroup(item.id),selected=store.selected.includes(item.id),hidden=!store.visible(item.id),locked=store.locked(item.id),closed=collapsed.has(item.id);
    const row=`<div role="treeitem" aria-selected="${selected}" ${group?`aria-expanded="${!closed}"`:''} class="layer-row ${group?'group':''} ${selected?'selected':''} ${hidden?'hidden-row':''}" data-layer="${esc(item.id)}" style="padding-left:${9+level*15}px"><button data-action="${group?'collapse':'select'}" title="${group?'Expand / collapse':esc(item.kind)}" class="tree-icon">${group?(closed?'▸':'▾'):(icons[item.kind]||'□')}</button><span class="layer-label" title="${esc(item.label)}">${esc(item.label)}</span><button class="row-action ${hidden?'is-off':''}" data-action="visibility" title="${hidden?'Show':'Hide'} ${esc(item.label)}" aria-label="${hidden?'Show':'Hide'} ${esc(item.label)}">${hidden?'◌':'◉'}</button><button class="row-action ${locked?'is-off':''}" data-action="lock" title="${locked?'Unlock':'Lock'} ${esc(item.label)}">${locked?'▣':'▫'}</button></div>`;
    return row+(group&&!closed?render(item.id,level+1):'');
  }).join('');$('layers').innerHTML=render(null,0);
}
$('layers').addEventListener('click',e=>{const row=e.target.closest('[data-layer]');if(!row)return;const id=row.dataset.layer,action=e.target.closest('[data-action]')?.dataset.action;if(action==='visibility')store.toggleVisibility(id);else if(action==='lock')store.toggleLock(id);else if(action==='collapse'){collapsed.has(id)?collapsed.delete(id):collapsed.add(id);renderLayers();}else store.select(id,e.shiftKey);});
$('collapse-all').onclick=()=>{if(collapsed.size)collapsed.clear();else store.scene.groups.forEach(g=>collapsed.add(g.id));renderLayers();};
function field(key,label,value,suffix=store.options.units,disabled=false,limits=''){return `<label class="field">${label}<span class="input-wrap"><input data-field="${key}" aria-label="${label}" type="number" step="${suffix==='°'||['shelf_columns','shelf_tiers','stack_bag_count'].includes(key)?1:key==='stack_bag_thickness'?.01:.1}" ${limits||(key==='shelf_columns'?'min="1" max="24"':'')} value="${Number(value.toFixed(3))}" ${disabled?'disabled':''}><span class="suffix">${suffix}</span></span></label>`;}
function properties(){
  const ids=store.selected,items=store.resolve(),one=ids.length===1?store.item(ids[0]):null,o=one&&store.object(one.id),bb=o||bounds(items),f=store.options.units==='px'?200:100,locked=ids.some(id=>store.locked(id));
  $('selection-count').textContent=ids.length?ids.length+' selected':'';
  if(!items.length){$('properties').innerHTML=`<div class="empty-selection">Select an item in the plan, 3D scene, or layer list.<span class="advanced-only"><br><br>The selected robot's reach appears as circles in 2D and translucent sphere surfaces in 3D, alongside distances.</span></div><div class="property-section" data-standard-property><h3>Room size</h3><div class="field-grid">${field('room_width','Width',store.scene.room.width*f)}${field('room_depth','Depth',store.scene.room.depth*f)}</div><p class="hint">Changing the room boundary keeps equipment positions fixed.</p></div>`;return;}
  let html=`<section class="property-section" data-standard-property><label class="field object-name-field">Label<input id="item-name" class="selection-name" aria-label="Label" type="text" maxlength="240" value="${esc(one?.label||items.length+' selected items')}" ${one?'':'disabled'}></label><div class="type-label">${o?esc(o.kind):'Area / group'}${o?.kind==='robot'?' · actual URDF model':''}</div></section>`;
  if(o&&['robot','machine','dispenser','charger','human','placement_zone','customer_barrier','vent'].includes(o.kind)){
    html+=`<section class="property-section" data-standard-property><h3>Support</h3><select id="support" aria-label="Support" ${locked?'disabled':''}><option value="">Floor</option>${store.scene.objects.filter(t=>['table','counter','cart','support'].includes(t.kind)&&t.id!==o.id).map(t=>`<option value="${esc(t.id)}" ${o.support===t.id?'selected':''}>${esc(t.label)}</option>`).join('')}</select><div class="field-grid room-field">${field('z','Offset above support',(o.z||0)*f,store.options.units,locked)}<div class="field">Mount elevation<div style="padding-top:12px;color:#557b82">${store.format(store.z(o))}</div></div></div><p class="hint">Moving or rotating a support carries its equipment with it. Hiding it hides its equipment.</p></section>`;
  }
  if (o?.support && store.object(o.support)) {
    const support = store.object(o.support);
    const local = rotate(o.x - support.x, o.y - support.y, -(support.yaw_deg || 0));
    html += `<section class="property-section"><h3>Position on support</h3><div class="field-grid">${field('support_x','Local X',local[0]*f,store.options.units,locked)}${field('support_y','Local Y',local[1]*f,store.options.units,locked)}</div><p class="hint">Offsets from the table centre. Local +Y points toward the back of the table.</p></section>`;
  }
  html+=`${labelProperties(o,field)}<section class="property-section"><h3>Resize settings</h3>${resizeControls(store)}</section><section class="property-section" data-standard-property><h3>Transform <span style="float:right;color:#a1b2b8;font-weight:400">${store.options.units}</span></h3><div class="field-grid">${field('x','Centre X',bb.x*f,store.options.units,locked)}${field('y','Centre Y',(store.scene.room.depth-bb.y)*f,store.options.units,locked)}${field('width','Width',bb.width*f,store.options.units,locked)}${field('depth','Depth',bb.depth*f,store.options.units,locked||o?.kind==='robot')}${field('rotation',o?'Rotation':'Rotate by',o?cleanAngle(-(o.yaw_deg||0)):0,'°',locked)}${o&&o.height?field('height','Height',o.height*f,store.options.units,locked):''}</div><p class="hint">Centre measured from the top-left of the plan.${o?.kind==='robot'?' Resizing a robot scales its complete model and reach uniformly.':''}</p>${one?`<label class="checkline"><input id="item-visible" type="checkbox" ${one.visible!==false?'checked':''}> Visible in both views</label><label class="checkline"><input id="item-locked" type="checkbox" ${one.locked?'checked':''}> Lock transforms</label>`:''}</section>`;
  if(o?.kind==='customer_barrier') html+=barrierProperties(o,store,field,locked);
  if(o?.kind==='zone') html+=zoneProperties(o,store,field,locked);
  if(o) html+=floorTeaProperties(o,store)+ventProperties(o);
  if(o?.kind==='shelf'){
    const l=store.shelfLayout(o),s=l.settings;
    html+=`<section class="property-section"><h3>Shelf &amp; bread</h3>
      <div class="shelf-stats">
        <div class="distance-row"><span>Clear column width</span><b data-stat="column-width">${store.format(l.clearColumnWidth)}</b></div>
        <div class="distance-row"><span>Clear vertical gap</span><b data-stat="shelf-gap">${s.tiers>1?store.format(l.clearVerticalGap):'—'}</b></div>
        <div class="distance-row"><span>Above dividers</span><b>${s.tiers>1?store.format(l.clearAboveDividers):'—'}</b></div>
        <div class="distance-row"><span>Maximum tiers</span><b data-stat="max-tiers">${l.maxTiers}</b></div>
      </div>
      <div class="field-grid">
        ${field('shelf_columns','Columns',s.columns,'',locked)}
        ${field('shelf_tiers','Racks / tiers',s.tiers,'',locked,`min="${l.maxTiers?1:0}" max="${l.maxTiers}"`)}
        ${field('shelf_tier_spacing','Tier spacing',s.tier_spacing*f,store.options.units,locked,`min="${l.minSpacing*f}"`)}
        ${field('shelf_back_to_front_drop','Back → front drop',s.back_to_front_drop*f,store.options.units,locked,'min="0"')}
        ${field('shelf_first_tier_front_height','Bottom tier → floor',s.first_tier_front_height*f,store.options.units,locked,'min="0"')}
        ${field('shelf_bread_height','Bread height',s.bread_height*f,store.options.units,locked)}
        ${field('shelf_bread_length_1','Length 1 · across',s.bread_length_1*f,store.options.units,locked)}
        ${field('shelf_bread_length_2','Length 2 · depth',s.bread_length_2*f,store.options.units,locked)}
      </div>
      <p class="hint">Tier spacing and floor clearance use the lowest front edge. Clear gap is tray surface to underside above, at the same horizontal position. Limits keep tiers and bread within the frame height and prevent vertical overlap.</p>
      <p class="hint">Bread sizes are full ellipsoid dimensions. Length 1 runs across the columns; length 2 runs along the tray.</p>
      <label class="checkline"><input id="shelf-show-bread" type="checkbox" ${s.show_buns?'checked':''} ${locked?'disabled':''}> Show bread</label>
      <p class="hint">${l.rows} piece${l.rows===1?'':'s'} per column · ${s.columns*l.rows} per tier.${l.tooWide?'<br><span style="color:#ae764c">Bread is wider than the clear column.</span>':''}${l.tooDeep?'<br><span style="color:#ae764c">Bread exceeds the tray depth.</span>':''}${!l.maxTiers?'<br>No tier fits this frame height with the current bread size.':''}</p>
      <button id="apply-shelf-settings" style="width:100%;margin-top:13px;font-size:10px" ${locked?'disabled':''}>Apply to all shelves</button></section>`;
  }
  if(['bag_opener','me6_bag_opener'].includes(o?.machine_type)){
    const bag=fixtureBag(o);
    html+=`<section class="property-section"><h3>Bag-opening fixture</h3><div class="distance-row"><span>Bag width × depth</span><b>${store.format(bag.width)} × ${store.format(bag.depth)}</b></div><div class="distance-row"><span>Bag height</span><b>${store.format(bag.height)}</b></div><div class="distance-row"><span>Mouth above floor</span><b>${store.format(store.z(o)+bag.floor+bag.height)}</b></div><label class="checkline"><input id="show-opening-bag" type="checkbox" ${o.bag_parameters?.show_bag!==false?'checked':''} ${locked?'disabled':''}> Show open bag</label><p class="hint">An 8 × 8 × 10 cm four-cup gripper is bolted to the backplate. The Nova-5 grips the opposite face and pulls back to open the bag; the tray supports its bottom. Fixture dimensions scale the bag and support, while the fixed suction tool retains its physical size.</p></section>`;
  }
  if(o?.layout_component==='magazine'){
    const p=stackSettings(o);
    html+=`<section class="property-section"><h3>Flat bag stack</h3><div class="field-grid">
      ${field('stack_bag_width','Flat bag width',p.bag_width*f,store.options.units,locked,'min="0.1"')}
      ${field('stack_bag_height','Flat bag length',p.bag_height*f,store.options.units,locked,'min="0.1"')}
      ${field('stack_bag_thickness','Thickness per folded bag',p.bag_thickness*f,store.options.units,locked,`min="${.0002*f}"`)}
      ${field('stack_bag_count','Bags in stack',p.bag_count,'',locked,`min="0" max="${p.capacity}"`)}
      </div><div class="distance-row"><span>Top above support</span><b>${store.format((o.z||0)+p.top)}</b></div><div class="distance-row"><span>Stack capacity at this thickness</span><b>${p.capacity}</b></div><p class="hint">Passive open-top holder with a front cutout. Bags lie flat, with their mouths toward local +Y. The robot picks the top face, lifts clear, then turns the empty bag upright. Bag length is its unfolded height. Count sets the current pickup height; each preview illustrates one pickup and does not consume saved inventory. Measure folded thickness rather than deriving it from GSM.</p></section>`;
  }
  if(o?.kind==='robot'){
    const reach=store.reach(o);
    html+=`<section class="property-section"><h3>Reach radii</h3><div class="reach-values"><div class="orange"><small>MAXIMUM EFFECTIVE</small><strong>${store.format(reach.effective)}</strong></div><div><small>REALISTIC PLACEMENT</small><strong>${store.format(reach.placement)}</strong></div></div><p class="hint">Effective = working radius + tool.<br>Placement = working radius × 70/85.</p></section><section class="property-section"><h3>Measure to</h3><div class="target-list">${store.scene.objects.filter(t=>['shelf','machine','charger','table','counter','dispenser'].includes(t.kind)&&t.id!==o.support).map(t=>`<label class="checkline"><input type="checkbox" data-target="${esc(t.id)}" ${o.distanceTargets?.includes(t.id)?'checked':''}> ${esc(t.label)}</label>`).join('')}</div><p class="hint">Horizontal distances to the centre of each machine’s front face; nearest edge for shelves. If none are chosen, the nearest three are shown.</p>${store.distances().filter(d=>d.robot===o.id).map(d=>`<div class="distance-row"><span>${esc(d.label)}${d.type==='edge'?' · gap':''}</span><b>${store.format(d.distance)}</b></div>`).join('')}</section>`;
  }
  $('properties').innerHTML=html;
}
$('properties').addEventListener('keydown',e=>{
  if(e.target.id==='item-name'&&e.key==='Enter'){e.preventDefault();e.target.blur();}
});
$('properties').addEventListener('change',e=>{
  const element=e.target,ids=[...store.selected],one=ids.length===1?store.item(ids[0]):null,o=one&&store.object(one.id),f=store.options.units==='px'?200:100,key=element.dataset.field;
  if (changeResizeControl(e,store) || changeBarrier(e,o,store) || changeZone(e,o,store) || changeLabelAppearance(e,o,store)) return;
  if(element.id==='show-opening-bag'&&o?.layout_component==='fixed_suction'&&!store.locked(o.id)){
    store.transact('Changed open bag visibility',()=>{o.bag_parameters={...o.bag_parameters,show_bag:element.checked};});return;
  }
  if(key?.startsWith('stack_')&&o?.layout_component==='magazine'){
    if(store.locked(o.id))return;
    const value=Number(element.value);if(!Number.isFinite(value)){properties();return;}
    const setting=key.slice(6);
    store.transact('Changed bag stack',()=>{
      o.bag_stack={...stackSettings(o),[setting]:setting==='bag_count'?Math.round(value):value/f};
      const p=stackSettings(o);o.bag_stack={bag_width:p.bag_width,bag_height:p.bag_height,bag_thickness:p.bag_thickness,bag_count:p.bag_count};
    });return;
  }
  if (o?.support && ['support_x','support_y'].includes(key)) {
    const support = store.object(o.support);
    const value = Number(element.value) / f;
    if (!support || !Number.isFinite(value)) return;
    const local = rotate(o.x - support.x, o.y - support.y, -(support.yaw_deg || 0));
    local[key === 'support_x' ? 0 : 1] = value;
    const offset = rotate(local[0], local[1], support.yaw_deg || 0);
    store.transact('Moved equipment on support', () => store.patch(o.id, {
      x: support.x + offset[0], y: support.y + offset[1],
    }));
    return;
  }
  if(key?.startsWith('shelf_')&&o?.kind==='shelf'){
    if(store.locked(o.id))return;const n=Number(element.value);if(!Number.isFinite(n)){properties();return;}
    const setting=key.slice(6),value=['columns','tiers'].includes(setting)?Math.round(n):n/f;
    store.transact('Changed shelf and bread settings',()=>{o.shelf_overrides={...o.shelf_overrides,[setting]:value};o.shelf_overrides=store.shelfSettings(o);});return;
  }
  if(element.id==='shelf-show-bread'&&o?.kind==='shelf'&&!store.locked(o.id)){store.transact('Changed bread visibility',()=>{o.shelf_overrides={...o.shelf_overrides,show_buns:element.checked};o.shelf_overrides=store.shelfSettings(o);});return;}
  if(key){const number=Number(element.value);if(!Number.isFinite(number)){properties();return;}const value=number/f;store.transact('Updated '+key,()=>{
    if(key.startsWith('room_')){store.scene.room[key.slice(5)]=Math.max(.5,value);return;}
    if(key==='rotation'){if(o)store.patch(o.id,{yaw_deg:-number});else store.rotateSelection(ids,-number);return;}
    if(key==='width'||key==='depth'){resizeDimension(store,ids,key,value);return;}
    if(o) store.patch(o.id,{[key]:key==='y'?store.scene.room.depth-value:key==='height'?Math.max(.01,value):value});
    else {const bb=store.selectionBounds();if(key==='x'||key==='y')store.move(ids,key==='x'?value-bb.x:0,key==='y'?store.scene.room.depth-value-bb.y:0);}
  });return;}
  if(element.id==='item-name'&&one)store.transact('Changed label',()=>{
    one.label=element.value.trim()||one.label;
    if(['machine','shelf','dispenser','vent'].includes(o?.kind))o.display_label=one.label;
  });
  if(element.id==='item-visible'&&one)store.toggleVisibility(one.id);
  if(element.id==='item-locked'&&one)store.toggleLock(one.id);
  if(element.id==='support'&&o)store.transact('Changed support',()=>{o.support=element.value||null;o.z=0;});
  if(element.dataset.target&&o)store.transact('Changed distance targets',()=>{const ids=new Set(o.distanceTargets||[]);element.checked?ids.add(element.dataset.target):ids.delete(element.dataset.target);o.distanceTargets=[...ids];});
});
$('properties').addEventListener('click',e=>{
  if(e.target.id==='align-barrier-opening') {
    const barrier=store.object(store.selected[0]);
    if(barrier?.kind==='customer_barrier'&&!store.locked(barrier.id)) toast(alignBarrierOpening(barrier,store)?'Opening aligned as closely as the panel allows; placement zone unchanged':'Choose a placement zone in Flow first');
    return;
  }
  if(e.target.id!=='apply-shelf-settings')return;
  const o=store.object(store.selected[0]);if(o?.kind!=='shelf'||store.locked(o.id))return;
  const s=store.shelfSettings(o),values=Object.fromEntries(['columns','tiers','tier_spacing','back_to_front_drop','first_tier_front_height','bread_length_1','bread_length_2','bread_height','show_buns'].map(k=>[k,s[k]]));
  store.transact('Applied settings to all shelves',()=>{for(const shelf of store.scene.objects)if(shelf.kind==='shelf'&&!store.locked(shelf.id)){shelf.shelf_overrides={...shelf.shelf_overrides,...values};shelf.shelf_overrides=store.shelfSettings(shelf);}});
  toast('Shelf and bread settings applied to all unlocked shelves');
});
const componentLibrary = new ComponentLibrary(store,plan,toast);
function library(){componentLibrary.render();}
document.querySelectorAll('[data-panel]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-panel]').forEach(tab => tab.classList.toggle('active', tab === button));
  $('layers-panel').hidden = button.dataset.panel !== 'layers';
  $('library-panel').hidden = button.dataset.panel !== 'library';
  $('workflow-panels').hidden = button.dataset.panel !== 'flow';
  syncActiveFlows();
});
function syncActiveFlows(){
  const active=document.querySelector('[data-panel="flow"]').classList.contains('active');
  if(studioMode()==='standard'){
    flow.setActive(false);coffee.setActive(false);standard?.setActive(active);
    flow.suspended=coffee.suspended=true;
  }else{
    if(standard){standard.active=false;clearTimeout(standard.timer);}
    order.setActive(active&&activeWorkflow==='order');
    flow.suspended=coffee.suspended=active&&activeWorkflow==='order';
    flow.setActive(active&&activeWorkflow==='bag');coffee.setActive(active&&activeWorkflow==='coffee');
  }
}
function applyOptions(){
  $('plan-names').value=store.options.planNames||'always';
  plan.svg.dataset.planNames=store.options.planNames||'always';
  for(const [id,key] of [['show-distances','showAllDistances'],['show-reach','showAllReach'],['snap','snap'],['labels','showLabels']])$(id).checked=store.options[key];
  $('units').value=store.options.units;$('distance-mode').value=store.options.distanceMode;$('viewports').dataset.view=store.options.view;document.querySelectorAll('[data-view]').forEach(b=>{if(b.tagName==='BUTTON')b.classList.toggle('active',b.dataset.view===store.options.view);});
}
for(const [id,key] of [['show-distances','showAllDistances'],['show-reach','showAllReach'],['snap','snap'],['labels','showLabels']])$(id).onchange=e=>store.setOption(key,e.target.checked);
$('plan-names').onchange=e=>store.setOption('planNames',e.target.value);
$('units').onchange=e=>store.setOption('units',e.target.value);$('distance-mode').onchange=e=>store.setOption('distanceMode',e.target.value);
document.querySelectorAll('button[data-view]').forEach(b=>b.onclick=()=>{store.setOption('view',b.dataset.view);requestAnimationFrame(()=>three.overview());});
$('undo').onclick=()=>store.undo();$('redo').onclick=()=>store.redo();$('duplicate').onclick=()=>store.duplicate();$('delete').onclick=()=>store.removeSelected();
$('plan-fit').onclick=()=>plan.fit();$('fit-view').onclick=()=>{plan.fit();three.overview();};$('zoom-in').onclick=()=>plan.zoom(.8);$('zoom-out').onclick=()=>plan.zoom(1.25);
$('scene-top').onclick=()=>three.top();$('scene-home').onclick=()=>three.overview();$('scene-focus').onclick=()=>three.focus();
for(const mode of ['orbit','move'])$(mode+'-mode').onclick=()=>{three.mode=mode;$('orbit-mode').classList.toggle('active',mode==='orbit');$('move-mode').classList.toggle('active',mode==='move');$('scene-hint').textContent=mode==='orbit'?'Drag to orbit · right-drag to pan · scroll to zoom':'Drag an object to move it · both views update live';};
$('reset-scene').onclick=()=>{store.reset();plan.fit();three.overview();toast('Source layout restored. Undo is available.');};
window.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
  const modifier=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
  if(modifier&&key==='z'){e.preventDefault();e.shiftKey?store.redo():store.undo();}
  else if(modifier&&key==='y'){e.preventDefault();store.redo();}
  else if(modifier&&key==='d'){e.preventDefault();store.duplicate();}
  else if(modifier&&key==='a'){e.preventDefault();store.selectAll();}
  else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();store.removeSelected();}
  else if(e.key==='Escape'){store.cancel();plan.drag=null;plan.placementDrawer=null;plan.svg.style.cursor='';plan.render();three.drag=null;three.controls.enabled=true;store.select(null);}
  else if(e.key.startsWith('Arrow')){const step=e.shiftKey?.1:.01,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0;e.preventDefault();store.transact('Nudged selection',()=>store.move(store.selected,dx,dy));}
});
async function exportFile(type){
  const exportName=studioMode()==='standard'?({json:'Project',png:'Image'}[type]||type.toUpperCase()):type.toUpperCase();
  try{$('export-menu').open=false;toast('Preparing '+exportName+'…');
    if(type==='handoff'){handoff.open();return;}
    if(type==='svg')download(await plan.exportSVG($('include-library').checked),'coffee-bar-edited.svg','image/svg+xml');
    if(type==='json')download(JSON.stringify(store.exportScene(),null,2),'coffee-bar-edited.json','application/json');
    if(type==='glb'){if(!three.ready)throw new Error('Please wait for the robot models to load.');download(await three.glb(),'coffee-bar-edited.glb','model/gltf-binary');}
    if(type==='png'){if(!three.ready)throw new Error('Please wait for the models to load.');const a=document.createElement('a');a.href=three.png();a.download='coffee-bar-edited.png';a.click();}
    toast(exportName+' exported');
  }catch(e){toast('Export failed: '+e.message);console.error(e);}
}
document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportFile(b.dataset.export));
$('import-button').onclick=()=>$('import-file').click();
async function importText(text,name='scene.json'){
  let value;if(name.toLowerCase().endsWith('.svg')){const doc=new DOMParser().parseFromString(text,'image/svg+xml');if(doc.querySelector('parsererror'))throw new Error('The SVG is not valid XML.');const meta=doc.querySelector('metadata#coffee-scene-data');if(!meta)throw new Error('Import an SVG exported by Layout studio, or its scene JSON.');value=JSON.parse(meta.textContent);}else value=JSON.parse(text);
  for(const o of value.objects||[])if(o.kind==='robot'?!store.seed.robot_inventory[o.model_key||o.id]:!seed.objects.some(t=>t.id===(o.asset_key||o.id))&&o.asset_key!=='nova5_cart'&&o.asset_key!==FLOOR_TEA_KEY&&!['placement_zone','customer_barrier','vent'].includes(o.kind))throw new Error('No matching 3D model for '+(o.label||o.id));
  store.importScene(value);plan.fit();library();toast(studioMode()==='standard'?'Project opened':'Editable scene imported');
}
$('import-file').onchange=async e=>{try{const file=e.target.files[0];if(file)await importText(await file.text(),file.name);}catch(error){toast('Import failed: '+error.message);}finally{e.target.value='';}};
store.on(type=>{
  applyOptions();if(type!=='preview'){renderLayers();properties();}
  $('undo').disabled=!store.undoStack.length;$('redo').disabled=!store.redoStack.length;$('delete').disabled=!store.selected.length;$('duplicate').disabled=!store.selected.length;
  const count=store.resolve().length;$('selection-status').dataset.projectLabel=String(count===1);$('selection-status').textContent=count===1?store.resolve()[0].label:count?count+' items selected':(studioMode()==='standard'?'Select an object to edit it':'Select a robot for reach and distances');
  if(!['preview','selection','workflow'].includes(type)){clearTimeout(saveTimer);$('save-status').textContent='Saving locally…';saveTimer=setTimeout(()=>{try{const state=store.exportScene();state.editor_selection=store.selected;localStorage.setItem(STORAGE,JSON.stringify(state));$('save-status').textContent='Saved locally · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch(e){$('save-status').textContent='Use Export to save';toast('Local storage unavailable. Export JSON to save your changes.');}},250);}
});
renderLayers();properties();library();applyOptions();store.emit('selection');$('save-status').textContent=restored?'Restored your local edits':'Source layout · edits save locally';
installComponentClipboard(store, {
  copyButton: $('copy'),
  pasteButton: $('paste'),
  toast,
});
let activeWorkflow='bag';
const flow = new BagWorkflow(store,plan,three,$('flow-panel'),toast);
const coffee = new CoffeeWorkflow(store,plan,three,$('coffee-flow-panel'),toast);
const order = new OrderWorkflow(store,three,flow,coffee,$('order-flow-panel'),toast);
document.querySelectorAll('[data-workflow]').forEach(button=>button.onclick=()=>{
  activeWorkflow=button.dataset.workflow;
  document.querySelectorAll('[data-workflow]').forEach(b=>b.classList.toggle('active',b===button));
  $('flow-panel').hidden=activeWorkflow!=='bag';
  $('coffee-flow-panel').hidden=activeWorkflow!=='coffee';
  $('order-flow-panel').hidden=activeWorkflow!=='order';
  order.setActive(activeWorkflow==='order');
  flow.player.stop();coffee.player.stop();
  syncActiveFlows();
});
const collisions=new CollisionControls(store,three,toast,()=>order.active?{...flow.settings(),...order.breadSettings()}:flow.settings());
const snapshots=new SceneSnapshots(store,three,{toast,getWorkflow:()=>activeWorkflow,setWorkflow:value=>document.querySelector('[data-workflow="'+value+'"]').click()});
$('snapshots-button').onclick=()=>snapshots.open();
const handoff=new HandoffExport(store,three,download,[flow.player,coffee.player]);
standard=new StandardPreview({store,view:three,order,panel:$('standard-flow-panel'),toast,exportFile,getMode:studioMode,setMode:value=>modeUI.setMode(value)});
modeUI=installStudioMode({store,plan,view:three,order,bag:flow,coffee,collisions,properties,onChange:syncActiveFlows});
$('export-video').onclick=()=>{$('export-menu').open=false;document.querySelector('[data-panel="flow"]').click();$('standard-flow-panel').querySelector('.standard-camera').scrollIntoView({block:'nearest'});};
window.coffeeEditor={modeUI,standard,languageUI,handoff,collisions,snapshots,order,coffee,flow,store,plan,three,importText,exportFile,getState:()=>store.exportScene(),ready:false};
try{await three.load();window.coffeeEditor.ready=true;collisions.checkPoses();if(studioMode()==='advanced')flow.start();standard.loaded();if(new URLSearchParams(location.search).has('workflow')){document.querySelector('[data-panel="flow"]').click();if(studioMode()==='standard'){three.overview();}else if(new URLSearchParams(location.search).get('workflow')==='order'){document.querySelector('[data-workflow="order"]').click();if(store.scene.order_camera)order.restoreCamera();else order.frame();}else if(new URLSearchParams(location.search).get('workflow')==='coffee'){document.querySelector('[data-workflow="coffee"]').click();coffee.frame();}else flow.frame();}if(restored)toast('Your saved layout has been restored');}catch(e){$('model-status').textContent='Model loading failed';toast(e.message);console.error(e);}
