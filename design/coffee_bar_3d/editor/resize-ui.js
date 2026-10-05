import {resizeMode} from './resize-geometry.js';

export function resizeControls(store) {
  const options = store.options;
  const mode = resizeMode(options);
  const option = (value, text, selected) =>
    `<option value="${value}" ${selected === value ? 'selected' : ''}>${text}</option>`;
  return `<div class="resize-controls">
    <label class="checkline resize-children-check"><input type="checkbox" data-resize-option="resizeKeepChildren" ${options.resizeKeepChildren !== false ? 'checked' : ''}> Keep child objects in place</label>
    <p class="hint resize-children-hint">Resizing a support keeps mounted items at the same room X/Y and size. Uncheck to move them with the resized support. Height changes still raise or lower them with the worktop. Group members selected for resizing still resize together.</p>
    <label class="field">Resize behaviour
      <select data-resize-option="resizeMode" aria-label="Resize behaviour">
        ${option('opposite', 'Keep opposite side fixed', mode)}
        ${option('center', 'Resize around centre', mode)}
      </select>
    </label>
    ${mode === 'opposite' ? `<div class="field-grid">
      <label class="field">Width field keeps
        <select data-resize-option="resizeAnchorX" aria-label="Width field keeps">
          ${option('left', 'Left edge', options.resizeAnchorX || 'left')}
          ${option('right', 'Right edge', options.resizeAnchorX || 'left')}
        </select>
      </label>
      <label class="field">Depth field keeps
        <select data-resize-option="resizeAnchorY" aria-label="Depth field keeps">
          ${option('top', 'Top edge', options.resizeAnchorY || 'top')}
          ${option('bottom', 'Bottom edge', options.resizeAnchorY || 'top')}
        </select>
      </label>
    </div>
    <p class="hint">Dragging fixes the opposite edge or corner. These choices apply to the size fields. Edges follow the object's rotation.</p>`
    : '<p class="hint">Dragging and size fields resize equally about the centre.</p>'}
  </div>`;
}

export function changeResizeControl(event, store) {
  const key = event.target.dataset.resizeOption;
  if (key === 'resizeKeepChildren') {
    store.setOption(key, event.target.checked);
    return true;
  }
  const choices = {resizeMode: ['opposite', 'center'], resizeAnchorX: ['left', 'right'], resizeAnchorY: ['top', 'bottom']};
  if (!choices[key]) return false;
  if (choices[key].includes(event.target.value)) store.setOption(key, event.target.value);
  return true;
}
