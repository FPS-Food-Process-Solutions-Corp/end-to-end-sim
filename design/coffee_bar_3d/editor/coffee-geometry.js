import {COFFEE_ROBOT_KEYS} from './coffee-robots.js';
import {Quaternion, Euler, Vector3} from '../vendor/three.module.js';
import {rotate} from './store.js';
import {placementAssessment} from './placement-validation.js';

export const COFFEE_DEFAULTS = {
  robot_id:'nova2', temperature:'hot', drink:'coffee', sugar:'50%', milk:'regular',
  ice:'regular', paper_cup_id:'cup_dispenser', plastic_cup_id:'plastic_cup_dispenser',
  coffee_id:'coffee_machine', tea_id:'tea_machine', ice_id:'ice_machine',
  paper_lid_id:'lid_dispenser', plastic_lid_id:'lid_machine',
  stamp_rest_id:'cup_stamping_rest', pickup_id:'beverage_pickup_zone',
  service_fraction:.25, clearance:.08, lift:.12, beverage_seconds:4, max_tcp_speed:1.5,
};
export const CUP = {height:.11, rimDiameter:.085, bottomDiameter:.060, gripHeight:.085};
const Z = new Vector3(0,0,1);
const orientation = yaw => new Quaternion().setFromEuler(new Euler(-Math.PI/2,0,yaw*Math.PI/180,'ZYX')).toArray();
const point = (position,quaternion) => ({position:[...position],quaternion:[...quaternion]});
const shift = (pose,z) => ({...pose,position:[pose.position[0],pose.position[1],pose.position[2]+z]});
function backward(pose,distance) {
  const v=Z.clone().applyQuaternion(new Quaternion(...pose.quaternion)).multiplyScalar(-distance);
  return {...pose,position:pose.position.map((x,i)=>x+v.getComponent(i))};
}
function toward(robot,position) {
  return Math.atan2(-(position[0]-robot.x),position[1]-robot.y)*180/Math.PI;
}
export function coffeeSettings(store) {return {...COFFEE_DEFAULTS,...store.scene.coffee_workflow};}

