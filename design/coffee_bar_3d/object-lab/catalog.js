import {isPastry} from './pastries.js';
import {queueEntry, validateQueue} from './drop-queue.js';

// All dimensions in this workspace are centimetres.
export const BAG_SIZES = [
  ['bag-2', 'No. 2 bag', 9, 5.5, 17],
  ['bag-3', 'No. 3 bag', 12, 7, 21],
  ['bag-4', 'No. 4 bag', 13, 8, 24],
  ['bag-6', 'No. 6 bag', 15, 9, 27],
  ['bag-8', 'No. 8 bag', 15.5, 10, 30],
  ['bag-12', 'No. 12 bag', 18, 11, 32],
  ['bag-13', 'No. 13 bag', 20, 12.5, 30],
  ['bag-14', 'No. 14 bag', 25, 14, 33],
  ['bag-15', 'No. 15 bag', 25, 14, 28],
  ['bag-16', 'No. 16 bag', 28, 15, 28],
];
export const DROP_DEFAULTS = {height: 12, x: 0, z: 0, tilt: 15, yaw: 0, friction: .45, bounce: .08, speed: 1, cadence: 'settled', interval: 1};

export function defaults() {
  let edge = -56;
  const bags = BAG_SIZES.map(([id, name, width, depth, height], index) => {
    // Larger bags form a second row behind the original comparison lineup.
    if (index === 6) edge = -58;
    const x = edge + width / 2;
    edge += width + 6;
    return {id, name, kind: 'bag', width, depth, height, x, z: index < 6 ? -6 : -32, yaw: 0, visible: true};
  });
  return {
    schema: 'object-size-lab', version: 1, catalog_revision: 3, units: 'cm',
    objects: [...bags,
      {id: 'mini-donut', name: 'Mini donut', kind: 'donut', diameter: 7, height: 2.8, x: -9, z: 20, yaw: 0, upright: false, visible: true},
      {id: 'donut', name: 'Donut', kind: 'donut', diameter: 10, height: 3.3, x: 8, z: 20, yaw: 0, upright: false, visible: true}],
    selected: 'bag-6', mode: 'compare', bag: 'bag-6', donut: 'donut',
    unit: 'cm', xray: false, dimensions: true, labels: true, allowance: .2, drop: {...DROP_DEFAULTS}, dropQueue: [],
  };
}

export function dimensions(o) {
  return o.kind === 'donut'
    ? {width: o.diameter, depth: o.upright ? o.height : o.diameter, height: o.upright ? o.diameter : o.height}
    : {width: o.width, depth: o.depth, height: o.height};
}

export function fitAssessment(bag, donut, allowance) {
  if (!bag || !donut) return null;
  const a = dimensions(bag), b = dimensions(donut);
  const remaining = Object.fromEntries(['width', 'depth', 'height'].map(k => [k, a[k] - b[k] - 2 * allowance]));
  return {remaining, fits: Object.values(remaining).every(v => v >= -1e-7)};
}

export function validateScene(value) {
  if (value?.schema !== 'object-size-lab' || value.version !== 1 || value.units !== 'cm' || !Array.isArray(value.objects)) throw Error('Choose an Object size lab JSON export.');
  if (value.objects.length > 60) throw Error('Please use 60 objects or fewer.');
  const state = {...defaults(), ...structuredClone(value)}, ids = new Set();
  if ((value.catalog_revision || 0) < 2) {
    const mini = state.objects.find(o => o.id === 'mini-donut' && o.kind === 'donut');
    if (mini && Math.abs(mini.height - 3.3) < 1e-8) mini.height = 2.8;
  }
  state.catalog_revision = 3;
  const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  for (const o of state.objects) {
    if (!['bag', 'donut', 'box'].includes(o.kind) || typeof o.id !== 'string' || !o.id || ids.has(o.id)) throw Error('Objects need unique IDs and a supported type.');
    ids.add(o.id);
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80) throw Error('Names must be between 1 and 80 characters.');
    for (const key of o.kind === 'donut' ? ['diameter', 'height'] : ['width', 'depth', 'height']) if (!finite(o[key], .1, 200)) throw Error('Dimensions must be 0.1–200 cm.');
    for (const key of ['x', 'z']) if (!finite(o[key], -500, 500)) throw Error('Positions must be within 500 cm of the origin.');
    if (!finite(o.yaw, -360, 360)) throw Error('Rotation must be between -360° and 360°.');
    if (typeof o.visible !== 'boolean') throw Error('Object visibility must be true or false.');
    o.upright = o.upright === true;
  }
  if ((value.catalog_revision || 0) < 3) {
    // Add only the new presets once; preserve edited objects and later removals.
    // Keep the new row behind the saved layout, including rotated objects.
    const back = Math.min(-18.5, ...state.objects.map(o => {
      const d = dimensions(o), angle = o.yaw * Math.PI / 180;
      return o.z - (Math.abs(Math.sin(angle)) * d.width + Math.abs(Math.cos(angle)) * d.depth) / 2;
    }));
    const z = Math.max(-500, back - 13.5);
    for (const bag of defaults().objects.filter(o => ['bag-13', 'bag-14', 'bag-15', 'bag-16'].includes(o.id))) {
      if (ids.has(bag.id) || state.objects.length >= 60) continue;
      state.objects.push({...bag, z, upright: false});
      ids.add(bag.id);
    }
  }
  state.selected = ids.has(state.selected) ? state.selected : state.objects[0]?.id || null;
  state.bag = state.objects.find(o => o.id === state.bag && o.kind === 'bag')?.id || state.objects.find(o => o.kind === 'bag')?.id || null;
  state.donut = state.objects.find(o => o.id === state.donut && o.kind === 'donut')?.id || state.objects.find(o => o.kind === 'donut')?.id || null;
  state.mode = ['fit', 'drop'].includes(state.mode) ? state.mode : 'compare';
  state.unit = state.unit === 'mm' ? 'mm' : 'cm';
  for (const k of ['xray', 'dimensions', 'labels']) state[k] = !!state[k];
  if (!finite(state.allowance, 0, 5)) throw Error('Wall allowance must be 0–5 cm.');
  state.drop = {...DROP_DEFAULTS, ...state.drop};
  for (const [key, lo, hi] of [['height',.1,100],['x',-100,100],['z',-100,100],['tilt',-180,180],['yaw',-180,180],['friction',0,1.5],['bounce',0,.8]]) {
    if (!finite(state.drop[key],lo,hi)) throw Error('Invalid drop setting: '+key);
  }
  if (![.25,.5,1].includes(state.drop.speed)) throw Error('Choose 0.25x, 0.5x or 1x playback speed.');
  if (!['settled', 'timed'].includes(state.drop.cadence) || !finite(state.drop.interval, .2, 10)) throw Error('Choose a release interval of 0.2–10 seconds.');
  // Older single-drop workspaces become a one-item queue. Queue definitions
  // are independent copies: editing or deleting catalogue objects is safe.
  if (value.dropQueue === undefined) {
    const pastry = state.objects.find(o => o.id === state.donut && isPastry(o));
    state.dropQueue = pastry ? [queueEntry(pastry, state.drop, 1, 'migrated-drop')] : [];
  }
  validateQueue(state.dropQueue);
  return state;
}
