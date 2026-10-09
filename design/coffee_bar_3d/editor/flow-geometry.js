import {BREAD_DEFAULTS, resolveBreadShelf, makeBreadRequest} from './bread-geometry.js';
import {fixtureBag, fixedContact, stackSettings} from './bag-fixture-parameters.js';
import {Quaternion, Euler, Vector3} from '../vendor/three.module.js';
import {rotate, corners} from './store.js';
import {MOTION_DEFAULTS} from './bag-motion.js';
import {placementAssessment, placementError} from './placement-validation.js';

export const FLOW_DEFAULTS = {
  ...MOTION_DEFAULTS,
  robot_id: 'nova5_suction',
  ...BREAD_DEFAULTS,
  magazine_id: 'bag_magazine',
  fixture_id: 'bag_opener',
  placement_zone_id: 'placement_zone',
  shared_table_id: 'middle_counter',
  pullback: .086,
  approach: .08,
  lift: .25,
  auto_check: true,
};

function orientation(yaw) {
  return new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, yaw * Math.PI / 180, 'ZYX')).toArray();
}

function surfacePose(store, object, local, name, id) {
  const offset = rotate(local[0], local[1], object.yaw_deg || 0);
  return {
    id, name,
    position: [object.x + offset[0], object.y + offset[1], store.z(object) + local[2]],
    quaternion: orientation(object.yaw_deg || 0),
  };
}

function displaced(pose, amount, vertical = 0) {
  const direction = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...pose.quaternion));
  return {...pose, position: [
    pose.position[0] - direction.x * amount,
    pose.position[1] - direction.y * amount,
    pose.position[2] - direction.z * amount + vertical,
  ]};
}

function overlaps(a, b) {
  const ac = corners(a);
  const bc = corners(b);
  const axes = [a, b].flatMap(object =>
    [rotate(1, 0, object.yaw_deg || 0), rotate(0, 1, object.yaw_deg || 0)]);
  return axes.every(axis => {
    const project = point => point[0] * axis[0] + point[1] * axis[1];
    const ap = ac.map(project);
    const bp = bc.map(project);
    return Math.min(Math.max(...ap), Math.max(...bp)) -
      Math.max(Math.min(...ap), Math.min(...bp)) > .001;
  });
}

