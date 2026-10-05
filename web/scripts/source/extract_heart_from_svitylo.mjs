// Extract heart + coronary sub-meshes from Svitylo/Z-Anatomy chunked GLBs into a standalone GLB with one named node per structure.
import {NodeIO, Document} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import fs from 'fs';
await MeshoptDecoder.ready;
const base=process.argv[2], quality=process.argv[3], out=process.argv[4];
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMeshQuantization]).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const man=JSON.parse(fs.readFileSync(`${base}/manifest.json`));
const byId=Object.fromEntries(man.structures.map(s=>[s.id,s]));
const want=process.argv[5].split(',');            // structure ids (without 'cardiovascular.' prefix)
const wantMesh=new Map();
for(const w of want){const s=byId['cardiovascular.'+w]; if(!s||!s.meshes) throw new Error('missing '+w); wantMesh.set(s.meshes[0],s.id);}
const chunkOf=mi=>man.chunks.find(c=>c.meshStart<=mi&&mi<c.meshStart+c.meshCount);
const chunks=new Map(); for(const mi of wantMesh.keys()){const c=chunkOf(mi); (chunks.get(c.id)||chunks.set(c.id,{c,ms:[]}).get(c.id)).ms.push(mi);}
const parts=[]; // {id, pos(Float32 world m), nrm, idx}
for(const {c,ms} of chunks.values()){
  const doc=await io.read(`${base}/${c.files[quality].path}`);
  const node=doc.getRoot().listNodes()[0]; const S=node.getScale(), T=node.getTranslation();
  const prim=doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P=prim.getAttribute('POSITION').getArray(), N=prim.getAttribute('NORMAL').getArray(), I=prim.getAttribute('_ID').getArray(), ia=prim.getIndices().getArray();
  for(const mi of ms){
    const remap=new Map(), pos=[], nrm=[], idx=[];
    for(let t=0;t<ia.length;t+=3){
      if(I[ia[t]*2]!==mi) continue;
      for(let k=0;k<3;k++){const v=ia[t+k]; let r=remap.get(v);
        if(r===undefined){r=pos.length/3; remap.set(v,r);
          for(let a=0;a<3;a++) pos.push(P[v*3+a]/32767*S[a]+T[a]);
          for(let a=0;a<3;a++) nrm.push(N[v*3+a]/32767);}
        idx.push(r);}
    }
    parts.push({id:wantMesh.get(mi),pos:Float32Array.from(pos),nrm:Float32Array.from(nrm),idx:Uint32Array.from(idx)});
  }
}
// recentre on centroid of the 4 chambers' bbox, scale so chamber bbox max extent = 1
const ch=parts.filter(p=>/\.(left|right)_(atrium|ventricle)$/.test(p.id));
const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
for(const p of ch) for(let i=0;i<p.pos.length;i+=3) for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],p.pos[i+a]);mx[a]=Math.max(mx[a],p.pos[i+a]);}
const ctr=mn.map((m,a)=>(m+mx[a])/2), ext=Math.max(...mx.map((m,a)=>m-mn[a])), sc=1/ext;
console.log('chamber bbox (m)',mn.map(x=>x.toFixed(4)),mx.map(x=>x.toFixed(4)),'centre',ctr.map(x=>x.toFixed(4)),'extent',ext.toFixed(4),'scale',sc.toFixed(3));
const doc=new Document(); const buf=doc.createBuffer(); const scene=doc.createScene('heart');
doc.getRoot().getAsset().generator='extract.mjs from Svitylo data 1.1.0 (Z-Anatomy / BodyParts3D)';
const root=doc.createNode('heart_root').setExtras({sourceCentre_m:ctr,scaleToUnit:sc,coordinates:'+Y up, +Z anterior (patient front), +X patient left; metres*scale'}); scene.addChild(root);
const colour=id=>/left_coronary_artery$/.test(id)?[0.9,0.2,0.2]:/anterior_interventricular_artery$/.test(id)?[0.95,0.55,0.1]:/circumflex/.test(id)?[0.2,0.5,0.9]:/right_coronary_artery$/.test(id)?[0.2,0.75,0.3]:/septal_branches|inferolateral/.test(id)?[0.8,0.8,0.2]:/atrium|ventricle|papillary/.test(id)?[0.75,0.45,0.45]:/leaflet/.test(id)?[0.9,0.85,0.7]:[0.7,0.6,0.6];
let tris=0;
for(const p of parts){
  for(let i=0;i<p.pos.length;i+=3) for(let a=0;a<3;a++) p.pos[i+a]=(p.pos[i+a]-ctr[a])*sc;
  const name=p.id.replace('cardiovascular.','');
  const mat=doc.createMaterial(name).setBaseColorFactor([...colour(p.id),1]).setRoughnessFactor(0.6).setMetallicFactor(0).setDoubleSided(true);
  const prim=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(p.pos).setBuffer(buf)).setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(p.nrm).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(p.idx).setBuffer(buf)).setMaterial(mat);
  const mesh=doc.createMesh(name).addPrimitive(prim);
  root.addChild(doc.createNode(name).setMesh(mesh).setExtras({zAnatomyObject:byId[p.id].source?.object,structureId:p.id}));
  tris+=p.idx.length/3;
}
await io.write(out,doc);
console.log('parts',parts.length,'tris',tris,'bytes',fs.statSync(out).size);
