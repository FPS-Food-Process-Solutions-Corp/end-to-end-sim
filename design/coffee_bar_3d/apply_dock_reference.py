"""Replace the initial dock placeholder with the user's dimensioned reference."""
from pathlib import Path
import json
import shutil

HERE=Path(__file__).resolve().parent
cfg=HERE/'scene_config.json'
c=json.loads(cfg.read_text())
o=next(o for o in c['objects'] if o['id']=='charger')
o.update(label='Charging dock / reference model / port faces left',x=2.844,y=1.45,width=.545,depth=.572,height=.280,yaw_deg=-90)
o['reference_dimensions_m']={'body_width':.490,'body_depth':.400,'body_height':.216,'overall_width':.545,'overall_depth':.572,'overall_height':.280,'port_center_height':.1475}
c['assumptions']=[n for n in c['assumptions'] if not n.startswith('Charging zone follows')]
c['assumptions'].append('Charging dock follows the supplied reference: overall 545 x 572 x 280 mm, main housing 490 x 400 x 216 mm, port axis 147.5 mm above floor. Small control/vent/foot details are visual approximations.')
c['assumptions'].append('Dock local front is -Y and yaw is -90 degrees: the mating connector points world -X, LEFT in the source floor plan. Its rightmost edge is 20 mm inside the charging-zone boundary.')
cfg.write_text(json.dumps(c,indent=2)+'\n')
shutil.copy2(r'C:\Users\andyl\AppData\Local\Temp\codex-clipboard-b924109e-c3e0-46db-b23c-348dd971f78a.png',HERE/'charging-dock-reference.png')

code='''def make_charger(o):
    r=root(o,COL['Equipment'])
    # Local -Y is the mating face. Overall envelope is centred on this root.
    # A 71 mm body offset centres the asymmetric projecting connector envelope.
    bw,bd,bh=.490,.400,.216
    body_y=.071
    body_bottom=.056
    top=body_bottom+bh
    shell=material('Charger enclosure enamel',(.67,.71,.72,1),.35,.34)
    label_mat=material('Charging control label plate',(.34,.39,.42,1),.35,.32)
    green=material('Start button green',(.025,.33,.12,1),.08,.32)
    red=material('Stop button red',(.52,.027,.02,1),.1,.32)
    contact=material('Charging connector contacts',(.68,.45,.12,1),.85,.22)
    box('490 x 400 x 216 mm main housing',(0,body_y,body_bottom+bh/2),(bw,bd,bh),shell,r,.012)
    box('Top lid seam',(0,body_y,top-.004),(bw-.008,bd-.008,.004),STEEL,r,.008)
    # Levelling feet determine the 545 mm crosswise envelope.
    for x in [-.235,.235]:
        for y in [body_y-.1775,body_y+.1775]:
            cyl('Round floor foot',(x,y,.004),.0375,.008,STEEL,r)
            cyl('Foot isolation pad',(x,y,.010),.025,.006,BLACK,r)
            bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.023,radius2=.011,depth=.020)
            foot=finish(bpy.context.object,'Tapered levelling foot',r,STEEL)
            foot.location=(x,y,.024)
            cyl('Adjustable foot stem',(x,y,.044),.008,.023,STEEL,r)
            cyl('Foot locking nut',(x,y,.052),.013,.008,STEEL,r,vertices=6)
    # HMI and two pushbuttons on the top, matching the reference arrangement.
    box('Top control panel',(0,body_y-.02,top+.0007),(.36,.25,.0014),label_mat,r,.014)
    box('HMI bezel',(-.055,body_y-.02,top+.002),(.205,.172,.004),DARK,r,.004)
    box('HMI inner trim',(-.055,body_y-.02,top+.0045),(.188,.155,.003),STEEL,r,.002)
    box('HMI screen',(-.055,body_y-.02,top+.006),(.167,.134,.0015),SCREEN,r,.002)
    for y,mat,word in [(body_y+.065,green,'START'),(body_y-.035,red,'STOP')]:
        cyl(word+' button ring',(.145,y,top+.002),.016,.004,STEEL,r)
        cyl(word+' pushbutton',(.145,y,top+.006),.012,.004,mat,r)
        text_obj(word+' label',word,(.145,y+.027,top+.002),.011,WHITE,r)
    for x,mat,word in [(-.11,green,'POWER'),(-.03,green,'RUN'),(.05,red,'FAULT')]:
        cyl('Status lamp '+word,(x,body_y-.125,top+.0025),.0035,.003,mat,r,vertices=16)
        text_obj('Status label '+word,word,(x,body_y-.146,top+.002),.007,WHITE,r)
    # Side ventilation and recessed handle/display window.
    box('Side window bezel',(-bw/2-.001,body_y+.07,.218),(.003,.11,.054),DARK,r,.003)
    box('Side window insert',(-bw/2-.003,body_y+.07,.218),(.001,.095,.040),WHITE,r,.002)
    for row in range(6):
        for column in range(10):
            vent=cyl('Side vent perforation',(-bw/2-.0008,body_y-.13+column*.009,.112+row*.009),.0024,.0015,DARK,r,vertices=12)
            vent.rotation_euler.y=math.pi/2
    # The projecting mating assembly is 157 mm beyond the main housing front.
    front=body_y-bd/2
    port_h=.1475
    box('Charging connector mounting flange',(0,front-.007,port_h),(.146,.014,.096),STEEL,r,.006)
    box('Charging connector carriage',(0,front-.045,port_h),(.112,.062,.067),STEEL,r,.004)
    box('Charging connector extension',(0,-.236,port_h),(.081,.060,.043),STEEL,r,.003)
    box('Charging connector tip',(0,-.276,port_h),(.071,.020,.031),DARK,r,.002)
    for x in [-.020,0,.020]:
        pin=cyl('Mating contact',(x,-.2855,port_h),.005,.001,contact,r,vertices=20)
        pin.rotation_euler.x=math.pi/2
    for x in [-.057,.057]:
        for z in [port_h-.034,port_h+.034]:
            screw=cyl('Flange screw',(x,front-.0145,z),.0032,.001,BLACK,r,vertices=16)
            screw.rotation_euler.x=math.pi/2
    # Small auxiliary connectors visible on the side in the supplied drawing.
    for yy,zz in [(body_y+.09,.18),(body_y-.04,.12)]:
        plug=cyl('Side auxiliary connector',(bw/2+.006,yy,zz),.011,.012,DARK,r)
        plug.rotation_euler.y=math.pi/2
    text_obj('Dock top ID','CHARGING DOCK',(0,body_y+.17,top+.001),.016,DARK,r)
    r.scale=(o['width']/.545,o['depth']/.572,o['height']/.280)
    r['connector_front_local']='-Y'
    r['connector_direction_world']='-X / left in source plan'
    r['reference_overall_mm']='545 x 572 x 280'


'''
p=HERE/'build_scene.py'
s=p.read_text()
start=s.index('def make_charger(o):')
end=s.index('def make_source_annotations():',start)
s=s[:start]+code+s[end:]
p.write_text(s)
p=HERE/'viewer.html'
s=p.read_text(encoding='utf-8').replace('Coffee equipment and the charging dock have provisional placements.','Coffee equipment has provisional placements. The dock follows the supplied reference, with its charging port pointing left in the plan.')
p.write_text(s,encoding='utf-8')
print('Dimensioned charging dock model installed; connector points LEFT / -X.')
