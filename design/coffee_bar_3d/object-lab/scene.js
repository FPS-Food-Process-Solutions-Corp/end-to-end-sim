import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {RoomEnvironment} from '../vendor/RoomEnvironment.js';
import {GLTFExporter} from '../vendor/GLTFExporter.js';
import {dimensions} from './catalog.js';
import {makeObject, dispose} from './models.js';

export class ObjectScene {
  constructor(canvas, labels, onSelect, onMove) {
    Object.assign(this, {canvas, labels, onSelect, onMove, labels3d: [], records: new Map(), moveMode: false, cameraMode: 'iso'});
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#e9eeea');
    this.camera = new THREE.OrthographicCamera(-65, 65, 45, -45, .1, 4000);
    this.camera.position.set(35, 85, 135);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true;
    this.controls.target.set(0, 10, 0); this.controls.minZoom = .1; this.controls.maxZoom = 60;
    this.controls.maxPolarAngle = Math.PI * .49; this.controls.update();
    const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, .04).texture; this.scene.environmentIntensity = .35;
    environment.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#eef9ff', '#bdac88', 2.1));
    const key = new THREE.DirectionalLight('#fff4dc', 3); key.position.set(-60, 150, 75); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, {left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 400});
    key.shadow.normalBias = .12; key.shadow.bias = -.00005; this.scene.add(key);
    const fill = new THREE.DirectionalLight('#dbeaff', .65); fill.position.set(80, 80, -100); this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({color: '#e8ede5', roughness: 1}));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.06; floor.receiveShadow = true; this.scene.add(floor);
    const major = new THREE.GridHelper(1000, 100, '#b6c7b8', '#cbd6c9'); major.position.y = -.035; major.material.transparent = true; major.material.opacity = .45; this.scene.add(major);
    const minor = new THREE.GridHelper(200, 200, '#c9d5c9', '#c9d5c9'); minor.position.y = -.04; minor.material.transparent = true; minor.material.opacity = .12; this.scene.add(minor);
    this.physical = new THREE.Group(); this.physical.name = 'Object size comparison'; this.scene.add(this.physical);
    this.guides = new THREE.Group(); this.scene.add(this.guides);
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    canvas.addEventListener('pointerdown', e => this.down(e), true);
    window.addEventListener('pointermove', e => this.move(e)); window.addEventListener('pointerup', e => this.up(e));
    this.controls.addEventListener('start', () => {this.cameraMode = 'free';});
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize(); this.animate();
  }
  format(v) {return (v * (this.state?.unit === 'mm' ? 10 : 1)).toLocaleString('en', {maximumFractionDigits: 1}) + ' ' + (this.state?.unit || 'cm');}
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect(); this.renderer.setSize(r.width, r.height, false);
    const half = 45, aspect = r.width / Math.max(1, r.height);
    this.camera.left = -half * aspect; this.camera.right = half * aspect; this.camera.top = half; this.camera.bottom = -half; this.camera.updateProjectionMatrix();
  }
  update(state) {
    this.state = state;
    dispose(this.physical); this.physical.clear(); this.records.clear();
    dispose(this.guides); this.guides.clear(); this.labels.replaceChildren(); this.labels3d = [];
    const pair = state.mode !== 'compare';
    const chosen = state.mode === 'drop' ? state.objects.filter(o => o.id === state.bag)
      : pair ? state.objects.filter(o => o.id === state.bag || o.id === state.donut) : state.objects.filter(o => o.visible);
    for (const o of chosen) {
      const root = makeObject(o, state.xray || pair);
      root.position.set(pair ? 0 : o.x, state.mode === 'fit' && o.kind === 'donut' ? state.allowance : 0, pair ? 0 : o.z);
      root.rotation.y = pair ? 0 : o.yaw * Math.PI / 180;
      this.physical.add(root); this.records.set(o.id, root);
      const d = dimensions(o);
      if (state.labels && state.mode === 'compare' && o.id !== state.selected) {
        const f = state.unit === 'mm' ? 10 : 1;
        this.label([0, .3, d.depth / 2 + 3.3], root, o.name, o.kind === 'donut' ? 'Ø ' + this.format(o.diameter) : `${o.width*f} × ${o.depth*f} × ${o.height*f} ${state.unit}`);
      }
      if (o.id === state.selected && state.mode === 'compare' || pair && o.kind === 'bag') {
        this.outline(o, root);
        if (state.dimensions) this.dimensionGuides(o, root);
      }
    }
    document.getElementById('empty-state').hidden = chosen.length > 0;
    this.physical.updateMatrixWorld(true);
    this.render();
  }
  label(point, root, text, sub = '', dimension = false) {
    const el = document.createElement('div'); el.className = dimension ? 'dimension-label' : 'object-label';
    const strong = document.createElement('strong'); strong.textContent = text; el.append(strong);
    if (sub) {const small = document.createElement('small'); small.textContent = sub; el.append(small);}
    this.labels.append(el); this.labels3d.push({el, point: new THREE.Vector3(...point), root});
  }
  outline(o, root) {
    const d = dimensions(o), box = new THREE.BoxGeometry(d.width + .06, d.height + .06, d.depth + .06);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({color: '#388979', transparent: true, opacity: .55}));
    box.dispose(); edge.position.y = d.height / 2;
    const group = new THREE.Group(); group.userData.objectId = o.id; group.position.copy(root.position); group.quaternion.copy(root.quaternion); group.add(edge); this.guides.add(group);
  }
  dimensionGuides(o, root) {
    const {width: w, depth: d, height: h} = dimensions(o), group = new THREE.Group();
    group.userData.objectId = o.id; group.position.copy(root.position); group.quaternion.copy(root.quaternion); this.guides.add(group);
    const color = '#257564', material = new THREE.LineBasicMaterial({color, depthTest: false, transparent: true, opacity: .8});
    const line = (a, b) => {const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), material); l.renderOrder = 5; group.add(l);};
    const arrow = (a, b, text, at) => {
      line(a, b);
      const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), direction = bv.clone().sub(av).normalize();
      const size = Math.min(.65, av.distanceTo(bv) / 8);
      for (const [pos, dir] of [[av, direction], [bv, direction.clone().negate()]]) {
        const head = new THREE.Mesh(new THREE.ConeGeometry(size * .35, size, 10), new THREE.MeshBasicMaterial({color, depthTest: false}));
        head.position.copy(pos).addScaledVector(dir, size / 2); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()); head.renderOrder = 6; group.add(head);
      }
      this.label(at, group, text, '', true);
    };
    const z = d / 2 + 3, x = w / 2 + 3;
    line([-w/2, .2, d/2], [-w/2, .2, z+1]); line([w/2, .2, d/2], [w/2, .2, z+1]);
    arrow([-w/2, .2, z], [w/2, .2, z], (o.kind === 'donut' ? 'Ø ' : '') + this.format(w), [0, .2, z+1.5]);
    line([w/2, .2, -d/2], [x+1, .2, -d/2]); line([w/2, .2, d/2], [x+1, .2, d/2]);
    arrow([x, .2, -d/2], [x, .2, d/2], this.format(d), [x+2, .2, 0]);
    line([-w/2, 0, d/2], [-w/2-4, 0, d/2]); line([-w/2, h, d/2], [-w/2-4, h, d/2]);
    arrow([-w/2-3, 0, d/2], [-w/2-3, h, d/2], this.format(h), [-w/2-4.3, h/2, d/2]);
  }
  bounds(selectedOnly = false) {
    const box = new THREE.Box3();
    for (const [id, root] of this.records) if (!selectedOnly || id === this.state.selected) box.expandByObject(root);
    if (box.isEmpty()) box.set(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 25, 20));
    return box;
  }
  frame(mode = this.cameraMode, selectedOnly = false) {
    const box = this.bounds(selectedOnly).expandByScalar(4.5), center = box.getCenter(new THREE.Vector3());
    const direction = {iso: [0.26, .65, 1], front: [0, .001, 1], top: [0, 1, .001], side: [1, .001, 0]}[mode]
      || this.camera.position.clone().sub(this.controls.target).normalize().toArray();
    this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(...direction).normalize().multiplyScalar(350));
    this.camera.up.set(0, 1, 0); this.camera.lookAt(center); this.camera.zoom = 1; this.camera.updateMatrixWorld();
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
    }
    this.camera.zoom = Math.min((this.camera.right-this.camera.left)/Math.max(xmax-xmin, 1), (this.camera.top-this.camera.bottom)/Math.max(ymax-ymin, 1)) * .77;
    this.camera.updateProjectionMatrix(); this.controls.update(); this.cameraMode = mode; this.render();
  }
  rayAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.set((e.clientX-rect.left)/rect.width*2-1, -(e.clientY-rect.top)/rect.height*2+1); this.ray.setFromCamera(this.mouse, this.camera);
  }
  hit(e) {
    this.rayAt(e); let hit = this.ray.intersectObjects(this.physical.children, true)[0]?.object;
    while (hit && !hit.userData.objectId) hit = hit.parent;
    return hit?.userData.objectId;
  }
  down(e) {
    if (e.button !== 0) return;
    this.start = {x: e.clientX, y: e.clientY, id: this.hit(e)};
    if (this.moveMode && this.state.mode === 'compare' && this.start.id) {
      this.controls.enabled = false;
      const hit = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
      if (hit) this.drag = {id: this.start.id, offset: this.records.get(this.start.id).position.clone().sub(hit)};
      e.stopImmediatePropagation(); this.canvas.setPointerCapture(e.pointerId);
    }
  }
  move(e) {
    if (!this.drag) return;
    this.rayAt(e); const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return;
    p.add(this.drag.offset); p.x = Math.max(-500, Math.min(500, p.x)); p.z = Math.max(-500, Math.min(500, p.z));
    const root = this.records.get(this.drag.id); if (!root) return;
    root.position.set(p.x, 0, p.z);
    for (const guide of this.guides.children) if (guide.userData.objectId === this.drag.id) guide.position.copy(root.position);
    this.render();
  }
  up(e) {
    if (!this.start) return;
    const distance = Math.hypot(e.clientX-this.start.x, e.clientY-this.start.y);
    if (this.drag) {
      const id = this.drag.id, p = this.records.get(id).position;
      if (distance > 3) this.onMove(id, Math.round(p.x * 10)/10, Math.round(p.z * 10)/10);
      else this.onSelect(id);
      this.drag = null; this.controls.enabled = true;
    } else if (distance < 4 && this.start.id) this.onSelect(this.start.id);
    this.start = null;
  }
  render() {
    this.renderer.render(this.scene, this.camera);
    const r = this.canvas.getBoundingClientRect();
    for (const label of this.labels3d) {
      const p = label.root.localToWorld(label.point.clone()).project(this.camera);
      const x = (p.x+1)*r.width/2, y = (1-p.y)*r.height/2;
      label.el.hidden = Math.abs(p.z)>1 || x<20 || x>r.width-20 || y<28 || y>r.height-60;
      label.el.style.left = x+'px'; label.el.style.top = y+'px';
    }
  }
  animate() {
    requestAnimationFrame(() => this.animate());
    const now=performance.now(), elapsed=this.lastTick?(now-this.lastTick)/1000:0;this.lastTick=now;
    this.onTick?.(elapsed);this.controls.update();this.render();
  }
  async exportGLB() {
    const root = this.physical.clone(true); root.scale.multiplyScalar(.01);
    root.userData = {units: 'metres', source_dimensions: 'centimetres', workspace: 'Object size lab'};
    return new GLTFExporter().parseAsync(root, {binary: true, onlyVisible: true});
  }
  async exportPNG() {
    this.render();
    const canvas = document.createElement('canvas'); canvas.width = this.canvas.width; canvas.height = this.canvas.height;
    const ctx = canvas.getContext('2d'), ratio = canvas.width / this.canvas.clientWidth;
    ctx.drawImage(this.canvas, 0, 0); ctx.scale(ratio, ratio); ctx.textAlign = 'center';
    for (const {el} of this.labels3d) if (!el.hidden) {
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top), lines = [...el.children].map(n => n.textContent);
      ctx.font = '12px Segoe UI';
      const w = Math.max(...lines.map(t => ctx.measureText(t).width))+14;
      ctx.fillStyle = '#fbfdf5ee'; ctx.fillRect(x-w/2, y-10, w, lines.length*15+5);
      ctx.fillStyle = '#376a5e'; lines.forEach((text, i) => ctx.fillText(text, x, y+3+i*15));
    }
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
}
