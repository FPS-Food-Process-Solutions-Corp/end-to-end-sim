import {wrapLabel} from './label-layout.js';

export function zoneSettings(object) {
  const saved = object.zone_marking || {};
  const size = Number(saved.text_height);
  return {
    text: String(saved.text ?? object.label?.split(' / ')[0] ?? 'Zone').slice(0, 240),
    show_text: saved.show_text !== false,
    show_outline: saved.show_outline !== false,
    text_height: Number.isFinite(size) && size > 0 ? Math.max(.005, Math.min(1, size)) : .067,
  };
}

// Respect the requested text size and use the long direction of a narrow strip.
export function zoneLabelLayout(object) {
  const settings = zoneSettings(object);
  const rotation = object.depth > object.width * 2.5 ? 90 : 0;
  const width = (rotation ? object.depth : object.width) * .9;
  return {...wrapLabel(settings.text,width,settings.text_height),settings,rotation};
}
