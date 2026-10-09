import {defaults, dimensions, fitAssessment, validateScene} from './catalog.js';
import {ObjectScene} from './scene.js';
import {DropController} from './drop-controller.js';
import {DropUI} from './drop-ui.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const STORAGE = 'object-size-lab-v1';
let state = defaults(), history = [], future = [], view, drop, dropUI, toastTimer, storageWarning = false;
try {const saved = localStorage.getItem(STORAGE); if (saved) state = validateScene(JSON.parse(saved));} catch {storageWarning = true;}
const object = id => state.objects.find(o => o.id === id);
const selected = () => object(state.selected);
const factor = () => state.unit === 'mm' ? 10 : 1;
const number = v => Number((v * factor()).toFixed(2));
const fmt = v => number(v).toLocaleString('en', {maximumFractionDigits: 2}) + ' ' + state.unit;
function toast(text) {clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500);}
function save() {
  try {localStorage.setItem(STORAGE, JSON.stringify(state)); $('save-state').textContent = 'Saved on this device';}
  catch {$('save-state').textContent = 'Not saved · export JSON to keep changes';}
}
function commit(change) {
  const before = structuredClone(state); change();
  try {state = validateScene(state);} catch(e) {state = before; toast(e.message); render(); return;}
  history.push(before); if (history.length > 50) history.shift(); future = []; render(); save();
}
function choose(id) {
  state.selected = id;
  if (state.mode !== 'compare') {
    const o = object(id);
    if (o?.kind === 'bag') state.bag = id;
    else if (o?.kind === 'donut') state.donut = id;
    else state.mode = 'compare';
    render(); view.resize(); view.frame('iso');
  } else render();
  save();
}
function sizeText(o) {return o.kind === 'donut' ? `Ø ${fmt(o.diameter)} · ${fmt(o.height)} thick` : `${number(o.width)} × ${number(o.depth)} × ${number(o.height)} ${state.unit}`;}

