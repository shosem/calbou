// 依存なしでPNGアイコンを生成する(緑地に白い円)
import zlib from 'node:zlib';
import fs from 'node:fs';
function crc(buf){let c,n,t=[];for(n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}
  let r=0xffffffff;for(const b of buf)r=t[(r^b)&255]^(r>>>8);return(r^0xffffffff)>>>0}
function chunk(type,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);
  const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
function png(size){
  const raw=Buffer.alloc((size*3+1)*size);
  for(let y=0;y<size;y++){raw[y*(size*3+1)]=0;for(let x=0;x<size;x++){
    const d=Math.hypot(x-size/2,y-size/2);const inC=d<size*0.3;const ring=d<size*0.3&&d>size*0.2;
    const o=y*(size*3+1)+1+x*3;const col=inC&&!ring&&d<size*0.14?[22,163,74]:inC?[255,255,255]:[22,163,74];
    raw[o]=col[0];raw[o+1]=col[1];raw[o+2]=col[2];}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
fs.writeFileSync('public/icon-192.png',png(192));
fs.writeFileSync('public/icon-512.png',png(512));
fs.writeFileSync('public/apple-touch-icon.png',png(180));
