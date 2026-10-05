import {zoneSettings} from './zone-parameters.js';
const escape = value => String(value).replace(/[&<>"']/g,
  character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function zoneProperties(object, store, field, locked) {
  const settings = zoneSettings(object), factor = store.options.units === 'px' ? 200 : 100;
  return '<section class="property-section"><h3>Floor marking</h3>' +
    '<label class="field">Floor text<span class="input-wrap"><input id="zone-text" aria-label="Floor text" type="text" maxlength="240" value="' +
    escape(settings.text) + '" ' + (locked ? 'disabled' : '') + '></span></label>' +
    '<div class="room-field">' + field('zone_text_height', 'Text size', settings.text_height * factor,
      store.options.units, locked, 'min="' + .005 * factor + '" max="' + factor + '"') + '</div>' +
    '<label class="checkline"><input id="zone-show-text" type="checkbox" ' + (settings.show_text ? 'checked ' : '') + (locked ? 'disabled' : '') + '> Show floor text</label>' +
    '<label class="checkline"><input id="zone-show-outline" type="checkbox" ' + (settings.show_outline ? 'checked ' : '') + (locked ? 'disabled' : '') + '> Show zone outline</label>' +
    '<p class="hint">Width and depth above resize the zone; Text size controls the lettering. Long text shrinks to fit. Hide the whole zone with Visible in both views or the layer eye.</p></section>';
}

export function changeZone(event, object, store) {
  if (object?.kind !== 'zone') return false;
  const input = event.target;
  const key = input.id === 'zone-text' ? 'text' : input.id === 'zone-show-text' ? 'show_text'
    : input.id === 'zone-show-outline' ? 'show_outline' : input.dataset.field === 'zone_text_height' ? 'text_height' : null;
  if (!key) return false;
  if (store.locked(object.id)) return true;
  const value = key === 'text' ? input.value : key === 'text_height'
    ? Number(input.value) / (store.options.units === 'px' ? 200 : 100) : input.checked;
  if (key === 'text_height' && (!Number.isFinite(value) || value < .005 || value > 1)) {
    store.emit('selection');
    return true;
  }
  store.transact('Updated floor marking', () => {
    object.zone_marking = {...object.zone_marking, [key]: value};
  });
  return true;
}
