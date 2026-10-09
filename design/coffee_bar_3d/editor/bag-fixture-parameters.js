// Fixture coordinates are metres, with +Z up and the customer/robot at local -Y.
export const isBagFixture = o => ['magazine', 'fixed_suction'].includes(o?.layout_component);
export const STACK_BASE = .006;
export const SUCTION_TOOL = {width: .08, height: .08, length: .10};

export function fixtureBag(o) {
  const p = o.bag_parameters || {};
  const scale = [o.width / .365, o.depth / .24, o.height / .304];
  return {
    width: (p.bag_width ?? .15) * scale[0],
    depth: (p.bag_depth ?? .09) * scale[1],
    height: (p.bag_height ?? .28) * scale[2],
    contactHeight: .206 * scale[2],
    flatDepth: (p.closed_gap ?? .004) * scale[1],
    floor: (p.bag_floor ?? .024) * scale[2],
  };
}

export function fixedContact(o) {
  const bag = fixtureBag(o);
  return [0, o.depth / 2 - .014 - SUCTION_TOOL.length, bag.floor + bag.contactHeight];
}

export function stackSettings(o) {
  const p = o.bag_stack || {};
  const bounded = (v, fallback, min, max) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  const thickness = bounded(p.bag_thickness, .004, .0002, .02);
  const capacity = Math.max(0, Math.floor((o.height - STACK_BASE - .002) / thickness));
  const count = Math.round(bounded(p.bag_count, Math.min(20, capacity), 0, capacity));
  return {
    bag_width: bounded(p.bag_width, .15, .08, 1),
    bag_height: bounded(p.bag_height, .28, .10, 1),
    bag_thickness: thickness, bag_count: count, capacity,
    top: STACK_BASE + count * thickness,
  };
}

export function migrateBagFixtures(scene, defaultLayout = false) {
  const fixture = scene.objects.find(o => o.id === (scene.bag_workflow?.fixture_id || 'bag_opener'));
  const bag = fixture ? fixtureBag(fixture) : {width: .15, height: .28, flatDepth: .004};
  for (const o of scene.objects) {
    if (!isBagFixture(o) || o.bag_fixture_revision >= 1) continue;
    if (o.layout_component === 'magazine') {
      o.bag_stack ||= {bag_width: bag.width, bag_height: bag.height, bag_thickness: bag.flatDepth, bag_count: 20};
      o.width = Math.max(o.width, o.bag_stack.bag_width + .024);
      o.depth = Math.max(o.depth, o.bag_stack.bag_height + .024);
      // Preserve custom heights; replace the original tall upright magazine.
      if (Math.abs(o.height - .325) < .00001) o.height = .13;
      // The old front-pick location is too far out for downward-facing pickup.
      // Bring only the factory layout inward; saved placements stay user-owned.
      if (defaultLayout && o.id === 'bag_magazine' && Math.abs(o.x - 1.9) < .00001 && Math.abs(o.y - 3.4) < .00001) {
        o.x = 1.8; o.y = 3.3;
      }
      if (/^Bag magazine/.test(o.label)) o.label = 'Bag stack holder / top pickup';
    } else if (o.label === 'Fixed suction + open bag') o.label = 'Fixed four-cup gripper + backplate';
    o.bag_fixture_revision = 1;
  }
}
