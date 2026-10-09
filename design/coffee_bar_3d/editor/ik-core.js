import {createSearchBudget,tryDetour,retimeDetours} from './motion-search.js';
import {WorldCollisionChecker} from './collision-core.js';
import {Matrix4, Vector3, Quaternion, Euler} from '../vendor/three.module.js';
import {MOTION_DEFAULTS, routeCandidates, interpolateMotion, inspectHeldInterval,
  bagTiltDegrees, jointTravel} from './bag-motion.js';

export const IK_TOLERANCE = {position: .001, orientationDegrees: 1};
export const MAX_JOINT_STEP = .5;
const Z = new Vector3(0, 0, 1);
const radians = value => value * Math.PI / 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function solveLinear(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 6; column++) {
    let pivot = column;
    for (let row = column + 1; row < 6; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-12) return Array(6).fill(0);
    for (let index = column; index <= 6; index++) rows[column][index] /= divisor;
    for (let row = 0; row < 6; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= 6; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map(row => row[6]);
}

function rotationError(current, target) {
  const delta = target.clone().multiply(current.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const angle = 2 * Math.atan2(length, clamp(delta.w, -1, 1));
  return new Vector3(delta.x, delta.y, delta.z).multiplyScalar(length < 1e-10 ? 2 : angle / length);
}

export class SuctionArm {
  constructor(definition, robot, mountingHeight) {
    this.definition = definition;
    this.tolerance = definition.tolerance || IK_TOLERANCE;
    this.joints = definition.joints;
    this.scale = robot.robot_scale || 1;
    this.base = new Matrix4().makeRotationZ(radians(robot.yaw_deg || 0));
    this.base.setPosition(robot.x, robot.y, mountingHeight);
    this.base.scale(new Vector3().setScalar(this.scale));
    this.origins = this.joints.map(joint => {
      const rotation = new Quaternion().setFromEuler(new Euler(...joint.rpy, 'ZYX'));
      return new Matrix4().compose(new Vector3(...joint.xyz), rotation, new Vector3(1, 1, 1));
    });
    this.axes = this.joints.map(joint => new Vector3(...joint.axis).normalize());
    this.tool = new Matrix4().makeTranslation(0, 0, definition.tool_length);
    this.initial = this.joints.map(joint => radians(robot.joints_deg?.[joint.name] || 0));
    this.lower = this.joints.map(joint => joint.lower + .001);
    this.upper = this.joints.map(joint => joint.upper - .001);
    this.mountingHeight = mountingHeight;
  }

  forward(angles) {
    const matrix = this.base.clone();
    const origins = [];
    const axes = [];
    const links = [];
    angles.forEach((angle, index) => {
      matrix.multiply(this.origins[index]);
      origins.push(new Vector3().setFromMatrixPosition(matrix));
      axes.push(this.axes[index].clone().transformDirection(matrix));
      matrix.multiply(new Matrix4().makeRotationAxis(this.axes[index], angle));
      links.push(new Vector3().setFromMatrixPosition(matrix).toArray());
    });
    matrix.multiply(this.tool);
    const position = new Vector3();
    const quaternion = new Quaternion();
    matrix.decompose(position, quaternion, new Vector3());
    return {position, quaternion, origins, axes, links};
  }

  solve(target, seed, iterations = 150, mobility = null) {
    const desiredPosition = new Vector3(...target.position);
    const desiredRotation = new Quaternion(...target.quaternion).normalize();
    let angles = seed.map((value, index) => clamp(value, this.lower[index], this.upper[index]));
    let best = null;
    for (let iteration = 0; iteration <= iterations; iteration++) {
      const pose = this.forward(angles);
      const positionError = desiredPosition.clone().sub(pose.position);
      const orientationError = rotationError(pose.quaternion, desiredRotation);
      const positionResidual = positionError.length();
      const orientationResidual = orientationError.length();
      const score = positionResidual + .2 * orientationResidual;
      const result = {
        q: [...angles],
        positionError: positionResidual,
        orientationError: orientationResidual,
        ok: positionResidual <= this.tolerance.position &&
          orientationResidual <= radians(this.tolerance.orientationDegrees),
        tcp: pose.position.toArray(),
        tcpQuaternion: pose.quaternion.toArray(),
        links: pose.links,
      };
      if (!best || score < best.score) best = {...result, score};
      if (result.ok) return result;
      if (iteration === iterations) break;
      const columns = pose.axes.map((axis, index) => {
        const linear = axis.clone().cross(pose.position.clone().sub(pose.origins[index]));
        return [...linear.toArray(), ...axis.clone().multiplyScalar(.2).toArray()];
      });
      const error = [...positionError.toArray(), ...orientationError.multiplyScalar(.2).toArray()];
      const damping = .007;
      const normal = Array.from({length: 6}, (_, row) =>
        Array.from({length: 6}, (_, column) =>
          columns.reduce((sum, values, joint) => sum + (mobility?.[joint] ?? 1) * values[row] * values[column], 0) +
          (row === column ? damping * damping : 0)));
      const step = solveLinear(normal, error);
      const change = columns.map((column, joint) =>
        (mobility?.[joint] ?? 1) * column.reduce((sum, value, index) => sum + value * step[index], 0));
      const factor = Math.min(1, .22 / Math.max(...change.map(Math.abs), 1e-10));
      angles = angles.map((angle, index) =>
        clamp(angle + change[index] * factor, this.lower[index], this.upper[index]));
    }
    return best;
  }

  solveMultiple(target, preferred = this.initial, attempts = 20) {
    let best = this.solve(target, preferred);
    let reachable = best.ok ? best : null;
    if (best.ok && (!this.poseAllowed || this.poseAllowed(best.q))) return {...best, attempts: 1};
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Deterministic restarts make repeated layout checks reproducible.
      const seed = this.joints.map((joint, index) => {
        const fraction = ((attempt + 1) * (index * 11 + 17) * .61803398875) % 1;
        const limit = index === 2 ? 2.5 : Math.PI;
        return clamp((fraction * 2 - 1) * limit, joint.lower + .01, joint.upper - .01);
      });
      const candidate = this.solve(target, seed);
      if (candidate.ok && (!reachable || candidate.score < reachable.score)) reachable = candidate;
      if (candidate.ok && (!this.poseAllowed || this.poseAllowed(candidate.q))) return {...candidate, attempts: attempt + 2};
      if (candidate.score < best.score) best = candidate;
    }
    return {...(reachable || best), attempts: attempts + 1};
  }
}

export function interpolateTarget(a, b, fraction) {
  const quaternion = new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion), fraction);
  return {
    position: a.position.map((value, index) => value + (b.position[index] - value) * fraction),
    quaternion: quaternion.toArray(),
  };
}