function renderList() {
  const groups = [['bag', 'Paper bags'], ['donut', 'Donuts'], ['box', 'References']];
  $('object-list').innerHTML = groups.map(([kind, label]) => {
    const items = state.objects.filter(o => o.kind === kind); if (!items.length) return '';
    return `<div class="list-section">${label}</div>` + items.map(o => `<div class="object-row ${o.id === state.selected ? 'selected' : ''} ${o.visible ? '' : 'invisible'}"><button data-select="${esc(o.id)}" aria-pressed="${o.id === state.selected}" aria-label="Select ${esc(o.name)}"><span class="shape-icon ${o.kind}" aria-hidden="true"></span><span class="object-text"><strong>${esc(o.name)}</strong><small>${sizeText(o)}</small></span></button><input type="checkbox" data-visible="${esc(o.id)}" aria-label="Show ${esc(o.name)}" ${o.visible ? 'checked' : ''} ${state.mode !== 'compare' ? 'disabled' : ''}></div>`).join('');
  }).join('');
  $('object-count').textContent = `${state.objects.length} objects`;
}
function numericField(o, key, label, min, max, unit = state.unit) {
  const f = unit === '°' ? 1 : factor();
  return `<label class="field">${label}<span class="input-unit"><input aria-label="${label}" data-property="${key}" data-factor="${f}" type="number" min="${min*f}" max="${max*f}" step="${unit === '°' ? 1 : .1*f}" value="${Number((o[key]*f).toFixed(3))}" required><span>${unit}</span></span></label>`;
}
function renderProperties() {
  const o = selected();
  if (!o) {$('properties').innerHTML = '<p class="panel-description">Select an object to inspect its size, or add one to begin.</p>'; return;}
  const d = dimensions(o);
  let fields = o.kind === 'donut' ? numericField(o, 'diameter', 'Outer diameter', .1, 200) : numericField(o, 'width', 'Length / X', .1, 200) + numericField(o, 'depth', 'Depth / Z', .1, 200);
  fields += numericField(o, 'height', o.kind === 'donut' ? 'Donut thickness' : 'Height / Y', .1, 200);
  $('properties').innerHTML = `<div class="selected-kind">${o.kind === 'bag' ? 'Open paper bag' : o.kind === 'donut' ? 'Donut' : 'Box reference'}</div><label><span class="property-heading">Name</span><input class="name-field" aria-label="Object name" data-property="name" value="${esc(o.name)}" maxlength="80" required></label><div class="property-heading">Physical size</div>${fields}${o.kind === 'donut' ? `<label class="field">Orientation<select aria-label="Object orientation" data-property="upright"><option value="false" ${!o.upright ? 'selected' : ''}>Flat</option><option value="true" ${o.upright ? 'selected' : ''}>Upright</option></select></label>` : ''}<div class="size-summary">Footprint: ${fmt(d.width)} × ${fmt(d.depth)}<br>Standing height: ${fmt(d.height)}</div><div class="property-heading">Comparison position</div>${numericField(o, 'x', 'Left / right', -500, 500)}${numericField(o, 'z', 'Front / back', -500, 500)}${numericField(o, 'yaw', 'Rotation', -360, 360, '°')}<div class="actions"><button id="duplicate">Duplicate</button><button id="remove" class="danger">Remove</button></div>`;
  if (state.mode !== 'compare') {
    for (const key of ['x', 'z', 'yaw']) $('properties').querySelector(`[data-property="${key}"]`).disabled = true;
    const note = document.createElement('p'); note.className = 'panel-description'; note.textContent = state.mode === 'drop' ? 'Use the drop controls to set release height, position and tilt.' : 'The fit view centres the donut inside the bag. Position controls apply in Compare sizes.';
    if(state.mode==='drop'&&o.kind==='donut') $('properties').querySelector('[data-property="upright"]').disabled=true;
    $('properties').querySelector('.actions').before(note);
  }
}
function renderFit() {
  $('fit-controls').hidden = state.mode === 'compare'; $('fit-status').hidden = state.mode !== 'fit';
  $('fit-orientation-label').hidden=state.mode==='drop';$('allowance-label').hidden=state.mode==='drop';
  for (const [key, kind] of [['bag', 'bag'], ['donut', 'donut']]) {
    $('fit-'+key).innerHTML = state.objects.filter(o => o.kind === kind).map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    $('fit-'+key).value = state[key] || '';
  }
  const bag = object(state.bag), donut = object(state.donut);
  $('fit-orientation').disabled = !donut; $('fit-orientation').value = donut?.upright ? 'upright' : 'flat';
  $('allowance').value = number(state.allowance); $('allowance').max = 5*factor(); $('allowance').step = .1*factor(); $('allowance-unit').textContent = state.unit;
  const fit = fitAssessment(bag, donut, state.allowance);
  $('fit-status').classList.toggle('not-fit', !!fit && !fit.fits);
  if (!fit) {$('fit-status').textContent = 'Add a bag and a donut to compare their sizes.'; return;}
  const text = fit.fits ? 'Fits this orientation' : 'Too large in this orientation';
  const remaining = Object.entries(fit.remaining).map(([key, v]) => `${key === 'width' ? 'Length' : key[0].toUpperCase()+key.slice(1)} ${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`).join(' · ');
  $('fit-status').innerHTML = `<strong>${text}</strong>${remaining}<small>Remaining space after ${fmt(state.allowance)} per wall.<br>Nominal rigid sizes; no squeezing or folding.</small>`;
}
function render() {
  renderList(); renderProperties(); renderFit();
  renderDropControls();
  dropUI?.render(state);
  $('undo').disabled = !history.length; $('redo').disabled = !future.length;
  $('units').value = state.unit; $('xray').checked = state.xray || state.mode !== 'compare'; $('xray').disabled = state.mode !== 'compare'; $('dimensions').checked = state.dimensions;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === state.mode));
  $('view-caption').textContent = state.mode === 'drop' ? 'RIGID DROP · FIXED OPEN BAG' : state.mode === 'fit' ? 'DONUT + BAG · NOMINAL FIT' : 'ONE SCALE · OPEN BAGS';
  $('grid-caption').textContent = `Grid: ${fmt(10)} · minor ${fmt(1)}`;
  $('move').disabled = state.mode !== 'compare'; $('fit-view').textContent = state.mode === 'drop' ? 'Fit test' : state.mode === 'fit' ? 'Fit pair' : 'Fit all';
  if (view) {view.update(state); if (state.mode !== 'compare') view.moveMode = false; drop?.sync(state);}
  updateMove();
}
function renderDropControls() {
  $('drop-controls').hidden=state.mode!=='drop';$('drop-status').hidden=state.mode!=='drop';
  document.querySelectorAll('[data-drop]').forEach(input=>{
    const key=input.dataset.drop,f=input.dataset.length?factor():1;
    input.value=key==='cadence'?state.drop[key]:Number((state.drop[key]*f).toFixed(3));
    if(input.dataset.length){input.min=(key==='height'?.1:-100)*f;input.max=100*f;input.step=.1*f;}
  });
  document.querySelectorAll('.drop-length-unit').forEach(el=>el.textContent=state.unit);
}
function dropStatus(report) {
  dropUI?.status(report);
}
function updateMove() {
  $('move').setAttribute('aria-pressed', !!view?.moveMode);
  $('interaction-hint').textContent = view?.moveMode ? 'Drag an object across the ground plane · positions snap to 1 mm' : 'Drag to orbit · right-drag to pan · scroll to zoom · click to select';
}
function importScene(value) {const parsed = validateScene(value); commit(() => {state = parsed;}); view.frame('iso');}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function add(kind, name) {
  commit(() => {
    const id = 'object-' + crypto.randomUUID();
    const o = {id, kind, name, x: 0, z: 33, yaw: 0, visible: true, height: kind === 'donut' ? 3.3 : 10};
    if (kind === 'donut') {o.diameter = 10; o.upright = false;} else {o.width = 10; o.depth = 10;}
    state.objects.push(o); state.selected = id; state.mode = 'compare';
  });
  view.frame('iso');
}

