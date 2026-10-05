import {registerBeverageRobots} from './coffee-robots.js';
import {rotate} from './store.js';
export function migrateCoffeeWorkflow(scene) {
  registerBeverageRobots(scene);
  if ((scene.coffee_flow_revision || 0) >= 1) return;
  const objects = scene.objects;
  const table = objects.find(o => o.id === 'coffee_station');
  const cup = objects.find(o => o.id === 'cup_dispenser');
  if (table && cup) {
    const local = (x,y) => {
      const p=rotate(x,y,table.yaw_deg||0);
      return {x:table.x+p[0],y:table.y+p[1]};
    };
    const unique = base => {
      let id=base,i=2;while(objects.some(o=>o.id===id))id=base+'_'+i++;
      return id;
    };
    const plastic = {...JSON.parse(JSON.stringify(cup)),id:unique('plastic_cup_dispenser'),
      label:'Plastic cup dispenser',asset_key:cup.asset_key||cup.id,...local(.62,-.25),cup_material:'plastic'};
    objects.push(plastic);
    const rest={id:unique('cup_stamping_rest'),kind:'placement_zone',asset_key:'placement_zone',
      label:'Cup stamping rest',role:'cup_rest',...local(.02,-.47),width:.105,depth:.105,height:.012,
      z:0,support:table.id,yaw_deg:table.yaw_deg||0,parentId:cup.parentId,visible:true,locked:false};
    const pickup={...rest,id:unique('beverage_pickup_zone'),label:'Beverage pickup',role:'beverage_pickup',
      ...local(.61,.29),width:.11,depth:.11,height:.003,z:.002,parentId:table.parentId};
    objects.push(rest,pickup);
    if(cup.label==='Cup dispenser')cup.label='Paper cup dispenser';
    for(const robot of objects.filter(o=>(o.model_key||o.id)==='nova2')) robot.distanceTargets=[...new Set([...(robot.distanceTargets||[]),plastic.id,rest.id,pickup.id])];
    scene.coffee_workflow={plastic_cup_id:plastic.id,stamp_rest_id:rest.id,pickup_id:pickup.id,...scene.coffee_workflow};
  }
  scene.coffee_flow_revision=1;
}