export function makeCoffeeRequest(store,definition,overrides={}) {
  const settings={...coffeeSettings(store),...overrides},errors=[];
  const requireObject=(id,kind,name)=>{
    const o=store.object(id);
    if(!o || (kind && o.kind!==kind))throw new Error('Choose '+name+'.');
    if(!store.visible(o.id))throw new Error(o.label+' is hidden.');
    return o;
  };
  if(!['hot','cold'].includes(settings.temperature)||!['coffee','milk_tea'].includes(settings.drink))
    throw new Error('Choose a valid drink and temperature.');
  for(const key of ['service_fraction','clearance','lift','beverage_seconds','max_tcp_speed'])
    if(!Number.isFinite(settings[key])||settings[key]<=0)throw new Error('Service height, clearance, timing and end-effector speed must be positive.');
  if(settings.service_fraction>1)throw new Error('Service height must be within the machine height.');
  const robot=requireObject(settings.robot_id,'robot','a beverage Nova');
  if(!COFFEE_ROBOT_KEYS.includes(store.key(robot)))throw new Error('Choose a Nova-2 or Nova-5 beverages robot.');
  const cold=settings.temperature==='cold';
  const dispenser=requireObject(settings[cold?'plastic_cup_id':'paper_cup_id'],'dispenser','the cup dispenser');
  const beverage=requireObject(settings[settings.drink==='coffee'?'coffee_id':'tea_id'],'machine','the beverage machine');
  const lid=requireObject(settings[cold?'plastic_lid_id':'paper_lid_id'],null,'the lid dispenser or applicator');
  const rest=cold?null:requireObject(settings.stamp_rest_id,'placement_zone','a cup stamping rest');
  const pickup=requireObject(settings.pickup_id,'placement_zone','a beverage pickup area');
  const ice=cold&&settings.ice!=='none'?requireObject(settings.ice_id,'machine','the ice machine'):null;
  const scale=robot.robot_scale||1;
  const offsets={cup:definition.cup_offset.map(v=>v*scale),stamp:definition.stamp_offset.map(v=>v*scale)};
  if(definition.cup_inner_diameter*scale<CUP.rimDiameter-.001)
    errors.push('The scaled cup prong is smaller than the 85 mm cup rim.');
  for(const zone of [pickup,...(rest?[rest]:[])]) {
    const bounds=placementAssessment(store,zone);
    if(!bounds.validSupport||!bounds.inside)errors.push(zone.label+' must be inside its supporting table.');
    if(zone.width<CUP.rimDiameter||zone.depth<CUP.rimDiameter)errors.push(zone.label+' is smaller than the cup.');
  }
  function service(o,cylinder=false) {
    const baseYaw=o.yaw_deg||0;
    const sideYaws=[baseYaw+90,baseYaw-90].sort((a,b)=>{
      const radius=yaw=>{const off=rotate(0,-.07*scale,yaw);return Math.hypot(o.x+off[0]-robot.x,o.y+off[1]-robot.y);};
      return Math.abs(radius(a)-.4)-Math.abs(radius(b)-.4);
    });
    const approach=o.service_approach||{};
    const yaw=cylinder?toward(robot,[o.x,o.y]):Number.isFinite(approach.yaw_offset_deg)?baseYaw+approach.yaw_offset_deg:sideYaws[0];
    const explicit=o.service_point&&['x','y','z'].every(k=>Number.isFinite(o.service_point[k]))?o.service_point:null;
    const mouth=cylinder?store.z(o)+(o.bottom_clearance??.30)-.012:
      store.z(o)+o.height*(explicit?explicit.z:settings.service_fraction);
    const robotLocal=rotate(robot.x-o.x,robot.y-o.y,-(o.yaw_deg||0));
    const serviceX=explicit?explicit.x*o.width:o.style==='tea'?Math.max(-o.width*.25,Math.min(o.width*.25,robotLocal[0])):0;
    const serviceY=explicit?explicit.y*o.depth:-o.depth/2-CUP.rimDiameter/2-.015;
    const p=cylinder?[o.x,o.y]:rotate(serviceX,serviceY,o.yaw_deg||0)
      .map((v,i)=>v+(i===0?o.x:o.y));
    const tcp=point([p[0],p[1],mouth-(CUP.height-CUP.gripHeight)],orientation(yaw));
    if(tcp.position[2]-CUP.gripHeight<store.z(o))
      errors.push('The service height at '+o.label+' puts the cup below the tabletop.');
    return {...tcp,id:o.id,name:o.label,mouthHeight:mouth,
      clearance:Number.isFinite(approach.clearance)?Math.max(.01,approach.clearance):settings.clearance,
      levelExit:!!approach.level_exit,linearContact:!!approach.linear_contact};
  }
  function onZone(o) {
    const floor=store.z(o)+(o.role==='cup_rest'?o.height:0);
    return {...point([o.x,o.y,floor+CUP.gripHeight],orientation(toward(robot,[o.x,o.y])+(o.role==='cup_rest'?90:0))),id:o.id,name:o.label,floor};
  }
  const cup=service(dispenser,true),drink=service(beverage),lidPose=service(lid,!cold);
  const delivery=onZone(pickup),park=rest?onZone(rest):null;
  const targets=[cup,...(ice?[service(ice)]:[]),drink,lidPose,...(park?[park]:[]),delivery];
  const knots=[],events=[];let time=0;
  let state={cup:'none',fill:0,ice:0,lid:'none',sealed:false};
  const flange=(pose,tool)=> {
    const offset=new Vector3(...offsets[tool]).applyQuaternion(new Quaternion(...pose.quaternion));
    return {position:pose.position.map((v,i)=>v-offset.getComponent(i)),quaternion:pose.quaternion};
  };
  const add=(seconds,pose,phase,patch={},signal=null,tool='cup')=>{
    time+=seconds;state={...state,...patch};
    const target=flange(pose,tool);
    knots.push({...target,time,phase,tool,contact:pose.position,motion:pose.motion,...state});
    if(signal)events.push({time,phase,device:signal.device,command:signal.command,
      preferences:{temperature:settings.temperature,drink:settings.drink,sugar:settings.sugar,milk:settings.milk,ice:cold?settings.ice:'none'}});
  };
  const local = pose => pose.linearContact?{...pose,motion:'cartesian'}:pose;
  const visit=(pose,label)=>{
    add(1,shift(backward(pose,pose.clearance),settings.lift),'Move clear / '+label);
    add(1,local(backward(pose,pose.clearance)),'Approach / '+label);
    add(1,local(pose),'At '+label);
  };
  add(0,shift(backward(cup,settings.clearance),settings.lift),'Order received');
  add(1,backward(cup,settings.clearance),'Approach '+dispenser.label);
  add(1,cup,'Prong beneath cup dispenser');
  add(.25,cup,'Request one '+(cold?'plastic':'paper')+' cup',{}, {device:dispenser.id,command:'dispense_one_cup'});
  add(.8,cup,'Cup drops into prong',{cup:'held'});
  if(settings.collision_level_exit)add(1,backward(cup,settings.clearance),'Withdraw level / cup dispenser');
  add(1,shift(backward(cup,settings.clearance),settings.lift),'Withdraw cup');
  if(ice) {
    const icePose=targets.find(t=>t.id===ice.id);
    visit(icePose,'ice outlet');
    add(.25,icePose,'Request '+settings.ice+' ice',{}, {device:ice.id,command:'dispense_ice'});
    add(1.5,icePose,'Ice dispensed',{ice:settings.ice==='light'?.3:.7});
    add(1,shift(backward(icePose,settings.clearance),settings.lift),'Withdraw from ice');
  }
  visit(drink,settings.drink==='coffee'?'coffee outlet':'milk-tea outlet');
  add(.25,drink,'Send drink preferences',{}, {device:beverage.id,command:'dispense_drink'});
  add(settings.beverage_seconds,drink,'Fill '+(settings.drink==='coffee'?'coffee':'milk tea'),{fill:.8});
  if(drink.levelExit)add(1,local(backward(drink,drink.clearance)),'Withdraw level / beverage outlet');
  add(1,drink.levelExit?local(shift(backward(drink,drink.clearance),settings.lift)):shift(backward(drink,drink.clearance),settings.lift),'Withdraw filled cup');
  visit(lidPose,cold?'plastic lid applicator':'paper lid dispenser');
  add(.25,lidPose,cold?'Request lid application':'Request paper lid',{},
    {device:lid.id,command:cold?'apply_plastic_lid':'dispense_paper_lid'});
  add(1,lidPose,cold?'Plastic lid applied':'Paper lid rests on cup',
    {lid:cold?'plastic':'paper',sealed:cold});
  if(settings.collision_level_exit&&!cold)add(1,backward(lidPose,settings.clearance),'Withdraw level / lid dispenser');
  add(1,shift(backward(lidPose,settings.clearance),settings.lift),'Withdraw lidded cup');
  if(park) {
    add(2,shift(park,.12),'Above stamping rest');
    add(1,park,'Set cup on stamping rest',{cup:'parked'});
    add(1,backward(park,.14),'Slide prong off cup');
    add(1,shift(backward(park,.14),.22),'Clear cup before turning tool');
    const stamp=point([park.position[0],park.position[1],park.floor+CUP.height+.009],
      new Quaternion().setFromAxisAngle(Z,(rest.yaw_deg||0)*Math.PI/180).toArray());
    add(2,shift(stamp,.18),'Turn opposite stamper downward',{},null,'stamp');
    add(1.5,shift(stamp,.012),'Approach paper lid',{},null,'stamp');
    add(.7,stamp,'Press paper lid',{sealed:true},null,'stamp');
    add(.5,stamp,'Hold lid press',{},null,'stamp');
    add(1,shift(stamp,.18),'Lift stamper',{},null,'stamp');
    add(2,shift(backward(park,.14),.18),'Turn cup prong back');
    add(1,backward(park,.14),'Approach sealed cup');
    add(1,park,'Slide prong around sealed cup',{cup:'held'});
    add(1,shift(park,.12),'Lift sealed drink');
  }
  add(2,shift(delivery,.12),'Carry to pickup counter');
  add(1,delivery,'Set drink on counter',{cup:'delivered'});
  add(1,backward(delivery,.14),'Withdraw prong from delivered drink');
  add(1,shift(backward(delivery,.14),.12),'Drink ready for pickup');
  return {settings,robot,mountingHeight:store.z(robot),knots,events,targets,duration:time,
    cupSpec:CUP,offsets,park,delivery,errors,checks:'Illustrative predefined sequence; no machine commands are sent.'};
}
