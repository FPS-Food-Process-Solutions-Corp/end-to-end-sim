const escape = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

export function motionControls(settings) {
  const field = (key, label, value, unit, min, max) =>
    '<label class="flow-field">' + label + '<div class="flow-number"><input type="number" ' +
    'data-flow-setting="' + key + '" data-flow-unit="' + unit + '" min="' + min +
    '" max="' + max + '" step=".1" value="' + Number(value.toFixed(2)) +
    '"><span>' + unit + '</span></div></label>';
  return `
    <details class="flow-settings" open><summary>Bag motion</summary>
      <label class="checkline"><input type="checkbox" data-flow-setting="prefer_j1" ${settings.prefer_j1 ? 'checked' : ''}> Favour J1 sweeps · allow longer paths</label>
      ${field('max_bag_tilt_deg', 'Maximum held-bag tilt', settings.max_bag_tilt_deg, '°', .01, 45)}
      ${field('min_j1_share', 'Minimum J1 share during sweeps', settings.min_j1_share * 100, '%', 0, 100)}
      ${field('extra_lift_search', 'Additional lift to search', settings.extra_lift_search * 100, 'cm', 0, 100)}
      <p class="flow-hint">Withdraw/lift → J1 sweep → upright alignment. Search both sweep directions, extra heights and two starting postures. Shoulder/elbow and wrist adjustments remain available for lifting and alignment.</p>
    </details>
  `;
}

export function motionSummary(result) {
  if (!result?.route || !result.motion) return '';
  const motion = result.motion;
  const search = result.routeSearch;
  const rows = motion.transfers.map(transfer =>
    '<tr><th>' + (transfer.id === 'fixed' ? 'To holder' : 'To placement') +
    '</th><td>' + (transfer.j1Share * 100).toFixed(1) + '%</td></tr>').join('');
  const travelRows = motion.travelDegrees?.map((value, index) =>
    '<tr><th>J' + (index + 1) + '</th><td>' + value.toFixed(1) + '°</td></tr>').join('') || '';
  return `
    <section class="flow-motion-summary" id="flow-motion-summary">
      <b>${result.pathOK ? 'Selected route' : 'Furthest tested route'} · ${result.route.duration.toFixed(1)} s</b>
      <p>${escape(result.route.label)}<br>Extra lift: ${(result.route.extraLift * 100).toFixed(1)} cm</p>
      <p>${search.passed || 0} / ${search.attempts.length} route/posture candidates passed.</p>
      ${motion.maxBagTiltDegrees !== undefined ? '<p>Peak bag tilt: <b>' +
        motion.maxBagTiltDegrees.toFixed(2) + '°</b><br>Conservative tilt bound: ' +
        motion.maxTiltBoundDegrees.toFixed(2) + '° / ' + motion.tiltLimitDegrees + '° allowed.</p>' : ''}
      ${rows ? '<table><caption>J1 share during transfer sweeps</caption><tbody>' + rows + '</tbody></table>' : ''}
      <p class="flow-hint">J1 share = J1 travel ÷ combined J1–J3 travel in each sweep. Lifting, withdrawal and final alignment use other joints. Wrist compensation is allowed.</p>
      <details><summary>Motion and search details</summary>
        <table><caption>Total joint travel · ${result.pathOK ? 'full sequence' : 'accepted partial path'}</caption><tbody>${travelRows}</tbody></table>
        <p>Extra height and duration apply only to this solved preview; component positions are unchanged.</p>
        <p>The search is bounded. Failure means none of the tested routes passed; it does not prove that no route exists.</p>
      </details>
    </section>
  `;
}
