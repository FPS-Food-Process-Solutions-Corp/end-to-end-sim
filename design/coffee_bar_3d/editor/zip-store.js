// ZIP STORE format: no dependency or upload. CRC-32 and UTF-8 filenames allow
// ordinary ZIP tools to read the bundle, including Windows Explorer.
const table = Uint32Array.from({length:256}, (_,n) => {
  let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc32(bytes) {let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
const encode = new TextEncoder();
export function zipStore(files) {
  const chunks=[],central=[];let offset=0,size=0;
  for(const [name,value] of files) {
    if(name.startsWith('/') || name.split('/').includes('..') || name.includes('\\'))throw new Error('Unsafe archive name');
    const filename=encode.encode(name),bytes=typeof value==='string'?encode.encode(value):new Uint8Array(value);
    const crc=crc32(bytes),header=new Uint8Array(30),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);
    h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,filename.length,true);
    chunks.push(header,filename,bytes);
    const entry=new Uint8Array(46),v=new DataView(entry.buffer);
    v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);
    v.setUint32(16,crc,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);
    central.push(entry,filename);size+=46+filename.length;offset+=30+filename.length+bytes.length;
    if(offset+size>0xffffffff||files.size>65535)throw new Error('Bundle exceeds ZIP size limits');
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.size,true);e.setUint16(10,files.size,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