$('object-list').addEventListener('click', e => {const b = e.target.closest('[data-select]'); if (b) choose(b.dataset.select);});
$('object-list').addEventListener('change', e => {const id = e.target.dataset.visible; if (id) commit(() => {object(id).visible = e.target.checked;});});
$('properties').addEventListener('change', e => {
  const key = e.target.dataset.property, o = selected(); if (!key || !o) return;
  if (!e.target.checkValidity()) {e.target.reportValidity(); return;}
  const value = key === 'name' ? e.target.value.trim() : key === 'upright' ? e.target.value === 'true' : Number(e.target.value)/Number(e.target.dataset.factor || 1);
  commit(() => {o[key] = value;});
});
$('properties').addEventListener('click', e => {
  const o = selected(); if (!o) return;
  if (e.target.id === 'duplicate') {
    commit(() => {const copy = {...structuredClone(o), id: 'object-'+crypto.randomUUID(), name: (o.name+' copy').slice(0,80), x: Math.min(500,o.x+dimensions(o).width+3), visible: true}; state.objects.push(copy); state.selected = copy.id;}); view.frame('iso');
  }
  if (e.target.id === 'remove') commit(() => {state.objects = state.objects.filter(item => item.id !== o.id);});
});
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {state.mode = b.dataset.mode; render(); save(); view.resize(); view.frame('iso');});
for (const key of ['xray', 'dimensions']) $(key).onchange = e => {state[key] = e.target.checked; render(); save();};
$('units').onchange = e => {state.unit = e.target.value; render(); save();};
for (const key of ['bag', 'donut']) $('fit-'+key).onchange = e => {state[key] = e.target.value; state.selected = state[key]; render(); save(); view.frame('iso');};
$('fit-orientation').onchange = e => {const o = object(state.donut); if (o) commit(() => {o.upright = e.target.value === 'upright';});};
$('allowance').onchange = e => {if (e.target.checkValidity()) commit(() => {state.allowance = Number(e.target.value)/factor();}); else e.target.reportValidity();};
document.querySelectorAll('[data-camera]').forEach(b => b.onclick = () => {view.frame(b.dataset.camera); document.querySelectorAll('[data-camera]').forEach(button => button.setAttribute('aria-pressed', button === b));});
$('fit-view').onclick = () => view.frame(); $('focus').onclick = () => view.frame(view.cameraMode, state.mode === 'compare');
$('move').onclick = () => {view.moveMode = !view.moveMode; updateMove();};
$('fullscreen').onclick = async () => {try {if (document.fullscreenElement) await document.exitFullscreen(); else await $('stage-panel').requestFullscreen();} catch {toast('Fullscreen is not available in this browser.');}};
document.addEventListener('fullscreenchange', () => {$('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'; view.resize();});
function undo() {if (!history.length) return; future.push(structuredClone(state)); state = history.pop(); render(); save();}
function redo() {if (!future.length) return; history.push(structuredClone(state)); state = future.pop(); render(); save();}
$('undo').onclick = undo; $('redo').onclick = redo;
$('reset').onclick = () => {commit(() => {state = defaults();}); view.frame('iso'); toast('Default sizes restored. Undo is available.');};
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || $('add-dialog').open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {e.preventDefault(); e.shiftKey ? redo() : undo();}
  if (e.key === 'Delete' && selected()) {e.preventDefault(); commit(() => {state.objects = state.objects.filter(o => o.id !== state.selected);});}
});
$('add-object').onclick = () => $('add-dialog').showModal(); $('close-add').onclick = () => $('add-dialog').close();
$('new-kind').onchange = e => {$('new-name').value = {box:'Reference box', bag:'Custom bag', donut:'Custom donut'}[e.target.value];};
$('add-form').onsubmit = e => {e.preventDefault(); if (!$('new-name').value.trim()) return; add($('new-kind').value, $('new-name').value.trim()); $('add-dialog').close();};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  try {const file = e.target.files[0]; if (!file) return; if (file.size > 1e6) throw Error('Please choose a JSON file smaller than 1 MB.'); importScene(JSON.parse(await file.text())); toast('Workspace imported.');}
  catch (error) {toast('Import failed: '+error.message);} finally {e.target.value = '';}
};
document.querySelectorAll('[data-export]').forEach(b => b.onclick = async () => {
  $('export-menu').open = false;
  try {
    const kind = b.dataset.export;
    if (kind === 'json') download(new Blob([JSON.stringify(state,null,2)], {type:'application/json'}), 'object-size-workspace.json');
    if (kind === 'png') download(await view.exportPNG(), 'object-size-comparison.png');
    if (kind === 'glb') download(new Blob([await view.exportGLB()], {type:'model/gltf-binary'}), 'object-size-comparison.glb');
    toast('Export saved.');
  } catch(error) {toast('Export failed: '+error.message);}
});
document.querySelectorAll('[data-drop]').forEach(input=>input.onchange=e=>{
  if(!e.target.checkValidity()){e.target.reportValidity();return;}
  const key=input.dataset.drop,value=key==='cadence'?input.value:Number(input.value)/(input.dataset.length?factor():1);
  commit(()=>{state.drop[key]=value;});
  if(key!=='speed')view.frame('iso');
});
$('drop-play').onclick=()=>drop.play();
$('drop-next').onclick=()=>drop.next();
$('drop-reset').onclick=()=>{drop.reset();view.frame('iso');};

try {
  view = new ObjectScene($('canvas'), $('labels'), choose, (id, x, z) => commit(() => {Object.assign(object(id), {x, z}); state.selected = id;}));
  drop = new DropController(view,dropStatus);
  dropUI = new DropUI({state:()=>state,commit,frame:()=>view.frame('iso')});
  render(); view.frame('iso');
  window.objectSizeLab = {ready: true, getState: () => structuredClone(state), view, drop, importScene, fit: () => fitAssessment(object(state.bag), object(state.donut), state.allowance)};
  $('save-state').textContent = storageWarning ? 'Default sizes loaded · previous save unreadable' : 'Your own size workspace';
  if(!storageWarning)save();
} catch (error) {$('error').hidden = false; $('error').textContent = 'Could not start the 3D view: '+error.message; console.error(error);}
