// Upgrade the old slide opener while retaining the rest of a saved layout.
const copy = value => JSON.parse(JSON.stringify(value));
const rotate = (x, y, degrees) => {
  const angle = degrees * Math.PI / 180;
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
};

export function migrateBagStation(scene, seed) {
  const previous = scene.objects.find(object => object.id === 'bag_opener');
  const counter = scene.objects.find(object => object.id === previous?.support);
  // A deliberately deleted station stays deleted.
  if (!previous || !counter) return;

  const oldCenter = {x: counter.x, y: counter.y};
  const stationOffset = [previous.x - oldCenter.x, previous.y - oldCenter.y];
  const widthIncrease = Math.max(0, .75 - counter.width);
  const shift = rotate(-widthIncrease / 2, 0, counter.yaw_deg || 0);
  counter.x += shift[0];
  counter.y += shift[1];
  counter.width += widthIncrease;
  counter.depth = Math.max(1, counter.depth);

  const angle = previous.yaw_deg ?? (counter.yaw_deg || 0) - 90;
  const parentId = previous.parentId || counter.parentId;
  const components = seed.objects.filter(object => object.layout_component);
  const replacement = [];

  for (const source of components) {
    if (source.id !== previous.id && scene.objects.some(o => o.id === source.id)) {
      continue;
    }
    const object = copy(source);
    const offset = rotate(...source.station_offset, angle);
    Object.assign(object, {
      x: counter.x + stationOffset[0] + offset[0],
      y: counter.y + stationOffset[1] + offset[1],
      yaw_deg: angle,
      z: (source.z || 0) + (previous.z || 0),
      support: counter.id,
      parentId,
      visible: previous.visible !== false,
      locked: previous.locked || false,
    });
    replacement.push(object);
  }

  scene.objects = scene.objects.filter(object => object.id !== previous.id);
  scene.objects.push(...replacement);
  const group = scene.groups.find(item => item.id === parentId);
  if (group && ['Middle counter', 'Bag packing station / ME6'].includes(group.label)) {
    group.label = 'Bag packing station / ME6';
  }
}
