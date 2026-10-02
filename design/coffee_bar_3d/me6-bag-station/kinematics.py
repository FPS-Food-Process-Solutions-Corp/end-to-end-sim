"""URDF forward kinematics and continuous damped least-squares IK, in metres."""
from pathlib import Path
import json, math, xml.etree.ElementTree as ET
import numpy as np

HERE=Path(__file__).resolve().parent
def rot(axis,angle):
    axis=np.asarray(axis,dtype=float);axis/=np.linalg.norm(axis)
    x,y,z=axis;K=np.array([[0,-z,y],[z,0,-x],[-y,x,0]])
    return np.eye(3)+math.sin(angle)*K+(1-math.cos(angle))*(K@K)
def transform(xyz=(0,0,0),rpy=(0,0,0)):
    T=np.eye(4);T[:3,3]=xyz
    r,p,y=rpy;T[:3,:3]=rot([0,0,1],y)@rot([0,1,0],p)@rot([1,0,0],r)
    return T
class Arm:
    def __init__(self,p):
        self.p=p;doc=ET.parse(p['robot']['urdf'])
        self.joints=[]
        for j in doc.findall('joint'):
            if j.get('type')!='revolute':continue
            o=j.find('origin');lim=j.find('limit')
            self.joints.append(dict(name=j.get('name'),child=j.find('child').get('link'),xyz=list(map(float,o.get('xyz').split())),rpy=list(map(float,o.get('rpy').split())),axis=list(map(float,j.find('axis').get('xyz').split())),lower=float(lim.get('lower')),upper=float(lim.get('upper'))))
        self.origins=[transform(j['xyz'],j['rpy']) for j in self.joints]
        self.axes=[np.array(j['axis']) for j in self.joints]
        self.lower=np.array([j['lower'] for j in self.joints])+.01
        self.upper=np.array([j['upper'] for j in self.joints])-.01
        self.base=transform(p['robot']['base'])
        self.tool=transform([0,0,p['robot']['tool_length']])
    def fk(self,q,details=False):
        T=self.base.copy();origins=[];axes=[];links=[]
        for origin,axis,angle in zip(self.origins,self.axes,q):
            T=T@origin;origins.append(T[:3,3].copy());axes.append(T[:3,:3]@axis)
            R=np.eye(4);R[:3,:3]=rot(axis,angle);T=T@R;links.append(T.copy())
        T=T@self.tool
        return (T,origins,axes,links) if details else T
    def solve(self,pos,R,seed):
        q=np.clip(np.array(seed,dtype=float),self.lower,self.upper)
        for k in range(180):
            T,origins,axes,links=self.fk(q,True)
            ep=np.array(pos)-T[:3,3]
            eo=sum(np.cross(T[:3,i],R[:,i]) for i in range(3))*.5
            error=np.r_[ep,eo*.22]
            if np.linalg.norm(ep)<.00006 and np.linalg.norm(R-T[:3,:3])<.001:break
            J=np.zeros((6,6))
            for i,(o,a) in enumerate(zip(origins,axes)):
                J[:3,i]=np.cross(a,T[:3,3]-o);J[3:,i]=a*.22
            damping=.006
            dq=J.T@np.linalg.solve(J@J.T+np.eye(6)*damping**2,error)
            length=np.max(np.abs(dq))
            if length>.16:dq*=.16/length
            q=np.clip(q+dq,self.lower,self.upper)
        T=self.fk(q)
        return q,float(np.linalg.norm(T[:3,3]-pos)),float(np.linalg.norm(T[:3,:3]-R))

