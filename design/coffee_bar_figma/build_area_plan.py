"""Build the area-grouped plan and same-scale copyable robot reference library."""
from pathlib import Path
import copy
import json
import math
import re
import xml.etree.ElementTree as ET
import sys
sys.path.insert(0, r'C:\Users\andyl\.codex\visualizations\2026\09\29\01a0ee3a-44e6-7282-8274-6cd194728ded\figma-tools')
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
UTILITY = Path(r'C:\Users\andyl\.codex\visualizations\2026\09\29\01a0ee3a-44e6-7282-8274-6cd194728ded')
P = json.loads((HERE/'plan_parameters.json').read_text(encoding='utf-8-sig'))
for inv in P['robot_inventory'].values():
    inv['effective_diameter_cm'] = 2*(inv['working_radius_cm']+inv['tool_length_cm'])
    inv['placement_diameter_cm'] = 2*inv['working_radius_cm']*P['reach_ratio']
S = P['pixels_per_cm']; OX,OY = P['plan_origin_px']; W,H = P['canvas_px']
assert S == 2
COL = {'ink':'#18313F','muted':'#657A87','line':'#BCCAD1','blue':'#3B6482','counter':'#EDF3F6','shelf':'#ECF2E7','max':'#CC7133','place':'#008896','pale':'#F7F9FA'}
LAYERS = []
ALL = []
TEXTS = []
fonts = {'Inter':TTFont(UTILITY/'Inter.ttf'),'CJK':TTFont('C:/Windows/Fonts/NotoSansSC-VF.ttf')}
cmaps = {k:v.getBestCmap() for k,v in fonts.items()}
glyphsets = {k:v.getGlyphSet(location={'wght':400} if 'fvar' in v else None) for k,v in fonts.items()}
paths = {}

def family(char):
    return 'Inter' if ord(char) in cmaps['Inter'] else 'CJK'

def glyph_width(char,size):
    f = family(char); n = cmaps[f].get(ord(char))
    if n is None: raise ValueError('Missing glyph '+char)
    return fonts[f]['hmtx'].metrics[n][0]*size/fonts[f]['head'].unitsPerEm

def group(name,parent=None,**metadata):
    g = {'name':name,'id':'g_'+str(len(ALL))+'_'+re.sub(r'[^A-Za-z0-9]+','_',name).strip('_'),'shapes':[],'texts':[],'children':[],**metadata}
    ALL.append(g)
    (LAYERS if parent is None else parent['children']).append(g)
    return g

def shape(g,name,kind,**kw):
    o = {'name':name,'kind':kind,**kw}; g['shapes'].append(o); return o

def rect(g,name,x,y,w,h,fill='none',stroke=COL['line'],sw=1.5,dash=None,radius=0,**meta):
    return shape(g,name,'rect',x=x,y=y,width=w,height=h,fill=fill,stroke=stroke,stroke_width=sw,dash=dash or [],radius=radius,**meta)

def circle(g,name,cx,cy,d,fill='none',stroke=COL['ink'],sw=2,dash=None,**meta):
    return shape(g,name,'ellipse',x=cx-d/2,y=cy-d/2,width=d,height=d,fill=fill,stroke=stroke,stroke_width=sw,dash=dash or [],**meta)

def line(g,name,x1,y1,x2,y2,stroke=COL['line'],sw=1,dash=None,**meta):
    return shape(g,name,'line',x1=x1,y1=y1,x2=x2,y2=y2,stroke=stroke,stroke_width=sw,dash=dash or [],**meta)

def label(g,name,text,x,y,size=18,color=COL['ink'],align='center',rotate=0):
    item = {'name':name,'text':text,'x':x,'y':y,'font_size':size,'color':color,'align':align,'rotation':rotate,'width':sum(glyph_width(c,size) for c in text),'height':size*1.25,'ascent':size*.98}
    g['texts'].append(item); TEXTS.append(item); return item

def px(v): return OX+v*S
def py(v): return OY+v*S
def plan_rect(g,name,x,y,w,h,**kw):
    return rect(g,name,px(x),py(y),w*S,h*S,physical_cm={'x':x,'y':y,'width':w,'depth':h},**kw)

