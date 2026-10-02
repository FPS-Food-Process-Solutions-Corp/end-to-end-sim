export const SHELF_DEFAULTS={tiers:4,tier_spacing:.4,first_tier_front_height:.35,back_to_front_drop:.1,columns:6,post_width:.025,sheet_thickness:.002,divider_height:.06,front_lip_height:.025,show_buns:true,bread_length_1:.102,bread_length_2:.094,bread_height:.062,bread_gap:.015};
const number=(v,fallback,min,max)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
export function shelfSettings(scene,object){return shelfLayout(scene,object).settings;}
export function shelfLayout(scene,object){
  const s={...SHELF_DEFAULTS,...scene.shelves,...object.shelf_overrides},h=Math.max(.01,object.height||1.8);
  s.columns=Math.round(number(s.columns,6,1,24));
  for(const k of ['bread_length_1','bread_length_2'])s[k]=number(s[k],SHELF_DEFAULTS[k],.01,1);
  s.bread_height=number(s.bread_height,.062,.005,.5);s.bread_gap=number(s.bread_gap,.015,0,.1);
  const trayWidth=Math.max(.01,object.width-2*s.post_width-.004),trayDepth=Math.max(.01,object.depth-2*s.post_width);
  s.back_to_front_drop=number(s.back_to_front_drop,.1,0,Math.max(0,h-.08));
  const slope=Math.atan2(s.back_to_front_drop,trayDepth),cos=Math.cos(slope),sin=Math.sin(slope),surfaceDepth=Math.hypot(trayDepth,s.back_to_front_drop);
  const columnWidth=trayWidth/s.columns,clearColumnWidth=Math.max(0,columnWidth-s.sheet_thickness);
  const rows=Math.max(1,Math.min(24,Math.floor((surfaceDepth-.02+s.bread_gap)/(s.bread_length_2+s.bread_gap))));
  // Heights and pitch are measured from the lowest front underside of each tray.
  const structureEnvelope=s.back_to_front_drop+(s.divider_height+s.sheet_thickness)*cos+s.sheet_thickness/2*sin;
  const breadEnvelope=s.sheet_thickness*cos+s.back_to_front_drop/2+(rows-1)/2*(s.bread_length_2+s.bread_gap)*sin+s.bread_height/2*cos+Math.hypot(s.bread_length_2/2*sin,s.bread_height/2*cos);
  const tierEnvelope=Math.max(structureEnvelope,s.show_buns?breadEnvelope:0);
  const minSpacing=(s.sheet_thickness+Math.max(s.divider_height,s.show_buns?s.bread_height:0))/cos+.005;
  s.first_tier_front_height=number(s.first_tier_front_height,.35,0,Math.max(0,h-tierEnvelope));
  s.tier_spacing=number(s.tier_spacing,.4,minSpacing,Math.max(h,minSpacing));
  const maxTiers=tierEnvelope>h+1e-9?0:Math.max(1,Math.floor((h-s.first_tier_front_height-tierEnvelope+1e-9)/s.tier_spacing)+1);
  s.tiers=maxTiers?Math.round(number(s.tiers,Math.min(4,maxTiers),1,maxTiers)):0;
  const clearVerticalGap=Math.max(0,s.tier_spacing-s.sheet_thickness/cos);
  const clearAboveDividers=Math.max(0,s.tier_spacing-(s.sheet_thickness+s.divider_height)/cos);
  const bread=[];
  for(let col=0;col<s.columns;col++)for(let row=0;row<rows;row++)bread.push({x:-trayWidth/2+(col+.5)*columnWidth,y:(row-(rows-1)/2)*(s.bread_length_2+s.bread_gap),z:s.bread_height/2,column:col,row});
  return {settings:s,trayWidth,trayDepth,surfaceDepth,slope,columnWidth,clearColumnWidth,rows,bread,tooWide:s.bread_length_1>clearColumnWidth,tooDeep:s.bread_length_2>surfaceDepth-.02,maxTiers,minSpacing,tierEnvelope,clearVerticalGap,clearAboveDividers};
}
