import {translateText} from './i18n.js';
import {sceneAssetCatalog, addSceneAsset} from './asset-library.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const icons = {vent:'▧', table: '▱', counter: '▱', cart: '▱', shelf: '▤', machine: '▣',
  dispenser: '○', placement_zone: '▧', customer_barrier: '▯', human: '♙', charger: '▥', zone: '▧'};
const groups = ['Furniture', 'Robots', 'Coffee equipment', 'Bag fixtures', 'Customer area', 'Other'];

export class ComponentLibrary {
  constructor(store, plan, toast) {
    Object.assign(this, {store, plan, toast});
    this.host = document.getElementById('robot-library');
    this.search = document.getElementById('library-search');
    this.category = document.getElementById('library-category');
    this.category.innerHTML = '<option value="">All categories</option>' +
      groups.map(group => '<option>' + group + '</option>').join('');
    this.search.addEventListener('input', () => this.render());
    window.addEventListener('layout-language-change', () => this.render());
    this.category.addEventListener('change', () => this.render());
    this.host.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-robot],[data-asset]');
      if (!card) return;
      const robot = card.dataset.robot;
      event.dataTransfer.setData(robot ? 'application/robot-key' : 'application/scene-asset-key',
        robot || card.dataset.asset);
      event.dataTransfer.effectAllowed = 'copy';
    });
    this.host.addEventListener('click', event => {
      const card = event.target.closest('[data-robot],[data-asset]');
      if (!card) return;
      const robot = card.dataset.robot;
      if (robot) {
        const selected = store.object(store.selected[0]);
        const support = selected && ['table', 'cart', 'counter', 'support'].includes(selected.kind) ? selected : null;
        store.addRobot(robot, support?.x ?? 1.8, support?.y ?? 2.9);
        toast(store.scene.robot_inventory[robot].name + ' added to both views');
      } else {
        const id = addSceneAsset(store, card.dataset.asset);
        if (!id) return;
        toast(store.object(id).label + ' added. Adjust its size and position in Properties.');
      }
      plan.fit();
    });
    store.on(type => {
      if (!['preview', 'selection', 'workflow', 'camera'].includes(type)) this.render();
    });
    this.render();
  }

  render() {
    const {store} = this;
    const assets = sceneAssetCatalog(store).map(asset => ({
      ...asset, icon: icons[asset.spec.kind] || '▣',
      description: [asset.spec.width, asset.spec.depth, asset.spec.height || .003]
        .map(size => store.format(size, false)).join(' × ') + ' ' + store.options.units,
      tag: 'data-asset="' + escape(asset.key) + '"',
    }));
    for (const [key, robot] of Object.entries(store.scene.robot_inventory)) assets.push({
      key, category: 'Robots', name: robot.name, icon: key === 'atom_w' ? '♜' : '◇',
      description: 'R ' + (robot.working_radius_cm + robot.tool_length_cm).toFixed(1) + ' / ' +
        (robot.working_radius_cm * store.scene.reach_ratio).toFixed(1) + ' cm',
      tag: 'data-robot="' + escape(key) + '"',
    });
    const query = this.search.value.trim().toLowerCase();
    const matches = assets.filter(asset =>
      (!this.category.value || asset.category === this.category.value) &&
      (asset.name + ' ' + asset.category + ' ' + asset.key + ' ' + translateText(asset.name) + ' ' + translateText(asset.category)).toLowerCase().includes(query));
    document.getElementById('library-count').textContent = assets.length;
    document.getElementById('library-results').textContent = matches.length + ' assets';
    this.host.innerHTML = groups.map(group => {
      const entries = matches.filter(asset => asset.category === group);
      if (!entries.length) return '';
      return '<section class="library-section"><h3>' + group + '</h3>' + entries.map(asset =>
        '<div class="robot-card asset-card" draggable="true" ' + asset.tag + '>' +
        '<span class="robot-icon" aria-hidden="true">' + asset.icon + '</span><div><strong>' +
        escape(asset.name) + '</strong><small>' + escape(asset.description) + '</small>' +
        (asset.betweenShelves ? '<small>Starts between Shelf 1 and Shelf 2</small>' : '') +
        (asset.floorTea ? '<small>Floor-mounted · HZ-D01 reference</small>' : '') +
        '</div><button '+(asset.key === 'customer_barrier' ? 'data-add-barrier ' : '') +
        'title="Add ' + escape(asset.name) + '" aria-label="Add ' + escape(asset.name) + '">+</button></div>'
      ).join('') + '</section>';
    }).join('') || '<p class="library-empty">No matching assets. Try another name or category.</p>';
  }
}
