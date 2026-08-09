// Decisive check: determinant of the linear (orientation) transform for each gun.
// det = +1  -> proper rotation, winding preserved, FrontSide renders correctly.
// det = -1  -> reflection, winding flipped, mesh becomes inside-out ("only back faces").
const fs = require('fs');
const THREE = require('./libs/three.min.js');
const window = {};
const fn = new Function('window', fs.readFileSync('models/weapons_data.js','utf8') + '\nreturn window.WEAPONS_DATA;');
const WD = fn(window);
function f32(b64){ const r=Buffer.from(b64,'base64'); return new Float32Array(r.buffer,r.byteOffset,r.length/4); }
function det3(m){ const[a,b,c]=m; return a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]); }

for (const key of Object.keys(WD)){
  const p = f32(WD[key].pos);
  let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
  for(let i=0;i<p.length;i+=3){ mnx=Math.min(mnx,p[i]);mxx=Math.max(mxx,p[i]); mny=Math.min(mny,p[i+1]);mxy=Math.max(mxy,p[i+1]); mnz=Math.min(mnz,p[i+2]);mxz=Math.max(mxz,p[i+2]); }
  const sx=mxx-mnx, sy=mxy-mny, sz=mxz-mnz;
  let basis;
  if (sy>=sx && sy>=sz) basis=[[1,0,0],[0,0,1],[0,-1,0]];        // Y-long (rifle)
  else if (sx>=sz)      basis=[[0,0,1],[-1,0,0],[0,-1,0]];       // X-long FIXED: y -> -X (det +1)
  const d = det3(basis);
  console.log(key.padEnd(8), 'basisDet=', d.toFixed(3), d>0 ? 'OK rotation (front faces render)' : 'BROKEN reflection');
}
