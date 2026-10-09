import * as THREE from 'three';
import {pastryType} from './pastries.js';
export {torusParts} from './pastries.js';

// Physics uses metres and seconds; viewer dimensions are centimetres.
export const STEP = 1 / 240;
let engine;
export async function physicsEngine() {
  engine ||= import('./physics/rapier.js').then(async R => {await R.init(); return R;}).catch(error => {engine = null; throw error;});
  return engine;
}
export function releaseRotation(settings) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(settings.tilt * Math.PI / 180, settings.yaw * Math.PI / 180, 0, 'YXZ'));
}
export function releasePose(bag, pastry, settings, geometry = pastryType(pastry).collisionGeometry(pastry)) {
  const rotation = releaseRotation(settings);
  const bottom = Math.min(...geometry.samples.map(point => point.clone().applyQuaternion(rotation).y));
  return {rotation, position: new THREE.Vector3(settings.x / 100, (bag.height + settings.height) / 100 - bottom, settings.z / 100)};
}
function transformedBounds(samples, {position, rotation}) {
  const box = new THREE.Box3();
  for (const point of samples) box.expandByPoint(point.clone().applyQuaternion(rotation).add(position));
  return box;
}
export class ReleaseBlockedError extends Error {
  constructor(name) {
    super('Release space is occupied by ' + name + '. Raise or offset this queued release, or reset the test.');
    this.name = 'ReleaseBlockedError';
  }
}

