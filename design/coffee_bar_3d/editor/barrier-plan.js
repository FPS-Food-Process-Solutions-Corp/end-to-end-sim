import {barrierSettings, barrierSections} from './barrier-parameters.js';

// Plan coordinates are SVG pixels: +X right, +Y down.
export function barrierPlan(object, labels) {
  const p = barrierSettings(object);
  const sections = barrierSections(object);
  let markup = '';
  for (const side of ['front', ...(p.right_return ? ['right'] : [])]) {
    const span = (side === 'front' ? object.width : object.depth) * 200;
    const features = sections.filter(feature => feature.side === side);
    const pickup = features.find(feature => feature.kind === 'pickup');
    const transform = side === 'front' ? `translate(0 ${object.depth * 100})` :
      `translate(${object.width * 100} 0) rotate(-90)`;
    let out = '';
    const pieces = pickup ? [[-span / 2, (pickup.center - pickup.width / 2) * 200],
      [(pickup.center + pickup.width / 2) * 200, span / 2]] : [[-span / 2, span / 2]];
    for (const [from, to] of pieces) {
      out += `<path d="M ${from} 0 H ${to}" stroke="#78bac7" stroke-width="${Math.max(5, p.thickness * 200)}"/>`;
    }
    // A transparent stroke gives this thin wall a comfortable click target.
    out += `<path d="M ${-span / 2} 0 H ${span / 2}" stroke="transparent" stroke-width="16" fill="none"/>`;
    for (const feature of features) {
      const u = feature.center * 200, width = feature.width * 200;
      if (feature.kind === 'pickup') {
        out += `<g data-barrier-section="pickup"><path d="M ${u-width/2} -5 V 5 M ${u+width/2} -5 V 5" stroke="#238b79" stroke-width="3"/><path d="M ${u-width/2+3} 0 H ${u+width/2-3}" stroke="#58aa94" stroke-dasharray="4 4" stroke-width="1.5"/>`;
        if (labels) out += `<text x="${u}" y="21" text-anchor="middle" font-size="10" fill="#217c6d">PICKUP OPENING</text>`;
        out += '</g>';
      } else {
        const color = feature.kind === 'tablet' ? '#284a51' : feature.kind === 'intercom' ? '#657b80' : '#a2b5a8';
        out += `<g data-barrier-section="${feature.kind}"><rect x="${u-width/2}" y="-5" width="${width}" height="10" rx="2" fill="${color}" stroke="#eef8f6" stroke-width="1"/>`;
        if (labels) out += `<text x="${u}" y="21" text-anchor="middle" font-size="9" fill="#496873">${feature.kind === 'tablet' ? 'TABLET' : feature.kind === 'intercom' ? 'MIC / SPEAKER' : 'INSTRUCTIONS'}</text>`;
        out += '</g>';
      }
    }
    markup += `<g data-barrier-panel="${side}" transform="${transform}">${out}</g>`;
  }
  return markup;
}