function jointDiagnostics(arm, result, seed) {
  return arm.joints.map((joint, index) => ({
    name: joint.name,
    angle: result.q[index],
    lower: joint.lower,
    upper: joint.upper,
    delta: seed ? result.q[index] - seed[index] : null,
    limitDistance: Math.min(result.q[index] - joint.lower, joint.upper - result.q[index]),
    nearestLimit: result.q[index] - joint.lower < joint.upper - result.q[index] ? 'lower' : 'upper',
  }));
}

export function pathFailure(arm, target, result, previous, context) {
  const joints = jointDiagnostics(arm, result, previous?.q);
  const largestStep = previous
    ? joints.reduce((largest, joint) => Math.abs(joint.delta) > Math.abs(largest.delta) ? joint : largest)
    : null;
  // Restarts diagnose whether another posture reaches this pose. They never
  // replace a failed continuation or silently splice a different joint branch.
  const alternative = !result.ok && previous ? arm.solveMultiple(target, previous.q, 14) : null;
  const reason = context.reason || (result.ok ? 'joint_step_exceeded' : 'ik_not_converged');
  return {
    ...result,
    ...context,
    reason,
    target: {position: [...target.position], quaternion: [...target.quaternion]},
    toolDirection: Z.clone().applyQuaternion(new Quaternion(...target.quaternion)).toArray(),
    robotRelativePosition: new Vector3(...target.position)
      .applyMatrix4(arm.base.clone().invert()).multiplyScalar(arm.scale).toArray(),
    previous: previous ? {time: previous.time, q: [...previous.q], target: previous.target} : null,
    positionDelta: target.position.map((value, index) => value - result.tcp[index]),
    failedTolerances: [
      ...(result.positionError > arm.tolerance.position ? ['position'] : []),
      ...(result.orientationError > radians(arm.tolerance.orientationDegrees) ? ['orientation'] : []),
    ],
    joints,
    nearLimits: joints.filter(joint => joint.limitDistance <= radians(1)),
    largestStep,
    maxJointStep: MAX_JOINT_STEP,
    alternative: alternative ? {
      ...alternative,
      joints: jointDiagnostics(arm, alternative, previous.q),
      maxStep: Math.max(...alternative.q.map((angle, index) => Math.abs(angle - previous.q[index]))),
    } : null,
    search: previous ? 'Continuation from the previous joint pose' : 'Independent multi-start search',
    tolerance: {...arm.tolerance},
    interpretation: context.interpretation || (alternative?.ok
      ? 'An independent IK search found this pose, but the sampled path could not continue from the previous posture.'
      : result.ok
        ? 'The pose satisfies IK tolerances, but exceeds the sampled joint-step guard. This guard is not a hardware speed limit.'
        : 'No solution met the tolerances in this numerical search. This is not proof that the pose is unreachable.'),
  };
}

