import * as THREE from 'three';
import {PastryDropWorld, ReleaseBlockedError, physicsEngine, releasePose, STEP} from './drop-physics.js';
import {expandQueue} from './drop-queue.js';
import {pastryType} from './pastries.js';
import {dispose} from './models.js';

export class DropController {
  constructor(view, onStatus) {
    this.view = view; this.onStatus = onStatus;
    this.generation = 0; this.playing = false; this.tracks = new Map();
    view.onTick = seconds => this.tick(seconds);
  }
  sync(state) {
    this.state = state;
    this.bag = state.objects.find(object => object.id === state.bag);
    this.queue = expandQueue(state.dropQueue);
    const signature = state.mode === 'drop' && this.bag
      ? JSON.stringify([this.bag.id, this.bag.width, this.bag.depth, this.bag.height, state.drop.friction, state.drop.bounce]) : null;
    const emitted = this.queue.slice(0, this.world?.items.length || 0);
    const changed = signature !== this.signature || this.emittedSignature && JSON.stringify(emitted) !== this.emittedSignature;
    this.signature = signature;
    if (changed) this.reset();
    this.rebuildTrails(); this.applyPose(); this.status();
  }
  reset() {
    this.generation++; this.world?.free(); this.world = null;
    this.playing = false; this.loading = false; this.auto = false;
    this.accumulator = 0; this.clock = 0; this.lastRelease = 0;
    this.message = ''; this.blocked = false; this.nextAttempt = 0;
    this.emittedSignature = null;
    for (const track of this.tracks.values()) if (track.line) {track.line.removeFromParent(); dispose(track.line);}
    this.tracks.clear(); this.lastStatus = 0; this.slowFrames = 0;
    for (const [key, root] of this.view.records) if (key.startsWith('drop:')) {
      root.removeFromParent(); dispose(root); this.view.records.delete(key);
    }
    this.rebuildTrails(); this.applyPose(); this.status();
  }
  get released() {return this.world?.items.length || 0;}
  get pending() {return this.queue?.length > this.released;}
  get complete() {return !!this.world?.done && !this.pending;}
  async prepare() {
    if (this.world) return true;
    if (!this.signature || !this.pending || this.loading) return false;
    const generation = this.generation;
    this.loading = true; this.status();
    try {
      const R = await physicsEngine();
      if (generation !== this.generation) return false;
      this.world = new PastryDropWorld(R, this.bag, this.state.drop);
      this.loading = false; return true;
    } catch (error) {
      if (generation === this.generation) {this.loading = false; this.message = error.message; this.status();}
      return false;
    }
  }
  releaseNext() {
    const entry = this.queue[this.released];
    if (!entry) return false;
    try {
      const item = this.world.addPastry(entry.pastry, entry.release, entry.id);
      this.tracks.set(item.id, {points: [], lastTime: -1, dirty: true});
      this.lastRelease = this.clock;
      this.emittedSignature = JSON.stringify(this.queue.slice(0, this.released));
      this.blocked = false; this.message = '';
      this.applyPose(); return true;
    } catch (error) {
      this.message = error.message; this.blocked = error instanceof ReleaseBlockedError;
      this.nextAttempt = this.clock + .1;
      if (!this.blocked || this.world.done) this.playing = false;
      return false;
    }
  }
  async play() {
    if (this.playing) {this.playing = false; this.status(); return;}
    if (this.loading) return;
    if (this.complete || this.world?.timedOut) this.reset();
    if (!await this.prepare()) return;
    this.auto = true; this.playing = true; this.accumulator = 0;
    if (!this.released || this.world.done && this.pending) this.releaseNext();
    this.status();
  }
  async next() {
    if (this.loading || !this.pending || !await this.prepare()) return;
    this.auto = false;
    if (this.releaseNext()) {this.playing = true; this.accumulator = 0;}
    this.status();
  }
  meshFor(key, pastry, preview = false) {
    let root = this.view.records.get(key);
    if (!root) {
      root = new THREE.Group(); root.name = pastry.name;
      root.userData = {pastry: structuredClone(pastry), instanceId: key, preview};
      root.add(pastryType(pastry).makeVisual(pastry));
      if (preview) root.traverse(node => {
        if (node.material) {node.material.transparent = true; node.material.opacity = .3; node.material.depthWrite = false;}
        node.castShadow = false;
      });
      (preview ? this.view.guides : this.view.physical).add(root);
      this.view.records.set(key, root);
    }
    return root;
  }
  applyPose() {
    const next = this.signature ? this.queue[this.released] : null;
    const previewSignature = next ? JSON.stringify(next) : null;
    const preview = this.view.records.get('drop:preview');
    if (preview && preview.userData.signature !== previewSignature) {preview.removeFromParent(); dispose(preview); this.view.records.delete('drop:preview');}
    if (!this.signature) return;
    for (const item of this.world?.items || []) {
      const root = this.meshFor('drop:' + item.id, item.pastry), pose = this.world.pose(item);
      root.name = item.name;
      root.position.copy(pose.position).multiplyScalar(100); root.quaternion.copy(pose.rotation);
      root.updateMatrixWorld(true);
    }
    if (next && !this.view.records.has('drop:preview')) {
      const root = this.meshFor('drop:preview', next.pastry, true), pose = releasePose(this.bag, next.pastry, next.release);
      root.userData.signature = previewSignature;
      root.name = 'Next release preview';
      root.position.copy(pose.position).multiplyScalar(100); root.quaternion.copy(pose.rotation);
      root.updateMatrixWorld(true);
    }
  }
  rebuildTrails() {
    for (const track of this.tracks.values()) {
      if (track.line) {track.line.removeFromParent(); dispose(track.line);}
      track.line = null;
      track.dirty = true;
    }
    if (this.signature) this.drawTrails();
  }
  drawTrails() {
    for (const [id, track] of this.tracks) {
      if (!track.line) {
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(1500), 3));
        geometry.setDrawRange(0, 0);
        track.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({color: '#298977', transparent: true, opacity: .28, depthTest: false}));
        track.line.name = 'Pastry trajectory ' + id; this.view.guides.add(track.line);
      }
      if (!track.dirty) continue;
      const attribute = track.line.geometry.attributes.position;
      track.points.forEach((point, index) => attribute.setXYZ(index, point.x * 100, point.y * 100, point.z * 100));
      attribute.needsUpdate = true; track.line.geometry.setDrawRange(0, track.points.length); track.line.geometry.computeBoundingSphere();
      track.dirty = false;
    }
  }
  tick(seconds) {
    if (!this.playing || !this.world) return;
    // Bound catch-up work so an expensive pile cannot stall orbit, pause or
    // input handling. Under overload, slow simulation time instead of taking
    // progressively longer animation frames or using an unstable large step.
    const started = performance.now(), maxSteps = 8, budgetMs = 6;
    const requested = this.accumulator + Math.min(seconds, .1) * this.state.drop.speed;
    this.accumulator = Math.min(requested, maxSteps * STEP);
    let steps = 0;
    while (this.accumulator >= STEP && this.playing && steps < maxSteps && (steps === 0 || performance.now() - started < budgetMs)) {
      steps++;
      this.accumulator -= STEP; this.clock += STEP;
      this.world.step();
      if (this.world.timedOut) {this.playing = false; this.message = 'Some pastries are still moving after 15 s. Reset to retry with different settings.'; break;}
      const due = this.state.drop.cadence === 'settled' ? this.world.done : this.clock - this.lastRelease >= this.state.drop.interval;
      if (this.auto && this.pending && due && this.clock >= this.nextAttempt) this.releaseNext();
      if (this.world.done && (!this.auto || !this.pending)) this.playing = false;
    }
    const limited = this.accumulator >= STEP || requested > maxSteps * STEP;
    if (limited) this.accumulator %= STEP;
    this.slowFrames = limited ? Math.min(20, this.slowFrames + 1) : Math.max(0, this.slowFrames - 1);
    this.frameStats = {steps, physicsMs: performance.now() - started, limited};
    this.applyPose();
    for (const item of this.world.items) {
      const track = this.tracks.get(item.id);
      if (this.clock - track.lastTime >= 1 / 30 && track.points.length < 500) {
        const position = this.world.pose(item).position;
        if (!track.points.length || position.distanceToSquared(track.points.at(-1)) > 1e-8) {
          track.points.push(position); track.dirty = true;
        }
        track.lastTime = this.clock;
      }
    }
    this.drawTrails();
    if (!this.playing || this.clock - this.lastStatus >= .1) {this.lastStatus = this.clock; this.status();}
  }
  status() {
    const status = !this.signature || !this.queue?.length ? 'unavailable'
      : this.loading ? 'loading' : this.playing ? 'running'
      : this.blocked ? 'blocked' : this.complete ? 'done'
      : this.world ? 'paused' : 'ready';
    this.onStatus({status, ...this.report(), released: this.released, total: this.queue?.length || 0, message: this.message, pending: this.pending, slowPlayback: this.playing && this.slowFrames > 4});
  }
  report() {
    return this.world ? {...this.world.report(), time: this.clock, done: this.complete, released: this.released, total: this.queue.length} : null;
  }
}
