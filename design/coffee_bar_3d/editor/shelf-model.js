import * as THREE from '../vendor/three.module.js';
import {shelfLayout} from './shelf-parameters.js';

// All generated parts use metres and the same tilted-tier geometry as Blender.
export function buildShelf(scene,object,source){
  const layout=shelfLayout(scene,object),s=layout.settings,root=new THREE.Group();root.name='Parametric bread shelf';
  let steelSource,darkSource,breadSource,labelSource;
  source?.traverse(n=>{if(n.name.startsWith('Continuous_solid_stainless'))steelSource=n.material;if(n.name.startsWith('Rack_foot'))darkSource=n.material;if(n.name.startsWith('Bun__scale_placeholder'))breadSource=n.material;if(n.name.startsWith('Shelf_label'))labelSource=n;});
  const steel=steelSource?.clone()||new THREE.MeshStandardMaterial({color:0xc4cbcc,metalness:.8,roughness:.28});
  const dark=darkSource?.clone()||new THREE.MeshStandardMaterial({color:0x2a3439,roughness:.55});
  const breadMaterial=breadSource?.clone()||new THREE.MeshStandardMaterial({color:0xdba657,roughness:.8});
  const unitBox=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,28,18),foot=new THREE.CylinderGeometry(.021,.021,.02,20);
  const mesh=(geometry,material,name,parent)=>{const m=new THREE.Mesh(geometry,material);m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const box=(name,pos,size,parent=root)=>{const m=mesh(unitBox,steel,name,parent);m.position.set(pos[0],pos[2],-pos[1]);m.scale.set(size[0],size[2],size[1]);return m;};
  const w=object.width,d=object.depth,h=object.height,post=s.post_width;
  for(const x of [-w/2+post/2,w/2-post/2])for(const y of [-d/2+post/2,d/2-post/2]){
    box('Rack post',[x,y,h/2],[post,post,h]);const f=mesh(foot,dark,'Rack foot',root);f.position.set(x,.01,-y);
  }
  for(let i=0;i<s.tiers;i++){
    const tier=new THREE.Group();tier.name='Tier '+(i+1)+' / '+s.columns+' columns';tier.userData={shelf_tier:i+1,columns:s.columns,front_bottom_height_m:s.first_tier_front_height+i*s.tier_spacing};
    tier.position.y=s.first_tier_front_height+i*s.tier_spacing+s.back_to_front_drop/2+s.sheet_thickness*Math.cos(layout.slope);tier.rotation.x=layout.slope;root.add(tier);
    box('Continuous solid stainless tier base',[0,0,-s.sheet_thickness/2],[layout.trayWidth,layout.surfaceDepth,s.sheet_thickness],tier);
    for(let k=1;k<s.columns;k++)box('Divider '+k,[-layout.trayWidth/2+k*layout.columnWidth,0,s.divider_height/2],[s.sheet_thickness,layout.surfaceDepth,s.divider_height],tier).userData.shelf_divider=true;
    for(const x of [-layout.trayWidth/2,layout.trayWidth/2])box('Tray side',[x,0,s.divider_height/2],[s.sheet_thickness,layout.surfaceDepth,s.divider_height],tier);
    for(const [y,height] of [[-layout.surfaceDepth/2,s.front_lip_height],[layout.surfaceDepth/2,s.divider_height]])box('Tray front or rear lip',[0,y,height/2],[layout.trayWidth,s.sheet_thickness,height],tier);
    if(s.show_buns)for(const p of layout.bread){const bun=mesh(sphere,breadMaterial,'Bread ellipsoid',tier);bun.position.set(p.x,p.z,-p.y);bun.scale.set(s.bread_length_1/2,s.bread_height/2,s.bread_length_2/2);bun.userData={bread_ellipsoid:true,length_1_m:s.bread_length_1,length_2_m:s.bread_length_2,height_m:s.bread_height,column:p.column+1,row:p.row+1};}
  }
  if(labelSource){const label=labelSource.clone(true);label.traverse(n=>{if(n.geometry)n.geometry=n.geometry.clone();if(n.material)n.material=Array.isArray(n.material)?n.material.map(m=>m.clone()):n.material.clone();});label.position.set(0,h-.07,d/2+.007);root.add(label);}
  root.userData={shelf_configuration:s,bread_rows_per_column:layout.rows,clear_column_width_m:layout.clearColumnWidth,clear_vertical_gap_m:layout.clearVerticalGap,max_tiers:layout.maxTiers};
  // Dispose any allocated shape not used when bread or feet are absent.
  if(!s.show_buns||!s.tiers){sphere.dispose();breadMaterial.dispose();}
  return root;
}

export function disposeShelf(root){
  const geometries=new Set(),materials=new Set();root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);if(n.material)(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>materials.add(m));});
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}