def arrow(g,name,x1,y1,x2,y2,color=COL['blue'],sw=2):
    line(g,name,x1,y1,x2,y2,color,sw)
    angle = math.atan2(y2-y1,x2-x1)
    for a in [angle+2.55,angle-2.55]: line(g,name+' arrowhead',x2,y2,x2+8*math.cos(a),y2+8*math.sin(a),color,sw)

def tick(g,x,y): line(g,'Dimension tick',x-4,y+4,x+4,y-4,COL['muted'],1.5)
def hdim(g,name,a,b,y,text,ref_y,size=18):
    for x in [a,b]: line(g,name+' extension',x,y-6,x,ref_y,COL['line'],1,[4,4]); tick(g,x,y)
    line(g,name,a,y,b,y,COL['muted'])
    label(g,name+' value',text,(a+b)/2,y-9,size)
def vdim(g,name,a,b,x,text,ref_x,size=18):
    for y in [a,b]: line(g,name+' extension',x-5,y,ref_x,y,COL['line'],1,[4,4]); tick(g,x,y)
    line(g,name,x,a,x,b,COL['muted'])
    label(g,name+' value',text,x-12,(a+b)/2,size,rotate=-90)

def robot_package(parent,key,cx,cy,reference=False):
    inv = P['robot_inventory'][key]
    r = group(('Copy / ' if reference else '')+inv['name']+' / equipment + both reach circles',parent,robot=key,role='robot_package',reference=reference)
    # Atom's reach is centred on the torso yaw axis, rather than the chassis origin.
    axis = inv.get('torso_axis_offset_cm',[0,0]); rx=cx+axis[0]*S; ry=cy+axis[1]*S
    for role,diam,color,dash in [('effective',inv['effective_diameter_cm'],COL['max'],[10,7]),('placement',inv['placement_diameter_cm'],COL['place'],[])]:
        circle(r,inv['name']+' / '+role+' reach / diameter '+f'{diam:.2f}'+' cm',rx,ry,diam*S,stroke=color,sw=2.3 if role=='placement' else 2,dash=dash,role='reach_'+role,robot=key,physical_cm={'diameter':diam},range_type=role)
    bw=inv['base_width_cm']*S; bd=inv['base_depth_cm']*S
    if key=='nova5':
        cart=P['robots']['nova5']['cart']; cw=cart['width_cm']*S; cd=cart['depth_cm']*S
        cart_x=cx+bw/2+cart['robot_right_gap_cm']*S-cw
        cart_y=cy-bd/2-cart['robot_top_gap_cm']*S
        rect(r,'Nova-5 cart / 60 cm X by 80 cm Y',cart_x,cart_y,cw,cd,'#F3F0EC','#8D795F',1.8,role='nova5_cart',physical_cm={'width':60,'depth':80})
        for xx in [cart_x+6,cart_x+cw-12]:
            for yy in [cart_y+7,cart_y+cd-17]: rect(r,'Cart caster symbol',xx,yy,6,10,'#8D795F','none',0,radius=2)
        label(r,'Nova-5 cart label','CART',cart_x+cw/2,cart_y+cd-35,13,'#796850')
        label(r,'Nova-5 cart size','60 × 80 cm',cart_x+cw/2,cart_y+cd-16,12,'#796850')
    if key=='atom_w':
        rect(r,'Atom-W base / 70 x 51 cm',cx-bw/2,cy-bd/2,bw,bd,'#EAF5F2','#177E73',2,radius=9,role='robot_base',robot=key,physical_cm={'width':70,'depth':51})
        for yy in [cy-bd/2+5,cy+bd/2-11]:rect(r,'Atom-W wheel',cx-42,yy,44,6,'#177E73','none',0,radius=2)
        label(r,'Atom-W robot label','ATOM-W',cx,cy-7,17,'#177E73')
        label(r,'Atom-W base size','70 × 51 cm',cx,cy+17,13,'#177E73')
        arrow(r,'Atom-W forward',cx+bw/2-14,cy,cx+bw/2+18,cy,'#177E73')
        circle(r,'Torso yaw axis',rx,ry,5,'#177E73','none',0,role='reach_center')
    else:
        rect(r,inv['name']+' mounting footprint',cx-bw/2,cy-bd/2,bw,bd,'#FFFFFF',COL['blue'],2,radius=2,role='robot_base',robot=key,physical_cm={'width':inv['base_width_cm'],'depth':inv['base_depth_cm']})
        circle(r,inv['name']+' mounting centre',cx,cy,5,COL['blue'],'none',0,role='reach_center')
        label(r,inv['name']+' name',inv['name'],cx,cy-bd/2-11,16,COL['blue'])
        if not reference: arrow(r,inv['name']+' working direction',cx+bw/2+4,cy,cx+bw/2+28,cy)
    return r