export function makeWorkflowRequest(store, overrides = {}) {
  const settings = {...FLOW_DEFAULTS, ...store.scene.bag_workflow, ...overrides};
  if (!Number.isFinite(settings.max_bag_tilt_deg) || settings.max_bag_tilt_deg <= 0 ||
      settings.max_bag_tilt_deg > 45) throw new Error('Bag tilt limit must be above 0° and no more than 45°.');
  if (!Number.isFinite(settings.min_j1_share) || settings.min_j1_share < 0 || settings.min_j1_share > 1)
    throw new Error('Minimum J1 share must be between 0 and 100%.');
  if (!Number.isFinite(settings.extra_lift_search) || settings.extra_lift_search < 0 || settings.extra_lift_search > 1)
    throw new Error('Additional lift search must be between 0 and 100 cm.');
  const robot = store.object(settings.robot_id);
  const magazine = store.object(settings.magazine_id);
  const fixture = store.object(settings.fixture_id);
  const zone = store.object(settings.placement_zone_id);
  if (!robot || store.key(robot) !== 'nova5_suction') throw new Error('Choose a Nova-5 suction robot.');
  if (!magazine || magazine.layout_component !== 'magazine') throw new Error('Choose a bag stack holder.');
  if (!fixture || fixture.layout_component !== 'fixed_suction') throw new Error('Choose the fixed suction holder.');
  if (!zone || zone.kind !== 'placement_zone') throw new Error('Add or choose a placement rectangle.');
  const table = store.object(zone.support);
  const placementBounds = placementAssessment(store, zone);
  if (!placementBounds.validSupport) throw new Error(placementError(placementBounds));
  for (const object of [robot, magazine, fixture, zone]) {
    if (!store.visible(object.id)) throw new Error(object.label + ' is hidden.');
  }

  const bag = fixtureBag(fixture);
  const stack = stackSettings(magazine);
  if (!stack.bag_count) throw new Error('The bag stack is empty. Increase Bags in stack in the holder properties.');
  bag.flatDepth = stack.bag_thickness;
  const stroke = settings.pullback;
  const openDepth = bag.flatDepth + stroke;
  const warnings = [];
  const errors = [];
  if (stack.bag_width > magazine.width - .008 || stack.bag_height > magazine.depth - .008)
    errors.push('The flattened bag does not fit inside the stack holder. Increase holder width/depth.');
  if (Math.abs(stack.bag_width - bag.width) > .001 || Math.abs(stack.bag_height - bag.height) > .001)
    errors.push('Stack bag width/height must match the bag at the opening fixture.');
  if (stroke <= 0 || openDepth > bag.depth + .0001) {
    errors.push('Opening stroke must be positive and no more than ' +
      ((bag.depth - bag.flatDepth) * 100).toFixed(1) + ' cm for this bag.');
  }
  if (zone.width < bag.width || zone.depth < openDepth) {
    errors.push('The placement rectangle is smaller than the opened bag footprint.');
  }
  const boundaryError = placementError(placementBounds);
  if (boundaryError) errors.push(boundaryError);
  // A barrier footprint is an L-shaped panel envelope with an empty interior.
  // Do not treat that bounding rectangle as a solid occupied tabletop area.
  const blockers = store.scene.objects.filter(object =>
    object.id !== zone.id && object.support === table.id &&
    !['placement_zone', 'customer_barrier'].includes(object.kind) && store.visible(object.id) && overlaps(zone, object));
  if (blockers.length) errors.push('Placement rectangle overlaps: ' + blockers.map(object => object.label).join(', '));

  const pickup = surfacePose(store, magazine, [
    0, -bag.height / 2 + bag.contactHeight, stack.top,
  ], 'Top bag pickup', 'magazine');
  pickup.quaternion = new Quaternion().setFromEuler(new Euler(Math.PI, 0,
    (magazine.yaw_deg || 0) * Math.PI / 180, 'ZYX')).toArray();
  const fixedLocal = fixedContact(fixture);
  const fixed = surfacePose(store, fixture,
    [fixedLocal[0], fixedLocal[1] - bag.flatDepth, fixedLocal[2]], 'Opposing suction contact', 'fixed');
  const opened = {...displaced(fixed, stroke), id: 'open', name: 'After opening stroke'};
  const supportHeight = store.z(table) + table.height;
  const placementPose = (x, y, id, name) => surfacePose(store,
    {...zone, x, y, support: null, z: supportHeight},
    [0, -openDepth / 2, bag.contactHeight + .002], name, id);
  const placement = placementPose(zone.x, zone.y, 'placement', 'Placement zone centre');

  const halfWidth = Math.max(0, (zone.width - bag.width) / 2);
  const halfDepth = Math.max(0, (zone.depth - openDepth) / 2);
  const zoneSamples = [];
  for (let row = -1; row <= 1; row++) {
    for (let column = -1; column <= 1; column++) {
      const offset = rotate(column * halfWidth, row * halfDepth, zone.yaw_deg || 0);
      const pose = placementPose(zone.x + offset[0], zone.y + offset[1],
        'zone-' + zoneSamples.length, 'Placement sample ' + (zoneSamples.length + 1));
      zoneSamples.push({...pose, row, column, center: [zone.x + offset[0], zone.y + offset[1], supportHeight + .008]});
    }
  }

  if (!['magic','nova'].includes(settings.bread_mode)) throw new Error('Atom-W bread pickup is not implemented yet. Choose magic or Nova-5.');
  const breadShelf = resolveBreadShelf(store, settings);
  const bread = breadShelf ? store.shelfSettings(breadShelf) : store.scene.shelves;
  const breadSize = [bread.bread_length_1, bread.bread_length_2, bread.bread_height];
  const breadTask = makeBreadRequest(store, settings, opened, bag, openDepth);
  const breadFits = breadTask ? breadTask.fits : breadSize[0] <= bag.width && breadSize[1] <= openDepth;
  if (breadTask && !breadFits) errors.push('The vertically held bun does not fit the bag: allow 4 mm total clearance for bun width and thickness, and sufficient bag height. Adjust the rack bread size or bag dimensions.');
  if (!breadTask && !breadFits) {
    warnings.push('Bread placeholder is ' + (breadSize[0] * 100).toFixed(1) + ' × ' +
      (breadSize[1] * 100).toFixed(1) + ' cm; the opening is ' +
      (bag.width * 100).toFixed(1) + ' × ' + (openDepth * 100).toFixed(1) +
      ' cm. Adjust bag/opening or bread dimensions before loading.');
  }
  const approach = displaced(pickup, settings.approach);
  // Clear the holder before rotating the whole empty bag from flat to upright.
  const turnHeight = Math.max(pickup.position[2] + settings.lift,
    store.z(magazine) + magazine.height + bag.contactHeight + .02);
  const lifted = {...pickup, position: [pickup.position[0], pickup.position[1], turnHeight]};
  const withdrawn = {...lifted, quaternion: orientation(magazine.yaw_deg || 0)};
  const fixedApproach = displaced(fixed, settings.approach, settings.lift);
  const released = displaced(opened, settings.approach, settings.lift);
  const aboveZone = {...placement, position: [placement.position[0], placement.position[1], placement.position[2] + settings.lift]};
  const retreat = displaced(placement, settings.approach, settings.lift);
  const knots = [];
  function knot(time, pose, phase, state = {}) {
    knots.push({
      ...pose, time, phase, bagState: 'carried', bagDepth: bag.flatDepth,
      robotVacuum: true, fixedVacuum: false, loaded: false, ...state,
    });
  }
  knot(0, displaced(approach, 0, settings.lift), 'Approach bag stack', {bagState: 'magazine', robotVacuum: false, clearance: true});
  knot(1.5, approach, 'Approach top bag', {bagState: 'magazine', robotVacuum: false});
  knot(3, pickup, 'Grip top bag', {allowBagReorientation: true});
  knot(3.8, pickup, 'Confirm robot vacuum', {allowBagReorientation: true});
  knot(5.5, lifted, 'Lift clear of stack holder', {allowBagReorientation: true});
  knot(7, withdrawn, 'Turn empty bag upright');
  knot(7.5, fixedApproach, 'Carry to fixed holder', {clearance: true, transfer: 'fixed'});
  knot(9, fixed, 'Present to opposing suction', {fixedVacuum: true});
  knot(10, fixed, 'Confirm opposing vacuum', {fixedVacuum: true});
  knot(12, opened, 'Pull the bag open', {fixedVacuum: true, bagDepth: openDepth});
  knot(15, opened, 'Wait for bun loading', {fixedVacuum: true, bagDepth: openDepth, loaded: true});
  knot(15.6, opened, 'Release fixed suction', {bagDepth: openDepth, loaded: true});
  knot(17, released, 'Lift the loaded bag', {bagDepth: openDepth, loaded: true, clearance: true});
  knot(20.5, aboveZone, 'Carry to placement zone', {bagDepth: openDepth, loaded: true, clearance: true, transfer: 'placement'});
  knot(22, placement, 'Set bag on table', {bagDepth: openDepth, loaded: true});
  knot(22.8, placement, 'Release robot vacuum', {bagState: 'placed', robotVacuum: false, bagDepth: openDepth, loaded: true});
  knot(24, retreat, 'Retract from placed bag', {bagState: 'placed', robotVacuum: false, bagDepth: openDepth, loaded: true, clearance: true});

  // Allow the added upright-turn step its own time before the existing sequence.
  for (const k of knots) if (k.time >= 7.5) k.time += 1.5;

  return {
    settings, robot, mountingHeight: store.z(robot),
    targets: [pickup, fixed, opened, placement], zoneSamples, knots,
    bag, stack, breadSize, breadTask, errors, warnings, zone, fixture, placementBounds,
    duration: 25.5,
    breadFits,
  };
}
