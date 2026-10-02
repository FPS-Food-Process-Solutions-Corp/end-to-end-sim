import {corners, rotate} from './store.js';

export const SUPPORT_KINDS = ['table', 'counter', 'cart', 'support'];
const EPSILON = .0001; // 0.1 mm numerical tolerance; do not hide real overhangs.
const escape = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

function footprint(zone, table) {
  const worldCorners = corners(zone);
  const localCorners = worldCorners.map(point =>
    rotate(point[0] - table.x, point[1] - table.y, -(table.yaw_deg || 0)));
  const min = [0, 1].map(axis => Math.min(...localCorners.map(point => point[axis])));
  const max = [0, 1].map(axis => Math.max(...localCorners.map(point => point[axis])));
  const half = [table.width / 2, table.depth / 2];
  const inside = localCorners.every(point => point.every((value, axis) => Math.abs(value) <= half[axis] + EPSILON));
  const canTranslate = [0, 1].every(axis => max[axis] - min[axis] <= half[axis] * 2 + EPSILON);
  const shift = [0, 1].map(axis => max[axis] > half[axis] ? half[axis] - max[axis]
    : min[axis] < -half[axis] ? -half[axis] - min[axis] : 0);
  const correction = canTranslate ? rotate(...shift, table.yaw_deg || 0) : null;
  return {worldCorners, localCorners, min, max, half, inside, correction};
}

export function placementAssessment(store, zone) {
  if (!zone) return null;
  const support = store.object(zone.support);
  const validSupport = support && SUPPORT_KINDS.includes(support.kind);
  const candidates = store.scene.objects.filter(table =>
    table.id !== support?.id && SUPPORT_KINDS.includes(table.kind) &&
    store.visible(table.id) && footprint(zone, table).inside)
    .map(table => ({id: table.id, label: table.label}));
  if (!validSupport) return {zoneId: zone.id, supportId: zone.support || null, validSupport: false, inside: false, candidates};
  const result = footprint(zone, support);
  const tableCorners = corners(support);
  const edges = [
    {axis: 0, sign: -1, label: 'left (local −X)', indexes: [3, 0]},
    {axis: 0, sign: 1, label: 'right (local +X)', indexes: [1, 2]},
    {axis: 1, sign: -1, label: 'front (local −Y)', indexes: [0, 1]},
    {axis: 1, sign: 1, label: 'back (local +Y)', indexes: [2, 3]},
  ];
  const overhangs = edges.map(edge => ({
    ...edge,
    amount: edge.sign < 0 ? -result.half[edge.axis] - result.min[edge.axis]
      : result.max[edge.axis] - result.half[edge.axis],
    points: edge.indexes.map(index => tableCorners[index]),
  })).filter(edge => edge.amount > EPSILON);
  return {
    ...result, zoneId: zone.id, supportId: support.id, supportLabel: support.label,
    validSupport: true, tableCorners, overhangs, candidates,
    tableHeight: store.z(support) + support.height,
    zoneHeight: store.z(zone),
    outsideCorners: result.localCorners.flatMap((point, index) =>
      point.some((value, axis) => Math.abs(value) > result.half[axis] + EPSILON) ? [index] : []),
  };
}

export function placementError(assessment) {
  if (!assessment?.validSupport) return 'Assign the placement rectangle to a table or counter.';
  if (assessment.inside) return null;
  return 'Placement rectangle extends beyond "' + assessment.supportLabel + '" (' + assessment.supportId + '): ' +
    assessment.overhangs.map(edge => edge.label + ' edge by ' + (edge.amount * 100).toFixed(2) + ' cm').join('; ') + '.';
}

export function placementMarkup(store, zone) {
  const assessment = placementAssessment(store, zone);
  if (!zone) return '<p class="flow-warning">No active placement rectangle. Draw or choose one below.</p>';
  const table = store.object(zone.support);
  const locked = store.locked(zone.id);
  const options = store.scene.objects.filter(object => SUPPORT_KINDS.includes(object.kind))
    .map(object => '<option value="' + escape(object.id) + '" ' +
      (object.id === zone.support ? 'selected' : '') + '>' + escape(object.label) + '</option>').join('');
  const candidates = !assessment.inside && assessment.candidates.length
    ? '<p>This rectangle fits on: ' + assessment.candidates.map(item => escape(item.label)).join(', ') +
      '. Choose the intended support above.</p>' : '';
  return `
    <section class="flow-placement ${assessment.inside ? 'ok' : 'failed'}" id="flow-placement">
      <b>Active placement rectangle</b>
      <p>${escape(zone.label)}<small>${escape(zone.id)}</small></p>
      <label class="flow-field">Assigned support table
        <select data-flow-support aria-label="Placement support table" ${locked ? 'disabled' : ''}>
          <option value="">Choose a table…</option>${options}
        </select>
      </label>
      ${table ? '<small>' + store.format(table.width) + ' × ' + store.format(table.depth) +
        ' · rotation ' + (table.yaw_deg || 0).toFixed(1) + '°</small>' : ''}
      <p class="flow-boundary-status">${assessment.inside
        ? 'All four corners fit on this table.'
        : escape(placementError(assessment))}</p>
      ${candidates}
      <button class="flow-wide" data-flow-action="placement">Inspect placement &amp; table</button>
      ${assessment.validSupport && !assessment.inside ? '<button class="flow-wide" data-flow-action="fit-zone" ' +
        (locked || !assessment.correction ? 'disabled' : '') + '>Move rectangle inside this table</button>' : ''}
      ${assessment.validSupport && !assessment.inside && !assessment.correction
        ? '<p>The rotated rectangle is too large to fit by moving alone. Resize it or choose a larger table.</p>' : ''}
      <p class="flow-hint">The green placement rectangle must fit its assigned table. Reach guides are separate. Dragging it onto another table keeps its existing support until you change it here.</p>
    </section>
  `;
}
