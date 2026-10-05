export const COFFEE_ROBOT_KEYS = ['nova2', 'nova5_coffee'];
export const NOVA5_COFFEE_INVENTORY = {
  name: 'Nova-5 beverages', working_radius_cm: 85, tool_length_cm: 10,
  base_width_cm: 13, base_depth_cm: 13,
  tool: '85 mm cup prong + wrist-mounted lid stamper',
  effective_diameter_cm: 190, placement_diameter_cm: 140,
};
export function registerBeverageRobots(scene) {
  scene.robot_inventory = {...scene.robot_inventory,
    nova5_coffee: {...NOVA5_COFFEE_INVENTORY, ...scene.robot_inventory?.nova5_coffee}};
}
export function beverageRobotKey(store) {
  const robot = store.object(store.scene.coffee_workflow?.robot_id || 'nova2');
  const key = robot && store.key(robot);
  if (!COFFEE_ROBOT_KEYS.includes(key)) throw new Error('Choose a Nova-2 or Nova-5 beverages robot.');
  return key;
}
const definitions = new Map();
export async function loadCoffeeDefinition(store) {
  const key = beverageRobotKey(store);
  if (!definitions.has(key)) {
    const file = key === 'nova2' ? 'nova2_coffee' : key;
    definitions.set(key, fetch('./robot-library/' + file + '-kinematics.json').then(response => {
      if (!response.ok) throw new Error('Beverage robot kinematics could not be loaded.');
      return response.json();
    }).catch(error => {definitions.delete(key); throw error;}));
  }
  return definitions.get(key);
}
