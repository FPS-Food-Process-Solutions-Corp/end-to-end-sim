// Keep evidence separate from scene configuration; changing the scene makes old
// results stale instead of silently relabelling them as current checks.
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function sceneKey(scene) {
  const {editor_options, editor_selection, order_camera, flow_video, ...layout} = scene;
  return JSON.stringify(canonical(layout));
}

export function beginValidation(store) {
  return {sceneKey: sceneKey(store.exportScene()), startedAt: new Date().toISOString()};
}

export function recordValidation(store, context, scope, request, result) {
  if (!context || !result) return;
  const record = {id: crypto.randomUUID(), ...context, scope,
    completedAt: new Date().toISOString(), request: structuredClone(request), result: structuredClone(result)};
  store.validationHistory = [...(store.validationHistory || []), record].slice(-8);
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function worldStatus(request, result) {
  if (!request?.collision?.enabled) return 'disabled';
  if (!result) return 'not_run';
  if (result.failure?.reason === 'world_collision') return 'blocked';
  return result.pathOK && result.collision?.enabled ? 'passed' : 'incomplete';
}

export async function validationReport(history, scene) {
  const key = sceneKey(scene), hash = await sha256(key);
  const records = await Promise.all(history.map(async (entry, index) => {
    const {request, result} = entry;
    return {id: entry.id, scope: entry.scope, started_at: entry.startedAt, completed_at: entry.completedAt,
      scene_sha256: await sha256(entry.sceneKey), matches_current_scene: entry.sceneKey === key,
      settings: request.settings, robot_id: request.robot?.id, bread_robot_id: request.breadTask?.robot?.id,
      path_status: result.pathOK && !request.errors?.length && (!request.breadTask || result.bread?.pathOK) ? 'passed' : 'failed',
      world_collision: worldStatus(request, result),
      bread_world_collision: request.breadTask ? worldStatus(request.breadTask, result.bread) : 'not_applicable',
      nova5_pair_collision: request.pairCollision?.enabled ? result.pairCollision?.status || 'not_run' : 'disabled',
      failure: result.bread?.failure || result.failure || null,
      evidence_file: `validation/check-${index + 1}.json`};
  }));
  return {schema_version: 1, scene_sha256: hash,
    history_scope: 'Latest eight completed checks in this browser session; not persisted across reloads.',
    current_scene_status: records.some(record => record.matches_current_scene) ? 'see_individual_checks' : 'not_run',
    export_runs_ik: false, records,
    limitations: ['Disabled collision checks are not passed checks.',
      'Only the named settings/order/robots were tested; a pass does not cover every drink or placement.',
      'A failed bounded search does not prove that no path exists.',
      'World boxes and held-object proxies are approximations. Self-collision, robot pairs other than the selected packing Novas, dynamics, grip forces and bag deformation are not validated.']};
}
