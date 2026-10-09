import {pastryType, isPastry} from './pastries.js';
import {queueEntry, expandQueue, MAX_PASTRIES} from './drop-queue.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));

export class DropUI {
  constructor({state, commit, frame}) {
    this.getState = state; this.commit = commit; this.frame = frame;
    $('queue-add').onclick = () => {
      const state = this.getState(), pastry = state.objects.find(object => object.id === state.donut);
      const quantity = $('drop-quantity');
      if (!isPastry(pastry) || !quantity.reportValidity()) return;
      commit(() => state.dropQueue.push(queueEntry(pastry, state.drop, Number(quantity.value))));
      frame();
    };
    $('queue-clear').onclick = () => commit(() => {this.getState().dropQueue = [];});
    $('queue-list').addEventListener('change', event => {
      const input = event.target, row = input.closest('[data-entry]');
      if (!row || !input.dataset.key || !input.reportValidity()) return;
      const state = this.getState(), entry = state.dropQueue.find(item => item.id === row.dataset.entry);
      const value = Number(input.value) / (input.dataset.unit === 'length' && state.unit === 'mm' ? 10 : 1);
      commit(() => {
        const target = input.dataset.section ? entry[input.dataset.section] : entry;
        target[input.dataset.key] = value;
      });
      frame();
    });
    $('queue-list').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const state = this.getState(), index = state.dropQueue.findIndex(entry => entry.id === button.closest('[data-entry]').dataset.entry);
      commit(() => {
        if (button.dataset.action === 'remove') state.dropQueue.splice(index, 1);
        else {
          const to = index + (button.dataset.action === 'up' ? -1 : 1);
          [state.dropQueue[index], state.dropQueue[to]] = [state.dropQueue[to], state.dropQueue[index]];
        }
      });
    });
  }
  render(state) {
    this.state = state;
    $('drop-queue-panel').hidden = state.mode !== 'drop';
    $('pastry-select-label').textContent = state.mode === 'drop' ? 'Pastry to add' : 'Donut';
    $('interval-label').hidden = state.drop.cadence !== 'timed';
    const total = expandQueue(state.dropQueue).length;
    $('queue-count').textContent = `${total} / ${MAX_PASTRIES}`;
    $('queue-clear').disabled = !total;
    $('queue-add').disabled = total >= MAX_PASTRIES || !isPastry(state.objects.find(object => object.id === state.donut));
    const open = new Set([...$('queue-list').querySelectorAll('details[open]')].map(row => row.dataset.entry));
    const factor = state.unit === 'mm' ? 10 : 1;
    const field = (value, key, label, section, min, max, unit = 'length', suffix = '') => {
      const f = unit === 'length' ? factor : 1;
      return `<label>${label}<span class="input-unit"><input aria-label="Queued ${esc(label)} ${suffix}" data-key="${key}" data-section="${section}" data-unit="${unit}" type="number" required min="${min * f}" max="${max * f}" step="${key === 'quantity' ? 1 : .1 * f}" value="${Number((value * f).toFixed(3))}"><span>${unit === 'length' ? state.unit : unit === 'angle' ? '°' : ''}</span></span></label>`;
    };
    $('queue-list').innerHTML = state.dropQueue.map((entry, index) => {
      const type = pastryType(entry.pastry), suffix = index + 1;
      const dimensions = type.fields.map(({key}) => Number((entry.pastry[key] * factor).toFixed(2))).join(' × ');
      return `<details class="queue-entry" data-entry="${esc(entry.id)}" ${open.has(entry.id) ? 'open' : ''}>
        <summary><strong>${index + 1}. ${esc(entry.pastry.name)} × ${entry.quantity}</strong><small>${dimensions} ${state.unit}<span data-progress="${esc(entry.id)}"></span></small></summary>
        <div class="queue-edit">${field(entry.quantity, 'quantity', 'Quantity', '', 1, MAX_PASTRIES, '', suffix)}
        ${type.fields.map(({key, label}) => field(entry.pastry[key], key, label, 'pastry', .1, 200, 'length', suffix)).join('')}
        <p>Release for this entry</p>
        ${[['height', 'Above rim', .1, 100, 'length'], ['x', 'Offset X', -100, 100, 'length'], ['z', 'Offset Z', -100, 100, 'length'], ['tilt', 'Tilt', -180, 180, 'angle'], ['yaw', 'Heading', -180, 180, 'angle']].map(([key, label, min, max, unit]) => field(entry.release[key], key, label, 'release', min, max, unit, suffix)).join('')}
        <div class="queue-buttons"><button data-action="up" aria-label="Move entry ${suffix} up" ${index === 0 ? 'disabled' : ''}>↑</button><button data-action="down" aria-label="Move entry ${suffix} down" ${index === state.dropQueue.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove">Remove</button></div></div></details>`;
    }).join('') || '<p class="queue-help">Select a pastry, set a quantity and click Add to queue. Mix sizes by adding more entries.</p>';
  }
  status(report) {
    const state = this.state;
    if (!state) return;
    const factor = state.unit === 'mm' ? 10 : 1;
    const fmt = value => `${Number((value * factor).toFixed(2))} ${state.unit}`;
    const labels = {ready: 'Run queue', running: 'Pause', paused: 'Run / resume queue', done: 'Run again', loading: 'Loading…', unavailable: 'Run queue', blocked: 'Retry queue'};
    $('drop-play').textContent = labels[report.status] || 'Run queue';
    $('drop-play').disabled = ['loading', 'unavailable'].includes(report.status);
    $('drop-next').disabled = !report.pending || report.status === 'loading' || report.status === 'unavailable';
    if (state.mode !== 'drop') return;
    const heading = {ready: 'Ready to release', running: 'Dropping…', paused: 'Paused / ready for next', loading: 'Preparing physics…', unavailable: 'Add pastries to the queue', blocked: 'Release blocked', done: report.timedOut ? 'Test stopped' : 'Queue finished'}[report.status];
    const progress = `${report.released} / ${report.total} released${report.time === undefined ? '' : ' · ' + report.time.toFixed(2) + ' s'}${report.slowPlayback ? '<br>Adaptive playback · keeping controls responsive' : ''}`;
    const last = report.items?.at(-1);
    $('drop-status').innerHTML = `<strong>${esc(heading || 'Drop test')}</strong>${progress}${report.message ? '<p class="drop-warning">' + esc(report.message) + '</p>' : ''}${last ? '<br>' + esc(last.name) + ': ' + esc(last.outcome) : ''}<small>Pastry-to-pastry and bag collisions · rigid shapes<br>Ghost previews are excluded from GLB exports.</small>`;
    const counts = new Map();
    for (const item of report.items || []) {
      const entryId = state.dropQueue.find(entry => item.id.startsWith(entry.id + ':'))?.id;
      counts.set(entryId, (counts.get(entryId) || 0) + 1);
    }
    document.querySelectorAll('[data-progress]').forEach(element => {element.textContent = counts.has(element.dataset.progress) ? ' · ' + counts.get(element.dataset.progress) + ' released' : ' · queued';});
    $('drop-results-list').innerHTML = report.items?.length ? report.items.map(item => `<div class="landing-result"><strong>${esc(item.name)}</strong><span>${esc(item.outcome)}</span><small>Centre X ${fmt(item.centerCm[0])}, Z ${fmt(item.centerCm[2])}<br>Bottom ${fmt(item.bottomCm)} · tilt ${item.tiltDegrees.toFixed(1)}°<br>Touched: ${esc(item.contacts.join(', ') || '—')}</small></div>`).join('') : 'Run a test to see each pastry’s final position.';
  }
}
