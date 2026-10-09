import {FlowVideo} from './flow-video.js';
import {beginValidation, recordValidation} from './handoff-validation.js';
import {attachCollisions} from './collision-scene.js';
import {packingCollisionMarkup,pairCollisionMarkup} from './collision-ui.js';
import {collisionText} from './collision-core.js';
import {breadControls,handleBreadPoseAction} from './bread-ui.js';
import * as THREE from '../vendor/three.module.js';
import {FLOW_DEFAULTS, makeWorkflowRequest} from './flow-geometry.js';
import {FlowPlayer} from './flow-player.js';
import {packingDiagnostic} from './failure-preview.js';
import {failureMarkup} from './flow-diagnostics.js';
import {motionControls, motionSummary} from './bag-motion-ui.js';
import {placementAssessment, placementMarkup, SUPPORT_KINDS} from './placement-validation.js';
import {corners} from './store.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

export class BagWorkflow {
  constructor(store, plan, view, panel, toast) {
    this.store = store;
    this.plan = plan;
    this.view = view;
    this.panel = panel;
    this.toast = toast;
    this.result = null;
    this.request = null;
    this.message = 'Ready to check the packing sequence';
    this.runId = 0;
    this.active = false;
    this.guideGroup = new THREE.Group();
    this.guideGroup.name = 'Bag workflow IK targets';
    view.scene.add(this.guideGroup);
    this.player = new FlowPlayer(store, view, (time, state) => this.updatePlayback(time, state));
    this.video = new FlowVideo(this,'bag');
    panel.addEventListener('click', event => this.click(event));
    panel.addEventListener('change', event => this.change(event));
    panel.addEventListener('input', event => {
      if (event.target.id === 'flow-scrub') {
        this.player.playing = false;
        if(this.result?.pathOK)this.player.seek(Number(event.target.value));
        else this.player.seekDiagnostic(Number(event.target.value));
      }
    });
    store.on(type => {
      if (['selection', 'option', 'workflow', 'camera'].includes(type)) return;
      this.invalidate(type !== 'preview');
    });
    this.render();
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.video.stop('Workflow changed');
      this.guideGroup.visible = false;
      this.store.workflowOverlay = null;
      this.store.placementOverlay = null;
      this.store.emit('workflow');
      return;
    }
    this.drawGuides();
    this.video.mount();
  }

  settings() {
    return {...FLOW_DEFAULTS, ...this.store.scene.bag_workflow};
  }

  start() {
    this.check();
  }

  invalidate(schedule = true) {
    clearTimeout(this.timer);
    this.runId++;
    this.worker?.terminate();
    this.worker = null;
    this.player.stop();
    this.result = null;
    this.message = 'Layout changed — check again';
    // Layout diagnostics must follow edits even with automatic IK disabled.
    try {
      this.request = makeWorkflowRequest(this.store);
    } catch (error) {
      this.request = null;
      this.message = error.message;
    }
    this.drawGuides();
    if (schedule) {
      this.render();
      if (this.settings().auto_check && !this.suspended) this.timer = setTimeout(() => this.check(), 450);
    }
  }

  check() {
    this.video.stop('Route rechecked');
    clearTimeout(this.timer);
    if (!this.view.ready || this.suspended) return;
    this.worker?.terminate();
    this.player.stop();
    this.result = null;
    const id = ++this.runId;
    const validationContext = beginValidation(this.store);
    try {
      this.request = makeWorkflowRequest(this.store);
    } catch (error) {
      this.request = null;
      this.message = error.message;
      this.drawGuides();
      this.render();
      return;
    }
    try { attachCollisions(this.view, this.request); } catch (error) { this.message=error.message;this.render();return; }
    this.message = 'Checking joint limits, tool orientation and selected collision policy…';
    this.render();
    this.worker = new Worker(new URL('./ik-worker.js', import.meta.url), {type: 'module'});
    this.worker.onmessage = event => {
      if (event.data.id !== this.runId) return;
      if (event.data.progress) {
        const progress = event.data.progress;
        this.setStatus(progress.phase === 'nova-pair-recovery'
          ? 'Searching a detour around the bread Nova-5 · attempt '+(progress.completed+1)
          : progress.phase === 'nova-pair'
          ? 'Checking Nova-5 ↔ Nova-5 motion '+progress.completed+' / '+progress.total
          : progress.phase === 'bread'
          ? 'Checking bread pickup routes ' + (progress.completed + 1) + ' / ' + progress.total
          : progress.phase === 'routes'
          ? 'Searching upright routes ' + (progress.completed + 1) + ' / ' + progress.total
          : progress.phase === 'path'
          ? 'Checking transfer path ' + progress.completed + ' / ' + progress.total
          : 'Checking contact pose ' + progress.completed + ' / ' + progress.total);
        return;
      }
      if (event.data.error) {
        this.message = event.data.error;
      } else {
        this.result = event.data.result;
        recordValidation(this.store, validationContext, 'bag', this.request, this.result);
        this.player.configure(this.request, this.result);
        const endpointsOK = this.result.endpoints.every(target => target.ok);
        this.message = this.request.errors.length ? 'Adjust the highlighted layout issues'
          : this.result.pathOK && this.result.bread ? 'Both robot paths found — bag opens, bread loads, filled bag is placed'
          : this.result.pathOK ? this.result.motion?.preferJ1
            ? 'Upright J1-sweep path found for the full sequence'
            : 'Upright IK path found for the full sequence'
          : this.result.bread?.errors?.length ? this.result.bread.errors[0]
          : this.result.bread && !this.result.bread.pathOK ? (collisionText(this.result.bread.failure)||'Bread Nova path failed — see the bread phase and target below')
          : ['world_collision','robot_collision'].includes(this.result.failure?.reason) ? collisionText(this.result.failure)
          : this.result.failure?.reason === 'bag_tilt_exceeded' ? 'Tested routes exceed the bag tilt constraint'
          : this.result.failure?.reason === 'j1_share_too_low' ? 'Tested sweeps do not meet the J1 motion requirement'
          : endpointsOK ? this.result.failure?.reason === 'joint_step_exceeded'
            ? 'Contact poses pass; path exceeds the joint-step guard'
            : 'Contact poses pass; IK failed along the connecting path'
          : 'No IK solution found for some contact poses';
      }
      this.worker.terminate();
      this.worker = null;
      this.drawGuides();
      this.render();
    };
    this.worker.onerror = event => {
      if (id !== this.runId) return;
      this.message = 'IK check failed: ' + event.message;
      this.worker?.terminate();
      this.worker = null;
      this.render();
    };
    this.worker.postMessage({id, request: this.request});
  }

  setStatus(text) {
    const status = this.panel.querySelector('#flow-status');
    if (status) status.textContent = text;
  }

  render() {
    const settings = this.settings();
    const objects = this.store.scene.objects;
    const selector = (key, label, filter) =>
      '<label class="flow-field">' + label + '<select data-flow-setting="' + key + '">' +
      objects.filter(filter).map(object => '<option value="' + escape(object.id) + '" ' +
        (object.id === settings[key] ? 'selected' : '') + '>' + escape(object.label) + '</option>').join('') +
      '</select></label>';
    const number = (key, label, value, minimum = 0) =>
      '<label class="flow-field">' + label + '<div class="flow-number"><input type="number" min="' +
      minimum + '" step=".1" data-flow-setting="' + key + '" value="' +
      Number((value * 100).toFixed(2)) + '"><span>cm</span></div></label>';
    const table = this.store.object(settings.shared_table_id);
    const canPlay = this.result?.pathOK && !this.request?.errors.length;
    const diagnostic=packingDiagnostic(this.request,this.result);
    const placementZone = this.store.object(settings.placement_zone_id);
    const previewReason = canPlay ? '' : this.request?.errors.length
      ? 'Full preview unavailable: ' + this.request.errors[0]
      : this.result?.bread?.errors?.length ? 'Full preview unavailable: ' + this.result.bread.errors[0]
      : !this.request ? 'Full preview unavailable: ' + this.message
      : !this.result ? 'Full preview unavailable until the current layout passes Check IK.'
      : 'Full preview unavailable: the path has not passed the motion checks. See the failure details above.';
    const endpointRows = (this.result?.endpoints || []).map(target =>
      '<button class="flow-target ' + (target.ok ? 'ok' : 'failed') + '" data-flow-pose="' +
      escape(target.id) + '" ' + (target.ok ? '' : 'disabled') + '><span class="flow-dot"></span><span>' +
      escape(target.name) + '<small>' + (target.ok ? 'IK found' : 'No solution found') + ' · ' +
      (target.positionError * 1000).toFixed(2) + ' mm / ' +
      (target.orientationError * 180 / Math.PI).toFixed(2) + '° error</small></span><span>↗</span></button>').join('');
    const samples = this.result?.zoneSamples || [];
    const sampleMarkup = samples.map((sample, index) =>
      '<button class="' + (sample.ok ? 'ok' : 'failed') + '" data-flow-sample="' + index +
      '" title="' + escape(sample.name) + ': ' + (sample.ok ? 'IK found' : 'No solution') + '" ' +
      (sample.ok ? '' : 'disabled') + '>' + (sample.ok ? '✓' : '×') + '</button>').join('');
    const issues = [...(this.request?.errors || []), ...(this.result?.bread?.errors || []), ...(this.request?.warnings || [])]
      .map(message => '<p class="flow-warning">' + escape(message) + '</p>').join('');
    this.panel.innerHTML = `
      <div class="flow-heading"><span class="live-dot"></span>BAG PACKING FLOW</div>
      <h2>Pick. Open. Load. Place.</h2>
      <p class="flow-intro">Two Nova-5s share one table. The suction arm opens the bag and carries it to the front counter.</p>
      <button class="flow-wide" data-flow-action="table">Select shared table</button>
      <p class="flow-meta">${table ? this.store.format(table.width) + ' × ' + this.store.format(table.depth) +
        ' · height ' + this.store.format(table.height) : 'No shared table'}</p>
      <div class="flow-actions"><button data-flow-action="zone">Select zone</button><button data-flow-action="draw">Draw new zone</button></div>
      <p class="flow-hint">Draw a rectangle on its intended table. Move, resize or rotate it in either view.</p>
      ${placementMarkup(this.store, placementZone)}
      ${breadControls(this.store,settings,this.result,this.request,number)}
      <div class="flow-status ${this.result && (!this.result.pathOK || this.request?.errors.length) ? 'failed' : ''}" id="flow-status">${escape(this.message)}</div>
      <div class="flow-actions"><button class="primary" data-flow-action="check">Check IK</button><button data-flow-action="frame">View flow</button></div>
      <div class="flow-targets">${endpointRows}</div>
      ${samples.length ? '<div class="flow-sampling"><div class="flow-grid">' + sampleMarkup +
        '</div><p><b>' + samples.filter(sample => sample.ok).length + ' / 9</b> placement samples<br><small>Bag centres inset from the rectangle edges. Sampled points, not proof of the entire area.</small></p></div>' : ''}
      ${pairCollisionMarkup(this.request,this.result)}
      ${packingCollisionMarkup(this.request,this.result)}
      ${failureMarkup(this.result?.failure)}
      ${failureMarkup(this.result?.bread?.failure, 'bread')}
      ${motionSummary(this.result)}
      ${this.result?.searches?.some(s=>s.ok)?'<p class="flow-meta">Obstacle detour found; longer route timing is included.</p>':''}
      ${diagnostic?'<p class="flow-hint">Diagnostic preview only · shows calculated motion up to the last accepted pose. Full order playback remains blocked.</p><button id="flow-partial-play" data-flow-action="partial">▶ Preview to failure</button>':''}
      <div class="flow-player">
        <p id="flow-preview-reason" class="flow-hint" ${canPlay ? 'hidden' : ''}>${escape(previewReason)}</p>
        <div class="flow-actions"><button id="flow-play" data-flow-action="play" aria-describedby="flow-preview-reason" ${canPlay ? '' : 'disabled'}>▶ Preview flow</button><button data-flow-action="stop">Reset</button></div>
        <input id="flow-scrub" aria-label="Bag workflow timeline" type="range" min="0" max="${diagnostic?.end || this.result?.route?.duration || this.request?.duration || 24}" step=".02" value="0" ${canPlay || diagnostic ? '' : 'disabled'}>
        <div class="flow-time"><span id="flow-phase">Sequence preview</span><span id="flow-time">0.0 s</span></div>
        <div class="flow-vacuum"><span id="flow-robot-vac">Robot vacuum</span><span id="flow-fixed-vac">Fixed vacuum</span></div>
      </div>
      ${issues}
      ${motionControls(settings)}
      <details class="flow-settings" open><summary>Stroke &amp; clearance</summary>
        ${number('pullback', 'Opening stroke', settings.pullback, .1)}
        ${number('approach', 'Approach / withdrawal', settings.approach, .1)}
        ${number('lift', 'Lift above contact height', settings.lift, .1)}
        <label class="checkline"><input type="checkbox" data-flow-setting="auto_check" ${settings.auto_check ? 'checked' : ''}> Recheck after edits</label>
      </details>
      <details class="flow-settings"><summary>Choose components</summary>
        ${selector('robot_id', 'Suction robot', object => this.store.key(object) === 'nova5_suction')}
        ${selector('magazine_id', 'Bag stack holder', object => object.layout_component === 'magazine')}
        ${selector('fixture_id', 'Fixed suction', object => object.layout_component === 'fixed_suction')}
        ${selector('placement_zone_id', 'Placement rectangle', object => object.kind === 'placement_zone')}
      </details>
      <p class="flow-hint">IK checks position, tool orientation and all six URDF joint limits. Preview paths are solved at 12 Hz, with additional checks on held-bag tilt between samples; optional world collision checks cover arm and tool motion. Held bread and bags are included; vacuum strength is not checked. Nova bread pickup follows the tong URDF; geometric contact counts as a grasp. Cameras, grip forces, bag deformation, self collision and robot-to-robot contacts are not simulated.</p>
      <button class="flow-wide" data-flow-action="report" ${this.result ? '' : 'disabled'}>Export IK report</button>
    `;
    this.video.mount();
  }

  click(event) {
    if(event.target.closest('[data-bread-action]'))this.player.playing=false;
    if(handleBreadPoseAction(event,this.store,this.view,this.settings(),this.toast,patch=>this.store.transact('Changed bread pre-pick pose',()=>{this.store.scene.bag_workflow={...this.settings(),...patch};})))return;
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.flowAction;
    const settings = this.settings();
    if (button.dataset.flowPose || button.dataset.flowSample !== undefined) {
      const target = button.dataset.flowPose
        ? this.result.endpoints.find(item => item.id === button.dataset.flowPose)
        : this.result.zoneSamples[Number(button.dataset.flowSample)];
      if (target?.ok) {
        this.store.select(settings.robot_id);
        this.player.showPose(target);
      }
      return;
    }
    if (action === 'check') this.check();
    if (action === 'table') this.store.select(settings.shared_table_id);
    if (action === 'zone') this.store.select(settings.placement_zone_id);
    if (action === 'placement') this.locatePlacement();
    if (action === 'fit-zone') this.fitPlacement();
    if (action === 'draw') {
      this.store.setOption('view', 'split');
      this.plan.beginPlacementZone(rectangle => this.addZone(rectangle));
      this.toast('Drag a placement rectangle on the intended table');
    }
    if (action === 'partial') {this.frame();this.player.playPartial();}
    if (action === 'play') {
      this.player.play();
      this.updatePlayback(this.player.time, null);
    }
    if (action === 'stop') this.player.stop();
    if (action === 'frame') this.frame();
    if (action === 'failure') this.locateFailure();
    if (action === 'bread-failure') this.locateFailure('bread');
    if (action === 'report' && this.result) {
      const report = {layout: this.store.exportScene(), request: this.request, result: this.result};
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nova5-bag-workflow-ik.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  change(event) {
    if (event.target.hasAttribute('data-flow-support')) {
      const zone = this.store.object(this.settings().placement_zone_id);
      const table = this.store.object(event.target.value);
      if (!zone || this.store.locked(zone.id) || !table || !SUPPORT_KINDS.includes(table.kind)) {
        this.render();
        return;
      }
      this.store.transact('Changed placement support table', () => {
        zone.support = table.id;
        zone.parentId = table.parentId;
        zone.z = .002;
      });
      return;
    }
    const key = event.target.dataset.flowSetting;
    if (!key) return;
    const element = event.target;
    let value = element.type === 'checkbox' ? element.checked :
      element.type === 'number' ? Number(element.value) / (element.dataset.flowUnit === '°' ? 1 : 100) : element.value;
    const allowZero = ['min_j1_share', 'extra_lift_search'].includes(key);
    const signed=key.startsWith('bread_pre_pick_');
    const maximum = element.max === '' ? Infinity :
      Number(element.max) / (element.dataset.flowUnit === '°' ? 1 : 100);
    if (element.type === 'number' && (!Number.isFinite(value) ||
        (!signed && (allowZero ? value < 0 : value <= 0)) || value > maximum)) {
      this.render();
      return;
    }
    this.store.transact('Updated bag workflow', () => {
      this.store.scene.bag_workflow = {...this.settings(), [key]: value};
    });
  }

  addZone(rectangle) {
    if (rectangle.width < .04 || rectangle.depth < .04) {
      this.toast('Draw a rectangle at least 4 cm wide and deep');
      return;
    }
    const tables = this.store.scene.objects.filter(object =>
      SUPPORT_KINDS.includes(object.kind) && this.store.visible(object.id));
    const containing = tables.filter(table => placementAssessment(this.store, {
      ...rectangle, kind: 'placement_zone', yaw_deg: 180, support: table.id,
    }).inside);
    const selected = this.store.selected.map(id => this.store.object(id))
      .find(object => containing.some(table => table.id === object?.id));
    const table = selected || containing.find(table => table.id === 'coffee_station') ||
      containing.sort((a, b) => a.width * a.depth - b.width * b.depth)[0] ||
      this.store.supportAt(rectangle.x, rectangle.y) || this.store.object('coffee_station');
    if (!table) {
      this.toast('Add a table or counter before drawing a placement rectangle');
      return;
    }
    this.store.transact('Added placement rectangle', () => {
      const id = this.store.unique('placement_zone');
      this.store.scene.objects.push({
        id, kind: 'placement_zone', label: 'Bag placement zone',
        asset_key: 'placement_zone', ...rectangle, height: .003, z: .002,
        yaw_deg: 180, support: table.id, parentId: table.parentId, visible: true, locked: false,
      });
      this.store.scene.bag_workflow = {...this.settings(), placement_zone_id: id};
      this.store.selected = [id];
    });
    this.toast('Placement rectangle added; use Properties to adjust it');
  }

  updatePlayback(time, state) {
    const set = (id, text) => {
      const element = this.panel.querySelector('#' + id);
      if (element) element.textContent = text;
    };
    const slider = this.panel.querySelector('#flow-scrub');
    if (slider) slider.value = time;
    set('flow-time', time.toFixed(1) + ' s');
    if (state) set('flow-phase', state.phase);
    else if (!time) set('flow-phase', 'Sequence preview');
    set('flow-play', this.player?.playing&&!this.player.diagnostic ? 'Ⅱ Pause' : '▶ Preview flow');
    set('flow-partial-play',this.player?.playing&&this.player.diagnostic&&time<this.player.playbackEnd?'Ⅱ Pause inspection':'▶ Preview to failure');
    if(this.player.diagnostic&&time>=this.player.playbackEnd-1e-6)set('flow-phase','Stopped at last accepted pose · inspect rejected position');
    for (const [id, active] of [['flow-robot-vac', state?.robotVacuum], ['flow-fixed-vac', state?.fixedVacuum]]) {
      this.panel.querySelector('#' + id)?.classList.toggle('on', !!active);
    }
  }

  drawGuides() {
    this.guideGroup.traverse(node => {
      node.geometry?.dispose();
      node.material?.map?.dispose();
      node.material?.dispose();
    });
    this.guideGroup.clear();
    this.guideGroup.visible = this.active;
    if (!this.active) return;
    this.store.workflowOverlay = null;
    this.store.placementOverlay = null;
    const zone = this.store.object(this.settings().placement_zone_id);
    const placement = placementAssessment(this.store, zone);
    if (this.active && placement?.validSupport && (this.inspectPlacement || !placement.inside)) {
      this.store.placementOverlay = placement;
      this.drawPlacementGuides(placement);
    }
    if (this.result) {
      const samples = [
        ...this.result.endpoints.map(target => ({...target, position: target.position})),
        ...this.result.zoneSamples.map(target => ({...target, position: target.center})),
      ];
      const failure = (this.failureKind === 'bread' ? this.result.bread?.failure : this.result.failure) || this.result.bread?.failure || this.result.failure;
      const breadResult = this.result.bread;
      if (breadResult) samples.push(...breadResult.knots.map(k => ({...k,name:k.phase,ok:breadResult.pathOK,role:'bread-target'})));
      if (failure) {
        samples.push({
          name: 'Failed target · ' + failure.phase + ' · ' + failure.time.toFixed(2) + ' s',
          position: failure.target.position, ok: false, role: 'path-failure',
          previousPosition: failure.previous?.target.position,
        });
      }
      this.store.workflowOverlay = this.active ? samples : null;
      for (const sample of samples) {
        const failed = sample.role === 'path-failure';
        const marker = new THREE.Mesh(new THREE.SphereGeometry(failed ? .018 : .010, 16, 10),
          new THREE.MeshBasicMaterial({
            color: failed ? 0xd64942 : sample.ok ? 0x229c82 : 0xcb765b,
            depthTest: !failed,
          }));
        marker.name = failed ? 'Rejected IK target' : sample.name;
        marker.position.set(sample.position[0], sample.position[2], -sample.position[1]);
        marker.renderOrder = failed ? 100 : 0;
        this.guideGroup.add(marker);
      }
      if (this.result.frames.length > 1) {
        const points = this.result.frames.map(frame =>
          new THREE.Vector3(frame.target.position[0], frame.target.position[2], -frame.target.position[1]));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({color: 0x58b8b0, transparent: true, opacity: .45}));
        this.guideGroup.add(line);
      }
      if (breadResult?.frames.length > 1) {
        const points = breadResult.frames.map(f => new THREE.Vector3(f.target.position[0],f.target.position[2],-f.target.position[1]));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xe0a554,transparent:true,opacity:.6}));
        line.name='Bread tong path'; this.guideGroup.add(line);
      }
      if (failure) this.drawFailureGuide(failure);
    }
    this.store.emit('workflow');
  }

  drawPlacementGuides(placement) {
    const outline = (points, height, color, name) => {
      const positions = [...points, points[0]].map(point =>
        new THREE.Vector3(point[0], height, -point[1]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),
        new THREE.LineBasicMaterial({color, depthTest: false}));
      line.name = name;
      line.renderOrder = 100;
      this.guideGroup.add(line);
    };
    outline(placement.tableCorners, placement.tableHeight + .012, 0x417bcc, 'Assigned placement table boundary');
    outline(placement.worldCorners, placement.zoneHeight + .014,
      placement.inside ? 0x26977e : 0xd64942, 'Placement rectangle boundary');
    for (const index of placement.outsideCorners) {
      const point = placement.worldCorners[index];
      const marker = new THREE.Mesh(new THREE.SphereGeometry(.017, 12, 8),
        new THREE.MeshBasicMaterial({color: 0xd64942, depthTest: false}));
      marker.name = 'Placement corner outside support';
      marker.position.set(point[0], placement.zoneHeight + .018, -point[1]);
      marker.renderOrder = 101;
      this.guideGroup.add(marker);
    }
  }

  locatePlacement() {
    const zone = this.store.object(this.settings().placement_zone_id);
    if (!zone) return;
    const table = this.store.object(zone.support);
    this.player.stop();
    this.inspectPlacement = true;
    this.store.select(zone.id);
    this.store.setOption('view', 'split');
    this.drawGuides();
    const points = [zone, ...(table ? [table] : [])].flatMap(corners);
    const projected = points.map(point => this.plan.toPlan(point));
    const minX = Math.min(...projected.map(point => point[0]));
    const minY = Math.min(...projected.map(point => point[1]));
    const width = Math.max(80, Math.max(...projected.map(point => point[0])) - minX);
    const height = Math.max(80, Math.max(...projected.map(point => point[1])) - minY);
    this.plan.view = {x: minX - 65, y: minY - 65, width: width + 130, height: height + 130};
    this.plan.render();
    const centreX = (Math.min(...points.map(point => point[0])) + Math.max(...points.map(point => point[0]))) / 2;
    const centreY = (Math.min(...points.map(point => point[1])) + Math.max(...points.map(point => point[1]))) / 2;
    const centre = new THREE.Vector3(centreX, this.store.z(zone), -centreY);
    const distance = Math.max(.85, width / 200, height / 200) * 1.35;
    this.view.controls.target.copy(centre);
    this.view.camera.position.copy(centre).add(new THREE.Vector3(-.7, 1.2, .8).multiplyScalar(distance));
    this.view.camera.lookAt(centre);
    this.view.controls.update();
    this.toast('Blue outline: assigned table. Red dots: placement corners outside it.');
  }

  fitPlacement() {
    const zone = this.store.object(this.settings().placement_zone_id);
    const placement = placementAssessment(this.store, zone);
    if (!zone || this.store.locked(zone.id) || !placement?.correction || placement.inside) return;
    this.store.transact('Moved placement rectangle inside support', () => {
      zone.x += placement.correction[0];
      zone.y += placement.correction[1];
    });
    this.locatePlacement();
  }

  drawFailureGuide(failure) {
    const point = values => new THREE.Vector3(values[0], values[2], -values[1]);
    const target = point(failure.target.position);
    const crossPoints = [
      target.clone().add(new THREE.Vector3(-.035, -.035, 0)),
      target.clone().add(new THREE.Vector3(.035, .035, 0)),
      target.clone().add(new THREE.Vector3(-.035, .035, 0)),
      target.clone().add(new THREE.Vector3(.035, -.035, 0)),
    ];
    const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(crossPoints),
      new THREE.LineBasicMaterial({color: 0xd64942, depthTest: false}));
    cross.name = 'Failed target cross';
    cross.renderOrder = 101;
    this.guideGroup.add(cross);
    if (failure.previous) {
      const gap = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        point(failure.previous.target.position), target,
      ]), new THREE.LineDashedMaterial({
        color: 0xd64942, dashSize: .012, gapSize: .008, depthTest: false,
      }));
      gap.name = 'Rejected continuation from last valid sample';
      gap.computeLineDistances();
      gap.renderOrder = 100;
      this.guideGroup.add(gap);
    }
    if(failure.reason!=='robot_collision') {
      const direction = point(failure.toolDirection).normalize();
      const arrow = new THREE.ArrowHelper(direction, target, .12, 0xd64942, .025, .014);
      arrow.name = 'Requested tool-face normal';
      this.guideGroup.add(arrow);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff5f0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#a32f2a';
    context.font = 'bold 28px Segoe UI, sans-serif';
    context.textAlign = 'center';
    context.fillText((failure.reason==='robot_collision'?'Collision point · ':'Failed target · ') + failure.time.toFixed(2) + ' s', 256, 49);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas), depthTest: false,
    }));
    label.name = 'Failure target label';
    label.position.copy(target).add(new THREE.Vector3(0, .095, 0));
    label.scale.set(.50, .078, 1);
    label.renderOrder = 102;
    this.guideGroup.add(label);
  }

  locateFailure(kind = 'bag') {
    const failure = kind === 'bread' ? this.result?.bread?.failure : this.result?.failure;
    if (!failure) return;
    if (['world_collision','robot_collision'].includes(failure.reason)) { this.player.stop(); this.view.collisions.locate(failure); return; }
    this.failureKind = kind;
    this.drawGuides();
    this.store.select(null);
    this.store.setOption('view', 'split');
    this.player.stop();
    if (failure.previous) {
      this.player.showPose({
        ...failure.previous, robotId: failure.robotId,
        name: 'Last valid pose · ' + failure.previous.time.toFixed(2) + ' s',
      });
    }
    const robot = kind === 'bread' ? this.request.breadTask.robot : this.request.robot;
    const position = failure.target.position;
    const centre = new THREE.Vector3(
      (robot.x + position[0]) / 2,
      (this.store.z(robot) + position[2]) / 2,
      -(robot.y + position[1]) / 2,
    );
    const distance = Math.max(1.1, Math.hypot(position[0] - robot.x, position[1] - robot.y));
    this.view.controls.target.copy(centre);
    this.view.camera.position.copy(centre).add(new THREE.Vector3(-1.4, 1.2, 1).multiplyScalar(distance));
    this.view.camera.lookAt(centre);
    this.view.controls.update();
    this.toast('Red ×: rejected target. Robot: last valid pose. Red arrow: requested tool direction.');
  }

  frame() {
    const table = this.store.object(this.settings().shared_table_id);
    if (!table) return;
    this.store.select(null);
    this.store.setOption('view', 'scene');
    this.view.controls.target.set(table.x - .1, table.height + .25, -table.y + .35);
    this.view.camera.position.set(table.x - 2.8, table.height + 2.9, -table.y + .65);
    this.view.camera.lookAt(this.view.controls.target);
    this.view.controls.update();
  }
}
