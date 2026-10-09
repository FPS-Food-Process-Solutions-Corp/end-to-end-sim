import {messages as editorMessages, patterns as editorPatterns} from './i18n-zh-cn.js';
import {messages as flowMessages, patterns as flowPatterns} from './i18n-flow-zh-cn.js';

import {messages as standardMessages, patterns as standardPatterns} from './i18n-standard-zh-cn.js';

const STORAGE_KEY = 'layout-studio-language';
const messages = {...editorMessages, ...flowMessages, ...standardMessages};
const patterns = [...editorPatterns, ...flowPatterns, ...standardPatterns];
const normalize = text => text.replace(/\s+/g, ' ').trim();
let language = 'en';
try { if (localStorage.getItem(STORAGE_KEY) === 'zh-CN') language = 'zh-CN'; } catch {}

export const getLanguage = () => language;

// Project strings are deliberately not translated or written back to the scene.
// Keep the English strings as keys so saved workflow values remain compatible.
export function translateText(text, locale = language) {
  if (locale !== 'zh-CN' || typeof text !== 'string') return text;
  const key = normalize(text);
  if (!key) return text;
  let translated = Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (translated === undefined) {
    for (const [pattern, replacement] of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(key)) {
        pattern.lastIndex = 0;
        translated = key.replace(pattern, replacement);
        break;
      }
    }
  }
  if (translated === undefined) return text;
  return text.match(/^\s*/)[0] + translated + text.match(/\s*$/)[0];
}

export function installLanguageSelector({projectObject = () => null} = {}) {
  const selector = document.getElementById('ui-language');
  if (!selector) return;
  const textSources = new WeakMap();
  const attributeSources = new WeakMap();
  const attributes = ['title', 'placeholder', 'aria-label', 'alt'];
  const excluded = [
    'script', 'style', 'svg', 'canvas', 'textarea', 'code', 'pre',
    '[data-i18n-ignore]', '[translate="no"]', '[contenteditable="true"]',
    '.layer-label', '.snapshot-info > h3', '.snapshot-info > p',
    '.snapshot-info > time', '.target-list .checkline',
  ].join(',');

  function ignored(element) {
    if (!element || element.closest(excluded)) return true;
    const option = element.closest('option');
    // Dropdowns referring to an actual instance show that instance's saved name.
    if (option && projectObject(option.value)) return true;
    const status = element.closest('#selection-status');
    if (status?.dataset.projectLabel === 'true') return true;
    return false;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ignored(node.parentElement)) return;
      const previous = textSources.get(node);
      const source = previous && node.data === previous.rendered ? previous.source : node.data;
      const rendered = translateText(source);
      textSources.set(node, {source, rendered});
      if (node.data !== rendered) node.data = rendered;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || ignored(node)) return;
    // HTML derives an option's value from its text when value is omitted.
    // Freeze that English value before changing its displayed label.
    if (node.tagName === 'OPTION' && !node.hasAttribute('value')) node.value = node.textContent;
    const records = attributeSources.get(node) || {};
    for (const name of attributes) {
      if (!node.hasAttribute(name)) { delete records[name]; continue; }
      const current = node.getAttribute(name), previous = records[name];
      const source = previous && current === previous.rendered ? previous.source : current;
      const rendered = translateText(source);
      records[name] = {source, rendered};
      if (current !== rendered) node.setAttribute(name, rendered);
    }
    attributeSources.set(node, records);
    for (const child of node.childNodes) translateNode(child);
  }

  const observation = {subtree:true, childList:true, characterData:true,
    attributes:true, attributeFilter:attributes};
  const observer = new MutationObserver(records => {
    // Translate only changed subtrees; the SVG and WebGL scene are excluded.
    // Disconnect while writing translations to avoid feeding our own mutations
    // back into the observer or interrupting input focus and event handlers.
    observer.disconnect();
    try {
      const roots = new Set();
      for (const record of records) {
        if (record.type === 'childList') for (const node of record.addedNodes) roots.add(node);
        else roots.add(record.target);
      }
      for (const node of roots) if (node.isConnected) translateNode(node);
    } finally { observer.observe(document.body, observation); }
  });

  function apply(next) {
    language = next === 'zh-CN' ? 'zh-CN' : 'en';
    try {localStorage.setItem(STORAGE_KEY, language);} catch {}
    observer.disconnect();
    document.documentElement.lang = language;
    selector.value = language;
    translateNode(document.body);
    document.title = language === 'zh-CN' ? '咖啡吧 · 布局工作室' : 'Coffee bar · Layout studio';
    observer.observe(document.body, observation);
    window.dispatchEvent(new CustomEvent('layout-language-change', {detail:{language}}));
  }

  selector.addEventListener('change', () => apply(selector.value));
  apply(language);
  return {setLanguage:apply, refresh:() => apply(language), disconnect:() => observer.disconnect()};
}