background=group('Background')
rect(background,'White canvas',0,0,W,H,'#FFFFFF','none',0)
room=group('Room envelope and circulation')
left=group('Area / left work counter')
right=group('Area / right work counter')
upper=group('Area / upper shelf-strip counter')
middle=group('Area / middle shelf-strip counter')
shelf1=group('Area / shelf 1 + Atom-W')
shelf2=group('Area / shelf 2 + Nova-5 cart')
coffee=group('Area / coffee station')
charge=group('Area / charging dock')
measure=group('Measurements / dimensions and cart offsets')
legend=group('Legends / title and source notes')
library=group('Robot reference library / same-scale copy sources',role='reference_library')

main=P['main_width_cm']; side=P['right_counter_width_cm']; depth=P['working_depth_cm']; visible=depth+P['coffee_zone_depth_cm']; total=P['overall_depth_annotation_cm']; width=main+side
plan_rect(room,'Robot working area',60,0,160,depth,fill='#FAFCFD',stroke='none',sw=0)
plan_rect(room,'Replenishment aisle',255,0,60,depth,fill='#F7F5EE',stroke='none',sw=0)
plan_rect(room,'Unshown depth reference',0,visible,width,total-visible,fill='#FAFAFA',stroke=COL['line'],dash=[6,6])
label(room,'Unshown source label','Not visible in supplied crop',px(width/2),py(537.5)-3,18,COL['muted'])
label(room,'Crop note','75 cm dimension remainder / location unconfirmed',px(width/2),py(537.5)+24,13,COL['muted'])
label(room,'Replenishment label','补面包通道 / 60 cm replenishment aisle',px(288),py(180),17,'#827352',rotate=-90)
label(room,'Working area label','机器人活动空间',px(160),py(219),19,COL['muted'])
label(room,'Working area English','ROBOT WORKING AREA',px(160),py(219)+27,12,COL['muted'])
for name,a,b,dash in [('Top boundary',(0,0),(width,0),[]),('Left boundary',(0,0),(0,visible),[12,6]),('Right boundary',(width,0),(width,visible),[]),('Visible crop limit',(0,visible),(width,visible),[8,5]),('Coffee zone line',(60,depth),(main,depth),[8,5])]:
    line(room,name,px(a[0]),py(a[1]),px(b[0]),py(b[1]),COL['ink'] if not dash else COL['muted'],2 if not dash else 1.3,dash)

for g,name,x,y,w,d in [(left,'Left counter',0,0,60,360),(right,'Right counter',315,0,60,500),(upper,'Upper strip counter',220,0,35,60),(middle,'Middle strip counter',220,160,35,100)]:
    plan_rect(g,name,x,y,w,d,fill=COL['counter'],stroke=COL['blue'])
    label(g,name+' label','台面 / Counter' if w==60 else '台面',px(x+w/2),py(y+d/2),18,COL['blue'],rotate=-90)