def phases(p):
    m,s,t,b=p['magazine'],p['station'],p['tool'],p['bag']
    z=t['contact_height'];lift=p['motion']['lift'];ry=p['motion']['retreat_y']
    closed=s['rear_face_y']-b['flat_depth'];opened=s['rear_face_y']-b['depth']
    knots=[
      (0,[0,.05,z+.06],'Ready'),
      (1.8,[m['x'],ry,z],'Approach magazine'),
      (3,[m['x'],m['front_y'],z],'Grip one bag'),
      (3.7,[m['x'],m['front_y'],z],'Grip one bag'),
      (5.2,[m['x'],ry,z+lift],'Withdraw from magazine'),
      (7.8,[s['x'],ry,z+lift],'Carry to opener'),
      (9.4,[s['x'],closed,z],'Present to fixed suction'),
      (10.4,[s['x'],closed,z],'Confirm opposing suction'),
      (12.5,[s['x'],opened,z],'Pull mouth open'),
      (16,[s['x'],opened,z],'Hold for loading')]
    return [(t*p['motion']['duration']/16,pos,label) for t,pos,label in knots]
def target_at(p,t):
    knots=phases(p)
    for i in range(len(knots)-1):
        a,b=knots[i:i+2]
        if t<=b[0]+1e-8:
            u=np.clip((t-a[0])/(b[0]-a[0]),0,1);u=u*u*(3-2*u)
            return np.array(a[1])*(1-u)+np.array(b[1])*u,b[2]
    return np.array(knots[-1][1]),knots[-1][2]

def build_motion():
    p=json.loads((HERE/'parameters.json').read_text());arm=Arm(p)
    R=transform(rpy=[-math.pi/2,0,0])[:3,:3]
    pos,_=target_at(p,0)
    rng=np.random.default_rng(42)
    candidates=[]
    for seed in [[0,-.5,1.5,-1,0,0]]+[rng.uniform(-2,2,6) for _ in range(50)]:
        q,ep,er=arm.solve(pos,R,seed)
        if ep<.0003 and er<.003:
            T,origins,axes,links=arm.fk(q,True)
            if min(T[2,3] for T in links)>.035:
                candidates.append((sum(q*q)+max(0,max(T[1,3] for T in links)-.1)*50,q))
    if not candidates:raise RuntimeError('No initial pose found')
    candidates.sort(key=lambda a:a[0])
    frames=[];q=candidates[0][1];maxep=maxer=maxstep=0
    fps=p['motion']['fps'];count=round(p['motion']['duration']*fps)
    for f in range(count+1):
        t=f/fps;clock=t*16/p['motion']['duration'];pos,phase=target_at(p,t)
        old=q.copy();q,ep,er=arm.solve(pos,R,q)
        if ep>.0005 or er>.005:raise RuntimeError(f'Unreachable pose at {t}: {ep}, {er}')
        maxep=max(maxep,ep);maxer=max(maxer,er);maxstep=max(maxstep,float(np.max(abs(q-old))))
        T,origins,axes,links=arm.fk(q,True)
        actual=T[:3,3]
        b=p['bag'];m=p['magazine'];s=p['station']
        carried=clock>=3.7
        bagpos=([m['x'],m['front_y'],b['bottom']] if not carried else [float(actual[0]),float(actual[1]),float(actual[2]-p['tool']['contact_height']+b['bottom'])])
        depth=max(b['flat_depth'],s['rear_face_y']-actual[1]) if clock>=10.4 else b['flat_depth']
        frames.append(dict(time=round(t,6),q=q.tolist(),tcp=actual.tolist(),bag_position=bagpos,bag_depth=float(depth),robot_vacuum=clock>=3,fixed_vacuum=clock>=9.4,phase=phase))
    report=dict(max_tcp_error_mm=maxep*1000,max_orientation_matrix_error=maxer,max_joint_step_deg=math.degrees(maxstep),max_sampled_joint_speed_deg_s=math.degrees(maxstep)*fps,joint_limits_checked=True,collision_check='Not a full mesh collision simulation',duration_seconds=p['motion']['duration'],fps=fps,poses=len(frames),start_joint_degrees=np.degrees(frames[0]['q']).round(2).tolist(),end_joint_degrees=np.degrees(frames[-1]['q']).round(2).tolist())
    data=dict(parameters=p,joints=arm.joints,frames=frames,report=report)
    (HERE/'motion.json').write_text(json.dumps(data,separators=(',',':')))
    (HERE/'motion-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
if __name__=='__main__':build_motion()
