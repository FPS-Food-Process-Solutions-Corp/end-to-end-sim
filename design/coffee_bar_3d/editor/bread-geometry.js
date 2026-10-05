import {Vector3, Quaternion, Matrix4} from '../vendor/three.module.js';
import {rotate} from './store.js';

export const BREAD_DEFAULTS = {
  bread_mode: 'magic', bread_robot_id: 'nova5', bread_shelf_id: 'nearest',
  bread_pick_method: 'aim', bread_approach: .16, bread_lift: .14,
  bread_parallel: false,
  bread_grasp: 'sides', bread_pre_pick_mode: 'offset',
  bread_pre_pick_x: 0, bread_pre_pick_y: -.16, bread_pre_pick_z: .02,
};
const Z = new Vector3(0, 0, 1);

export function resolveBreadShelf(store, settings) {
  if (settings.bread_shelf_id !== 'nearest') return store.object(settings.bread_shelf_id);
  const robot = store.object(settings.bread_robot_id);
  return store.scene.objects.filter(o => o.kind === 'shelf' && store.visible(o.id))
    .sort((a, b) => Math.hypot(a.x-(robot?.x||0), a.y-(robot?.y||0)) -
      Math.hypot(b.x-(robot?.x||0), b.y-(robot?.y||0)))[0];
}

// Exactly matches the generated tilted tier meshes, including their bottom-edge datum.
export function rackBreads(store, shelf, robot, settings = BREAD_DEFAULTS) {
  const layout = store.shelfLayout(shelf), s = layout.settings;
  if (!s.show_buns || !s.tiers) return [];
  const c = Math.cos(layout.slope), n = Math.sin(layout.slope);
  const yaw = (shelf.yaw_deg || 0) * Math.PI / 180;
  const rotation = new Quaternion().setFromAxisAngle(Z, yaw)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), layout.slope));
  const width = new Vector3(1,0,0).applyQuaternion(rotation);
  const candidates = [];
  for (let tier = 0; tier < s.tiers; tier++) for (const bun of layout.bread.filter(b => b.row === 0)) {
    const offset = rotate(bun.x, bun.y*c-bun.z*n, shelf.yaw_deg||0);
    const position = [shelf.x+offset[0], shelf.y+offset[1],
      store.z(shelf)+s.first_tier_front_height+tier*s.tier_spacing+s.back_to_front_drop/2+
      s.sheet_thickness*c+bun.y*n+bun.z*c];
    let prePosition;
    if(settings.bread_pre_pick_mode==='fixed'){
      const local=rotate(settings.bread_pre_pick_x,settings.bread_pre_pick_y,shelf.yaw_deg||0);
      prePosition=[shelf.x+local[0],shelf.y+local[1],store.z(shelf)+settings.bread_pre_pick_z];
    } else {
      const offset=rotate(settings.bread_pre_pick_x,-settings.bread_approach,shelf.yaw_deg||0);
      prePosition=[position[0]+offset[0],position[1]+offset[1],position[2]+settings.bread_pre_pick_z];
    }
    const approach=new Vector3(...position).sub(new Vector3(...prePosition)).normalize();
    const closeAxis=(settings.bread_grasp==='top_bottom'?new Vector3(0,0,1).applyQuaternion(rotation):width).clone();
    closeAxis.addScaledVector(approach,-closeAxis.dot(approach));
    if(closeAxis.length()<.1||new Vector3(...position).distanceTo(new Vector3(...prePosition))<.01)continue;
    closeAxis.normalize();
    const pickRotation=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(closeAxis,approach.clone().cross(closeAxis),approach));
    const relative=pickRotation.clone().invert().multiply(rotation);
    candidates.push({prePosition, relative:relative.toArray(),tier:tier+1, column:bun.column+1, row:bun.row+1, position,
      quaternion:rotation.toArray(), toolQuaternion:pickRotation.toArray(),
      distance:Math.hypot(position[0]-robot.x,position[1]-robot.y,position[2]-store.z(robot))});
  }
  return candidates.sort((a,b) => a.distance-b.distance);
}

export function makeBreadRequest(store, settings, opened, bag, openDepth) {
  if (settings.bread_mode !== 'nova') return null;
  settings={...BREAD_DEFAULTS,...settings};
  if(!['sides','top_bottom'].includes(settings.bread_grasp)||!['offset','fixed'].includes(settings.bread_pre_pick_mode))throw new Error('Choose a valid bread grasp and pre-pick mode.');
  for(const key of ['bread_pre_pick_x','bread_pre_pick_y','bread_pre_pick_z'])if(!Number.isFinite(settings[key]))throw new Error('Pre-pick coordinates must be finite.');
  const robot = store.object(settings.bread_robot_id);
  const shelf = resolveBreadShelf(store, settings);
  if (!robot || store.key(robot) !== 'nova5') throw new Error('Choose a bread Nova-5 with Lebai tongs.');
  if (!shelf || shelf.kind !== 'shelf') throw new Error('Choose a bread rack.');
  for (const o of [robot,shelf]) if (!store.visible(o.id)) throw new Error(o.label+' is hidden.');
  if (!['aim','direct'].includes(settings.bread_pick_method)) throw new Error('Choose a bread pickup method.');
  for (const key of ['bread_approach','bread_lift']) if (!Number.isFinite(settings[key]) || settings[key] <= 0) throw new Error('Bread approach and lift must be positive distances.');
  const candidates = rackBreads(store,shelf,robot,settings);
  if (!candidates.length) throw new Error('No visible bread or valid pre-pick target is available. Enable bread on the rack and keep the pre-pick point at least 1 cm away from a bun, in front of its gripping faces.');
  const s = store.shelfSettings(shelf);
  const bagRotation = new Quaternion(...opened.quaternion)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0), Math.PI/2));
  const forward = Z.clone().applyQuaternion(new Quaternion(...opened.quaternion));
  const bottom = new Vector3(...opened.position).addScaledVector(forward,openDepth/2);
  bottom.z -= bag.contactHeight;
  const down = bagRotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI));
  // Picking along the tier and turning the jaws down places the bun vertically:
  // width is length 1; the mouth depth is the bun thickness, not length 2.
  const heldRotation = down.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2));
  const size = [s.bread_length_1,s.bread_length_2,s.bread_height];
  const fits = size[0] <= bag.width-.004 && size[2] <= openDepth-.004 && size[1] <= bag.height-.004;
  for(const candidate of candidates)candidate.releaseQuaternion=heldRotation.clone().multiply(new Quaternion(...candidate.relative).invert()).toArray();
  return {grasp:settings.bread_grasp,graspWidth:settings.bread_grasp==='sides'?size[0]:size[2],prePickMode:settings.bread_pre_pick_mode,
    robot, mountingHeight:store.z(robot), shelfId:shelf.id, shelfLabel:shelf.label,
    candidates, size, method:settings.bread_pick_method,
    approach:settings.bread_approach, lift:settings.bread_lift,
    bagBottom:bottom.toArray(), bagQuaternion:bagRotation.toArray(),
    releaseQuaternion:down.clone().multiply(new Quaternion().setFromAxisAngle(Z,-Math.PI/2)).toArray(), heldQuaternion:heldRotation.toArray(),
    releasePosition:[bottom.x,bottom.y,bottom.z+bag.height-size[1]/2-.012],
    restingPosition:[bottom.x,bottom.y,bottom.z+size[1]/2+.002],
    fits, opening:[bag.width,openDepth], bagHeight:bag.height};
}
