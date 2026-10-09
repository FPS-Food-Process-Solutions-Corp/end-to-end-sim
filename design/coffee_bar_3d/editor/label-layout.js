export function objectLabelSettings(object) {
  const size = Number(object.label_size_percent ?? 100);
  const angle = Number(object.label_rotation_deg ?? 0);
  const percent = Number.isFinite(size) ? Math.max(10,Math.min(400,size)) : 100;
  const rotation = Number.isFinite(angle) ? ((Math.round(angle/90)*90)%360+360)%360 : 0;
  return {percent,scale:percent/100,rotation};
}

let measureContext;
const family = '"Segoe UI", sans-serif';
const graphemes = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;

// Wrap at words, then at grapheme boundaries for a word wider than the object.
// Geometry controls line width; label length never reduces the chosen font size.
export function wrapLabel(text, maxWidth, fontSize, weight = 500) {
  measureContext ||= document.createElement('canvas').getContext('2d');
  measureContext.font = weight + ' 100px ' + family;
  const measure = value => measureContext.measureText(value).width / 100 * fontSize;
  const limit = Math.max(fontSize * .5, maxWidth);
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const joined = line ? line + ' ' + word : word;
      if (measure(joined) <= limit) { line = joined; continue; }
      if (line) { lines.push(line); line = ''; }
      if (measure(word) <= limit) { line = word; continue; }
      const characters = graphemes ? [...graphemes.segment(word)].map(s => s.segment) : Array.from(word);
      for (const character of characters) {
        if (line && measure(line + character) > limit) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  const lineHeight = fontSize * 1.3;
  return {lines, fontSize, lineHeight, weight, family,
    width:Math.max(fontSize * .5, ...lines.map(measure)), height:lines.length * lineHeight};
}

// The same metrics drive physical 3D text and SVG tspans. Texture resolution can
// decrease for extreme text lengths, but the lettering's physical size does not.
export function labelCanvas(layout, color) {
  const widthEm = layout.width / layout.fontSize + .3;
  const heightEm = layout.height / layout.fontSize + .3;
  const density = Math.min(100, 4096 / widthEm, 4096 / heightEm);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(widthEm * density));
  canvas.height = Math.max(1, Math.ceil(heightEm * density));
  const context = canvas.getContext('2d');
  context.font = layout.weight + ' ' + density + 'px ' + layout.family;
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  layout.lines.forEach((line,index) => context.fillText(line, canvas.width / 2,
    canvas.height / 2 + (index - (layout.lines.length - 1) / 2) * 1.3 * density));
  return {canvas, width:widthEm * layout.fontSize, height:heightEm * layout.fontSize};
}
