const fs=require('fs');
const s=fs.readFileSync('models/buildings_out.js','utf8');
const start=s.indexOf('{');
// 找到 JSON 结尾（最后一个 }）
const end=s.lastIndexOf('}');
const tail=s.slice(end, end+40);
console.log('JSON end tail:', JSON.stringify(tail));
const d=JSON.parse(s.slice(start, end+1));
for (const k of ['base','refinery','stadium','megatower','bunker','hangar','apartment','house','warehouse']) {
  const o=d[k];
  console.log(k, o ? ('存在 pos='+o.pos.length+' idx='+o.idx.length+' nor='+o.nor.length) : '缺失');
}
console.log('total keys:', Object.keys(d).length, '->', Object.keys(d).join(','));
