const fs = require('fs');
const src = fs.readFileSync('models/weapons_data.js','utf8');
const window = {};
const fn = new Function('window', src + '\nreturn window.WEAPONS_DATA;');
const WD = fn(window);

function f32(b64){
  const raw = Buffer.from(b64,'base64');
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length/4);
}
function det(m){
  const [a,b,c]=m;
  return a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
}
for(const key of Object.keys(WD)){
  const d = WD[key];
  const p = f32(d.pos);
  let minx=1e9,miny=1e9,minz=1e9,maxx=-1e9,maxy=-1e9,maxz=-1e9;
  for(let i=0;i<p.length;i+=3){
    minx=Math.min(minx,p[i]);maxx=Math.max(maxx,p[i]);
    miny=Math.min(miny,p[i+1]);maxy=Math.max(maxy,p[i+1]);
    minz=Math.min(minz,p[i+2]);maxz=Math.max(maxz,p[i+2]);
  }
  const sx=maxx-minx, sy=maxy-miny, sz=maxz-minz;
  let branch, mat;
  if(sy>=sx && sy>=sz){ branch='Y-long'; mat=[[1,0,0],[0,0,1],[0,-1,0]]; }
  else if(sx>=sz){ branch='X-long'; mat=[[0,0,1],[1,0,0],[0,-1,0]]; }
  else { branch='Z-long(else)'; mat=[[0,0,1],[1,0,0],[0,-1,0]]; }
  const dval=det(mat);
  console.log(key.padEnd(8), 'raw x,y,z=', sx.toFixed(3), sy.toFixed(3), sz.toFixed(3),
    '| branch=', branch, '| basisDet=', dval.toFixed(3), (dval<0?'(REFLECTION->inside-out)':'(rotation-ok)'));
}
