import {pastrySnapshot, validatePastry} from './pastries.js';

export const MAX_PASTRIES = 20;
export const RELEASE_FIELDS = ['height', 'x', 'z', 'tilt', 'yaw'];
export const releaseSettings = settings => Object.fromEntries(RELEASE_FIELDS.map(key => [key, settings[key]]));
export function queueEntry(pastry, settings, quantity = 1, id = crypto.randomUUID()) {
  return {id, pastry: pastrySnapshot(pastry), quantity, release: releaseSettings(settings)};
}
export function validateRelease(release) {
  for (const [key, min, max] of [['height', .1, 100], ['x', -100, 100], ['z', -100, 100], ['tilt', -180, 180], ['yaw', -180, 180]]) {
    if (!Number.isFinite(release?.[key]) || release[key] < min || release[key] > max) throw Error('Invalid release setting: ' + key);
  }
}
export function validateQueue(queue) {
  if (!Array.isArray(queue) || queue.length > MAX_PASTRIES) throw Error('Drop queue must contain at most 20 pastries.');
  const ids = new Set();
  let total = 0;
  for (const entry of queue) {
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw Error('Drop queue entries need unique IDs.');
    ids.add(entry.id);
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_PASTRIES) throw Error('Quantity must be 1–20.');
    total += entry.quantity;
    validatePastry(entry.pastry);
    validateRelease(entry.release);
  }
  if (total > MAX_PASTRIES) throw Error('Use at most 20 pastries per test.');
}
export function expandQueue(queue) {
  return queue.flatMap(entry => Array.from({length: entry.quantity}, (_, index) => ({
    id: `${entry.id}:${index}`, entryId: entry.id, pastry: entry.pastry, release: entry.release,
  })));
}
