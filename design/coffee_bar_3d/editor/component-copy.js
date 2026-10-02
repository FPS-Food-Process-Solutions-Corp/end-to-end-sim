// Copy scene data, keeping model references separate from each new layer ID.
const FORMAT = 'coffee-layout-components';
const VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));

export function captureComponents(store, selected = store.selected) {
  const objects = store.resolve(selected, true);
  if (!objects.length) return null;
  const groupIds = new Set();
  for (const id of selected) {
    if (!store.isGroup(id)) continue;
    groupIds.add(id);
    for (const child of store.descendants(id)) {
      if (store.isGroup(child)) groupIds.add(child);
    }
  }
  const groups = store.scene.groups.filter(group => groupIds.has(group.id));
  const included = new Set([...groupIds, ...objects.map(object => object.id)]);
  const selection = selected.filter(id => included.has(id));
  const worldHeights = Object.fromEntries(objects.map(object => [object.id, store.z(object)]));
  return clone({
    format: FORMAT,
    version: VERSION,
    copyId: crypto.randomUUID(),
    groups,
    objects,
    selection,
    worldHeights,
  });
}

export function parseComponents(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return value?.format === FORMAT ? value : null;
}

function validateComponents(store, packet) {
  if (packet?.format !== FORMAT || packet.version !== VERSION ||
      !Array.isArray(packet.groups) || !Array.isArray(packet.objects) ||
      !packet.objects.length || !Array.isArray(packet.selection)) {
    throw new Error('The clipboard does not contain supported layout components.');
  }
  if (packet.objects.length + store.scene.objects.length > 1000 ||
      packet.groups.length > 1000) {
    throw new Error('This paste would exceed the editor’s component limit.');
  }
  const entries = new Map();
  for (const item of [...packet.groups, ...packet.objects]) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        typeof item.label !== 'string' || entries.has(item.id)) {
      throw new Error('The copied layer data is invalid.');
    }
    entries.set(item.id, item);
  }
  const assets = new Map(store.seed.objects.map(object => [object.id, object]));
  assets.set('nova5_cart', {kind: 'cart'});
  assets.set('me6_bag_robot', {kind: 'robot', layout_component: 'me6_robot'});
  for (const object of packet.objects) {
    for (const key of ['x', 'y', 'width', 'depth']) {
      if (!Number.isFinite(object[key])) throw new Error('Invalid copied dimensions.');
    }
    for (const key of ['height', 'z', 'bottom', 'yaw_deg', 'robot_scale']) {
      if (object[key] !== undefined && !Number.isFinite(object[key])) {
        throw new Error('Invalid copied transform.');
      }
    }
    if (object.width <= 0 || object.depth <= 0 ||
        (object.robot_scale !== undefined && object.robot_scale <= 0)) {
      throw new Error('Copied dimensions must be positive.');
    }
    const asset = assets.get(object.asset_key || object.id);
    const robot = store.scene.robot_inventory[object.model_key || object.id];
    if (object.kind === 'robot' ? !robot : !['placement_zone', 'customer_barrier'].includes(object.kind) && asset?.kind !== object.kind) {
      throw new Error('No matching 3D model for ' + object.label + '.');
    }
    if (object.layout_component && asset?.layout_component !== object.layout_component) {
      throw new Error('No matching station model for ' + object.label + '.');
    }
  }
  // Check the combined dependency graph before anything reaches the live scene.
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (!entries.has(id) || visited.has(id)) return;
    if (visiting.has(id)) throw new Error('Copied layers have a circular dependency.');
    visiting.add(id);
    const item = entries.get(id);
    visit(item.parentId);
    visit(item.support);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of entries.keys()) visit(id);
}

export function insertComponents(store, packet, options = {}) {
  validateComponents(store, packet);
  const {dx = .15, dy = -.15, label = 'Pasted components'} = options;
  const reserved = new Set([...store.scene.groups, ...store.scene.objects].map(item => item.id));
  const idMap = new Map();
  for (const item of [...packet.groups, ...packet.objects]) {
    let suffix = 1;
    while (reserved.has(item.id + '_' + suffix)) suffix++;
    const id = item.id + '_' + suffix;
    reserved.add(id);
    idMap.set(item.id, id);
  }
  const copiedGroups = new Set(packet.groups.map(group => group.id));
  const remap = id => idMap.get(id) || (store.item(id) ? id : null);
  const groups = packet.groups.map(source => {
    const group = clone(source);
    group.id = idMap.get(source.id);
    group.parentId = remap(source.parentId);
    if (!copiedGroups.has(source.parentId)) group.label += ' copy';
    return group;
  });
  const objects = packet.objects.map(source => {
    const object = clone(source);
    object.id = idMap.get(source.id);
    object.asset_key = source.asset_key || source.id;
    if (source.kind === 'robot') object.model_key = source.model_key || source.id;
    object.parentId = remap(source.parentId);
    object.x += dx;
    object.y += dy;
    delete object.enabled;
    if (!copiedGroups.has(source.parentId)) object.label += ' copy';
    if (source.support) {
      object.support = remap(source.support);
      if (!object.support) {
        // Preserve the physical elevation if the original support was deleted.
        const elevation = packet.worldHeights?.[source.id] ?? source.z ?? 0;
        if (!Number.isFinite(elevation)) throw new Error('Invalid copied elevation.');
        object.z = elevation;
      }
    }
    if (source.follow) object.follow = remap(source.follow);
    if (source.distanceTargets) {
      object.distanceTargets = source.distanceTargets.map(remap).filter(Boolean);
    }
    return object;
  });
  const selection = packet.selection.map(id => idMap.get(id)).filter(Boolean);
  store.transact(label, () => {
    store.scene.groups.push(...groups);
    store.scene.objects.push(...objects);
    store.selected = selection.length ? selection : objects.map(object => object.id);
  });
  return objects.length;
}
