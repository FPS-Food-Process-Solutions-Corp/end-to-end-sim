// Move the ordering frontage to the named Left work counter without moving pickup.
import {BARRIER_KIND, barrierSettings} from './barrier-parameters.js';

const rotate = (x, y, degrees) => {
  const angle = degrees * Math.PI / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
};

export function createOrderingBarrier(scene, pickup, id = 'ordering_barrier') {
  const table = scene.objects.find(object => object.id === 'left_counter');
  if (!table) return null;
  const yaw = (table.yaw_deg || 0) + 180;
  const atom = scene.objects.find(object => object.id === 'atom_w');
  const target = atom ? rotate(atom.x - table.x, atom.y - table.y, -yaw)[1] : 0;
  const settings = barrierSettings(pickup);
  const barrier = {
    id, kind: BARRIER_KIND, asset_key: BARRIER_KIND, barrier_role: 'ordering',
    label: 'Ordering barrier / Left work counter',
    x: table.x, y: table.y, width: table.width, depth: table.depth,
    height: pickup.height, yaw_deg: yaw, support: table.id, z: pickup.z || 0,
    parentId: table.parentId, visible: pickup.visible !== false, locked: false,
    barrier: {...settings, front_panel: false, right_return: true,
      show_pickup: false, show_tablet: true, show_intercom: true,
      show_instructions: settings.show_instructions,
      tablet_side: 'right', intercom_side: 'right', instructions_side: 'right'},
  };
  // Keep the ordering cluster together, including user-resized controls.
  const micOffset = -(settings.tablet_width / 2 + .06 + settings.intercom_diameter / 2);
  const flyerOffset = settings.tablet_width / 2 + .06 + settings.instructions_width / 2;
  const low = micOffset - settings.intercom_diameter / 2;
  const high = settings.show_instructions ? flyerOffset + settings.instructions_width / 2 : settings.tablet_width / 2;
  const min = -barrier.depth / 2 + settings.frame - low;
  const max = barrier.depth / 2 - settings.frame - high;
  const center = Math.max(min, Math.min(max, target));
  barrier.barrier.tablet_center = center;
  barrier.barrier.intercom_center = center + micOffset;
  barrier.barrier.instructions_center = center + flyerOffset;
  barrier.barrier = barrierSettings(barrier);
  return barrier;
}

export function migrateCustomerFrontage(scene) {
  if ((scene.editor_revision || 0) >= 8) return;
  const pickup = scene.objects.find(object => object.id === 'customer_barrier' && object.kind === BARRIER_KIND);
  if (!pickup || scene.objects.some(object => object.barrier_role === 'ordering')) return;
  let id = 'ordering_barrier', suffix = 1;
  while (scene.objects.some(object => object.id === id) || scene.groups.some(group => group.id === id)) {
    id = 'ordering_barrier_' + suffix++;
  }
  const ordering = createOrderingBarrier(scene, pickup, id);
  if (!ordering) return;
  if (ordering.parentId && !scene.groups.some(group => group.id === ordering.parentId)) {
    scene.groups.push({id: ordering.parentId, label: 'Left work counter'});
  }
  scene.objects.push(ordering);
  pickup.barrier_role = 'pickup';
  pickup.label = 'Pickup barrier / coffee table';
  const p = barrierSettings(pickup);
  pickup.barrier = {...p, front_panel: p.pickup_side === 'front',
    right_return: p.pickup_side === 'right',
    show_tablet: false, show_intercom: false, show_instructions: false};
  const coffee = scene.objects.find(object => object.id === 'coffee_station');
  if (coffee) coffee.ordering_terminal = false;
  const human = scene.objects.find(object => object.id === 'human');
  if (human && !human.locked) {
    // The mannequin faces local +Y. The screen faces outward from local +X.
    const offset = rotate(ordering.width / 2 + .42, ordering.barrier.tablet_center, ordering.yaw_deg);
    human.x = ordering.x + offset[0];
    human.y = ordering.y + offset[1];
    human.yaw_deg = ordering.yaw_deg + 90;
    human.support = null;
    human.z = 0;
    human.label = 'Customer at ordering / 1.70 m';
  }
}
