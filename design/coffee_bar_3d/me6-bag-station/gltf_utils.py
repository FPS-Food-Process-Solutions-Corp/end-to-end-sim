"""Combine synchronized object tracks and start the exported GLB clip at time zero."""
import json,struct
def prepare_animation(path):
    raw=path.read_bytes();chunks=[];offset=12
    while offset<len(raw):
        length,kind=struct.unpack_from('<II',raw,offset);chunks.append([kind,bytearray(raw[offset+8:offset+8+length])]);offset+=8+length
    doc=json.loads(next(data for kind,data in chunks if kind==0x4E4F534A))
    combined={'name':'ME6 - pick, transfer and open','samplers':[],'channels':[]};targets=set()
    for clip in doc.get('animations',[]):
        shift=len(combined['samplers']);combined['samplers'].extend(clip['samplers'])
        for channel in clip['channels']:
            key=(channel['target']['node'],channel['target']['path'])
            if key in targets:raise ValueError('Overlapping animation channels')
            targets.add(key);combined['channels'].append({**channel,'sampler':channel['sampler']+shift})
    if not combined['channels']:raise ValueError('No animation was exported')
    doc['animations']=[combined]
    binary=next(data for kind,data in chunks if kind==0x004E4942)
    accessors=sorted({s['input'] for s in combined['samplers']})
    minimum=min(doc['accessors'][aid]['min'][0] for aid in accessors)
    for aid in accessors:
        a=doc['accessors'][aid];v=doc['bufferViews'][a['bufferView']]
        assert a['componentType']==5126 and a['type']=='SCALAR'
        start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',4)
        for i in range(a['count']):
            loc=start+i*stride;value=struct.unpack_from('<f',binary,loc)[0]
            struct.pack_into('<f',binary,loc,max(0,value-minimum))
        a['min']=[max(0,a['min'][0]-minimum)];a['max']=[a['max'][0]-minimum]
    encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    payload=b''.join(struct.pack('<II',len(encoded if kind==0x4E4F534A else data),kind)+(encoded if kind==0x4E4F534A else bytes(data)) for kind,data in chunks)
    path.write_bytes(struct.pack('<III',0x46546C67,2,len(payload)+12)+payload)