function solvePath(arm, request, endpoints, route, preferred, settings, progress) {
  const frames = [];
  let failure = null;
  let maxPositionError = 0;
  let maxOrientationError = 0;
  let maxBagTiltDegrees = 0;
  let maxTiltBoundDegrees = 0;
  const transfers = [],searches=[];
  const start = arm.solveMultiple(route.knots[0], preferred);
  if (!start.ok) {
    failure = pathFailure(arm, route.knots[0], start, null, {
      phase: 'Initial approach', time: route.knots[0].time,
    });
    return {frames, failure, pathOK: false, motion: {transfers}};
  }
  const startFrame = {...route.knots[0], q: start.q, target: route.knots[0]};
  const blockedStart = arm.collision.failure(arm, null, startFrame);
  if (blockedStart) return {frames, failure: blockedStart, pathOK: false, motion: {transfers}};
  let seed = start.q;
  frames.push({...route.knots[0], q: seed, target: route.knots[0]});
  for (let index = 1; index < route.knots.length; index++) {
    const a = route.knots[index - 1];
    const b = route.knots[index];
    const segmentStart = frames.length - 1;
    const steps = Math.max(1, Math.ceil((b.time - a.time) * 12));
    for (let sample = 1; sample <= steps; sample++) {
      const fraction = sample / steps;
      const smooth = fraction * fraction * (3 - 2 * fraction);
      const target = interpolateMotion(a, b, smooth, [request.robot.x, request.robot.y]);
      const previous = frames.at(-1);
      const time = a.time + (b.time - a.time) * fraction;
      const context = {
        phase: b.phase, time,
        segment: {
          index, from: a.phase, to: b.phase, startTime: a.time, endTime: b.time,
          sample, samples: steps, fraction, interpolationFraction: smooth,
        },
      };
      const held = a.bagState === 'carried' && a.robotVacuum;
      const reorienting = !!(a.allowBagReorientation || b.allowBagReorientation) &&
        !a.loaded && !b.loaded && !a.fixedVacuum && !b.fixedVacuum;
      const uprightHeld = held && !reorienting;
      const mobility = settings.prefer_j1 && uprightHeld ? [1, .25, .25, .5, .5, .5] : null;
      const result = arm.solve(target, seed, 100, mobility);
      if (!result.ok ||
          Math.max(...result.q.map((value, joint) => Math.abs(value - seed[joint]))) > MAX_JOINT_STEP) {
        failure = pathFailure(arm, target, result, previous, context);
        break;
      }
      const frame = {
        time, q: result.q, target, phase: b.phase,
        bagState: fraction < 1 ? a.bagState : b.bagState,
        bagDepth: a.bagDepth + (b.bagDepth - a.bagDepth) * smooth,
        robotVacuum: fraction < 1 ? a.robotVacuum : b.robotVacuum,
        fixedVacuum: fraction < 1 ? a.fixedVacuum : b.fixedVacuum,
        loaded: fraction < 1 ? a.loaded : b.loaded,
        transfer: b.transfer,
        allowBagReorientation: reorienting,
      };
      const blocked = arm.collision.failure(arm, previous, frame);
      if (blocked) {
        const free=(b.clearance||b.transfer||b.alignmentFor)&&!a.fixedVacuum&&!b.fixedVacuum&&a.bagState===b.bagState;
        const detour=free?tryDetour(arm,frames[segmentStart],b,{
          budget:arm.searchBudget,tiltLimit:uprightHeld?settings.max_bag_tilt_deg:null,
          minimumJ1Share:uprightHeld&&settings.prefer_j1?settings.min_j1_share:0,
        }):{ok:false,status:'protected_motion',method:'RRT-Connect',phase:b.phase,nodes:0};
        const report={...detour,frames:undefined,path:undefined};searches.push(report);
        if(detour.ok) {
          frames.splice(segmentStart+1);frames.push(...detour.frames);seed=frames.at(-1).q;
          const transferred=frames.slice(segmentStart);
          if(b.transfer)transfers.push({id:b.transfer,phase:b.phase,route:'searched detour',...jointTravel(transferred)});
          if(uprightHeld)for(let i=1;i<transferred.length;i++) {
            const tilt=inspectHeldInterval(arm,transferred[i-1],transferred[i],settings.max_bag_tilt_deg);
            maxBagTiltDegrees=Math.max(maxBagTiltDegrees,tilt.peakDegrees);
            maxTiltBoundDegrees=Math.max(maxTiltBoundDegrees,tilt.upperBoundDegrees);
            transferred[i].bagTiltDegrees=bagTiltDegrees(arm.forward(transferred[i].q).quaternion);
          }
        } else {failure=blocked;failure.search=report;failure.segment=context.segment;}
        break;
      }
      if (!reorienting && (held || (frame.bagState === 'carried' && frame.robotVacuum))) {
        const tilt = inspectHeldInterval(arm, held ? previous : frame, frame, settings.max_bag_tilt_deg);
        maxBagTiltDegrees = Math.max(maxBagTiltDegrees, tilt.peakDegrees);
        maxTiltBoundDegrees = Math.max(maxTiltBoundDegrees, tilt.upperBoundDegrees);
        if (!tilt.ok) {
          failure = pathFailure(arm, target, result, previous, {
            ...context, reason: 'bag_tilt_exceeded',
            tilt: {...tilt, peakTime: previous.time + (time - previous.time) * tilt.peakFraction},
            interpretation: 'The held bag exceeds its tilt limit, or that limit could not be certified between path samples.',
          });
          break;
        }
        frame.bagTiltDegrees = bagTiltDegrees(new Quaternion(...result.tcpQuaternion));
      }
      if (sample === steps && b.transfer) {
        const travel = jointTravel([...frames.slice(segmentStart), frame]);
        const transfer = {id: b.transfer, phase: b.phase, route: b.route || 'straight', ...travel};
        transfers.push(transfer);
        if (settings.prefer_j1 && travel.j1Share + 1e-8 < settings.min_j1_share) {
          failure = pathFailure(arm, target, result, previous, {
            ...context, reason: 'j1_share_too_low',
            transfer: {...transfer, minimumShare: settings.min_j1_share},
            interpretation: 'This transfer is reachable but uses more shoulder/elbow motion than the selected J1-share requirement allows.',
          });
          break;
        }
      }
      seed = result.q;
      maxPositionError = Math.max(maxPositionError, result.positionError);
      maxOrientationError = Math.max(maxOrientationError, result.orientationError);
      frames.push(frame);
    }
    if (failure) break;
  }
  return {
    frames, failure, pathOK: !failure, maxPositionError, maxOrientationError,searches,
    motion: {
      transfers, maxBagTiltDegrees, maxTiltBoundDegrees,
      tiltLimitDegrees: settings.max_bag_tilt_deg,
      ...jointTravel(frames),
    },
  };
}

