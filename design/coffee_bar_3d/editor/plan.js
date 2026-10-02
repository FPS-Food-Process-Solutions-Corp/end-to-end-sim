import {bounds,rotate,rad,clone} from './store.js';
const NS='http://www.w3.org/2000/svg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const palette={placement_zone:['#d8f3e9','#279c83'],table:['#edf1f2','#81949e'],counter:['#e5efec','#658b83'],cart:['#f3eee6','#9a886e'],shelf:['#edf2e8','#799668'],robot:['#edf7f5','#2b8b82'],machine:['#fff','#728e9d'],dispenser:['#fff','#728e9d'],charger:['#edf1f3','#7b919c'],human:['#eee6de','#ab9078'],zone:['none','#adbbc3']};
const abbreviations={bag_opener:'Open bag',bag_magazine:'Bag magazine',coffee_machine:'Coffee',tea_machine:'Tea',ice_machine:'Ice',milk_fridge:'Milk',lid_machine:'Lid press',cup_dispenser:'Cups',lid_dispenser:'Lids',coffee_station:'COFFEE / PICKUP',left_counter:'LEFT WORK COUNTER',right_counter:'RIGHT COUNTER',upper_counter:'COUNTER',middle_counter:'COUNTER'};

export class PlanView {
  constructor(svg,store){
    this.svg=svg;this.store=store;this.drag=null;this.space=false;this.view=null;
    this.svg.addEventListener('pointerdown',e=>this.down(e));
    window.addEventListener('pointermove',e=>this.move(e));window.addEventListener('pointerup',e=>this.up(e));
    svg.addEventListener('wheel',e=>this.wheel(e),{passive:false});
    svg.addEventListener('contextmenu',e=>e.preventDefault());
    svg.addEventListener('dragover',e=>e.preventDefault());
    svg.addEventListener('drop',e=>{e.preventDefault();const key=e.dataTransfer.getData('application/robot-key');if(store.scene.robot_inventory[key]){const p=this.point(e);store.addRobot(key,p.x/200,store.scene.room.depth-p.y/200);}});
    window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){this.space=true;e.preventDefault();}});
    window.addEventListener('keyup',e=>{if(e.code==='Space')this.space=false;});
    this.fit();store.on(()=>this.render());
  }
  beginPlacementZone(callback) {
    this.placementDrawer = callback;
    this.svg.style.cursor = 'crosshair';
  }
  point(e){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());return {x:p.x,y:p.y};}
  toPlan(p){return [p[0]*200,(this.store.scene.room.depth-p[1])*200];}
  fit(){const s=this.store.scene,bb=bounds(s.objects.filter(o=>this.store.visible(o.id)));const x0=Math.min(0,bb.x-bb.width/2)*200-75,x1=Math.max(s.room.width,bb.x+bb.width/2)*200+75,y0=Math.min(0,s.room.depth-bb.y-bb.depth/2)*200-85,y1=Math.max(s.room.depth,s.room.depth-bb.y+bb.depth/2)*200+90;this.view={x:x0,y:y0,width:x1-x0,height:y1-y0};this.render();}
  setView(){this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.width} ${this.view.height}`);}
  zoom(factor,point=null){const p=point||{x:this.view.x+this.view.width/2,y:this.view.y+this.view.height/2};if(this.view.width*factor<80||this.view.width*factor>15000)return;this.view={x:p.x-(p.x-this.view.x)*factor,y:p.y-(p.y-this.view.y)*factor,width:this.view.width*factor,height:this.view.height*factor};this.setView();}
  wheel(e){e.preventDefault();this.zoom(Math.exp(Math.max(-120,Math.min(120,e.deltaY))*.0018),this.point(e));}
  down(e){
    if(e.button!==0&&e.button!==1&&e.button!==2)return;
    const p=this.point(e);
    if (this.placementDrawer && e.button === 0) {
      this.drag = {mode: 'placement-zone', start: p, end: p};
      e.preventDefault();
      return;
    }
    if(e.button!==0||this.space){this.drag={mode:'pan',client:[e.clientX,e.clientY],view:{...this.view}};e.preventDefault();return;}
    const handle=e.target.closest('[data-handle]')?.dataset.handle;
    const hit=e.target.closest('[data-object-id]')?.dataset.objectId;
    if(!handle&&!hit){this.store.select(null);this.drag={mode:'pan',client:[e.clientX,e.clientY],view:{...this.view}};return;}
    if(hit&&!handle){if(e.shiftKey){this.store.select(hit,true);return;}if(!this.store.resolve().some(o=>o.id===hit))this.store.select(hit);}
    const ids=[...this.store.selected];const items=this.store.resolve();if(!items.length||items.some(o=>this.store.locked(o.id)))return;
    const one=ids.length===1&&this.store.object(ids[0]);const bb=this.store.selectionBounds();const centre=this.toPlan([bb.x,bb.y]);
    this.drag={mode:handle==='rotate'?'rotate':handle?'resize':'move',p,ids,one:one?clone(one):null,bb,centre,startAngle:Math.atan2(p.y-centre[1],p.x-centre[0]),moved:false};this.store.begin();e.preventDefault();
  }
  move(e){
    const d=this.drag;if(!d)return;
    if (d.mode === 'placement-zone') {
      d.end = this.point(e);
      this.svg.querySelector('[data-zone-drawing]')?.remove();
      const rectangle = document.createElementNS(NS, 'rect');
      const values = {
        x: Math.min(d.start.x, d.end.x), y: Math.min(d.start.y, d.end.y),
        width: Math.abs(d.start.x - d.end.x), height: Math.abs(d.start.y - d.end.y),
        fill: '#36b89533', stroke: '#218a73', 'stroke-width': 2, 'stroke-dasharray': '6 4',
        'data-zone-drawing': 'true', 'pointer-events': 'none',
      };
      for (const [name, value] of Object.entries(values)) rectangle.setAttribute(name, value);
      this.svg.append(rectangle);
      return;
    }
    if(d.mode==='pan'){const rect=this.svg.getBoundingClientRect();const factor=Math.max(d.view.width/rect.width,d.view.height/rect.height);this.view={...d.view,x:d.view.x-(e.clientX-d.client[0])*factor,y:d.view.y-(e.clientY-d.client[1])*factor};this.setView();return;}
    const p=this.point(e);d.moved=true;
    this.store.preview(()=>{
      if(d.mode==='move'){
        let dx=(p.x-d.p.x)/200,dy=-(p.y-d.p.y)/200;
        if(this.store.options.snap&&!e.altKey){dx=Math.round(dx/.01)*.01;dy=Math.round(dy/.01)*.01;}
        this.store.move(d.ids,dx,dy);
      }else if(d.mode==='rotate'){
        let degrees=-(Math.atan2(p.y-d.centre[1],p.x-d.centre[0])-d.startAngle)*180/Math.PI;
        if(e.shiftKey)degrees=Math.round(degrees/15)*15;this.store.rotateSelection(d.ids,degrees,d.bb);
      }else{
        const dx=(p.x-d.centre[0])/200,dy=-(p.y-d.centre[1])/200;
        if(d.one){const q=rotate(dx,dy,-(d.one.yaw_deg||0));let w=Math.max(.02,2*Math.abs(q[0])),dep=Math.max(.02,2*Math.abs(q[1]));if(this.store.options.snap&&!e.altKey){w=Math.round(w/.01)*.01;dep=Math.round(dep/.01)*.01;}if(e.shiftKey){const factor=Math.max(w/d.one.width,dep/d.one.depth);w=d.one.width*factor;dep=d.one.depth*factor;}this.store.resize(d.one.id,w,dep);}
        else{let sx=Math.max(.05,Math.abs(dx)*2/d.bb.width),sy=Math.max(.05,Math.abs(dy)*2/d.bb.depth);if(e.shiftKey)sx=sy=Math.max(sx,sy);this.store.resizeGroup(d.ids,sx,sy);}
      }
    });
  }
  up() {
    if (!this.drag) return;
    if (this.drag.mode === 'placement-zone') {
      const {start, end} = this.drag;
      const callback = this.placementDrawer;
      this.drag = null;
      this.placementDrawer = null;
      this.svg.style.cursor = '';
      this.render();
      callback?.({
        x: (start.x + end.x) / 400,
        y: this.store.scene.room.depth - (start.y + end.y) / 400,
        width: Math.abs(end.x - start.x) / 200,
        depth: Math.abs(end.y - start.y) / 200,
      });
      return;
    }
    if (this.drag.mode !== 'pan') this.store.commit('Layout transformed');
    this.drag = null;
  }
  defs(){return `<defs><pattern id="planGrid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M 100 0 L 0 0 0 100" fill="none" stroke="#e8edef" stroke-width="1"/></pattern><marker id="dimArrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 7 3.5 L 0 7" fill="none" stroke="#327b82" stroke-width="1.2"/></marker></defs>`;}
  geometry(o){
    const w=o.width*200,d=o.depth*200,[fill,stroke]=palette[o.kind]||palette.table;
    let out='';const rect=(extra='')=>`<rect x="${-w/2}" y="${-d/2}" width="${w}" height="${d}" rx="${o.kind==='robot'?5:1}" fill="${fill}" stroke="${stroke}" stroke-width="1.8" ${extra}/>`;
    if(o.kind==='dispenser')out=`<circle r="${w/2}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
    else if(o.kind==='human')out=`<ellipse rx="${w/2}" ry="${d/2}" fill="${fill}" stroke="${stroke}"/><circle r="12" cy="-3" fill="#dbcab9" stroke="${stroke}"/>`;
    else out=rect(['zone','placement_zone'].includes(o.kind)?'stroke-dasharray="7 5"':'');
    if(o.kind==='placement_zone')out+=`<path d="M -7 0 H 7 M 0 -7 V 7" stroke="#279c83" stroke-width="2"/>`;
    if(o.kind==='cart')for(const x of [-w/2+6,w/2-12])for(const y of [-d/2+7,d/2-17])out+=`<rect x="${x}" y="${y}" width="6" height="10" rx="2" fill="#9a886e"/>`;
    if(o.kind==='machine'){out+=`<line x1="${-w/2+5}" y1="${d/2-3}" x2="${w/2-5}" y2="${d/2-3}" stroke="#3b7484" stroke-width="4"/><path d="M -5 ${d/2+5} L 0 ${d/2+12} L 5 ${d/2+5}" fill="none" stroke="#3b7484" stroke-width="2"/>`;}
    if (o.machine_type === 'bag_magazine') {
      for (let index = 0; index < 14; index++) {
        const y = -d / 2 + 7 + index * (d - 14) / 13;
        out += `<line x1="${-w * .32}" y1="${y}" x2="${w * .32}" y2="${y}" stroke="#aa8150" stroke-width="1.3"/>`;
      }
    }
    if(['bag_opener','me6_bag_opener'].includes(o.machine_type)){
      const p=o.bag_parameters,bw=p.bag_width*200,bd=p.bag_depth*200;
      out+=`<rect x="${-bw/2}" y="${-bd/2}" width="${bw}" height="${bd}" fill="#d9b678" stroke="#9b7548" stroke-width="1"/><rect x="${-bw/2+2}" y="${-bd/2+2}" width="${bw-4}" height="${bd-4}" fill="#f5e8cc" stroke="none"/><path d="M ${-bw/2-3} ${-bd/2-5} H ${bw/2+3}" stroke="#739199" stroke-width="3"/>`;
    }
    if(o.kind==='shelf'&&this.store.shelfSettings(o).tiers>0){
      const l=this.store.shelfLayout(o),s=l.settings,tw=l.trayWidth*200,td=l.trayDepth*200;
      out+=`<g data-shelf-columns="${s.columns}"><rect x="${-tw/2}" y="${-td/2}" width="${tw}" height="${td}" fill="none" stroke="#a6b7a1"/>`;
      for(let i=1;i<s.columns;i++)out+=`<line data-shelf-divider="true" x1="${-tw/2+tw*i/s.columns}" y1="${-td/2}" x2="${-tw/2+tw*i/s.columns}" y2="${td/2}" stroke="#9eaf97"/>`;
      if(s.show_buns)for(const p of l.bread){
        const py=(-p.y*Math.cos(l.slope)+p.z*Math.sin(l.slope))*200;
        const ry=Math.hypot(s.bread_length_2*Math.cos(l.slope),s.bread_height*Math.sin(l.slope))*100;
        out+=`<ellipse data-bread-ellipse="true" cx="${p.x*200}" cy="${py}" rx="${s.bread_length_1*100}" ry="${ry}" fill="#e6bc76" stroke="#b49663" stroke-width=".8"/>`;
      }out+='</g>';
    }
    if(o.kind==='charger')out+=`<rect x="${-w*.07}" y="${d*.20}" width="${w*.14}" height="${d*.30}" fill="#657f8a"/><rect x="${-w*.2}" y="${-d*.25}" width="${w*.4}" height="${d*.3}" fill="#b1d7d9"/>`;
    if(o.kind==='robot'){
      out+=`<circle r="3" fill="#26877d"/>`;
      if(this.store.key(o)==='atom_w'){for(const y of [-d/2+5,d/2-11])out+=`<rect x="-35" y="${y}" width="40" height="6" rx="2" fill="#25877e"/>`;out+=`<path d="M ${w/2-7} 0 L ${w/2+17} 0 m -7 -5 l 7 5 -7 5" fill="none" stroke="#25877e" stroke-width="2"/>`;}
    }
    return out;
  }
  objectMarkup(o){
    const [x,y]=this.toPlan([o.x,o.y]),a=-(o.yaw_deg||0),visible=this.store.visible(o.id),sel=this.store.resolve().some(v=>v.id===o.id);
    const title=(o.kind==='robot'?this.store.scene.robot_inventory[this.store.key(o)]?.name:null)||abbreviations[o.id]||o.label?.split(' / ')[0]||o.id;
    let text='';
    if(this.store.options.showLabels){
      const short=title.length>24?title.slice(0,23)+'…':title;
      let rotateLabel=0,ty=5,size=o.kind==='robot'?18:Math.min(19,Math.max(12,o.width*200/(short.length*.55)));
      if(o.kind==='robot'&&this.store.key(o)!=='atom_w')ty=-o.depth*100-11;
      if(o.kind==='cart'||o.id==='coffee_station')ty=o.depth*100-20;
      if(o.kind==='dispenser')ty=-o.depth*100-7;
      if(o.depth>o.width*2.5)rotateLabel=90;
      if(o.kind==='robot'||o.kind==='cart'||o.kind==='charger')rotateLabel=-a;
      else if(Math.abs(((a+rotateLabel+180)%360+360)%360-180)>90)rotateLabel+=180;
      text=`<text x="0" y="${ty}" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-size="${size}" fill="#496873" transform="rotate(${rotateLabel} 0 ${ty})" pointer-events="none">${esc(short)}</text>`;
    }
    return `<g id="object_${esc(o.id)}" data-object-id="${esc(o.id)}" data-name="${esc(o.label)}" transform="translate(${x} ${y}) rotate(${a})" ${!visible?'display="none"':''} class="${sel?'selected-object':''}"><title>${esc(o.label)}</title>${this.geometry(o)}${text}</g>`;
  }
  groupMarkup(id){const group=this.store.group(id);return `<g id="area_${esc(id)}" data-group-id="${esc(id)}" data-name="${esc(group.label)}"><title>${esc(group.label)}</title>${this.store.children(id).sort((a,b)=>Number(this.store.isGroup(a.id))-Number(this.store.isGroup(b.id))).map(o=>this.store.isGroup(o.id)?this.groupMarkup(o.id):this.objectMarkup(o)).join('')}</g>`;}
  annotationMarkup(){
    let out='<g data-name="Reach guides" pointer-events="none">';
    for(const o of this.store.relevantRobots(this.store.options.showAllReach)){
      if(o.show_reach===false)continue;const r=this.store.reach(o),p=this.toPlan(r.center);
      out+=`<g data-reach-owner="${esc(o.id)}"><circle cx="${p[0]}" cy="${p[1]}" r="${r.effective*200}" fill="none" stroke="#c97a42" stroke-width="2" stroke-dasharray="9 6"/><circle cx="${p[0]}" cy="${p[1]}" r="${r.placement*200}" fill="none" stroke="#178d98" stroke-width="2.2"/></g>`;
    }
    out+='</g><g id="Robot_distances" data-name="Robot distances" pointer-events="none">';
    const labelBoxes=[],arrows=[],labels=[];
    this.store.distances().forEach((d,i)=>{
      const a=this.toPlan(d.a),b=this.toPlan(d.b),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.max(1,Math.hypot(dx,dy)),offset=d.type==='edge'?17:-16;
      const text=(d.type==='edge'?'Gap ':'')+this.store.format(d.distance),w=text.length*8+15;
      let x,y,labelBox;
      search:for(const shift of [offset,-offset,offset*2,-offset*2,offset*3,-offset*3,offset*4,-offset*4])for(const fraction of [.5,.72,.28]){
        x=a[0]+dx*fraction-dy/len*shift;y=a[1]+dy*fraction+dx/len*shift;
        labelBox={x:x-w/2-3,y:y-15,w:w+6,h:29};
        if(!labelBoxes.some(r=>labelBox.x<r.x+r.w&&labelBox.x+labelBox.w>r.x&&labelBox.y<r.y+r.h&&labelBox.y+labelBox.h>r.y))break search;
      }
      labelBoxes.push(labelBox);
      const ux=dx/len,uy=dy/len,arrow=([px,py],sign)=>'M '+(px+ux*8*sign-uy*4)+' '+(py+uy*8*sign+ux*4)+' L '+px+' '+py+' L '+(px+ux*8*sign+uy*4)+' '+(py+uy*8*sign-ux*4);
      const heads=len>2?'<path data-distance-arrowheads="true" d="'+arrow(a,1)+' '+arrow(b,-1)+'" fill="none" stroke="#327b82" stroke-width="1.6"/>':'';

      arrows.push(`<g data-distance-arrow-robot="${esc(d.robot)}" data-distance-arrow-target="${esc(d.target)}"><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#327b82" stroke-width="1.6"/>${heads}</g>`);
      labels.push(`<g data-distance-robot="${esc(d.robot)}" data-distance-target="${esc(d.target)}" data-distance-metres="${d.distance}" data-distance-type="${d.type}"><title>${esc(d.label)}: ${esc(text)}</title><rect x="${x-w/2}" y="${y-12}" width="${w}" height="23" rx="5" fill="#fff" stroke="#c8dcdf"/><text x="${x}" y="${y+5}" text-anchor="middle" font-family="Inter,Segoe UI,sans-serif" font-size="15" fill="#25616a">${esc(text)}</text></g>`);
    });return out+'<g data-name="Distance arrows">'+arrows.join('')+'</g><g data-name="Distance labels">'+labels.join('')+'</g></g>';
  }
  selectionMarkup(){
    const items=this.store.resolve().filter(o=>this.store.visible(o.id));if(!items.length)return '';
    const one=this.store.selected.length===1&&this.store.object(this.store.selected[0]);const box=one||bounds(items),p=this.toPlan([box.x,box.y]),a=one?-(one.yaw_deg||0):0,w=box.width*200,h=box.depth*200;
    let out=`<g data-selection-overlay="true" transform="translate(${p[0]} ${p[1]}) rotate(${a})"><rect x="${-w/2-3}" y="${-h/2-3}" width="${w+6}" height="${h+6}" fill="none" stroke="#1469b4" stroke-width="1.6" pointer-events="none"/>`;
    if(!items.some(o=>this.store.locked(o.id))){
      for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]])out+=`<rect data-handle="resize" x="${sx*w/2-5}" y="${sy*h/2-5}" width="10" height="10" rx="1" fill="#fff" stroke="#1469b4" stroke-width="1.5" style="cursor:nwse-resize"/>`;
      out+=`<line x1="0" y1="${-h/2}" x2="0" y2="${-h/2-29}" stroke="#1469b4"/><circle data-handle="rotate" cx="0" cy="${-h/2-35}" r="7" fill="#fff" stroke="#1469b4" stroke-width="1.5" style="cursor:grab"/>`;
    }return out+'</g>';
  }
  markup(includeSelection=true){
    const s=this.store.scene,w=s.room.width*200,h=s.room.depth*200,crop=s.room.cropped_front_depth*200;
    let out=this.defs()+`<g id="Room_and_measurements" data-name="Room and measurements"><rect width="${w}" height="${h}" fill="#fff" stroke="#8d9da6" stroke-width="1.5"/><rect width="${w}" height="${h}" fill="url(#planGrid)"/><rect x="0" y="${h-crop}" width="${w}" height="${crop}" fill="#f7f7f3"/><line x1="0" y1="${h-crop}" x2="${w}" y2="${h-crop}" stroke="#b8c2c7" stroke-dasharray="6 5"/><text x="${w/2}" y="-33" text-anchor="middle" font-size="21" font-family="Inter,Segoe UI,sans-serif" fill="#536d79">${this.store.format(s.room.width)} wide</text><text x="-34" y="${h/2}" text-anchor="middle" font-size="21" font-family="Inter,Segoe UI,sans-serif" fill="#536d79" transform="rotate(-90 -34 ${h/2})">${this.store.format(s.room.depth)} deep</text><text x="${w/2}" y="${h+40}" text-anchor="middle" font-size="16" font-family="Inter,Segoe UI,sans-serif" fill="#8b999f">2 px = 1 cm · front reference strip is unconfirmed</text></g>`;
    out+=this.store.children(null).map(o=>this.store.isGroup(o.id)?this.groupMarkup(o.id):this.objectMarkup(o)).join('');
    if (this.store.placementOverlay) {
      const placement = this.store.placementOverlay;
      const points = values => values.map(point => this.toPlan(point).join(',')).join(' ');
      out += '<g data-placement-bounds="true" pointer-events="none">';
      out += `<polygon data-placement-table="${esc(placement.supportId)}" points="${points(placement.tableCorners)}" fill="none" stroke="#417bcc" stroke-width="3"/>`;
      out += `<polygon points="${points(placement.worldCorners)}" fill="none" stroke="${placement.inside ? '#26977e' : '#d64942'}" stroke-width="2.5" stroke-dasharray="5 3"/>`;
      for (const index of placement.outsideCorners) {
        const p = this.toPlan(placement.worldCorners[index]);
        out += `<circle data-placement-overhang="true" cx="${p[0]}" cy="${p[1]}" r="6" fill="#d64942" stroke="white" stroke-width="1.5"/>`;
      }
      out += '</g>';
    }
    if (this.store.workflowOverlay) {
      out += '<g data-name="IK samples" pointer-events="none">';
      for (const sample of this.store.workflowOverlay) {
        const p = this.toPlan(sample.position);
        if (sample.role === 'path-failure') {
          const last = sample.previousPosition ? this.toPlan(sample.previousPosition) : null;
          out += '<g data-workflow-failure="true">';
          if (last) out += `<line x1="${last[0]}" y1="${last[1]}" x2="${p[0]}" y2="${p[1]}" stroke="#d64942" stroke-width="2" stroke-dasharray="4 3"/>`;
          out += `<circle cx="${p[0]}" cy="${p[1]}" r="10" fill="#fff5f0" stroke="#d64942" stroke-width="2"/><path d="M ${p[0]-4} ${p[1]-4} l 8 8 m 0 -8 l -8 8" fill="none" stroke="#d64942" stroke-width="2"/><text x="${p[0]+15}" y="${p[1]-13}" font-size="12" font-family="Segoe UI,sans-serif" fill="#a32f2a" stroke="white" stroke-width="3" paint-order="stroke">Failed target</text><title>${esc(sample.name)}</title></g>`;
          continue;
        }
        const color = sample.ok ? '#218b77' : '#c46a4e';
        out += `<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${color}" stroke="white" stroke-width="1.5"><title>${esc(sample.name)}</title></circle>`;
      }
      out += '</g>';
    }
    out+=this.annotationMarkup();if(includeSelection)out+=this.selectionMarkup();return out;
  }
  render(){if(!this.view)return;this.setView();this.svg.innerHTML=this.markup();}
  async exportSVG(includeLibrary=true){
    const s=this.store.scene,w=s.room.width*200,h=s.room.depth*200;
    const doc=document.implementation.createDocument(NS,'svg');const svg=doc.documentElement;
    const bb=bounds(s.objects.filter(o=>this.store.visible(o.id))),left=Math.min(-80,(bb.x-bb.width/2)*200-60),right=Math.max(w+80,(bb.x+bb.width/2)*200+60),top=Math.min(-80,(s.room.depth-bb.y-bb.depth/2)*200-60),bottom=Math.max(h+80,(s.room.depth-bb.y+bb.depth/2)*200+60);
    let width=right-left,height=bottom-top;
    svg.setAttribute('aria-label','Editable coffee bar plan, 2 pixels per centimetre');
    const metadata=doc.createElementNS(NS,'metadata');metadata.id='coffee-scene-data';metadata.textContent=JSON.stringify(this.store.exportScene());svg.append(metadata);
    const wrap=doc.createElementNS(NS,'g');wrap.setAttribute('transform',`translate(${-left} ${-top})`);wrap.innerHTML=this.markup(false);svg.append(wrap);
    // Keep exported reach rings in the same area and copyable package as their robot.
    for(const reach of [...wrap.querySelectorAll('[data-reach-owner]')]){
      const robot=wrap.querySelector('[data-object-id="'+reach.getAttribute('data-reach-owner')+'"]');
      if(!robot)continue;
      const pack=doc.createElementNS(NS,'g');pack.setAttribute('data-name',(robot.getAttribute('data-name')||'Robot')+' + reach');pack.id='package_'+reach.getAttribute('data-reach-owner');
      robot.parentNode.insertBefore(pack,robot);pack.append(reach,robot);
    }
    const extentPoints=[];
    for(const o of this.store.relevantRobots(this.store.options.showAllReach)){const r=this.store.reach(o),c=this.toPlan(r.center);extentPoints.push([c[0]-r.effective*200,c[1]-r.effective*200],[c[0]+r.effective*200,c[1]+r.effective*200]);}
    const minX=Math.min(left,...extentPoints.map(p=>p[0]-20)),minY=Math.min(top,...extentPoints.map(p=>p[1]-20));
    width=Math.max(right,...extentPoints.map(p=>p[0]+20))-minX;height=Math.max(bottom,...extentPoints.map(p=>p[1]+20))-minY;
    wrap.setAttribute('transform','translate('+(-minX)+' '+(-minY)+')');
    if(includeLibrary){
      const response=await fetch('./editor/robot-reference.svg');if(response.ok){const ref=new DOMParser().parseFromString(await response.text(),'image/svg+xml').documentElement;const group=doc.createElementNS(NS,'g');group.setAttribute('data-name','Robot reference library');group.setAttribute('transform',`translate(${width+90} 0)`);for(const child of [...ref.children])if(child.tagName!=='title'&&child.tagName!=='desc')group.append(doc.importNode(child,true));svg.append(group);width+=90+1750;height=Math.max(height,1490);}
    }
    svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(svg);
  }
}
