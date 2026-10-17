const fs=require('fs');
const s=fs.readFileSync('utf8');
const start=s.indexOf('{');
const d=JSON.parse(s.slice(start));
for (const k of ['base','refinery','stadium','megatower','bunker','hangar','apartment','house','warehouse']) {
  const o=d[k];
  console.log(k, o ? ('存在 pos='+o.pos.length+' idx='+o.idx.length+' nor='+o.nor.length) : '缺失');
}
console.log('total keys:', Object.keys(d).length, '->', Object.keys(d).join(','));
