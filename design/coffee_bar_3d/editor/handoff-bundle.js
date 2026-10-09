import {frozenStore, resolveLayout, workflowMap, readingBrief} from './handoff-data.js';
import {captureGeometry, topDownSVG, svgPNG, angledPNG, capturedGLB} from './handoff-views.js';
import {validationReport, sha256} from './handoff-validation.js';
import {captureWorld, collisionRequest} from './collision-scene.js';
import {zipStore} from './zip-store.js';

const json = value => JSON.stringify(value,null,2)+'\n';
const encoder = new TextEncoder();
async function sourceFiles(files,warnings) {
  const roots=['editor/ik-worker.js','editor/coffee-worker.js','editor/flow-geometry.js',
    'editor/coffee-geometry.js','editor/collision-scene.js','editor/shelf-parameters.js',
    'editor/barrier-parameters.js','editor/scene3d.js'];
  const seen=new Set();
  async function visit(path) {
    if(seen.has(path))return;seen.add(path);
    try {
      const response=await fetch('./'+path);
      if(!response.ok)throw new Error('HTTP '+response.status);
      const text=await response.text();files.set('analysis/source/'+path,text);
      const imports=[...text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match=>match[1]);
      const base=new URL(path,location.href);
      await Promise.all(imports.map(spec=>{
        if(spec==='three')return visit('vendor/three.module.js');
        if(!spec.startsWith('.'))return;
        const resolved=new URL(spec,base),root=new URL('.',location.href);
        if(resolved.origin!==root.origin||!resolved.pathname.startsWith(root.pathname))return;
        return visit(resolved.pathname.slice(root.pathname.length));
      }));
    } catch(error){warnings.push('Source file not included: '+path+' ('+error.message+')');}
  }
  await Promise.all(roots.map(visit));
  // These are the articulated Nova solver models currently shipped with the app.
  await Promise.all(['nova5_suction','nova5_bread','nova2_coffee','nova5_coffee'].map(async key=>{
    const path='robot-library/'+key+'-kinematics.json';
    try {const response=await fetch('./'+path);if(!response.ok)throw new Error('HTTP '+response.status);
      files.set('analysis/source/'+path,await response.text());}
    catch(error){warnings.push('Kinematics not included: '+key+' ('+error.message+')');}
  }));
}

export async function buildHandoffBundle({store,view,includeAnalysis=true,includeGLB=false,note='',players=[],progress=()=>{}}) {
  if(!view.ready)throw new Error('Wait for the 3D models to load.');
  // Capture synchronously before fetch/render awaits. User edits and running
  // animations cannot change the geometry or evidence of this export afterward.
  const scene=store.exportScene(),history=structuredClone(store.validationHistory||[]);
  const frozen=frozenStore(store,scene),capture=captureGeometry(view,frozen,players);
  const createdAt=new Date().toISOString(),files=new Map(),warnings=[];
  progress('Resolving layout and workflow service points…');
  const resolved=resolveLayout(frozen),validation=await validationReport(history,scene);
  const workflows=await workflowMap(frozen);
  files.set('scene.json',json(scene));files.set('resolved-layout.json',json(resolved));
  files.set('workflow-map.json',json(workflows));files.set('validation.json',json(validation));
  files.set('START_HERE.md',readingBrief(scene,resolved,validation,note.trim()));
  for(let index=0;index<history.length;index++) {
    const {sceneKey,...evidence}=history[index];
    files.set('validation/check-'+(index+1)+'.json',json({...evidence,scene_sha256:validation.records[index].scene_sha256}));
  }
  progress('Drawing labelled top-down and 3D views…');
  const svg=topDownSVG(frozen,resolved);
  files.set('views/top-down.svg',svg);
  files.set('views/top-down.png',await svgPNG(svg));
  files.set('views/angled-3d.png',await angledPNG(capture,resolved));
  if(includeAnalysis) {
    progress('Collecting kinematics, collision proxies and analysis source…');
    const world=captureWorld(capture),rigs=[];
    for(const object of scene.objects.filter(o=>o.kind==='robot'&&frozen.visible(o.id))) {
      if(!['nova5','nova5_suction','nova2','nova5_coffee'].includes(frozen.key(object))) {
        warnings.push('No articulated solver definition exported for '+object.id+' ('+frozen.key(object)+'). Supply its URDF for detailed robot analysis.');continue;
      }
      try {const data=collisionRequest(capture,object,undefined,[],undefined,{enabled:true,margin:0});
        rigs.push({robot_id:object.id,model_key:frozen.key(object),rig:data.rig,
          stored_joints_deg:object.joints_deg||{},mounting_height_m:frozen.z(object),payload:null});}
      catch(error){warnings.push('Robot proxies unavailable for '+object.id+': '+error.message);}
    }
    files.set('analysis/collision-geometry.json',json({basis:'Three.js [worldX, worldZ, -worldY]',units:'metres',
      representation:'Per-part oriented boxes and articulated node transforms, not exact solids',
      world,robots:rigs,
      held_objects:'Generic rigs have no payload. Checked request evidence includes its actual payload proxies; workflow-map describes bag/cup/bread dimensions. Build payloads using the included collision-scene.js for new checks.'}));
    await sourceFiles(files,warnings);
    files.set('analysis/README.md',[
      '# Analysis assets','',
      'Source files retain their relative paths under source/. The kinematics JSON files contain joints, limits and tool offsets for the shipped Nova variants. The collision geometry is a snapshot of current visible equipment and static robot rigs.',
      'These files are analysis inputs, not an automatically runnable standalone simulator. Browser imports of three use vendor/three.module.js. Copy a request from validation evidence or regenerate it from scene.json and the included target builders before invoking a solver.',
      'World and rig proxy coordinates use Three.js [worldX, worldZ, -worldY]; target poses and kinematics use scene-world XYZ. Refer to collision-core.js for the conversion. Geometry is approximate and selected robot-world mount/contact exemptions still apply.',
      'Current source files were collected at export time. Recorded validation predates export and does not cryptographically attest to an identical solver binary. Fingerprints bind the recorded scene/settings, not undocumented hardware or code history.',
      'GLB is optional. URDF-only models without a local solver definition need their original URDF and meshes for independent articulated analysis.',''
    ].join('\n'));
  }
  if(includeGLB) {progress('Exporting the saved 3D geometry…');files.set('scene.glb',await capturedGLB(capture,scene));}
  progress('Hashing and packaging the handoff…');
  const entries=await Promise.all([...files].map(async([name,value])=>{
    const bytes=typeof value==='string'?encoder.encode(value):value;
    return {path:name,bytes:bytes.byteLength,sha256:await sha256(bytes)};
  }));
  const manifest={schema_version:1,exporter:'Layout studio AI handoff v1',created_at:createdAt,
    scene_sha256:validation.scene_sha256,scene_fingerprint_scope:'Canonical scene minus editor_options, editor_selection and order_camera; includes dimensions, visibility, workflow settings, models and collision policy.',
    exact_scene_json_sha256:entries.find(e=>e.path==='scene.json').sha256,
    source:'Current browser scene at export click; no defaults imported or objects repositioned.',
    images:'Active objects only, saved JSON robot joint poses, automatic overview camera.',
    include_analysis:includeAnalysis,include_glb:includeGLB,validation_scope:validation.history_scope,
    warnings:[...resolved.warnings,...warnings],files:entries};
  files.set('manifest.json',json(manifest));
  return {blob:zipStore(files),manifest,filename:'robot-cafe-ai-handoff-'+createdAt.replace(/[:.]/g,'-')+'.zip'};
}
