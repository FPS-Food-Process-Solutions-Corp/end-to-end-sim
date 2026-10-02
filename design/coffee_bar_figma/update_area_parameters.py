import json
from pathlib import Path

base = Path(__file__).resolve().parent
path = base / 'plan_parameters.json'
p = json.loads(path.read_text(encoding='utf-8-sig'))
p['canvas_px'] = [2900, 1740]
p['reach_ratio'] = 70/85
p['robot_inventory'] = {
    'nova2': {'name':'Nova-2', 'working_radius_cm':62.5, 'tool_length_cm':10, 'base_width_cm':12, 'base_depth_cm':12, 'tool':'Cup tongs ~10 cm'},
    'nova5': {'name':'Nova-5', 'working_radius_cm':85, 'tool_length_cm':34, 'base_width_cm':13, 'base_depth_cm':13, 'tool':'Lebai tongs 34 cm'},
    'me6': {'name':'ME6', 'working_radius_cm':45, 'tool_length_cm':0, 'base_width_cm':16, 'base_depth_cm':12, 'tool':'No extra tool length in reach'},
    'mg400': {'name':'MG400', 'working_radius_cm':44, 'tool_length_cm':0, 'base_width_cm':19, 'base_depth_cm':19, 'tool':'No extra tool length in reach', 'base_note':'Nominal base symbol; reach is dimensioned'},
    'atom_w': {'name':'Atom-W', 'working_radius_cm':78.95097085090893, 'tool_length_cm':6.316330112983086, 'base_width_cm':70, 'base_depth_cm':51, 'tool':'To palm midpoint; no fingertips', 'torso_axis_offset_cm':[-2.5,0], 'torso_sweep_radius_cm':20.600970850908944, 'arm_to_hand_mount_cm':58.35},
}
for robot in p['robot_inventory'].values():
    robot['effective_diameter_cm'] = 2*(robot['working_radius_cm']+robot['tool_length_cm'])
    robot['placement_diameter_cm'] = 2*robot['working_radius_cm']*p['reach_ratio']
p['robots']['nova5'].pop('reach_diameter_cm', None)
p['robots']['nova5'].pop('marker_diameter_px', None)
p['robots']['nova5']['cart'] = {'width_cm':60, 'depth_cm':80, 'robot_top_gap_cm':4, 'robot_right_gap_cm':10}
p['robots']['atom_w']['show_turn_envelope'] = False
p['robots']['atom_w'].pop('arm_reach_diameter_cm', None)
p['robots']['nova2'] = {'center_cm':[94,443]}
p['coffee_devices'] = [
    {'id':'coffee_machine','name':'Coffee','x_cm':27,'y_cm':445,'width_cm':50,'depth_cm':30,'front':'right'},
    {'id':'milk_fridge','name':'Milk','x_cm':27,'y_cm':417,'width_cm':50,'depth_cm':21,'front':'right'},
    {'id':'tea_machine','name':'Tea','x_cm':27,'y_cm':387,'width_cm':50,'depth_cm':30,'front':'right'},
    {'id':'lid_machine','name':'Lid press','x_cm':25,'y_cm':477.5,'width_cm':40,'depth_cm':21,'front':'right'},
    {'id':'ice_machine','name':'Ice','x_cm':99,'y_cm':385.5,'width_cm':50,'depth_cm':45,'front':'down'},
    {'id':'cup_dispenser','name':'Cups','x_cm':132,'y_cm':415,'diameter_cm':10},
    {'id':'lid_dispenser','name':'Lids','x_cm':132,'y_cm':435,'diameter_cm':10},
]
p['assumptions'] = [a for a in p['assumptions'] if not a.startswith(('Robot centres','Nova-5 circle','Atom-W base','The charging outline'))]
p['assumptions'] += [
    'Robot groups include both reach circles and their equipment. Areas contain their tables, labels, and equipment. Architectural measurements and legends remain separate.',
    'Maximum effective diameter = 2 * (working radius + tool length); placement diameter = 2 * working radius * 70/85, with no tool length. Both formulas were confirmed by the user.',
    'Atom-W: arm to URDF hand mounting frame 58.35 cm; shoulder sweep around torso yaw axis 20.60097 cm; palm-mesh midpoint 6.31633 cm from hand mount. This is a geometric circular planning envelope, not joint-limit/collision validation.',
    'Atom-W reach circles are centred on the upright torso-yaw axis, 2.5 cm behind the chassis origin. Nominal chassis footprint remains 70 x 51 cm.',
    'Nova-5 uses the original draw.io 13 x 13 cm mounting symbol on a 60 cm X by 80 cm Y cart. Symbol top is 4 cm below cart top; symbol right is 10 cm left of cart right.',
    'Coffee devices and Nova-2 follow the corrected 3D coffee-table arrangement; individual positions are editable.',
    'Charging zone boundary remains inferred. The dock footprint follows the supplied 545 x 572 mm reference with its port facing left.',
    'MG400 reference base is a nominal 19 x 19 cm plan symbol. Robot circles are to the specified scale; arm poses are not depicted.',
]
path.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
print('Prepared area groups, five robot reach definitions, coffee devices, and cart constraints.')
