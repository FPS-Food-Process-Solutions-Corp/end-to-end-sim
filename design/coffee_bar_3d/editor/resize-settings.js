import {resizeControls, changeResizeControl} from './resize-ui.js';

export function installResizeSettings(store) {
  const button = document.getElementById('resize-settings-button');
  const panel = document.createElement('div');
  panel.id = 'resize-settings-panel';
  panel.className = 'property-section resize-settings-panel';
  panel.setAttribute('popover', 'auto');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Resize settings');
  document.getElementById('studio-view').append(panel);
  button.setAttribute('popovertarget', panel.id);
  button.setAttribute('aria-expanded', 'false');

  function render() {
    panel.innerHTML = `<div class="resize-settings-heading"><h3>Resize settings</h3>
      <button type="button" data-close-resize aria-label="Close resize settings">×</button></div>
      ${resizeControls(store)}`;
  }
  panel.addEventListener('beforetoggle', event => {
    if (event.newState === 'open') render();
    else panel.replaceChildren();
  });
  panel.addEventListener('toggle', event => button.setAttribute('aria-expanded', String(event.newState === 'open')));
  panel.addEventListener('change', event => changeResizeControl(event, store));
  panel.addEventListener('click', event => {
    if (event.target.closest('[data-close-resize]')) {
      panel.hidePopover();
      button.focus({preventScroll: true});
    }
  });
  // Close settings without clearing the selection or leaving fullscreen.
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.matches(':popover-open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      panel.hidePopover();
      button.focus({preventScroll: true});
    }
  }, true);
  store.on(type => {
    if (type === 'option' && panel.matches(':popover-open')) render();
  });
}
