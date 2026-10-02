// One-time conversion of the previous cart/ME6 station to a shared packing table.
export function migrateSuctionWorkflow(scene, seed) {
  scene.robot_inventory = {...scene.robot_inventory, nova5_suction: seed.robot_inventory.nova5_suction};
  if ((scene.editor_revision || 0) >= 6) return;
  const source = id => seed.objects.find(object => object.id === id);
  const current = id => scene.objects.find(object => object.id === id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const bunRobot = current('nova5');
  const oldCart = current('nova5_cart');
  const oldCounter = current('middle_counter');
  const dx = (bunRobot?.x ?? 1.85) - 1.85;
  const dy = (bunRobot?.y ?? 2.65) - 2.65;
  const table = copy(source('middle_counter'));
  table.x += dx;
  table.y += dy;
  table.height = oldCart?.height ?? table.height;
  table.parentId = oldCounter?.parentId || 'area_middle';
  if (oldCounter) table.visible = oldCounter.visible;
  if (!scene.groups.some(group => group.id === table.parentId)) {
    scene.groups.push({id: table.parentId, label: 'Packing cell / shared table'});
  }
  const replacements = [table];
  for (const id of ['bag_opener', 'bag_magazine', 'nova5_suction']) {
    const object = copy(source(id));
    const previous = current(id);
    object.x += dx;
    object.y += dy;
    object.parentId = table.parentId;
    if (previous) {
      object.visible = previous.visible;
      object.locked = previous.locked;
    }
    replacements.push(object);
  }
  if (bunRobot) {
    bunRobot.support = table.id;
    bunRobot.parentId = table.parentId;
    bunRobot.z = 0;
  }
  for (const object of scene.objects) {
    if (!['middle_counter', 'nova5_cart'].includes(object.support) || object.id === 'nova5') continue;
    const previousHeight = object.support === 'nova5_cart' ? oldCart?.height : oldCounter?.height;
    object.support = table.id;
    object.z = (object.z || 0) + (previousHeight ?? table.height) - table.height;
  }
  const replaceIds = new Set([...replacements.map(object => object.id), 'nova5_cart', 'me6_bag_robot']);
  scene.objects = scene.objects.filter(object => !replaceIds.has(object.id));
  scene.objects.push(...replacements);
  const group = scene.groups.find(item => item.id === table.parentId);
  if (group) group.label = 'Packing cell / shared table';
  if (!current('placement_zone')) {
    const zone = copy(source('placement_zone'));
    const front = current('coffee_station');
    if (front) {
      const angle = (front.yaw_deg || 0) * Math.PI / 180;
      const x = Math.min(.61, Math.max(0, (front.width - zone.width) / 2));
      const y = Math.min(.51, Math.max(0, (front.depth - zone.depth) / 2));
      zone.x = front.x + x * Math.cos(angle) - y * Math.sin(angle);
      zone.y = front.y + x * Math.sin(angle) + y * Math.cos(angle);
      zone.yaw_deg = (front.yaw_deg || 0) + 180;
      zone.parentId = front.parentId;
      scene.objects.push(zone);
    }
  }
  scene.bag_workflow = {...copy(seed.bag_workflow), ...scene.bag_workflow};
  scene.editor_revision = 6;
}