export function checkWorkflow(definition, request, progress = () => {}) {
  const arm = new SuctionArm(definition, request.robot, request.mountingHeight);
  arm.collision = new WorldCollisionChecker(request.collision);
  arm.searchBudget=createSearchBudget(request.collision);
  if (arm.collision.enabled) arm.poseAllowed = q => !arm.collision.pose(q);
  const settings = {...MOTION_DEFAULTS, ...request.settings};
  const endpoints = [];
  let seed = arm.initial;
  request.targets.forEach((target, index) => {
    const result = arm.solveMultiple(target, seed);
    if (result.ok) seed = result.q;
    endpoints.push({...target, ...result});
    progress({phase: 'targets', completed: index + 1, total: request.targets.length});
  });
  const samples = request.zoneSamples.map(target => ({...target, ...arm.solveMultiple(target, seed, 14)}));
  const common = {
    endpoints, zoneSamples: samples, collision: arm.collision.summary(),
    tolerance: {...IK_TOLERANCE},
    checks: 'Six URDF joint limits and full tool orientation; path solved at 12 Hz, with additional held-bag tilt checks and an angular bound between samples. Optional world-proxy collision checks include interpolated arm/tool motion; robot-to-robot, self collision are excluded. Held bags are included.',
  };
  if (endpoints.some(result => !result.ok)) return {
    ...common, frames: [], failure: null, pathOK: false, routeSearch: {attempts: []},
  };
  const routes = routeCandidates(request);
  const preferred = settings.prefer_j1
    ? [endpoints[0].q, [endpoints[0].q[0], -.7, -1.4, 0, 1.5, 0]]
    : [endpoints[0].q];
  const attempts = [];
  let selected = null;
  for (const route of routes) {
    for (let branch = 0; branch < preferred.length; branch++) {
      progress({phase: 'routes', completed: attempts.length, total: routes.length * preferred.length});
      const result = solvePath(arm, request, endpoints, route, preferred[branch], settings, progress);
      const travel = result.motion.travelDegrees || Array(6).fill(0);
      // Penalize non-J1 motion; wrist compensation is allowed to preserve bag pose.
      const cost = travel[0] * .15 + travel[1] * 3 + travel[2] * 3 +
        travel.slice(3).reduce((sum, value) => sum + value, 0) + route.duration * .1;
      const reached = result.pathOK ? Infinity :
        (result.failure?.segment?.index || 0) + (result.failure?.segment?.fraction || 0);
      const attempt = {
        id: route.id + '-posture-' + (branch + 1),
        route: route.label, extraLift: route.extraLift, branch: branch + 1,
        ok: result.pathOK, cost, duration: route.duration,
        failure: result.failure ? {
          reason: result.failure.reason, phase: result.failure.phase, time: result.failure.time,
        } : null,
        transfers: result.motion.transfers,
      };
      attempts.push(attempt);
      if (!selected || (result.pathOK && !selected.result.pathOK) ||
          (result.pathOK && selected.result.pathOK && cost < selected.cost) ||
          (!result.pathOK && !selected.result.pathOK && reached > selected.reached)) {
        selected = {result, route, cost, reached, attempt};
      }
    }
  }
  const timed=retimeDetours(selected.result,selected.route.knots);
  return {
    ...common, ...timed.result,
    route: {...selected.route,knots:timed.knots,duration:timed.duration, branch: selected.attempt.branch},
    routeSearch: {attempts, passed: attempts.filter(attempt => attempt.ok).length},
    motion: {...selected.result.motion, preferJ1: settings.prefer_j1, minimumJ1Share: settings.min_j1_share},
  };
}
