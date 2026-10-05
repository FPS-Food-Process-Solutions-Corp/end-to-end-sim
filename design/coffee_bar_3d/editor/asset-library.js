import {FLOOR_TEA_KEY, FLOOR_TEA_SPEC} from './floor-tea-machine.js';
import {rotate} from './store.js';
const clone = value => JSON.parse(JSON.stringify(value));
const supports = new Set(['table', 'counter', 'cart', 'support']);
const categories = {
  table: 'Furniture', counter: 'Furniture', cart: 'Furniture', shelf: 'Furniture',
  machine: 'Coffee equipment', dispenser: 'Coffee equipment',
  placement_zone: 'Bag fixtures', customer_barrier: 'Customer area',
  human: 'Customer area', charger: 'Other', zone: 'Other',
};

export function sceneAssetCatalog(store) {
  const assets = store.seed.objects.filter(o => o.kind !== 'robot').map(source => ({
    key: source.id, name: source.id === 'tea_machine' ? 'Tea machine / legacy tabletop' : source.label,
    category: source.layout_component ? 'Bag fixtures'
      : ['cup_rest', 'beverage_pickup'].includes(source.role) ? 'Coffee equipment'
      : categories[source.kind] || 'Other',
    spec: clone(source),
  }));
  const shortCounter = store.seed.objects.find(o => o.id === 'upper_counter');
  if (shortCounter) {
    assets.unshift({
      key: 'between_shelves_counter', name: 'Between-shelves counter', category: 'Furniture',
      betweenShelves: true,
      spec: {...clone(shortCounter), id: 'between_shelves_counter', label: 'Between-shelves counter',
        asset_key: shortCounter.asset_key || shortCounter.id, width: .35, depth: .60, height: .90},
    });
  }
  assets.push({key:FLOOR_TEA_KEY,name:FLOOR_TEA_SPEC.label,category:'Coffee equipment',floorTea:true,
    spec:{...clone(FLOOR_TEA_SPEC),yaw_deg:-90}});
  assets.push({
    key: 'nova5_cart', name: 'Robot cart / 60 × 80 cm', category: 'Furniture',
    spec: {id: 'nova5_cart', asset_key: 'nova5_cart', kind: 'cart', label: 'Robot cart',
      width: .60, depth: .80, height: .80, top_thickness: .035, yaw_deg: 0, z: 0},
  });
  return assets;
}

export function addSceneAsset(store, key, point) {
  const preset = sceneAssetCatalog(store).find(asset => asset.key === key);
  if (!preset) return null;
  const source = preset.spec;
  const selected = store.object(store.selected[0]);
  const selectedTable = selected && supports.has(selected.kind) && store.visible(selected.id) ? selected : null;
  const tabletop = !!source.support || source.kind === 'placement_zone' || source.kind === 'customer_barrier';
  const missing = !store.item(source.id);
  const originalSupport = source.support && store.object(source.support);
  let position = point;
  if (!position && preset.floorTea) {
    const counter=store.object('coffee_station');
    if (counter) {
      const offset=rotate((counter.width+source.depth)/2+.05,0,counter.yaw_deg||0);
      position={x:counter.x+offset[0],y:counter.y+offset[1]};
      source.yaw_deg=(counter.yaw_deg||0)-90;
    }
  }
  if (!position && preset.betweenShelves) {
    const a = store.object('shelf_1'), b = store.object('shelf_2');
    position = a && b ? {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2} : null;
  }
  if (!position && tabletop && selectedTable) position = {x: selectedTable.x, y: selectedTable.y};
  if (!position && tabletop && originalSupport && store.visible(originalSupport.id))
    position = {x: originalSupport.x, y: originalSupport.y};
  if (!position && missing && Number.isFinite(source.x) && Number.isFinite(source.y))
    position = {x: source.x, y: source.y};
  position ||= {x: store.scene.room.width / 2, y: store.scene.room.depth / 2};
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;

  // A new furniture card is bare furniture. It does not copy the robots or
  // appliances supported by an existing table; ordinary Copy/Paste does that.
  let id;
  store.transact('Added ' + preset.name, () => {
    id = missing ? source.id : store.unique(source.id);
    const support = tabletop ? store.supportAt(position.x, position.y) : null;
    const parentId = support?.parentId && store.group(support.parentId) && store.visible(support.parentId)
      ? support.parentId : 'area_added';
    if (parentId === 'area_added' && !store.group(parentId))
      store.scene.groups.push({id: parentId, label: 'Added equipment'});
    const object = {
      ...clone(source), id, asset_key: source.asset_key || source.id, label: preset.name,
      ...position, support: support?.id || null, parentId, visible: true, locked: false,
    };
    delete object.enabled;
    delete object.station_offset;
    if (!tabletop) object.z = 0;
    if (source.kind === 'shelf') object.shelf_overrides = clone(store.shelfSettings(source));
    if (source.kind === 'customer_barrier' && support) {
      object.width = support.width;
      object.depth = support.depth;
      object.yaw_deg = support.yaw_deg || 0;
      object.z = 0;
      object.height = Math.max(.5, 1.7 - store.z(support) - support.height);
    }
    store.scene.objects.push(object);
    store.selected = [id];
  });
  return id;
}
