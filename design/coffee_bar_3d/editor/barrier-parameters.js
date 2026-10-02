export const BARRIER_KIND = 'customer_barrier';
export const BARRIER_DEFAULTS = {
  right_return: true,
  thickness: .008,
  frame: .024,
  opacity: .22,
  pickup_side: 'right',
  pickup_center: .45,
  pickup_bottom: 0,
  pickup_width: .44,
  pickup_height: .42,
  tablet_side: 'front',
  tablet_center: -.16,
  tablet_bottom: .14,
  tablet_width: .30,
  tablet_height: .22,
  intercom_side: 'front',
  intercom_center: -.48,
  intercom_bottom: .23,
  intercom_diameter: .11,
  instructions_side: 'front',
  instructions_center: .32,
  instructions_bottom: .12,
  instructions_width: .34,
  instructions_height: .40,
  show_instructions: true,
};

const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
const numeric = (value, fallback) => Number.isFinite(value) ? value : fallback;
export function barrierSettings(object) {
  const p = {...BARRIER_DEFAULTS, ...object.barrier};
  p.right_return = !!p.right_return;
  p.show_instructions = !!p.show_instructions;
  p.frame = clamp(numeric(p.frame, .024), .005, Math.min(object.width, object.depth, object.height) / 8);
  p.thickness = clamp(numeric(p.thickness, .008), .002, .04);
  p.opacity = clamp(numeric(p.opacity, .22), .05, .75);
  for (const section of ['pickup', 'tablet', 'intercom', 'instructions']) {
    const side = p[section + '_side'] === 'right' && p.right_return ? 'right' : 'front';
    p[section + '_side'] = side;
    const span = side === 'right' ? object.depth : object.width;
    const widthKey = section === 'intercom' ? 'intercom_diameter' : section + '_width';
    const heightKey = section === 'intercom' ? 'intercom_diameter' : section + '_height';
    p[widthKey] = clamp(numeric(p[widthKey], BARRIER_DEFAULTS[widthKey]), .04,
      Math.max(.04, Math.min(span - 4 * p.frame, section === 'intercom' ? object.height - 3 * p.frame : Infinity)));
    p[heightKey] = clamp(numeric(p[heightKey], BARRIER_DEFAULTS[heightKey]), .04, object.height - 2 * p.frame);
    p[section + '_center'] = clamp(numeric(p[section + '_center'], 0),
      -span / 2 + p.frame + p[widthKey] / 2, span / 2 - p.frame - p[widthKey] / 2);
    p[section + '_bottom'] = clamp(numeric(p[section + '_bottom'], 0), 0,
      object.height - p.frame - p[heightKey]);
  }
  return p;
}

export function barrierSections(object) {
  const p = barrierSettings(object);
  return ['pickup', 'tablet', 'intercom', ...(p.show_instructions ? ['instructions'] : [])].map(kind => ({
    kind, side: p[kind + '_side'], center: p[kind + '_center'], bottom: p[kind + '_bottom'],
    width: p[kind === 'intercom' ? 'intercom_diameter' : kind + '_width'],
    height: p[kind === 'intercom' ? 'intercom_diameter' : kind + '_height'],
  }));
}

export function panelCells(span, height, cutouts) {
  const xs = [-span / 2, span / 2];
  const ys = [0, height];
  for (const hole of cutouts) {
    xs.push(hole.center - hole.width / 2, hole.center + hole.width / 2);
    ys.push(hole.bottom, hole.bottom + hole.height);
  }
  const unique = values => [...new Set(values)].sort((a, b) => a - b);
  const x = unique(xs);
  const y = unique(ys);
  const cells = [];
  for (let column = 1; column < x.length; column++) {
    for (let row = 1; row < y.length; row++) {
      const center = (x[column - 1] + x[column]) / 2;
      const middle = (y[row - 1] + y[row]) / 2;
      if (cutouts.some(hole => center > hole.center - hole.width / 2 &&
          center < hole.center + hole.width / 2 && middle > hole.bottom && middle < hole.bottom + hole.height)) continue;
      const width = x[column] - x[column - 1];
      const height = y[row] - y[row - 1];
      if (width > 1e-8 && height > 1e-8) cells.push({center, middle, width, height});
    }
  }
  return cells;
}

export function barrierWarnings(object) {
  const sections = barrierSections(object);
  const warnings = [];
  for (let a = 0; a < sections.length; a++) {
    for (let b = a + 1; b < sections.length; b++) {
      const first = sections[a], second = sections[b];
      if (first.side !== second.side) continue;
      if (Math.abs(first.center - second.center) < (first.width + second.width) / 2 + .012 &&
          first.bottom < second.bottom + second.height + .012 &&
          second.bottom < first.bottom + first.height + .012) {
        warnings.push(first.kind + ' and ' + second.kind + ' overlap or have less than 1.2 cm clearance.');
      }
    }
  }
  return warnings;
}

export function createCustomerBarrier(scene, id = 'customer_barrier') {
  const table = scene.objects.find(object => object.id === 'coffee_station') ||
    scene.objects.find(object => ['table', 'counter'].includes(object.kind));
  const object = {
    id, kind: BARRIER_KIND, asset_key: BARRIER_KIND, label: 'Customer barrier / ordering & pickup',
    x: table?.x ?? .7, y: table?.y ?? 1.45,
    width: table?.width ?? 1.4, depth: table?.depth ?? 1.4,
    height: Math.max(.5, 1.7 - (table?.height ?? .9)), yaw_deg: table?.yaw_deg ?? 0,
    support: table?.id || null, z: table ? 0 : .9,
    parentId: table?.parentId || 'area_added', visible: true, locked: false,
    barrier: {...BARRIER_DEFAULTS},
  };
  const zone = scene.objects.find(candidate => candidate.id === scene.bag_workflow?.placement_zone_id);
  if (zone) {
    const angle = -(object.yaw_deg || 0) * Math.PI / 180;
    object.barrier.pickup_center = (zone.x - object.x) * Math.sin(angle) +
      (zone.y - object.y) * Math.cos(angle);
  }
  object.barrier = barrierSettings(object);
  return object;
}

export function migrateCustomerBarrier(scene) {
  if ((scene.editor_revision || 0) >= 7) return;
  if (!scene.objects.some(object => object.kind === BARRIER_KIND)) {
    const barrier = createCustomerBarrier(scene);
    if (!scene.groups.some(group => group.id === barrier.parentId)) {
      scene.groups.push({id: barrier.parentId, label: 'Customer frontage'});
    }
    // Avoid colliding with a user-created legacy window of the same ID.
    let index = 1;
    while (scene.objects.some(object => object.id === barrier.id)) barrier.id = 'customer_barrier_' + index++;
    scene.objects.push(barrier);
  }
}

export function pickupWorld(object, mountingHeight) {
  const p = barrierSettings(object);
  const local = p.pickup_side === 'right' ? [object.width / 2, p.pickup_center] : [p.pickup_center, -object.depth / 2];
  const yaw = (object.yaw_deg || 0) * Math.PI / 180;
  return {
    center: [object.x + local[0] * Math.cos(yaw) - local[1] * Math.sin(yaw),
      object.y + local[0] * Math.sin(yaw) + local[1] * Math.cos(yaw),
      mountingHeight + p.pickup_bottom + p.pickup_height / 2],
    width: p.pickup_width, height: p.pickup_height,
  };
}