label(measure,'Left counter size','60 × 360 × H90 cm',px(42),py(180),14,COL['blue'],rotate=-90)
for g,n,y in [(shelf1,1,60),(shelf2,2,260)]:
    sg=group('Shelf '+str(n),g)
    plan_rect(sg,'Shelf '+str(n)+' bay',220,y,35,100,fill=COL['shelf'],stroke='#65805A')
    label(sg,'Shelf '+str(n)+' label','面包架 '+str(n),px(237.5)-5,py(y+50),19,'#47623A',rotate=-90)
    label(sg,'Shelf '+str(n)+' English','SHELF '+str(n),px(237.5)+18,py(y+50),10,'#65805A',rotate=-90)
ax,ay=P['robots']['atom_w']['center_cm']; robot_package(shelf1,'atom_w',px(ax),py(ay))
nx,ny=P['robots']['nova5']['center_cm']; robot_package(shelf2,'nova5',px(nx),py(ny))

table=group('Coffee table / ordering and pickup',coffee)
cw,cd,ch=P['coffee_station_cm']
plan_rect(table,'Coffee table / 140 x 140 cm',0,depth,cw,cd,fill=COL['counter'],stroke=COL['blue'])
plan_rect(table,'Ordering screen symbol',59,488,22,4,fill='#587687',stroke=COL['blue'],radius=2)
plan_rect(table,'Pickup pad',105,472,28,24,fill='#D2E0E6',stroke='#8BA7B5',sw=1)
label(table,'Coffee area name','COFFEE TABLE',px(3),py(500)+24,15,COL['blue'],align='left')
label(measure,'Coffee station size','140 × 140 × H90 cm',px(70),py(500)+45,13,COL['blue'])
equipment=group('Coffee equipment / machines, dispensers and Nova-2',coffee)
cx,cy=P['robots']['nova2']['center_cm']; robot_package(equipment,'nova2',px(cx),py(cy))
for device in P['coffee_devices']:
    dg=group(device['name'],equipment,equipment_id=device['id'])
    x=px(device['x_cm']); y=py(device['y_cm'])
    if 'diameter_cm' in device:
        circle(dg,device['name']+' dispenser',x,y,device['diameter_cm']*S,'#FFFFFF',COL['blue'],1.5,physical_cm={'diameter':device['diameter_cm']})
        label(dg,device['name']+' label',device['name'],x-18,y+4,10,COL['blue'],align='right')
    else:
        w=device['width_cm']*S; d=device['depth_cm']*S
        rect(dg,device['name']+' footprint',x-w/2,y-d/2,w,d,'#FFFFFF',COL['blue'],1.4,physical_cm={'width':device['width_cm'],'depth':device['depth_cm']})
        label(dg,device['name']+' label',device['name'],x,y+5,14,COL['blue'])
        if device['front']=='right': line(dg,'Machine operating face',x+w/2-3,y-d/2+5,x+w/2-3,y+d/2-5,COL['blue'],3)
        else: line(dg,'Machine operating face',x-w/2+5,y+d/2-3,x+w/2-5,y+d/2-3,COL['blue'],3)

plan_rect(charge,'Charging zone / inferred boundary',200,360,115,140,fill='none',stroke=COL['line'],dash=[8,6])
dock=group('Charging dock / port faces left',charge)
plan_rect(dock,'Dock reference overall envelope',255.8,402.75,57.2,54.5,fill='#F5F7F8',stroke='#8699A3',sw=1,dash=[3,3])
plan_rect(dock,'Dock housing',271.5,405.5,40,49,fill='#E8EEF0',stroke='#526D7A')
plan_rect(dock,'Dock charging port',255.8,424.4,15.7,11.2,fill='#526D7A',stroke='none',sw=0)
plan_rect(dock,'Dock display',281.5,417,19,18,fill='#ABD0D4',stroke='#526D7A',sw=1)
arrow(dock,'Dock connector points left',px(254),py(430),px(238),py(430),COL['blue'],2)
label(charge,'Charging zone label','充电桩 / Charging',px(257.5),py(478),16,COL['muted'])

hdim(measure,'Main width',px(0),px(main),173,'315 cm',OY-7,20)
hdim(measure,'Right counter width',px(main),px(width),173,'60 cm',OY-7,20)
x=0
for length in P['width_chain_cm']+[side]:
    hdim(measure,'Width chain '+str(x),px(x),px(x+length),230,str(length)+' cm',OY-7,18); x+=length
