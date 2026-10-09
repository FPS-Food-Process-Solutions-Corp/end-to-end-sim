const KEY = 'layout-studio-interface-mode';
const requested = new URLSearchParams(location.search).get('mode');
let mode = 'standard';
try { if (localStorage.getItem(KEY) === 'advanced') mode = 'advanced'; } catch {}
if (['standard', 'advanced'].includes(requested)) mode = requested;
document.documentElement.dataset.studioMode = mode;
export const studioMode = () => mode;

export function installStudioMode({store, plan, view, order, bag, coffee, collisions, properties, onChange}) {
  const selector = document.getElementById('studio-mode');
  function apply(value, persist = true) {
    const next = value === 'advanced' ? 'advanced' : 'standard';
    if (view.activeRecorder?.active) {
      selector.value = mode;
      return false;
    }
    order.cancelChecks(); order.reset();
    bag.setActive(false); coffee.setActive(false);
    mode = next;
    if (persist) try {localStorage.setItem(KEY, mode);} catch {}
    document.documentElement.dataset.studioMode = mode;
    selector.value = mode;
    // This is a view preference, never part of scene or collision configuration.
    store.presentationMode = mode === 'standard';
    bag.suspended = coffee.suspended = store.presentationMode;
    if (mode === 'advanced' && order.routeKinds.length !== 2) order.ready = false;
    document.querySelector('[data-panel="flow"]').textContent = mode === 'standard' ? 'Preview' : 'Flow';
    document.getElementById('import-button').textContent = mode === 'standard' ? 'Open project' : 'Import';
    document.getElementById('import-file').accept = mode === 'standard' ? '.json' : '.json,.svg';
    document.querySelector('[data-export="json"]').textContent = mode === 'standard' ? 'Save project' : 'JSON · editable scene';
    document.querySelector('[data-export="png"]').textContent = mode === 'standard' ? 'Save image' : 'PNG · current 3D view';
    properties(); plan.render();
    if (view.ready) {view.updateGuides(); collisions.renderShapes();}
    onChange(mode);
    return true;
  }
  selector.addEventListener('change', () => apply(selector.value));
  apply(mode, false);
  return {setMode:apply, get mode() {return mode;}};
}
