// Chromium's streaming WebM omits Duration. Fill it in once recording ends.
// Only insert into an unindexed, unknown-length Segment; other containers pass through.
function vint(bytes,offset,size=false) {
  if(offset>=bytes.length)throw new Error('Truncated EBML');
  let width=1,mask=128;
  while(width<=8 && !(bytes[offset]&mask)){width++;mask>>=1;}
  if(width>8||offset+width>bytes.length)throw new Error('Invalid EBML');
  let value=BigInt(size?bytes[offset]&(mask-1):bytes[offset]);
  for(let i=1;i<width;i++)value=(value<<8n)|BigInt(bytes[offset+i]);
  return {width,value,unknown:size&&value===(1n<<BigInt(7*width))-1n};
}
function element(bytes,offset) {
  const id=vint(bytes,offset),size=vint(bytes,offset+id.width,true);
  return {id:Number(id.value),offset,sizeOffset:offset+id.width,sizeWidth:size.width,
    data:offset+id.width+size.width,size:Number(size.value),unknown:size.unknown};
}
function encodeSize(value,width=1) {
  while(BigInt(value)>=(1n<<BigInt(width*7))-1n)width++;
  let number=BigInt(value)|(1n<<BigInt(width*7));
  const bytes=new Uint8Array(width);
  for(let i=width-1;i>=0;i--){bytes[i]=Number(number&255n);number>>=8n;}
  return bytes;
}

export async function withWebMDuration(blob,seconds) {
  if(!blob.type.includes('webm')||!Number.isFinite(seconds)||seconds<=0)return blob;
  try{
    // All recorder headers are small; clusters/video payload remain Blob slices.
    const bytes=new Uint8Array(await blob.slice(0,65536).arrayBuffer());
    const header=element(bytes,0);
    const segment=element(bytes,header.data+header.size);
    if(segment.id!==0x18538067||!segment.unknown)return blob;
    let info;
    for(let p=segment.data;p<bytes.length;){
      const item=element(bytes,p);
      if(item.id===0x114d9b74)return blob; // SeekHead offsets must not be shifted.
      if(item.id===0x1549a966)info=item;
      if(item.id===0x1f43b675||item.unknown)break;
      p=item.data+item.size;
    }
    if(!info||info.data+info.size>bytes.length)return blob;
    let scale=1000000;
    for(let p=info.data;p<info.data+info.size;){
      const item=element(bytes,p);
      if(item.id===0x4489)return blob;
      if(item.id===0x2ad7b1){
        scale=0;for(let i=item.data;i<item.data+item.size;i++)scale=scale*256+bytes[i];
      }
      p=item.data+item.size;
    }
    const duration=new Uint8Array(11);
    duration.set([0x44,0x89,0x88]);
    new DataView(duration.buffer).setFloat64(3,seconds*1e9/scale,false);
    const end=info.data+info.size;
    return new Blob([blob.slice(0,info.sizeOffset),encodeSize(info.size+duration.length,info.sizeWidth),
      blob.slice(info.data,end),duration,blob.slice(end)],{type:blob.type});
  }catch{return blob;}
}
