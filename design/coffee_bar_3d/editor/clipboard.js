import {captureComponents, insertComponents, parseComponents} from './component-copy.js';

const STORAGE = 'coffee-layout-components-v1';
const MIME = 'application/x-coffee-layout-components+json';

function editingText(target) {
  return target?.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName);
}

export function installComponentClipboard(store, {copyButton, pasteButton, toast}) {
  let packet = null;
  let lastPasteId = null;
  let pasteCount = 0;
  try {
    packet = parseComponents(localStorage.getItem(STORAGE) || '');
  } catch {
    // The in-memory clipboard still works when browser storage is unavailable.
  }

  function updateButtons() {
    copyButton.disabled = !store.resolve().length;
    pasteButton.disabled = !packet;
  }

  function remember(value) {
    packet = value;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(value));
    } catch {}
    updateButtons();
  }

  function copySelection() {
    const value = captureComponents(store);
    if (!value) return null;
    remember(value);
    toast('Copied ' + value.objects.length + ' component' +
      (value.objects.length === 1 ? '' : 's'));
    return value;
  }

  function paste(value = packet) {
    if (!value) {
      toast('Copy components first');
      return;
    }
    const nextCount = value.copyId === lastPasteId ? pasteCount + 1 : 1;
    try {
      const count = insertComponents(store, value, {
        dx: .15 * nextCount,
        dy: -.15 * nextCount,
      });
      lastPasteId = value.copyId;
      pasteCount = nextCount;
      remember(value);
      toast('Pasted ' + count + ' component' + (count === 1 ? '' : 's'));
    } catch (error) {
      toast('Could not paste: ' + error.message);
    }
  }

  // Native clipboard events handle Ctrl/Cmd+C and Ctrl/Cmd+V without read prompts.
  document.addEventListener('copy', event => {
    if (editingText(event.target) || window.getSelection()?.toString()) return;
    const value = copySelection();
    if (!value || !event.clipboardData) return;
    const text = JSON.stringify(value);
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData(MIME, text);
    event.preventDefault();
  });
  document.addEventListener('paste', event => {
    if (editingText(event.target)) return;
    const text = event.clipboardData?.getData(MIME) ||
      event.clipboardData?.getData('text/plain') || '';
    const value = parseComponents(text);
    if (!value) return;
    event.preventDefault();
    paste(value);
  });

  copyButton.addEventListener('click', () => {
    const value = copySelection();
    if (!value) return;
    // Also make toolbar copies available to native Paste in another editor tab.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(value)).catch(() => {});
    }
  });
  pasteButton.addEventListener('click', () => paste());
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE) return;
    packet = parseComponents(event.newValue || '');
    updateButtons();
  });
  store.on(updateButtons);
  updateButtons();
}