vdim(measure,'Working depth',py(0),py(depth),173,'360 cm',OX-7,20)
vdim(measure,'Coffee depth',py(depth),py(visible),173,'140 cm',OX-7,20)
vdim(measure,'Unshown remainder',py(visible),py(total),173,'75 cm *',OX-7,18)
vdim(measure,'Overall depth',py(0),py(total),102,'575 cm *',OX-7,21)

label(legend,'Main title','ROBOTIC COFFEE BAR',OX,61,31,align='left')
label(legend,'Scale and Chinese title','机器人咖啡吧 / 2 px = 1 cm',OX,98,19,COL['muted'],align='left')
label(legend,'Grouping description','Area groups · robot + reach pairs · editable equipment',OX,127,14,COL['muted'],align='left')
notes=[
    'SCALE: 2 px = 1 cm. All robot references use the same scale as the plan.',
    'Shelf bays: 60 / 100 / 100 / 100 cm are approximate; working depth remains 360 cm.',
    '* The source shows 500 cm of the annotated 575 cm depth. The pale 75 cm strip is unconfirmed.',
    'Nova-5 cart: 60 cm X × 80 cm Y; base top gap 4 cm, right gap 10 cm (original 13 × 13 cm symbol).',
    'Reach rings are circular planning envelopes; they do not certify joint limits or collision-free movement.',
    'Select a work area to move its contents. Select a robot package to move its equipment and both circles.',
]
for i,t in enumerate(notes): label(legend,'Plan note '+str(i),t,OX,1494+i*28,14,COL['muted'],align='left')

# A separate same-scale reference library: every Copy group is a reusable robot package.
libhead=group('Reference legend / heading',library)
label(libhead,'Library title','ROBOT REFERENCE LIBRARY',1110,178,29,align='left')
label(libhead,'Library instructions','Copy a “Copy / robot” group into the plan · circles and equipment stay together · 2 px = 1 cm',1110,209,16,COL['muted'],align='left')
positions=[('nova2',1390,565),('nova5',1960,565),('me6',2530,565),('mg400',1390,1245),('atom_w',1960,1245)]
for key,cx,cy in positions:
    inv=P['robot_inventory'][key]
    card=group('Reference / '+inv['name'],library,role='reference_card',robot=key)
    payload=robot_package(card,key,cx,cy,reference=True)
    caption=group(inv['name']+' / reference measurements',card,role='reference_measurements')
    label(caption,inv['name']+' reference heading',inv['name'].upper(),cx,cy-275,24)
    label(caption,inv['name']+' tool',inv['tool'],cx,cy-247,14,COL['muted'])
    label(caption,inv['name']+' maximum diameter','MAX EFFECTIVE  Ø '+f"{inv['effective_diameter_cm']:.2f}"+' cm',cx,cy+281,18,COL['max'])
    label(caption,inv['name']+' placement diameter','PLACEMENT  Ø '+f"{inv['placement_diameter_cm']:.2f}"+' cm',cx,cy+309,18,COL['place'])
    label(caption,inv['name']+' working radius','Working R '+f"{inv['working_radius_cm']:.2f}"+' cm  +  tool '+f"{inv['tool_length_cm']:.2f}"+' cm',cx,cy+336,13,COL['muted'])
    if key=='nova5':
        # All four cart dimensions are grouped separately from the reusable payload.
        cart=next(o for o in payload['shapes'] if o.get('role')=='nova5_cart')
        mount=next(o for o in payload['shapes'] if o.get('role')=='robot_base')
        x,y,w,d=cart['x'],cart['y'],cart['width'],cart['height']
        hdim(caption,'Cart width',x,x+w,y+d+28,'60 cm',y+d,13)
        vdim(caption,'Cart long edge',y,y+d,x-22,'80 cm',x,13)
        gap_x=x+w+18
        for yy in [y,mount['y']]:line(caption,'4 cm top gap extension',mount['x']+mount['width'],yy,gap_x+5,yy,COL['muted'],1)
        line(caption,'4 cm top gap',gap_x,y,gap_x,mount['y'],COL['muted'],1.5)
        label(caption,'4 cm cart top offset','4 cm',gap_x+9,(y+mount['y'])/2+4,13,COL['muted'],align='left')
        gx=mount['x']+mount['width']; gy=mount['y']+mount['height']+19
        line(caption,'10 cm right offset',gx,gy,x+w,gy,COL['muted'],1.5)
        for xx in [gx,x+w]:line(caption,'10 cm right extension',xx,gy-4,xx,gy+4,COL['muted'],1)
        label(caption,'10 cm cart right offset','10 cm',x+w+22,gy+5,13,COL['muted'],align='left')

