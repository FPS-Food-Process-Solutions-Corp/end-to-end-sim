// Expand only the view area, retaining the view switcher and camera controls.
// Embedded browsers without the Fullscreen API still get a full-window view.
export function installFullscreenView(view, button) {
  let expanded = false;
  let nativeFullscreen = false;
  const surrounding = [...document.querySelectorAll('.topbar, .workspace > aside')];
  const previousInert = new Map();

  function setExpanded(value) {
    expanded = value;
    view.classList.toggle('view-fullscreen', value);
    button.textContent = value ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(value));
    button.title = value ? 'Exit fullscreen (Escape)' : 'Fullscreen the current view';
    for (const element of surrounding) {
      if (value) {
        if (!previousInert.has(element)) previousInert.set(element, element.inert);
        element.inert = true;
      } else if (previousInert.has(element)) {
        element.inert = previousInert.get(element);
        previousInert.delete(element);
      }
    }
    if (!value) button.focus({preventScroll: true});
  }

  async function exit() {
    if (document.fullscreenElement === view) {
      try { await document.exitFullscreen(); }
      catch { return; }
    }
    setExpanded(false);
  }

  button.addEventListener('click', async () => {
    if (expanded) return exit();
    setExpanded(true);
    if (!view.requestFullscreen || !document.fullscreenEnabled) return;
    try {
      await view.requestFullscreen();
      // Escape can be pressed before the browser completes its request.
      if (!expanded && document.fullscreenElement === view) await document.exitFullscreen();
    } catch {
      // Keep the full-window layout if the embedding app denies native fullscreen.
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === view) nativeFullscreen = true;
    else if (nativeFullscreen) {
      nativeFullscreen = false;
      setExpanded(false);
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void exit();
  }, true);
}
