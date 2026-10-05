import {bounds, rotate} from './store.js';

export const resizeMode = options => options.resizeMode === 'center' ? 'center' : 'opposite';

// Anchor coordinates are local to the object: -/+ X = left/right,
// +Y = the top of its unrotated footprint in the plan.
export function resizeAnchor(options, axis) {
  if (resizeMode(options) === 'center') return [0, 0];
  return axis === 'width'
    ? [options.resizeAnchorX === 'right' ? 1 : -1, 0]
    : [0, options.resizeAnchorY === 'bottom' ? -1 : 1];
}

function anchorPoint(box, anchor) {
  const offset = rotate(anchor[0] * box.width / 2, anchor[1] * box.depth / 2, box.yaw_deg || 0);
  return [box.x + offset[0], box.y + offset[1]];
}

export function resizeAnchored(store, ids, width, depth, anchor = [0, 0]) {
  const items = store.resolve(ids);
  if (!items.length || items.some(item => store.locked(item.id))) return;
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return;
  const selectedIds = new Set(items.map(item => item.id));
  // Preserve only implicit mounted descendants. Explicitly selected items and
  // members of a selected area/group remain part of the resize operation.
  const childTransforms = store.options.resizeKeepChildren !== false
    ? store.resolve(ids, true).filter(item => !selectedIds.has(item.id)).map(item => ({item, original: {...item}}))
    : [];
  const one = ids.length === 1 && store.object(ids[0]);
  const before = one || bounds(items);
  const fixed = anchorPoint(before, anchor);
  width = Math.max(.02, width);
  depth = Math.max(.02, depth);
  if (one) store.resize(one.id, width, depth);
  else store.resizeGroup(ids, width / before.width, depth / before.depth);
  // Use the resulting dimensions: robots/circular dispensers constrain scaling,
  // and a group's rotated members may produce a different bounding rectangle.
  const after = one || bounds(store.resolve(ids));
  const moved = anchorPoint(after, anchor);
  store.move(ids, fixed[0] - moved[0], fixed[1] - moved[1]);
  // Restore after the anchor translation too: fixing an edge moves the parent's
  // centre, but must not move its mounted items when this option is enabled.
  for (const {item, original} of childTransforms) {
    for (const key of ['x', 'y', 'width', 'depth', 'diameter', 'robot_scale']) {
      if (key in original) item[key] = original[key];
      else delete item[key];
    }
  }
}

export function resizeDimension(store, ids, axis, value) {
  const one = ids.length === 1 && store.object(ids[0]);
  const box = one || bounds(store.resolve(ids));
  let width = axis === 'width' ? value : box.width;
  const depth = axis === 'depth' ? value : box.depth;
  if (axis === 'depth' && ['robot', 'dispenser'].includes(one?.kind)) {
    width = box.width * Math.max(.02, value) / box.depth;
  }
  resizeAnchored(store, ids, width, depth, resizeAnchor(store.options, axis));
}