key=group('Reference legend / formulas and Atom-W derivation',library)
rect(key,'Reference notes background',2260,970,540,570,'#F6F8FA','none',0,radius=12)
tx=2284
label(key,'Reach legend title','READING THE TWO CIRCLES',tx,1009,19,align='left')
line(key,'Effective style sample',tx,1040,tx+85,1040,COL['max'],2,[10,7])
label(key,'Effective legend','Maximum effective reach',tx+103,1046,16,COL['max'],align='left')
line(key,'Placement style sample',tx,1080,tx+85,1080,COL['place'],2.3)
label(key,'Placement legend','Realistic placement reach',tx+103,1086,16,COL['place'],align='left')
for i,t in enumerate(['Effective diameter = 2 × (working R + tool)', 'Placement diameter = 2 × working R × 70/85', 'Tool length is excluded from placement reach.']): label(key,'Formula '+str(i),t,tx,1125+i*25,14,COL['muted'],align='left')
label(key,'Atom derivation title','ATOM-W / MEASURED FROM URDF',tx,1227,18,align='left')
atomnotes=['Arm to hand mount: 58.35 cm','Torso-to-shoulder sweep radius: 20.60 cm','Working radius: 78.95 cm','Hand mount to palm midpoint: 6.32 cm','Fingers excluded; upright torso assumed.','Circle centre = torso yaw axis, 2.5 cm','behind the chassis origin. Geometric estimate.']
for i,t in enumerate(atomnotes):label(key,'Atom derivation '+str(i),t,tx,1260+i*25,14,COL['muted'],align='left')
label(key,'Reference note','Mounting shapes are plan symbols, not arm poses.',tx,1471,13,COL['muted'],align='left')
label(key,'Reference note 2','Cart offsets use the original 13 × 13 cm Nova-5 symbol.',tx,1495,13,COL['muted'],align='left')

NS='http://www.w3.org/2000/svg'; ET.register_namespace('',NS)
def tag(n):return '{'+NS+'}'+n
counter=0
def svg_shape(parent,o):
    global counter
    counter+=1
    attrs={'id':'Shape_'+str(counter),'data-name':o['name'],'stroke':o.get('stroke','none'),'stroke-width':str(o.get('stroke_width',0)),'fill':o.get('fill','none')}
    for key in ['role','robot']: 
        if key in o:attrs['data-'+key]=str(o[key])
    if o.get('dash'):attrs['stroke-dasharray']=' '.join(map(str,o['dash']))
    if 'diameter' in o.get('physical_cm',{}):attrs['data-diameter-cm']=str(o['physical_cm']['diameter'])
    if o['kind']=='line':
        attrs.update({k:str(o[k]) for k in ['x1','y1','x2','y2']}); node=ET.SubElement(parent,tag('line'),attrs)
    elif o['kind']=='rect':
        attrs.update({k:str(o[k]) for k in ['x','y','width','height']})
        if o.get('radius'):attrs['rx']=str(o['radius'])
        node=ET.SubElement(parent,tag('rect'),attrs)
    else:
        attrs.update(cx=str(o['x']+o['width']/2),cy=str(o['y']+o['height']/2),rx=str(o['width']/2),ry=str(o['height']/2)); node=ET.SubElement(parent,tag('ellipse'),attrs)
    ET.SubElement(node,tag('title')).text=o['name']

