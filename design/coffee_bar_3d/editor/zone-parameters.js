let measurementContext;
export const ZONE_FONT = '500 100px "Segoe UI", sans-serif';

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

// Use the same font measurement and uniform fit in SVG and on the 3D floor.
export function zoneLabelLayout(object) {
  const settings = zoneSettings(object);
  measurementContext ||= document.createElement('canvas').getContext('2d');
  measurementContext.font = ZONE_FONT;
  const measured = measurementContext.measureText(settings.text).width;
  const width = (measured + 20) / 100 * settings.text_height;
  const height = 1.4 * settings.text_height;
  const fit = Math.min(1, object.width * .9 / width, object.depth * .9 / height);
  return {settings, measured, width: width * fit, height: height * fit, fontSize: settings.text_height * fit};
}
