import {breadControls} from './bread-ui.js';
import {packingCollisionMarkup,pairCollisionMarkup} from './collision-ui.js';
import {coffeeSettings} from './coffee-geometry.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function orderMarkup(order) {
  const {store, busy, ready, recorder} = order;
  const locked = recorder.active;
  const s = coffeeSettings(store);
  const select = (key, label, values) => '<label class="flow-field">'+label+
    '<select data-order-coffee="'+key+'">'+values.map(([id, text]) =>
      '<option value="'+id+'" '+(s[key]===id?'selected':'')+'>'+text+'</option>').join('')+'</select></label>';
  const number = (key,label,value,min) => '<label class="flow-field">'+label+
    '<div class="flow-number"><input data-flow-setting="'+key+'" type="number" min="'+min+
    '" step=".1" value="'+Number((value*100).toFixed(2))+'"><span>cm</span></div></label>';
  const bread = breadControls(store,order.breadSettings(),order.routes.bag?.result,
    order.routes.bag?.request,number).replaceAll('data-flow-setting','data-order-bread');
  const card = (kind,label) => {
    const route=order.routes[kind] || {};
    const failure=route.result?.bread?.failure||route.result?.failure;
    return '<div class="order-route '+(route.ok?'ok':route.error?'failed':'')+'"><b>'+
      (route.ok?'✓ ':route.error?'! ':'○ ')+label+'</b><p id="order-route-'+kind+'">'+
      escape(route.message || 'Not checked')+'</p>'+(route.result&&!route.ok?'<button data-order-action="inspect-'+kind+'" '+(locked||busy?'disabled':'')+'>Inspect failed motion ↗</button>':'')+(['world_collision','robot_collision'].includes(failure?.reason)?'<button data-order-action="collision-'+kind+'">Locate collision</button>':'')+'<button data-order-action="edit-'+kind+
      '" '+(locked?'disabled':'')+'>Configure '+(kind==='bag'?'packing':'beverages')+' ↗</button></div>';
  };
  return [
    '<div class="flow-heading"><span class="live-dot"></span>SIMULATED ORDER</div>',
    '<h2>Bread + coffee.</h2>',
    '<p class="flow-intro">One bread bag and one drink. Both routes start together after their checks pass.</p>',
    '<fieldset class="order-fields" '+(locked||busy?'disabled':'')+'>',
    '<details class="flow-settings" open><summary>Drink order</summary>',
    select('drink','Drink',[['coffee','Coffee'],['milk_tea','Milk tea']]),
    select('temperature','Temperature',[['hot','Hot · paper cup'],['cold','Cold · plastic cup']]),
    '<div class="field-grid">',
    select('sugar','Sugar',[['100%','100%'],['50%','50%'],['0%','No sugar']]),
    select('milk','Milk',[['regular','Regular'],['oat','Oat'],['none','No milk']]),'</div>',
    s.temperature==='cold'?select('ice','Ice',[['regular','Regular'],['light','Light'],['none','No ice']]):'',
    '<label class="flow-field">Nova-2 maximum end-effector speed<div class="flow-number"><input type="number" min=".01" step=".1" data-order-coffee="max_tcp_speed" value="'+s.max_tcp_speed+'"><span>m/s</span></div></label>',
    '</details>',bread,'</fieldset>',
    '<div class="flow-actions"><button class="primary" data-order-action="place" '+(busy||locked?'disabled':'')+
      '>'+(busy?'Checking routes…':'Place combined order')+'</button></div>',
    '<div id="order-status" class="flow-status '+(order.failed?'failed':'')+'" role="status">'+escape(order.message)+'</div>',
    card('bag','Bread & bag'),pairCollisionMarkup(order.routes.bag?.request,order.routes.bag?.result,true),packingCollisionMarkup(order.routes.bag?.request,order.routes.bag?.result),card('coffee','Beverage'),
    '<div class="flow-player"><div class="flow-actions">',
    '<button data-order-action="play" id="order-play" '+(!ready||locked?'disabled':'')+'>'+
      (order.playing?'Ⅱ Pause':'▶ Play together')+'</button>',
    '<button data-order-action="reset" '+(locked?'disabled':'')+'>Reset</button></div>',
    '<input id="order-scrub" aria-label="Combined order timeline" type="range" min="0" max="'+
      (order.duration||1)+'" step=".02" value="'+order.time+'" '+(!ready||locked?'disabled':'')+'>',
    '<div class="flow-time"><span id="order-phase">Shared timeline</span><span id="order-time">0.0 s</span></div>',
    '<div class="order-tracks"><div><b>Bread</b><progress id="order-bag-progress" max="1" value="0"></progress>',
    '<span id="order-bag-phase">Waiting</span></div><div><b>Drink</b><progress id="order-coffee-progress" max="1" value="0"></progress>',
    '<span id="order-coffee-phase">Waiting</span></div></div></div>',
    '<details class="flow-settings" open><summary>Camera &amp; video</summary>',
    '<p class="flow-hint">Orbit and zoom to choose a view. Save it here to reuse for later orders.</p>',
    '<div class="flow-actions"><button data-order-action="frame" '+(locked?'disabled':'')+'>Frame both</button>',
    '<button data-order-action="save-camera" '+(locked?'disabled':'')+'>Save this POV</button></div>',
    '<button class="flow-wide" data-order-action="restore-camera" '+(!store.scene.order_camera||locked?'disabled':'')+'>Restore saved POV</button>',
    '<label class="flow-field">Video resolution<select id="order-video-height" '+(locked?'disabled':'')+'>'+
      [720,1080].map(h=>'<option value="'+h+'" '+(order.videoHeight===h?'selected':'')+'>'+h+'p · 30 fps</option>').join('')+'</select></label>',
    '<button class="primary flow-wide" data-order-action="record" '+(!ready||locked||!recorder.mimeType?'disabled':'')+'>Record full order from this view</button>',
    locked?'<button class="flow-wide danger" data-order-action="stop-record" '+(recorder.state==='stopping'?'disabled':'')+'>Stop recording</button>':'',
    '<p id="order-record-status" class="flow-hint">'+escape(recorder.state==='recording'?'● Recording · fixed camera':recorder.state==='stopping'?'Finishing video…':
      recorder.state==='ready'?recorder.reason+' · '+(recorder.blob.size/1048576).toFixed(1)+' MB':
      recorder.error||(!recorder.mimeType?'This browser does not support canvas video recording.':'Records only the 3D scene, without audio. The selected view is preserved with letterboxing when needed.'))+'</p>',
    recorder.url?'<button class="primary flow-wide" data-order-action="save-video">Save video · '+(recorder.mimeType.startsWith('video/mp4')?'MP4':'WebM')+'</button>':'',
    '</details><p class="flow-hint">Uses the configured packing equipment and drink stations. The optional Nova-5 pair check validates synchronized packing motion. Other robot pairs are not checked.</p>',
  ].join('');
}
