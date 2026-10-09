export const VENT_KEY = 'ventilation_shaft';

export function ventilationShaftSpec(scene) {
  return {
    id:VENT_KEY, asset_key:VENT_KEY, kind:'vent', label:'Ventilation shaft / 风井',
    x:2.48, y:scene.room.depth-5.37, width:2.55, depth:.74, height:3,
    z:0, yaw_deg:0, support:null, parentId:'area_building',
    visible:true, locked:false, height_status:'provisional',
    dimension_provenance:'Plan centre (248, 537) cm and 255 × 74 cm footprint supplied by user. Initial 300 cm height is provisional: the supplied floor plan labels 风井 (ventilation shaft) but gives no vertical height.',
    geometry_note:'Architectural shaft enclosure / reserved volume. Surface finish and enclosure details are illustrative; this is not an exposed vent grille.',
  };
}

// Add this requested building feature once to older saved scenes. Keeping the
// revision in exports makes later deletion, hiding and repositioning persistent.
export function migrateVentilationShaft(scene) {
  if ((scene.vent_layout_revision||0)>=1) return;
  scene.groups ||= [];
  if (!scene.objects.some(o=>o.asset_key===VENT_KEY||o.id===VENT_KEY)) {
    const object=ventilationShaftSpec(scene);
    if(!scene.groups.some(g=>g.id===object.parentId))
      scene.groups.push({id:object.parentId,label:'Building / ventilation'});
    scene.objects.push(object);
  }
  scene.vent_layout_revision=1;
}

export function ventProperties(object) {
  if(object?.kind!=='vent')return '';
  return '<section class="property-section"><h3>Ventilation shaft · 风井</h3>' +
    '<p class="hint">The source is a floor plan: its 750 mm dimension describes the plan depth, not the height. This object uses your 255 × 74 cm footprint.</p>' +
    '<p class="hint">Height starts at <strong>300 cm, provisional</strong>; no vertical height is shown in the supplied drawing. Edit Height above and Offset above support below when measured.</p>' +
    '<p class="hint">Shown as a shaft enclosure. The entire volume participates in world collision checks.</p></section>';
}
