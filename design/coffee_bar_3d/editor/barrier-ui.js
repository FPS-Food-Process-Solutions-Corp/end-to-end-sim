import {barrierSettings, barrierWarnings, BARRIER_KIND} from './barrier-parameters.js';
import {rotate} from './store.js';

export function barrierProperties(object, store, field, locked) {
  const p = barrierSettings(object);
  const factor = store.options.units === 'px' ? 200 : 100;
  const disabled = locked ? 'disabled' : '';
  const check = (key, text) => `<label class="checkline"><input data-barrier="${key}" type="checkbox" ${p[key] ? 'checked' : ''} ${disabled}> ${text}</label>`;
  const side = key => `<label class="field">Panel<select data-barrier="${key}_side" aria-label="${key} panel" ${disabled}><option value="front" ${p[key + '_side'] === 'front' ? 'selected' : ''}>Front</option><option value="right" ${p[key + '_side'] === 'right' ? 'selected' : ''} ${p.right_return ? '' : 'disabled'}>Right side</option></select></label>`;
  const dimension = (key, title) => field('barrier_' + key, title, p[key] * factor, store.options.units, locked);
  const section = (key, title) => `<section class="property-section"><h3>${title}</h3><div class="field-grid">
    ${side(key)}${dimension(key + '_center', 'Offset along panel')}
    ${dimension(key + '_bottom', 'Bottom above wall base')}
    ${key === 'intercom' ? dimension('intercom_diameter', 'Diameter') :
      dimension(key + '_width', key === 'pickup' ? 'Clear opening width' : 'Section width') +
      dimension(key + '_height', key === 'pickup' ? 'Clear opening height' : 'Section height')}
    </div>${key === 'pickup' ? '<button id="align-barrier-opening" style="width:100%;margin-top:12px" ' + disabled + '>Align with placement zone</button>' : ''}
    </section>`;
  const warnings = barrierWarnings(object);
  return `<section class="property-section"><h3>Customer barrier</h3>
    <div class="distance-row"><span>Top above floor</span><b>${store.format(store.z(object) + object.height)}</b></div>
    ${check('right_return', 'Include right side panel')}
    <div class="field-grid">
      ${dimension('thickness', 'Plastic thickness')}${dimension('frame', 'Frame width')}
      ${field('barrier_opacity', 'Plastic opacity', p.opacity * 100, '%', locked, 'min="5" max="75"')}
    </div>
    <p class="hint">Width sets the front span; depth sets the right return. Height starts at the mounting surface. Offset 0 is the panel centre; positive runs right on the front, toward the back on the right side. Openings and devices stay inside their panel when resized.</p>
    </section>
    ${section('pickup', 'Pickup opening')}
    ${section('tablet', 'Embedded ordering tablet')}
    ${section('intercom', 'Combined mic / speaker')}
    <section class="property-section">${check('show_instructions', 'Show instructions / flyer')}</section>
    ${p.show_instructions ? section('instructions', 'Instructions panel') : ''}
    ${warnings.length ? '<section class="property-section"><p class="hint" style="color:#ae764c">' + warnings.join('<br>') + '</p></section>' : ''}`;
}

export function changeBarrier(event, object, store) {
  if (object?.kind !== BARRIER_KIND) return false;
  const element = event.target;
  const key = element.dataset.barrier || element.dataset.field?.replace(/^barrier_/, '');
  if (!element.dataset.barrier && !element.dataset.field?.startsWith('barrier_')) return false;
  if (store.locked(object.id)) return true;
  const factor = store.options.units === 'px' ? 200 : 100;
  const value = element.type === 'checkbox' ? element.checked :
    element.tagName === 'SELECT' ? element.value :
    Number(element.value) / (key === 'opacity' ? 100 : factor);
  if (typeof value === 'number' && !Number.isFinite(value)) return true;
  store.transact('Changed customer barrier', () => {
    object.barrier = barrierSettings({...object, barrier: {...barrierSettings(object), [key]: value}});
  });
  return true;
}

export function alignBarrierOpening(object, store) {
  const zone = store.object(store.scene.bag_workflow?.placement_zone_id);
  if (!zone) return false;
  const local = rotate(zone.x - object.x, zone.y - object.y, -(object.yaw_deg || 0));
  store.transact('Aligned pickup opening with placement zone', () => {
    const p = barrierSettings(object);
    p.pickup_center = local[p.pickup_side === 'right' ? 1 : 0];
    object.barrier = barrierSettings({...object, barrier: p});
  });
  return true;
}
