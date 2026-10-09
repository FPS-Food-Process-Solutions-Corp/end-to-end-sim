import {objectLabelSettings} from './label-layout.js';

const kinds = ['machine','shelf','dispenser','vent'];
export function labelProperties(object, field) {
  if (!kinds.includes(object?.kind)) return '';
  const {percent, rotation} = objectLabelSettings(object);
  return '<section class="property-section"><h3>Label appearance</h3>' +
    field('label_scale','3D label size',percent,'%',false,'min="10" max="400"') +
    '<label class="field room-field">Label rotation<select id="label-rotation" aria-label="Label rotation">' +
    [0,90,180,270].map(angle=>'<option value="'+angle+'" '+(angle===rotation?'selected':'')+'>'+angle+'°'+(angle===0?' · default direction':'')+'</option>').join('') +
    '</select></label><p class="hint">Size changes only 3D lettering; 2D labels keep a readable size. Rotation turns text in both views, clockwise from its default direction. Long names wrap.</p></section>';
}

export function changeLabelAppearance(event, object, store) {
  if (!kinds.includes(object?.kind)) return false;
  const input = event.target;
  const scale = input.dataset.field === 'label_scale';
  if (!scale && input.id !== 'label-rotation') return false;
  const value = Number(input.value);
  if (!Number.isFinite(value) || (scale ? value<10 || value>400 : ![0,90,180,270].includes(value))) {
    store.emit('selection'); return true;
  }
  store.transact('Changed label appearance',()=>{
    object[scale?'label_size_percent':'label_rotation_deg'] = value;
  });
  return true;
}