def svg_group(parent,layer,outlined):
    global counter
    attrs={'id':layer['id'],'data-name':layer['name']}
    for key in ['role','robot']:
        if key in layer:attrs['data-'+key]=str(layer[key])
    if layer.get('reference'):attrs['data-reference']='true'
    g=ET.SubElement(parent,tag('g'),attrs)
    ET.SubElement(g,tag('title')).text=layer['name']
    for o in layer['shapes']:svg_shape(g,o)
    for child in layer['children']:svg_group(g,child,outlined)
    for t in layer['texts']:
        counter+=1
        attrs={'id':'Label_'+str(counter),'data-name':t['name'],'fill':t['color']}
        if t['rotation']:attrs['transform']=f'rotate({t["rotation"]} {t["x"]} {t["y"]})'
        if not outlined:
            attrs.update(x=str(t['x']),y=str(t['y']),**{'font-size':str(t['font_size']),'font-family':'Inter, Noto Sans SC, Microsoft YaHei, sans-serif','text-anchor':{'left':'start','center':'middle','right':'end'}[t['align']]})
            ET.SubElement(g,tag('text'),attrs).text=t['text'];continue
        attrs['aria-label']=t['text']; tg=ET.SubElement(g,tag('g'),attrs)
        ET.SubElement(tg,tag('title')).text=t['text']
        xx=t['x']-(t['width']/2 if t['align']=='center' else t['width'] if t['align']=='right' else 0)
        for ch in t['text']:
            fam=family(ch); gn=cmaps[fam][ord(ch)]; cachekey=(fam,gn)
            if cachekey not in paths:
                pen=SVGPathPen(glyphsets[fam]); glyphsets[fam][gn].draw(pen); paths[cachekey]=pen.getCommands()
            if paths[cachekey]:
                scale=t['font_size']/fonts[fam]['head'].unitsPerEm
                ET.SubElement(tg,tag('path'),{'d':paths[cachekey],'transform':f'translate({xx:.6f} {t["y"]}) scale({scale:.9f} {-scale:.9f})'})
            xx+=glyph_width(ch,t['font_size'])

def create_svg(outlined,reference_only=False):
    global counter
    counter=0
    sw,sh=(1750,1490) if reference_only else (W,H)
    svg=ET.Element(tag('svg'),{'width':str(sw),'height':str(sh),'viewBox':f'0 0 {sw} {sh}','version':'1.1','id':'Robot_Coffee_Bar_Figma'})
    ET.SubElement(svg,tag('title')).text='Robot reference library' if reference_only else 'Coffee bar grouped by area'
    ET.SubElement(svg,tag('desc')).text='2 pixels per centimetre. Each robot package contains maximum effective and realistic placement reach circles. Orange dashed = effective; teal solid = placement.'
    if reference_only:
        ET.SubElement(svg,tag('rect'),{'width':str(sw),'height':str(sh),'fill':'#FFFFFF'})
        wrap=ET.SubElement(svg,tag('g'),{'transform':'translate(-1080 -145)'})
        svg_group(wrap,library,outlined)
    else:
        for layer in LAYERS:svg_group(svg,layer,outlined)
    return svg

data={'width':W,'height':H,'pixels_per_cm':S,'layers':LAYERS,'parameters':P,'grouping':'recursive area groups with paired robot reach circles'}
(HERE/'layout-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for outlined,name,refs in [(True,'coffee-bar-figma.svg',False),(False,'coffee-bar-editable-text.svg',False),(True,'robot-reference.svg',True),(False,'robot-reference-editable-text.svg',True)]:
    ET.ElementTree(create_svg(outlined,refs)).write(HERE/name,encoding='utf-8',xml_declaration=True)
print(json.dumps({'top_level_groups':len(LAYERS),'named_groups':len(ALL),'text_lines':len(TEXTS),'reference_robots':list(P['robot_inventory']),'svg_bytes':(HERE/'coffee-bar-figma.svg').stat().st_size}))
