import {Quaternion, Vector3} from '../vendor/three.module.js';

export const MOTION_DEFAULTS = {
  prefer_j1: true,
  max_bag_tilt_deg: 5,
  min_j1_share: .5,
  extra_lift_search: .20,
};
const degrees = radians => radians * 180 / Math.PI;
const upright = new Vector3(0, 0, 1);
const bagUpInTool = new Vector3(0, -1, 0);
const clamp = value => Math.max(-1, Math.min(1, value));

export function bagTiltDegrees(quaternion) {
  const up = bagUpInTool.clone().applyQuaternion(quaternion).normalize();
  return degrees(Math.acos(clamp(up.dot(upright))));
}

export function transferAngle(a, b, centre, direction = 'short') {
  const from = Math.atan2(a.position[1] - centre[1], a.position[0] - centre[0]);
  const to = Math.atan2(b.position[1] - centre[1], b.position[0] - centre[0]);
  let sweep = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  if (direction === 'long') sweep += sweep <= 0 ? Math.PI * 2 : -Math.PI * 2;
  return {from, sweep};
}

export function interpolateMotion(a, b, fraction, centre) {
  let quaternion = new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion), fraction);
  let position = a.position.map((value, index) => value + (b.position[index] - value) * fraction);
  if (b.route === 'j1-sweep') {
    const from = Math.atan2(a.position[1] - centre[1], a.position[0] - centre[0]);
    const radius = Math.hypot(a.position[0] - centre[0], a.position[1] - centre[1]);
    position = [
      centre[0] + radius * Math.cos(from + b.sweep * fraction),
      centre[1] + radius * Math.sin(from + b.sweep * fraction),
      a.position[2],
    ];
    quaternion = new Quaternion().setFromAxisAngle(upright, b.sweep * fraction)
      .multiply(new Quaternion(...a.quaternion));
  } else if (b.route === 'short' || b.route === 'long') {
    const {from, sweep} = transferAngle(a, b, centre, b.route);
    const r0 = Math.hypot(a.position[0] - centre[0], a.position[1] - centre[1]);
    const r1 = Math.hypot(b.position[0] - centre[0], b.position[1] - centre[1]);
    const radius = r0 + (r1 - r0) * fraction;
    position = [
      centre[0] + radius * Math.cos(from + sweep * fraction),
      centre[1] + radius * Math.sin(from + sweep * fraction),
      position[2],
    ];
  }
  return {position, quaternion: quaternion.toArray()};
}

export function routeCandidates(request) {
  const settings = {...MOTION_DEFAULTS, ...request.settings};
  if (!settings.prefer_j1) return [{
    id: 'straight', label: 'Straight transfers', extraLift: 0,
    knots: request.knots, duration: request.duration,
  }];
  const heights = [...new Set([0, settings.extra_lift_search / 2, settings.extra_lift_search])];
  const routes = [];
  for (const extraLift of heights) {
    for (const directions of [['short', 'short'], ['short', 'long'], ['long', 'short'], ['long', 'long']]) {
      let transfer = 0;
      const source = request.knots.map(knot => ({
        ...knot,
        position: knot.position.map((value, index) => value + (index === 2 && knot.clearance ? extraLift : 0)),
      }));
      const knots = [source[0]];
      let time = source[0].time;
      for (let index = 1; index < source.length; index++) {
        const a = knots.at(-1);
        const b = source[index];
        let duration = request.knots[index].time - request.knots[index - 1].time;
        if (b.transfer) {
          const direction = directions[transfer++];
          const centre = [request.robot.x, request.robot.y];
          const {from, sweep} = transferAngle(a, b, centre, direction);
          const radius = Math.hypot(a.position[0] - centre[0], a.position[1] - centre[1]);
          // A rigid base-axis rotation is exactly reachable by changing J1
          // alone (subject to its limits), with the bag remaining upright.
          const swept = {
            ...b,
            position: [centre[0] + radius * Math.cos(from + sweep),
              centre[1] + radius * Math.sin(from + sweep), a.position[2]],
            quaternion: new Quaternion().setFromAxisAngle(upright, sweep)
              .multiply(new Quaternion(...a.quaternion)).toArray(),
            phase: b.transfer === 'fixed' ? 'J1 sweep to fixed holder' : 'J1 sweep to placement zone',
            route: 'j1-sweep', direction, sweep,
          };
          time += Math.max(duration, Math.abs(degrees(sweep)) / 45);
          swept.time = time;
          knots.push(swept);
          const yawCorrection = new Quaternion(...swept.quaternion).angleTo(new Quaternion(...b.quaternion));
          duration = Math.max(1.5, degrees(yawCorrection) / 45);
          b.alignmentFor = b.transfer;
          b.transfer = undefined;
          b.phase = b.alignmentFor === 'fixed' ? 'Align with fixed holder' : 'Align above placement zone';
        }
        time += duration;
        b.time = time;
        knots.push(b);
      }
      routes.push({
        id: directions.join('-') + '-' + Math.round(extraLift * 1000),
        label: directions.map(direction => direction === 'short' ? 'short arc' : 'long arc').join(' / '),
        extraLift, knots, duration: time,
      });
    }
  }
  return routes;
}

export function inspectHeldInterval(arm, a, b, tiltLimit) {
  const angularTravel = a.q.reduce((sum, value, index) => sum + Math.abs(b.q[index] - value), 0);
  let divisions = 4;
  let peak = {degrees: 0, fraction: 0, q: a.q};
  let upperBound = Infinity;
  while (divisions <= 256) {
    peak = {degrees: 0, fraction: 0, q: a.q};
    for (let index = 0; index <= divisions; index++) {
      const fraction = index / divisions;
      const q = a.q.map((value, joint) => value + (b.q[joint] - value) * fraction);
      const tilt = bagTiltDegrees(arm.forward(q).quaternion);
      if (tilt >= peak.degrees) peak = {degrees: tilt, fraction, q};
    }
    // Orientation can vary no faster than the sum of joint-angle changes.
    // Every point is within half one subinterval of a checked sample.
    upperBound = peak.degrees + degrees(angularTravel) / (2 * divisions);
    if (peak.degrees > tiltLimit || upperBound <= tiltLimit) break;
    divisions *= 2;
  }
  return {
    ok: upperBound <= tiltLimit,
    peakDegrees: peak.degrees,
    upperBoundDegrees: upperBound,
    limitDegrees: tiltLimit,
    peakFraction: peak.fraction,
    peakQ: peak.q,
    divisions: Math.min(divisions, 256),
  };
}

export function jointTravel(frames) {
  const travel = Array(6).fill(0);
  for (let index = 1; index < frames.length; index++) {
    for (let joint = 0; joint < 6; joint++) {
      travel[joint] += degrees(Math.abs(frames[index].q[joint] - frames[index - 1].q[joint]));
    }
  }
  const positioningTravel = travel[0] + travel[1] + travel[2];
  return {
    travelDegrees: travel,
    j1Share: positioningTravel < .01 ? 1 : travel[0] / positioningTravel,
    positioningTravelDegrees: positioningTravel,
  };
}
