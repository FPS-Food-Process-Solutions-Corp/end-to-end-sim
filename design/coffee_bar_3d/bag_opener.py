"""Editable vacuum bag-opening concept inferred from the supplied video.

The hidden actuator, cup layout and all dimensions are proposed, not measured.
Geometry uses metres; local front is -Y. Called by the main Blender builder.
"""
import math
import bpy


def make_bag_opener(api, obj):
    box, cyl, rod = (api[k] for k in ('box', 'cyl', 'rod'))
    text, empty, material, finish = (api[k] for k in ('text_obj', 'empty', 'material', 'finish'))
    steel, dark, black, teal = (api[k] for k in ('STEEL', 'DARK', 'BLACK', 'TEAL'))
    root = api['root'](obj, api['COL']['Equipment'])
    p = dict(bag_width=.26, bag_depth=.16, bag_height=.30, bag_floor=.044,
             cup_diameter=.03, cup_projection=.024, plate_height=.275,
             plate_width=.31, plate_thickness=.003, opening_fraction=1,
             show_bag=True, closed_gap=.012)
    p.update(obj.get('bag_parameters', {}))
    w, d, h = obj['width'], obj['depth'], obj['height']
    bw, bd, bh = (p[k] for k in ('bag_width', 'bag_depth', 'bag_height'))
    floor, cup, projection = p['bag_floor'], p['cup_diameter'], p['cup_projection']
    plate_w, plate_h, sheet = p['plate_width'], p['plate_height'], p['plate_thickness']
    if not (0 < bw < plate_w < w and bd + 2*projection + 2*sheet < d and bh+floor <= h):
        raise ValueError('Bag/plate geometry does not fit the configured fixture envelope')
    amount = max(0, min(1, p['opening_fraction']))
    gap = p['closed_gap'] + amount*(bd-p['closed_gap'])
    rear_face, front_face = bd/2, bd/2-gap
    rear_plate, front_plate = rear_face+projection+sheet/2, front_face-projection-sheet/2
    moving = empty('Moving vacuum platen assembly', api['COL']['Equipment'], root)
    moving['bag_moving_plate'] = True
    moving['opening_stroke_m'] = bd-p['closed_gap']
    root['concept_only'] = True
    root['bag_parameters_json'] = __import__('json').dumps(p)
    root['open_mouth_dimensions_m'] = [bw, bd]
    root['mouth_height_above_support_m'] = floor+bh
    root['mechanism_assumption'] = 'One fixed platen; one guided linear slide; independent vacuum circuits; bottom support'
    blue = material('Bag opener vacuum tubing blue', (.018, .25, .46, 1), .12, .35)
    silicone = material('Soft ivory silicone cup', (.87, .88, .79, 1), 0, .6)
    kraft = material('Uncoated kraft paper bag', (.48, .30, .13, 1), 0, .88)
    crease = material('Kraft crease detail', (.29, .16, .066, 1), 0, .9)
    green = material('Vacuum ready indicator', (.06, .48, .21, 1), .1, .25)

    box('Table-bolted stainless base', (0, 0, .005), (w, d, .01), steel, root, .003)
    for x in [-w/2+.022, w/2-.022]:
        for y in [-d/2+.023, d/2-.023]:
            cyl('Mounting bolt M6', (x, y, .013), .0055, .006, dark, root, vertices=6)
    # A covered low-profile guided slide is proposed because the video hides its drive.
    for x in [-plate_w/2-.005, plate_w/2+.005]:
        box('Linear guide rail', (x, 0, .017), (.012, d-.038, .012), dark, root, .001)
        box('Moving carriage bearing', (x, front_plate, .026), (.026, .043, .013), teal, moving, .003)
    box('Proposed rodless actuator cassette', (0, 0, .018), (.065, d-.035, .017), dark, root, .003)
    box('Moving platen crosshead', (0, front_plate, .031), (plate_w+.05, .024, .007), teal, moving, .002)
    # Bottom support takes the contents' weight; cups only separate/retain the paper walls.
    box('Bag bottom support tray', (0, 0, floor-.0015), (bw+.02, bd+.018, .003), steel, root, .001)
    for x in [-bw/2-.007, bw/2+.007]:
        box('Low side locating guide', (x, 0, floor+.007), (.003, bd*.7, .014), dark, root, .001)

    def cup_mesh(name, pos, inward, parent):
        # Hollow revolved bellows profile: the bag touches the soft open lip.
        R = cup/2
        profile = [(R*.30,0),(R*.30,.004),(R*.69,.006),(R*.42,.009),
                   (R*.86,.012),(R*.50,.015),(R*.97,.020),(R,projection),
                   (R*.86,projection),(R*.80,.021),(R*.38,.016),(R*.35,.007),(R*.18,.005),(R*.18,0)]
        verts, faces, n = [], [], 40
        for r,z in profile:
            for i in range(n):
                a=i*2*math.pi/n;verts.append((r*math.cos(a),r*math.sin(a),z))
        for j in range(len(profile)):
            for i in range(n):
                faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i))
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        ob=bpy.data.objects.new(name,mesh);api['COL']['Equipment'].objects.link(ob)
        finish(ob,name,parent,silicone);ob.location=pos;ob.rotation_euler.x=-inward*math.pi/2
        for face in mesh.polygons: face.use_smooth=True
        ob['vacuum_cup']=True;ob['nominal_diameter_m']=cup
        return ob

    for name, yp, inward, parent in [('Fixed rear',rear_plate,-1,root),('Moving front',front_plate,1,moving)]:
        box(name+' suction platen', (0, yp, floor+plate_h/2), (plate_w, sheet, plate_h), steel, parent, .001)
        for x in [-plate_w/2+.014, plate_w/2-.014]:
            box(name+' folded stiffening edge', (x, yp-inward*.010, floor+plate_h/2), (.008,.02,plate_h), steel, parent, .001)
        for x in [-bw*.32,bw*.32]:
            for z in [floor+bh*.35, floor+bh*.75]:
                cup_mesh(name+' soft vacuum cup',(x,yp+inward*sheet/2,z),inward,parent)
                fitting=cyl(name+' bulkhead fitting',(x,yp-inward*.005,z),.005,.013,dark,parent)
                fitting.rotation_euler.x=math.pi/2
                rod(name+' blue vacuum branch',(x,yp-inward*.015,z),(x,yp-inward*.015,floor+.055),.002,blue,parent)
        rod(name+' vacuum manifold',(-bw*.34,yp-inward*.015,floor+.055),(bw*.34,yp-inward*.015,floor+.055),.0035,blue,parent)
        for x in [-plate_w/2-.001,plate_w/2+.001]:
            box(name+' outside-tray mounting foot',(x,yp-inward*.014,(.025+floor+.012)/2),(.020,.050,floor+.012-.025),steel,parent,.002)
        label='01  FIXED VACUUM PLATE' if inward==-1 else '02  MOVING PLATE'
        # Front-facing engraved identifier visible from the robot approach side.
        if inward==1:
            text(name+' identifier',label,(0,yp-.002,floor+plate_h-.020),.013,teal,parent,(math.pi/2,0,0))
    # External valves/sensor block alongside the working area, away from the bag mouth.
    control_x=w/2-.045
    box('Vacuum manifold and valve enclosure',(control_x,.025,.047),(.060,.17,.074),dark,root,.006)
    for y in [-.023,.048]:
        box('Independent vacuum channel',(control_x,y,.087),(.042,.033,.010),teal,root,.002)
        cyl('Vacuum ready LED',(control_x+.014,y,.094),.004,.003,green,root,vertices=20)
        rod('Air line inlet',(control_x-.035,y,.050),(plate_w/2+.002,y,.050),.003,blue,root)
    sensor_x=-w/2+.045
    box('Bag presence sensor bracket',(sensor_x,.025,.052),(.02,.045,.083),steel,root,.002)
    box('Bag mouth / presence sensor',(sensor_x,.01,.090),(.032,.035,.030),dark,root,.003)
    cyl('Sensor lens',(sensor_x,.01,.108),.007,.006,blue,root)
    text('Slide identifier','03  GUIDED SLIDE',(0,-d/2+.011,.011),.012,teal,root)

    if p['show_bag']:
        bag=empty('Example kraft bag - provisional size',api['COL']['Equipment'],root)
        bag['example_bag']=True;bag['bag_dimensions_m']=[bw,bd,bh]
        # Mouth is open; no top polygon. Each wall remains an independently named part.
        for name,y in [('Front',front_face),('Rear',rear_face)]:
            box(name+' paper wall',(0,y,floor+bh/2),(bw,.0006,bh),kraft,bag,.00015)
            box(name+' reinforced mouth fold',(0,y,floor+bh-.003),(bw,.0013,.006),kraft,bag,.0002)
        center_y=(front_face+rear_face)/2
        for x in [-bw/2,bw/2]:
            box('Paper gusset side',(x,center_y,floor+bh/2),(.0006,gap,bh),kraft,bag,.00015)
            rod('Gusset crease',(x*1.002,center_y,floor+.02),(x*1.002,center_y,floor+bh-.01),.00045,crease,bag)
            for y in [front_face,rear_face]:
                rod('Bottom gusset fold',(x*1.002,y,floor+.005),(x*1.002,center_y,floor+gap*.42),.0004,crease,bag)
        box('Supported bag bottom',(0,center_y,floor+.0004),(bw,gap,.0008),kraft,bag,.0001)
        # A restrained marking identifies the assumed bag dimensions in the render.
        text('Bag sample print','SAMPLE BAG',(0,front_face-.0007,floor+bh*.60),.022,crease,bag,(math.pi/2,0,0))
    return root