// Sleeping pastries remain dynamic and can be moved by later impacts.
export class PastryDropWorld {
  constructor(R, bag, settings) {
    this.R = R; this.bag = bag; this.settings = settings;
    this.world = new R.World({x: 0, y: -9.81, z: 0});
    this.events = new R.EventQueue(true);
    this.world.timestep = STEP;
    const parameters = this.world.integrationParameters;
    parameters.numSolverIterations = 8; parameters.maxCcdSubsteps = 4;
    parameters.normalizedAllowedLinearError = .00005;
    parameters.normalizedPredictionDistance = .0005;
    this.time = 0; this.quietTime = 0; this.lastReleaseTime = 0;
    this.done = true; this.timedOut = false;
    this.items = []; this.colliders = []; this.contactNames = new Map(); this.colliderOwners = new Map();
    const w = bag.width / 100, d = bag.depth / 100, h = bag.height / 100, t = .001;
    const fixed = (name, half, position) => {
      const descriptor = R.ColliderDesc.cuboid(...half).setTranslation(...position).setFriction(settings.friction).setRestitution(settings.bounce);
      const collider = this.world.createCollider(descriptor);
      this.colliders.push({name, collider}); this.contactNames.set(collider.handle, name);
    };
    fixed('Left wall', [t / 2, h / 2, d / 2 + t], [-w / 2 - t / 2, h / 2, 0]);
    fixed('Right wall', [t / 2, h / 2, d / 2 + t], [w / 2 + t / 2, h / 2, 0]);
    fixed('Front wall', [w / 2, h / 2, t / 2], [0, h / 2, d / 2 + t / 2]);
    fixed('Back wall', [w / 2, h / 2, t / 2], [0, h / 2, -d / 2 - t / 2]);
    fixed('Bag bottom', [w / 2, .001, d / 2], [0, -.00085, 0]);
    // Keep near-coplanar ground contacts outside the bag.
    const extent = 5;
    fixed('Ground', [(extent - w / 2) / 2, .01, extent], [-(extent + w / 2) / 2, -.01, 0]);
    fixed('Ground', [(extent - w / 2) / 2, .01, extent], [(extent + w / 2) / 2, -.01, 0]);
    fixed('Ground', [w / 2, .01, (extent - d / 2) / 2], [0, -.01, -(extent + d / 2) / 2]);
    fixed('Ground', [w / 2, .01, (extent - d / 2) / 2], [0, -.01, (extent + d / 2) / 2]);
  }
  addPastry(pastry, release, id) {
    if (this.items.some(item => item.id === id)) throw Error('Duplicate pastry instance ID.');
    const type = pastryType(pastry), geometry = type.collisionGeometry(pastry);
    const initial = releasePose(this.bag, pastry, release, geometry);
    const bounds = transformedBounds(geometry.samples, initial);
    // Conservative release guard: never spawn intersecting bodies.
    for (const item of this.items) if (bounds.intersectsBox(this.bounds(item))) throw new ReleaseBlockedError(item.name);
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic()
      .setTranslation(...initial.position.toArray()).setRotation(initial.rotation)
      .setLinearDamping(.04).setAngularDamping(.2).setCcdEnabled(true).setCanSleep(true));
    const item = {id, pastry, body, initial, samples: geometry.samples, colliders: [], contacts: new Set(), activeContacts: new Set(), quietTime: 0, name: '#' + (this.items.length + 1) + ' ' + pastry.name};
    try {
      const mass = type.massKg(pastry);
      for (const vertices of geometry.parts) {
        const descriptor = this.R.ColliderDesc.convexHull(vertices);
        if (!descriptor) throw Error('Could not build pastry collision geometry.');
        descriptor.setMass(mass / geometry.parts.length).setFriction(this.settings.friction).setRestitution(this.settings.bounce)
          .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
        const collider = this.world.createCollider(descriptor, body);
        item.colliders.push(collider); this.contactNames.set(collider.handle, item.name); this.colliderOwners.set(collider.handle, item);
      }
    } catch (error) {
      item.colliders.forEach(collider => {this.contactNames.delete(collider.handle); this.colliderOwners.delete(collider.handle);});
      this.world.removeRigidBody(body); throw error;
    }
    this.items.push(item);
    this.lastReleaseTime = this.time; this.quietTime = 0; this.done = false; this.timedOut = false;
    return item;
  }
  step() {
    if (this.done) return;
    this.world.step(this.events); this.time += STEP;
    // Contact start/stop events avoid walking hundreds of compound colliders
    // and their manifolds from JavaScript on every physics step.
    this.events.drainCollisionEvents((a, b, started) => {
      const pair = a < b ? a + ':' + b : b + ':' + a;
      for (const [handle, other] of [[a, b], [b, a]]) {
        const item = this.colliderOwners.get(handle);
        if (!item) continue;
        if (started) {
          item.activeContacts.add(pair);
          const name = this.contactNames.get(other);
          if (name && name !== item.name) item.contacts.add(name);
        } else item.activeContacts.delete(pair);
      }
    });
    let allQuiet = true;
    for (const item of this.items) {
      const touching = item.activeContacts.size > 0;
      const velocity = item.body.linvel(), angular = item.body.angvel();
      const slow = Math.hypot(velocity.x, velocity.y, velocity.z) < .006 && Math.hypot(angular.x, angular.y, angular.z) < .12;
      // Let each supported, stationary pastry sleep independently instead of
      // waiting for an entire pile to become quiet at once. It stays dynamic
      // and Rapier wakes it when a later impact needs it to move.
      item.quietTime = touching && slow ? item.quietTime + STEP : 0;
      if (item.quietTime >= .8) item.body.sleep();
      allQuiet &&= item.body.isSleeping() || (touching && slow);
    }
    this.quietTime = allQuiet ? this.quietTime + STEP : 0;
    if (this.quietTime >= .8 || this.items.every(item => item.body.isSleeping())) {
      this.done = true;
      this.items.forEach(item => item.body.sleep());
    } else if (this.time - this.lastReleaseTime >= 15) {
      this.done = true; this.timedOut = true;
    }
  }
  pose(item = this.items.at(-1)) {
    const p = item.body.translation(), q = item.body.rotation();
    return {position: new THREE.Vector3(p.x, p.y, p.z), rotation: new THREE.Quaternion(q.x, q.y, q.z, q.w)};
  }
  bounds(item = this.items.at(-1)) {return transformedBounds(item.samples, this.pose(item));}
  classify(item = this.items.at(-1)) {
    const b = this.bounds(item), w = this.bag.width / 200, d = this.bag.depth / 200, h = this.bag.height / 100, e = .001;
    const within = b.min.x >= -w - e && b.max.x <= w + e && b.min.z >= -d - e && b.max.z <= d + e;
    if (within && b.max.y <= h + e) return 'Settled inside bag';
    const overlaps = b.max.x > -w && b.min.x < w && b.max.z > -d && b.min.z < d;
    if (overlaps && b.min.y > h + e) return 'Resting above the opening';
    if (overlaps && b.max.y >= h - e && b.min.y >= h - .025) return 'Resting on the rim';
    if (overlaps && b.min.y < h && b.max.y > h) return 'Wedged in the opening';
    if (overlaps && b.min.y >= h) return 'Resting above the opening';
    return 'Settled outside bag';
  }
  reportItem(item) {
    const pose = this.pose(item), bounds = this.bounds(item);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.rotation);
    const settled = this.done && !this.timedOut || item.body.isSleeping();
    return {id: item.id, name: item.name, settled,
      outcome: settled ? this.classify(item) : this.timedOut ? 'Still moving after 15 s' : 'Falling / colliding',
      centerCm: pose.position.clone().multiplyScalar(100).toArray(), rotation: pose.rotation.toArray(),
      bottomCm: bounds.min.y * 100, tiltDegrees: Math.acos(Math.min(1, Math.abs(normal.y))) * 180 / Math.PI,
      contacts: [...item.contacts], boundsCm: {min: bounds.min.clone().multiplyScalar(100).toArray(), max: bounds.max.clone().multiplyScalar(100).toArray()}};
  }
  report() {
    const items = this.items.map(item => this.reportItem(item));
    return {...items.at(-1), time: this.time, done: this.done, timedOut: this.timedOut, items};
  }
  free() {this.events.free(); this.world.free();}
}

// Compatibility facade for earlier one-donut integrations.
export class DonutDrop extends PastryDropWorld {
  constructor(R, bag, donut, settings) {
    super(R, bag, settings);
    const item = this.addPastry(donut, settings, 'single');
    this.body = item.body; this.samples = item.samples;
    this.donutColliders = item.colliders; this.initial = item.initial;
  }
}
