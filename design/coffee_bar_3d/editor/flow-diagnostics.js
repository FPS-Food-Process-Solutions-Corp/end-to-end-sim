const escape = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const degrees = value => value * 180 / Math.PI;
const cm = values => values.map(value => (value * 100).toFixed(2)).join(', ');
const errorText = result => (result.positionError * 1000).toFixed(2) + ' mm / ' +
  degrees(result.orientationError).toFixed(2) + '°';

export function failureMarkup(failure) {
  if (!failure) return '';
  const stepFailure = failure.reason === 'joint_step_exceeded';
  const tiltFailure = failure.reason === 'bag_tilt_exceeded';
  const shareFailure = failure.reason === 'j1_share_too_low';
  const policyFailure = tiltFailure || shareFailure;
  const title = tiltFailure ? 'Held-bag tilt limit exceeded'
    : shareFailure ? 'J1 motion requirement not met'
    : stepFailure ? 'Joint-step guard stopped the path' : 'IK did not converge';
  const segment = failure.segment;
  const previous = failure.previous;
  const alternative = failure.alternative;
  const limits = failure.nearLimits || [];
  const nearbyLimits = limits.length
    ? limits.map(joint => escape(joint.name) + ' is ' + degrees(joint.limitDistance).toFixed(2) +
      '° from its ' + joint.nearestLimit + ' limit (' + degrees(joint.angle).toFixed(2) +
      '°; limit ' + degrees(joint[joint.nearestLimit]).toFixed(2) + '°).').join(' ')
    : 'No joint is within 1° of a limit in the best continuation attempt.';
  const step = failure.largestStep;
  const reason = tiltFailure
    ? 'Held-bag tilt peaks at ' + failure.tilt.peakDegrees.toFixed(2) + '° near ' +
      failure.tilt.peakTime.toFixed(2) + ' s. Its conservative bound is ' +
      failure.tilt.upperBoundDegrees.toFixed(2) + '°; the allowed limit is ' +
      failure.tilt.limitDegrees + '°. The current interval was rejected.'
    : shareFailure ? 'J1 contributes ' + (failure.transfer.j1Share * 100).toFixed(1) +
      '% of J1–J3 travel during this sweep; at least ' +
      (failure.transfer.minimumShare * 100).toFixed(1) + '% is required.'
    : stepFailure
    ? escape(step.name) + ' needs a ' + degrees(Math.abs(step.delta)).toFixed(2) +
      '° step from the previous sample; the preview guard allows ' +
      degrees(failure.maxJointStep).toFixed(2) + '°. The target pose itself passes IK.'
    : 'The ' + escape(failure.failedTolerances.join(' and ')) +
      ' error exceeds the allowed tolerance at this sample.';
  const independent = policyFailure
    ? 'IK met the target-pose tolerance, but this route failed the selected motion constraint. This is not an IK reachability failure.'
    : alternative
    ? alternative.ok
      ? 'Independent check: this same target IS reachable from another solved posture. ' +
        'That does not establish a continuous route from the preceding pose.'
      : 'Independent check: no solution found after ' + alternative.attempts +
        ' starting guesses. Best attempt: ' + errorText(alternative) +
        '. This does not prove the pose is unreachable.'
    : stepFailure ? 'This is a continuity guard, not a physical joint-speed limit.'
      : 'A numerical search failure does not prove this pose is unreachable.';
  const rows = failure.joints.map(joint =>
    '<tr><th>' + escape(joint.name) + '</th><td>' + degrees(joint.angle).toFixed(1) +
    '°</td><td>' + degrees(joint.lower).toFixed(1) + ' … ' +
    degrees(joint.upper).toFixed(1) + '°</td></tr>').join('');
  return `
    <section class="flow-failure" id="flow-failure" aria-label="Path failure details">
      <h3>${title}</h3>
      <p><b>${escape(failure.phase)} · ${failure.time.toFixed(2)} s</b></p>
      ${segment ? '<p>Sample ' + segment.sample + ' / ' + segment.samples +
        ' in the ' + segment.startTime.toFixed(2) + '–' + segment.endTime.toFixed(2) +
        ' s segment (' + (segment.fraction * 100).toFixed(1) + '% of segment time).</p>' : ''}
      <p>${reason}</p>
      <dl class="flow-errors">
        <dt>Position error</dt><dd>${(failure.positionError * 1000).toFixed(2)} mm / ${failure.tolerance.position * 1000} mm allowed</dd>
        <dt>Orientation error</dt><dd>${degrees(failure.orientationError).toFixed(2)}° / ${failure.tolerance.orientationDegrees}° allowed</dd>
      </dl>
      <p>${independent}</p>
      <p><b>Joint-limit evidence:</b> ${nearbyLimits} Proximity alone does not establish the cause.</p>
      <div class="flow-failure-point">
        <b>Requested suction contact point</b>
        <span>X, Y, Z = ${cm(failure.target.position)} cm</span>
        <small>X/Y use the layout coordinates; Z is height above the floor.</small>
      </div>
      <p>${previous ? 'Last valid sample: ' + previous.time.toFixed(2) +
        ' s. The teal path ends there; the red × marks the rejected target.'
        : 'The initial approach failed; there is no valid preceding path sample.'}</p>
      <button class="flow-wide" data-flow-action="failure">Locate failure${previous ? ' · show last valid pose' : ''}</button>
      <details>
        <summary>Pose and joint details</summary>
        <p>Target relative to the robot base (local X, Y, Z): ${cm(failure.robotRelativePosition)} cm.</p>
        <p>Tool-face normal (world X, Y, Z): ${failure.toolDirection.map(value => value.toFixed(3)).join(', ')}.</p>
        <p>Best attempted tool position: ${cm(failure.tcp)} cm. This failed attempt is not animated.</p>
        <table><caption>Best attempt angles and URDF limits</caption><thead><tr><th>Joint</th><th>Angle</th><th>Range</th></tr></thead><tbody>${rows}</tbody></table>
      </details>
      <p class="flow-hint">Adjust the lift, arm/fixture positions or placement rotation and recheck. Collision testing is not implemented, so this stop is not a collision diagnosis.</p>
    </section>
  `;
}
