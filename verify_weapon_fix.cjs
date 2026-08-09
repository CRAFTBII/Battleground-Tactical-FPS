// Runtime verification for the "only back faces render" fix.
// Builds each weapon body exactly like ModelLib.buildWeaponMesh, then raycasts
// from outside the bounding sphere toward the center. A correct (non-inside-out)
// mesh with a FrontSide material must be hit from outside.
const fs = require('fs');
const THREE = require('./libs/three.min.js');
const window = {};
const fn = new Function('window', fs.readFileSync('models/weapons_data.js','utf8') + '\nreturn window.WEAPONS_DATA;');
const WD = fn(window);

function f32FromB64(b64){ const raw = Buffer.from(b64,'base64'); return new Float32Array(raw.buffer, raw.byteOffset, raw.length/4); }
function u16FromB64(b64){ const raw = Buffer.from(b64,'base64'); return new Uint16Array(raw.buffer, raw.byteOffset, raw.length/2); }

// mirror of buildWeaponMesh body construction
function buildBody(key, flippedYAxis){
  const d = WD[key];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f32FromB64(d.pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(f32FromB64(d.nor), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(f32FromB64(d.uv), 2));
  geo.setIndex(new THREE.BufferAttribute(u16FromB64(d.idx), 1));
  geo.computeBoundingBox();
  const sz = geo.boundingBox.getSize(new THREE.Vector3());
  if (sz.y >= sz.x && sz.y >= sz.z) {
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,1), new THREE.Vector3(0,-1,0)));
  } else if (sz.x >= sz.z) {
    const yTarget = flippedYAxis ? new THREE.Vector3(-1,0,0) : new THREE.Vector3(1,0,0);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,1), yTarget, new THREE.Vector3(0,-1,0)));
  }
  geo.computeBoundingBox();
  const sz2 = geo.boundingBox.getSize(new THREE.Vector3());
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a4d52 }));
  mesh.scale.setScalar(0.78 / sz2.z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function raycastHits(mesh){
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  const center = new THREE.Vector3(); bb.getCenter(center);
  const radius = bb.getBoundingSphere(new THREE.Sphere()).radius;
  const dirs = [];
  for (let i=0;i<24;i++){
    const u = i/24*Math.PI*2;
    dirs.push(new THREE.Vector3(Math.cos(u), 0.3, Math.sin(u)).normalize());
    dirs.push(new THREE.Vector3(0.4*Math.cos(u), 1, 0.4*Math.sin(u)).normalize());
  }
  const ray = new THREE.Raycaster();
  let hits=0;
  for (const dir of dirs){
    const origin = center.clone().add(dir.clone().multiplyScalar(radius*2.2));
    ray.set(origin, center.clone().sub(origin).normalize());
    ray.far = radius*5;
    const res = ray.intersectObject(mesh, false);
    if (res.length) hits++;
  }
  return { hits, total: dirs.length, center, muzzleZ: bb.min.z };
}

console.log('=== OLD basis (y axis +X, det=-1 reflection) — should FAIL (inside-out) ===');
for (const k of ['rifle','pistol','sniper','shotgun']){
  const m = buildBody(k, false);
  const r = raycastHits(m);
  console.log(k.padEnd(8), 'outside ray hits:', r.hits+'/'+r.total, r.hits < r.total*0.5 ? '  <-- INSIDE-OUT (bug)' : '');
}

console.log('\n=== NEW basis (y axis -X, det=+1 proper rotation) ===');
for (const k of ['rifle','pistol','sniper','shotgun']){
  const m = buildBody(k, true);
  const r = raycastHits(m);
  console.log(k.padEnd(8), 'outside ray hits:', r.hits+'/'+r.total, r.hits >= r.total*0.5 ? '  OK (front faces outward)' : '  <-- STILL BROKEN');
}
