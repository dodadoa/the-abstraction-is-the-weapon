'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------- palettes */
const PALETTES = [
  { sky:[0x24ff00,0xff00a8], ground:[0x0f5c00,0x8cff00], fog:0x145200, bldg:[0x2d7a00,0xffe000,0xff5ce0], mark:0xff2f6d, root:55.00 },
  { sky:[0xd6ff00,0x8a00ff], ground:[0x6b7a00,0xfff200], fog:0x4d5500, bldg:[0x665e00,0xc400ff,0x00ffc8], mark:0x00e5ff, root:61.74 },
  { sky:[0xff8a7a,0x7a0030], ground:[0x8a2a1a,0xffb09a], fog:0x5c1c10, bldg:[0x7a3020,0xffd0c0,0x30ff8a], mark:0xb6ff2b, root:49.00 },
  { sky:[0x00ffee,0xff6a00], ground:[0x006b62,0x00ffd0], fog:0x00443e, bldg:[0x005550,0xff9a00,0xff00ff], mark:0xffe22b, root:65.41 },
  { sky:[0xbf00ff,0x9dff00], ground:[0x4d0066,0xd12bff], fog:0x33004d, bldg:[0x40085c,0x9dff00,0xff2f6d], mark:0x9dff3a, root:43.65 },
  { sky:[0xff0000,0xffe000], ground:[0x660000,0xff4d00], fog:0x4d0000, bldg:[0x661111,0xffd000,0x00ff88], mark:0x00ffcc, root:58.27 }
];

export default function ScopeOrgan() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const $ = (sel) => root.querySelector(sel);
    const disposers = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      disposers.push(() => target.removeEventListener(type, fn, opts));
    };

    // Match the legacy r128 color pipeline the original was tuned against
    THREE.ColorManagement.enabled = false;

    let palIndex = 0;

    /* the stage is either the whole window or a fixed-resolution box scaled to
       fit it; everything lays out in stage pixels (viewW x viewH), and pointer
       positions are mapped from the window into the stage through lx / ly */
    let viewW = window.innerWidth, viewH = window.innerHeight;
    let viewS = 1, viewOX = 0, viewOY = 0;
    const lx = e => (e.clientX - viewOX)/viewS;
    const ly = e => (e.clientY - viewOY)/viewS;

    /* ---------------------------------------------------------- three setup */
    const stage = $('#stage');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(78, viewW/viewH, 0.1, 2000);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 3.2, 0);
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    renderer.setSize(viewW, viewH);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    stage.appendChild(renderer.domElement);

    const cur = {
      skyTop:new THREE.Color(), skyBot:new THREE.Color(),
      gLo:new THREE.Color(), gHi:new THREE.Color(),
      fog:new THREE.Color(), b0:new THREE.Color(), b1:new THREE.Color(), b2:new THREE.Color(),
      mark:new THREE.Color()
    };
    let target = null;
    let lastPal = 0;
    function setPalette(i, instant){
      lastPal = performance.now();
      const p = PALETTES[i % PALETTES.length];
      const t = {
        skyTop:new THREE.Color(p.sky[0]), skyBot:new THREE.Color(p.sky[1]),
        gLo:new THREE.Color(p.ground[0]), gHi:new THREE.Color(p.ground[1]),
        fog:new THREE.Color(p.fog),
        b0:new THREE.Color(p.bldg[0]), b1:new THREE.Color(p.bldg[1]), b2:new THREE.Color(p.bldg[2]),
        mark:new THREE.Color(p.mark)
      };
      target = t;
      if (instant) for (const k in t) cur[k].copy(t[k]);
    }
    setPalette(0, true);

    scene.fog = new THREE.FogExp2(cur.fog.getHex(), 0.0085);

    /* sky dome, banded on purpose */
    const skyMat = new THREE.ShaderMaterial({
      side:THREE.BackSide, depthWrite:false,
      uniforms:{ top:{value:cur.skyTop}, bot:{value:cur.skyBot}, tme:{value:0} },
      vertexShader:`varying vec3 vP; void main(){ vP=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform vec3 top; uniform vec3 bot; uniform float tme; varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = d.y;
          float t = clamp(h*0.5+0.5, 0.0, 1.0);
          float smoothv = pow(t, 0.65);
          float band = floor(smoothv*21.0)/21.0;
          vec3 c = mix(bot, top, mix(smoothv, band, 0.72));
          float horizon = 1.0 - smoothstep(0.0, 0.12, abs(h));
          c += bot * horizon * 0.5;
          float ang = atan(d.z, d.x);
          float rays = step(0.965, sin(ang*24.0 + tme*0.13));
          c = mix(c, vec3(1.0)-c, rays*0.45*(1.0-abs(h)));
          float ring = step(0.94, sin(h*46.0 - tme*0.5));
          c = mix(c, c.gbr*1.5, ring*0.5);
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 48, 28), skyMat));

    // Modern three measures light intensity in physical units; x PI restores the r128 look
    const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
    sun.position.set(60, 90, -40);
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {left:-260, right:260, top:260, bottom:-260, far:600});
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    const amb = new THREE.AmbientLight(0xffffff, 0.45 * Math.PI);
    scene.add(amb);

    /* ---------------------------------------------------------- terrain */
    const SIZE = 420, SEG = 120;
    const gGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    gGeo.rotateX(-Math.PI/2);
    const gPos = gGeo.attributes.position;
    const vCount = gPos.count;
    const baseH = new Float32Array(vCount);
    const hashA = new Float32Array(vCount);
    const hashB = new Float32Array(vCount);
    function terrain(x, z){
      return Math.sin(x*0.031)*3.4 + Math.cos(z*0.027)*3.0
           + Math.sin((x+z)*0.013)*5.2 + Math.sin(x*0.09)*Math.cos(z*0.077)*1.3;
    }
    for (let i=0;i<vCount;i++){
      const x = gPos.getX(i), z = gPos.getZ(i);
      hashA[i] = Math.random();
      hashB[i] = Math.random();
      baseH[i] = terrain(x,z);
      gPos.setY(i, baseH[i]);
    }
    gGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vCount*3), 3));
    const gCol = gGeo.attributes.color;
    const groundLambert = new THREE.MeshLambertMaterial({vertexColors:true});
    const ground = new THREE.Mesh(gGeo, groundLambert);
    scene.add(ground);

    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.PlaneGeometry(SIZE, SIZE, 31, 31).rotateX(-Math.PI/2)),
      new THREE.LineBasicMaterial({color:0x000000, transparent:true, opacity:0.22})
    );
    grid.position.y = 0.06;
    scene.add(grid);

    /* terrain is permanently static: ripples are retired, calls are inert */
    function addRipple(){}

    /* ---------------------------------------------------------- architecture */
    const boxes = [];
    const bldgMats = [];
    const bGroup = new THREE.Group();
    scene.add(bGroup);
    for (let i=0;i<105;i++){
      const a = Math.random()*Math.PI*2;
      const r = 22 + Math.pow(Math.random(),0.7)*165;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      const spire = Math.random() < 0.22;
      const w = spire ? 1.6+Math.random()*2.2 : 4+Math.random()*13;
      const d = spire ? w : 4+Math.random()*13;
      const h = spire ? 22+Math.random()*46 : 5+Math.random()*34;
      const tier = Math.random();
      const mat = new THREE.MeshLambertMaterial({flatShading:true, vertexColors:true});
      mat.userData = {tier};
      bldgMats.push(mat);
      const geo = spire ? new THREE.ConeGeometry(w, h, 7) : new THREE.BoxGeometry(w, h, d);
      crunch(geo);
      const m = new THREE.Mesh(geo, mat);
      const y = terrain(x,z);
      m.position.set(x, y + h/2 - 0.5, z);
      m.rotation.y = Math.random()*Math.PI;
      bGroup.add(m);
      boxes.push({x, z, hw:w*0.75, hd:d*0.75, top:y+h-0.5, spire});
    }
    // garish per-vertex tints; geometry stays undistorted
    function crunch(geo){
      const p = geo.attributes.position;
      const colArr = new Float32Array(p.count*3);
      for (let j=0;j<p.count;j++){
        let cr = 0.75+Math.random()*0.5, cg = 0.75+Math.random()*0.5, cb = 0.75+Math.random()*0.5;
        if (Math.random() < 0.07){
          const ch = (Math.random()*3)|0;
          if (ch===0) cr = 1.9; else if (ch===1) cg = 1.9; else cb = 1.9;
        }
        colArr[j*3] = cr; colArr[j*3+1] = cg; colArr[j*3+2] = cb;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    }

    /* ---------------------------------------------------------- vegetation
       grass tufts, bushes and trees for the operator's view. Everything is
       instanced (one draw call per kind); material colors ride the palette and
       a per-instance tint keeps any two plants from matching exactly. */
    const veg = new THREE.Group();
    scene.add(veg);
    const vegClear = (x, z, pad)=>{
      for (const b of boxes) if (Math.hypot(x - b.x, z - b.z) < Math.max(b.hw, b.hd) + pad) return false;
      return true;
    };
    const _vd = new THREE.Object3D(), _vc = new THREE.Color();
    function vegMesh(geo, mat, spots, shadow){
      const m = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i)=>{
        _vd.position.set(s.x, terrain(s.x, s.z) - 0.15, s.z);
        _vd.rotation.set(s.tx || 0, s.ry, s.tz || 0);
        _vd.scale.set(s.sx, s.sy, s.sx);
        _vd.updateMatrix();
        m.setMatrixAt(i, _vd.matrix);
        m.setColorAt(i, _vc.setScalar(s.tint));
      });
      m.castShadow = !!shadow;
      m.frustumCulled = false; // instances span the whole map
      veg.add(m);
      return m;
    }
    /* lumpy canopy: push each vertex in or out by a function of where it sits,
       so the non-indexed faces stay welded */
    function lump(geo, amt){
      const p = geo.attributes.position;
      for (let i=0;i<p.count;i++){
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + amt*Math.sin(x*7.1 + y*12.7 + z*5.3);
        p.setXYZ(i, x*k, y*k, z*k);
      }
      geo.computeVertexNormals();
      return geo;
    }
    /* grass tuft: five flat blades fanned out of one root */
    const tuftGeo = (()=>{
      const v = [];
      for (let i=0;i<5;i++){
        const a = (i/5)*Math.PI*2 + i*0.7, lean = 0.25 + (i%3)*0.18, hgt = 0.7 + (i%2)*0.45;
        const cx = Math.cos(a), cz = Math.sin(a);
        v.push(cx*0.1 - cz*0.14, 0, cz*0.1 + cx*0.14,
               cx*0.1 + cz*0.14, 0, cz*0.1 - cx*0.14,
               cx*lean, hgt, cz*lean);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
      g.computeVertexNormals();
      return g;
    })();
    const grassMat = new THREE.MeshLambertMaterial({side:THREE.DoubleSide});
    const bushMat = new THREE.MeshLambertMaterial({flatShading:true});
    const leafMat = new THREE.MeshLambertMaterial({flatShading:true});
    const pineMat = new THREE.MeshLambertMaterial({flatShading:true});
    const trunkMat = new THREE.MeshLambertMaterial({flatShading:true});
    const vegMats = [grassMat, bushMat, leafMat, pineMat, trunkMat];
    {
      const grassSpots = [], bushSpots = [], pineSpots = [], leafSpots = [], trunkSpots = [];
      const ring = (lo, hi)=>{
        const a = Math.random()*Math.PI*2, r = lo + Math.sqrt(Math.random())*(hi - lo);
        return [Math.cos(a)*r, Math.sin(a)*r];
      };
      /* grass grows in patches, thick in the middle and thinning outward */
      for (let i=0;i<620;i++){
        const [px, pz] = ring(3, 195);
        const pr = 3 + Math.random()*7, n = 10 + (Math.random()*16)|0;
        for (let j=0;j<n;j++){
          const a = Math.random()*Math.PI*2, r = Math.pow(Math.random(), 0.7)*pr;
          const x = px + Math.cos(a)*r, z = pz + Math.sin(a)*r;
          if (!vegClear(x, z, 0.5)) continue;
          grassSpots.push({x, z, ry:Math.random()*6.28, sx:0.8 + Math.random()*0.9,
            sy:0.7 + Math.random()*1.3, tint:0.55 + Math.random()*0.75});
        }
        // most patches shelter a bush or two
        if (Math.random() < 0.55) for (let j=0;j<1 + (Math.random()*2)|0;j++){
          const x = px + (Math.random() - 0.5)*pr, z = pz + (Math.random() - 0.5)*pr;
          if (Math.hypot(x, z) < 6 || !vegClear(x, z, 2)) continue;
          bushSpots.push({x, z, ry:Math.random()*6.28, sx:0.9 + Math.random()*1.5,
            sy:0.7 + Math.random()*0.9, tint:0.6 + Math.random()*0.6});
        }
      }
      for (let i=0;i<190;i++){
        const [x, z] = ring(12, 190);
        if (!vegClear(x, z, 3)) continue;
        const s = 0.75 + Math.random()*0.9, ry = Math.random()*6.28;
        const tx = (Math.random() - 0.5)*0.12, tz = (Math.random() - 0.5)*0.12; // nothing grows dead straight
        trunkSpots.push({x, z, ry, tx, tz, sx:s, sy:s, tint:0.7 + Math.random()*0.5});
        (Math.random() < 0.5 ? pineSpots : leafSpots)
          .push({x, z, ry, tx, tz, sx:s*(0.85 + Math.random()*0.4), sy:s, tint:0.65 + Math.random()*0.55});
      }
      vegMesh(tuftGeo, grassMat, grassSpots, false);
      vegMesh(lump(new THREE.IcosahedronGeometry(1, 1), 0.2).translate(0, 0.55, 0), bushMat, bushSpots, true);
      vegMesh(new THREE.CylinderGeometry(0.28, 0.5, 5, 5).translate(0, 2.5, 0), trunkMat, trunkSpots, true);
      // broadleaf: a lumpy ball on the trunk; conifer: three stacked cones
      vegMesh(lump(new THREE.IcosahedronGeometry(3.4, 1), 0.16).translate(0, 7, 0), leafMat, leafSpots, true);
      vegMesh(mergeGeometries([
        new THREE.ConeGeometry(3.2, 5, 6).translate(0, 5, 0),
        new THREE.ConeGeometry(2.5, 4.5, 6).translate(0, 8, 0),
        new THREE.ConeGeometry(1.7, 4, 6).translate(0, 11, 0)
      ]), pineMat, pineSpots, true);
    }

    /* terrain geometry is cubes and spikes only, for now */
    const spinners = [];
    const meats = [];
    const meatMats = [];

    /* strobe rig: a ring of colored lights to play with */
    const strobeLights = [];
    const STROBE_COLS = [0xff2f6d, 0x7cff2b, 0xffffff, 0x00e5ff, 0xd12bff,
      0xffe22b, 0xff5e3a, 0x9dff3a, 0x2bffe0];
    for (let i=0;i<9;i++){
      const L = new THREE.PointLight(STROBE_COLS[i], 0, 160, 1.6);
      const ang = (i/9)*Math.PI*2;
      const rad = 25 + Math.random()*70;
      L.userData = {ang, rad, h:10 + Math.random()*18, ph:i/9,
        orbit:(Math.random() < 0.5 ? -1 : 1)*(0.05 + Math.random()*0.15),
        peak:9000 + Math.random()*7000, was:false};
      L.position.set(Math.cos(ang)*rad, 20, Math.sin(ang)*rad);
      scene.add(L);
      strobeLights.push(L);
    }

    /* ---------------------------------------------------------- birds */
    const birds = [];
    const birdGeo = new THREE.ConeGeometry(0.5, 2.0, 4);
    birdGeo.rotateX(Math.PI/2); // nose along +Z so lookAt() aims it
    const birdMat = new THREE.MeshLambertMaterial({color:0xffffff, flatShading:true});
    const leader = new THREE.Vector3();
    for (let i=0;i<24;i++){
      const m = new THREE.Mesh(birdGeo, birdMat);
      m.position.set((Math.random()-0.5)*200, 25+Math.random()*20, (Math.random()-0.5)*200);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0,0,1), m.position, 4, 0xffffff, 1.2, 0.6);
      scene.add(arrow);
      m.userData = {
        kind:'bird', alive:true, respawn:0, arrow,
        v:new THREE.Vector3((Math.random()-0.5)*10, 0, (Math.random()-0.5)*10)
      };
      scene.add(m);
      birds.push(m);
    }

    /* ---------------------------------------------------------- herd
       the birds' counterpart on the ground: same flock rules, same arrows */
    const walkers = [];
    const walkerGeo = new THREE.ConeGeometry(0.9, 2.6, 4);
    walkerGeo.rotateX(Math.PI/2); // nose along +Z so lookAt() aims it
    walkerGeo.scale(1, 0.55, 1);
    walkerGeo.translate(0, 0.6, 0); // origin at the feet
    const herdLead = new THREE.Vector3();
    for (let i=0;i<18;i++){
      const m = new THREE.Mesh(walkerGeo, birdMat);
      m.position.set((Math.random()-0.5)*160, 0, (Math.random()-0.5)*160);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0,0,1), m.position, 4, 0xffffff, 1.2, 0.6);
      scene.add(arrow);
      m.userData = {
        kind:'walker', alive:true, respawn:0, arrow,
        v:new THREE.Vector3((Math.random()-0.5)*6, 0, (Math.random()-0.5)*6)
      };
      scene.add(m);
      walkers.push(m);
    }

    /* ---------------------------------------------------------- targets */
    const targets = [];
    const TARGET_COUNT = 16;
    const beamMat = new THREE.MeshBasicMaterial({transparent:true, opacity:0.3});
    const beamGeo = new THREE.BoxGeometry(0.12, 1, 0.12).translate(0, -0.5, 0);
    function placeTarget(t){
      const a = Math.random()*Math.PI*2;
      const r = 16 + Math.pow(Math.random(), 0.85)*92;
      const x = Math.cos(a)*r, z = Math.sin(a)*r;
      const gy = terrain(x, z);
      t.userData.hover = 5 + Math.random()*11;
      t.position.set(x, gy + t.userData.hover, z);
      t.userData.phase = Math.random()*6.28;
      const va = Math.random()*Math.PI*2, sp = 3 + Math.random()*6;
      t.userData.vel.set(Math.cos(va)*sp, 0, Math.sin(va)*sp);
      t.userData.alive = true;
      t.visible = true;
      if (t.userData.arrow) t.userData.arrow.visible = true;
      t.userData.beam.scale.y = (t.position.y - gy) + 1.5;
    }
    for (let i=0;i<TARGET_COUNT;i++){
      const g = new THREE.OctahedronGeometry(2.2, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color:0xffffff}));
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(g),
        new THREE.LineBasicMaterial({color:0x000000}));
      wire.scale.setScalar(1.04);
      m.add(wire);
      const halo = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.5, 6), m.material);
      m.add(halo);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      m.add(beam);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), m.position, 4, 0xffffff, 1.4, 0.7);
      scene.add(arrow);
      m.userData = {alive:true, hover:8, phase:0, respawn:0, wire, halo, beam, arrow,
        vel:new THREE.Vector3()};
      placeTarget(m);
      scene.add(m);
      targets.push(m);
    }

    /* ---------------------------------------------------------- the being
       one thing hangs at the centre of the sky: a faceted core inside a
       gyroscope of rings, a knot threaded through it, loose curves writhing
       around and beneath. It can be shot. It answers. It does not die. */
    const BEING_Y = 96;
    const being = new THREE.Group();
    being.position.set(0, BEING_Y, 0);
    scene.add(being);
    const beingParts = []; // what a bullet can land on
    let beingHurt = 0, beingHits = 0;
    /* chrome: no env map — the reflection vector is looked up in a procedural
       copy of this world (white-hot horizon, sky above, black line, ground
       below), so the mirror always shows the current palette */
    const chromeU = {
      top:{value:cur.skyTop}, bot:{value:cur.skyBot}, gnd:{value:cur.gHi},
      tme:{value:0}, hurt:{value:0}
    };
    const chromeMat = ()=> new THREE.ShaderMaterial({
      uniforms:{...chromeU, tint:{value:new THREE.Color(0xffffff)}},
      vertexShader:`varying vec3 vN; varying vec3 vW;
        void main(){
          vec4 w = modelMatrix*vec4(position,1.0);
          vW = w.xyz; vN = mat3(modelMatrix)*normal;
          gl_Position = projectionMatrix*viewMatrix*w;
        }`,
      fragmentShader:`uniform vec3 top; uniform vec3 bot; uniform vec3 gnd; uniform vec3 tint;
        uniform float tme; uniform float hurt;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(vW - cameraPosition);
          vec3 R = reflect(V, N);
          // liquid wobble in the mirrored horizon
          float h = R.y + sin(R.x*7.0 + tme*1.3)*0.07 + sin(R.z*11.0 - tme*0.9)*0.04;
          vec3 up = mix(vec3(1.0), top, smoothstep(0.0, 0.45, h));
          up = mix(up, bot*0.25, smoothstep(0.55, 1.0, h));
          vec3 dn = mix(vec3(0.0), gnd, smoothstep(0.04, 0.6, -h));
          dn = mix(dn, vec3(1.0), smoothstep(0.75, 1.0, -h)*0.6);
          vec3 c = mix(dn, up, step(0.0, h));
          // pull toward silver, then cut hard black/white bands like polished steel
          c = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))), 0.6);
          float band = sin(h*13.0 + R.x*3.0 + tme*0.6);
          c = mix(c, vec3(step(0.0, band)), smoothstep(0.55, 0.9, abs(band))*0.55);
          c *= mix(vec3(1.0), tint, 0.3);
          float fres = pow(1.0 - max(dot(-V, N), 0.0), 3.0);
          c += vec3(fres)*0.7;
          c += vec3(pow(max(dot(R, normalize(vec3(0.5, 0.75, -0.33))), 0.0), 48.0))*1.5;
          gl_FragColor = vec4(mix(c, vec3(1.0), hurt), 1.0);
        }`
    });
    const beingCoreGeo = new THREE.IcosahedronGeometry(8, 0);
    const beingCore = new THREE.Mesh(beingCoreGeo, chromeMat());
    beingCore.userData = {part:'core'};
    const beingWire = new THREE.LineSegments(new THREE.WireframeGeometry(beingCoreGeo),
      new THREE.LineBasicMaterial({color:0x000000, fog:false}));
    beingWire.scale.setScalar(1.03);
    beingCore.add(beingWire);
    being.add(beingCore);
    beingParts.push(beingCore);
    /* knot: one closed curve passing in and out of the core */
    const beingKnot = new THREE.Mesh(new THREE.TorusKnotGeometry(9, 1.5, 180, 14, 2, 3), chromeMat());
    beingKnot.userData = {part:'knot'};
    being.add(beingKnot);
    beingParts.push(beingKnot);
    /* gyroscope rings, each tumbling on its own axis */
    const beingRings = [];
    [15, 19, 23].forEach((r, i)=>{
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 1.3, 14, 96), chromeMat());
      ring.userData = {part:'ring', idx:i,
        spin:new THREE.Vector3(0.21 + i*0.13, 0.34 - i*0.19, 0.11 + i*0.07)};
      ring.rotation.set(i*1.1, i*0.7, i*2.3);
      being.add(ring);
      beingRings.push(ring);
      beingParts.push(ring);
    });
    /* an eye that floats off the core and keeps the operator in view */
    const beingEye = new THREE.Group();
    const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28),
      new THREE.MeshBasicMaterial({color:0xffffff, fog:false}));
    eyeWhite.position.z = 8.4;
    const eyeIris = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.0, 28),
      new THREE.MeshBasicMaterial({fog:false}));
    eyeIris.position.z = 8.5;
    const eyePupil = new THREE.Mesh(new THREE.CircleGeometry(1.7, 5),
      new THREE.MeshBasicMaterial({color:0x000000, fog:false}));
    eyePupil.position.z = 8.6;
    beingEye.add(eyeWhite, eyeIris, eyePupil);
    being.add(beingEye);
    /* loose curves: closed Lissajous loops around the body and tendrils trailing
       below it, re-plotted every frame so the outline never holds still */
    const beingLineMat = new THREE.LineBasicMaterial({color:0xffffff, fog:false});
    const dynLine = (n, Ctor)=>{
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*3), 3));
      const line = new Ctor(geo, beingLineMat);
      line.frustumCulled = false;
      being.add(line);
      return line;
    };
    const LOOP_N = 160, TENDRIL_N = 28;
    const beingLoops = [[3,2,1], [2,3,5], [5,4,3]].map((k, i)=>{
      const line = dynLine(LOOP_N, THREE.LineLoop);
      line.userData = {k, ph:i*2.1, r:26 + i*4, sp:0.23 + i*0.09};
      return line;
    });
    const beingTendrils = [];
    for (let i=0;i<7;i++){
      const line = dynLine(TENDRIL_N, THREE.Line);
      line.userData = {ang:(i/7)*Math.PI*2, ph:Math.random()*6.28, len:34 + Math.random()*20};
      beingTendrils.push(line);
    }
    const _bc = new THREE.Color();
    const WHITE = new THREE.Color(0xffffff);
    function updateBeing(time, dt){
      beingHurt *= Math.pow(0.03, dt);
      const bh = beingHurt;
      /* assembled, it comes down to meet the field, swells and starts to prowl */
      const bk = bossK*bossK*(3 - 2*bossK);
      being.position.set(Math.sin(time*0.13)*30*bk,
        BEING_Y + (BOSS_Y - BEING_Y)*bk + Math.sin(time*0.4)*3,
        Math.cos(time*0.1)*30*bk);
      being.scale.setScalar(1 + bk*0.3);
      const shake = bh*Math.sin(time*46)*0.14;
      beingCore.rotation.x += dt*(0.22 + bh*5);
      beingCore.rotation.y += dt*(0.31 + bh*7);
      beingCore.scale.setScalar(1 + Math.sin(time*1.7)*0.06 + snarePulse*0.2 + shake);
      beingKnot.rotation.y -= dt*(0.4 + bh*4);
      beingKnot.rotation.z += dt*0.17;
      beingKnot.scale.setScalar(1 + Math.sin(time*0.9)*0.1 + bh*0.3);
      for (const r of beingRings){
        const s = r.userData.spin, k = dt*(1 + bh*9);
        r.rotation.x += s.x*k; r.rotation.y += s.y*k; r.rotation.z += s.z*k;
      }
      beingEye.lookAt(camera.position);
      eyePupil.scale.setScalar(1 + Math.sin(time*0.7)*0.12 - bh*0.75); // pinpoint when struck
      eyePupil.rotation.z += dt*0.5;
      beingEye.scale.y = 1 - bh*0.55; // flinch
      /* colours ride the palette; a hit bleaches everything toward white */
      chromeU.tme.value = time;
      chromeU.hurt.value = bh;
      beingCore.material.uniforms.tint.value.copy(cur.mark);
      beingRings[0].material.uniforms.tint.value.copy(cur.b1);
      beingRings[1].material.uniforms.tint.value.copy(cur.b2);
      beingRings[2].material.uniforms.tint.value.copy(cur.gHi);
      eyeIris.material.color.copy(cur.b2);
      beingLineMat.color.copy(_bc.copy(WHITE).lerp(cur.mark, bh));
      for (const L of beingLoops){
        const u = L.userData, p = L.geometry.attributes.position;
        const tt = time*u.sp, r = u.r*(1 + bh*0.25*Math.sin(time*31 + u.ph));
        for (let j=0;j<LOOP_N;j++){
          const a = (j/LOOP_N)*Math.PI*2;
          p.setXYZ(j,
            r*Math.sin(u.k[0]*a + tt + u.ph),
            r*0.6*Math.sin(u.k[1]*a + tt*1.3),
            r*Math.cos(u.k[2]*a + u.ph - tt*0.7));
        }
        p.needsUpdate = true;
      }
      for (const L of beingTendrils){
        const u = L.userData, p = L.geometry.attributes.position;
        const amp = 5 + bh*14;
        for (let j=0;j<TENDRIL_N;j++){
          const s = j/(TENDRIL_N-1);
          const rad = 3 + s*9;
          p.setXYZ(j,
            Math.cos(u.ang)*rad + Math.sin(time*1.1 + s*5 + u.ph)*s*amp,
            -6 - s*u.len,
            Math.sin(u.ang)*rad + Math.cos(time*0.9 + s*4 + u.ph)*s*amp);
        }
        p.needsUpdate = true;
      }
    }

    /* ---------------------------------------------------------- the boss
       G, first scene only: everything in the field lets go of the ground and
       is drawn up into the being. The architecture closes round it in five
       tilted rings, roofs outward; the targets pair off and circle each other
       as they circle the heart; every bird takes a target for a sun and every
       walker a building. It can be shot and it does not die. G again and it
       all falls back to where it stood. */
    const BOSS_Y = 78;
    let boss = false, bossK = 0, bossAway = false;
    const NONE = [];
    const UP = new THREE.Vector3(0, 1, 0);
    const _bp = new THREE.Vector3(), _bn = new THREE.Vector3(), _bu = new THREE.Vector3(), _bv = new THREE.Vector3();
    const _bq = new THREE.Quaternion(), _bq2 = new THREE.Quaternion();
    /* a point on the circle of radius r about c, in the plane whose normal
       leans `tilt` off vertical toward azimuth `az` */
    function orbitPt(out, c, r, th, tilt, az){
      _bn.set(Math.sin(tilt)*Math.cos(az), Math.cos(tilt), Math.sin(tilt)*Math.sin(az));
      _bu.set(-Math.sin(az), 0, Math.cos(az));
      _bv.crossVectors(_bn, _bu);
      return out.copy(c).addScaledVector(_bu, Math.cos(th)*r).addScaledVector(_bv, Math.sin(th)*r);
    }
    const BOSS_RINGS = [
      {n:14, r:38, tilt:0.6, sp:0.3},
      {n:18, r:50, tilt:-0.5, sp:-0.23},
      {n:21, r:62, tilt:0.42, sp:0.18},
      {n:24, r:74, tilt:-0.3, sp:-0.14},
      {n:28, r:86, tilt:0.2, sp:0.11}
    ];
    const bossBldgs = [];
    BOSS_RINGS.forEach((ring, ri)=>{
      for (let j=0;j<ring.n;j++){
        const m = bGroup.children[bossBldgs.length];
        if (!m) return;
        // r is where its foundation sits; the roof points away from the heart
        m.userData.boss = {ring, ri, ph:(j/ring.n)*Math.PI*2,
          r:ring.r + (Math.random() - 0.5)*8 + m.geometry.parameters.height/2,
          spin:(Math.random() - 0.5)*0.8, home:m.position.clone(), homeQ:m.quaternion.clone()};
        bossBldgs.push(m);
      }
    });
    const bossOuter = bossBldgs.slice(-BOSS_RINGS[BOSS_RINGS.length - 1].n);
    targets.forEach((t, i)=>{
      const p = i >> 1; // pairs share an orbit and circle a common centre
      t.userData.boss = {r:36 + (p%3)*4, tilt:0.4 + p*0.37, az:p*2.4, ph:p*0.785,
        sp:(p%2 ? -1 : 1)*(0.45 + p*0.03), side:i & 1};
    });
    function setBoss(v){
      if (boss === v) return;
      boss = v;
      for (const t of [...targets, ...birds, ...walkers]){
        const ud = t.userData;
        ud.arrow.visible = !v && ud.alive;
        if (ud.beam) ud.beam.visible = !v;
      }
      if (v){ ensureAudio(); braam(); flash('#ffffff', 0.5); }
      else morphTone(false);
      modeEl.textContent = v ? 'it has assembled, G to release'
        : (locked ? 'mouse held, esc to release' : 'drag to look');
    }
    /* the dead stay out of the body until their respawn comes round */
    function bossRevive(m, now){
      const ud = m.userData;
      if (ud.alive) return true;
      if (ud.pacified && now - ud.pacified > 3000){ m.visible = false; ud.pacified = 0; }
      if (now < ud.respawn) return false;
      ud.alive = true; m.visible = true;
      return true;
    }
    function bossMoon(m, c, r, th, tilt, az, a, now){
      if (!bossRevive(m, now)) return;
      m.lookAt(orbitPt(_bp, c, r, th + 0.6, tilt, az)); // nose along the orbit
      m.position.lerp(orbitPt(_bp, c, r, th, tilt, az), a);
      m.scale.setScalar(1.8);
    }
    function updateBoss(time, dt, now){
      bossK = Math.max(0, Math.min(1, bossK + (boss ? dt/3 : -dt/2.5)));
      if (!boss && bossK === 0){
        if (bossAway){
          for (const m of bossBldgs){ m.position.copy(m.userData.boss.home); m.quaternion.copy(m.userData.boss.homeQ); }
          bossAway = false;
        }
        return;
      }
      bossAway = true;
      const C = being.position;
      // the pull starts gentle, so the field peels up rather than snapping
      const a = 1 - Math.exp(-dt*(boss ? 0.5 + bossK*2.5 : 3.5));
      for (const m of bossBldgs){
        const b = m.userData.boss;
        if (!boss){
          m.position.lerp(b.home, a);
          m.quaternion.slerp(b.homeQ, a);
          continue;
        }
        orbitPt(_bp, C, b.r, b.ph + time*b.ring.sp, b.ring.tilt, b.ri*1.3 + time*0.07);
        m.position.lerp(_bp, a);
        _bq.setFromUnitVectors(UP, _bp.sub(C).normalize());
        m.quaternion.slerp(_bq.multiply(_bq2.setFromAxisAngle(UP, time*b.spin)), a);
      }
      if (!boss) return;
      for (const t of targets){
        if (!bossRevive(t, now)) continue;
        const b = t.userData.boss;
        orbitPt(_bp, C, b.r, b.ph + time*b.sp, b.tilt, b.az + time*0.05);
        orbitPt(_bp, _bp, 5.5, time*2.4 + b.side*Math.PI, b.tilt + 1.2, b.az);
        t.position.lerp(_bp, a);
        t.rotation.y += dt*1.6; t.rotation.x += dt*0.9;
        t.scale.setScalar(1.25 + snarePulse*0.35);
        t.userData.halo.lookAt(camera.position);
      }
      birds.forEach((m, i)=>bossMoon(m, targets[i % targets.length].position,
        6 + (i%3)*1.6, time*(2.6 + (i%5)*0.3), i*0.9, i*1.7, a, now));
      walkers.forEach((m, i)=>bossMoon(m, bossOuter[(i*3) % bossOuter.length].position,
        13 + (i%2)*3, time*1.4 + i, i*1.1, i*2, a, now));
    }

    /* fragment sequencer: a shot agent shatters, hangs frozen, then each shard
       fires in rhythm — a note, a pop — and disappears */
    const fragGroups = [];
    /* the six edge directions of a regular tetrahedron — used to fan crack
       lines out through the impact point along true triangle-edge geometry */
    const TET_EDGE_DIRS = (()=>{
      const v = [
        new THREE.Vector3(1,1,1), new THREE.Vector3(-1,-1,1),
        new THREE.Vector3(-1,1,-1), new THREE.Vector3(1,-1,-1)
      ];
      const dirs = [];
      for (let i=0;i<4;i++) for (let j=i+1;j<4;j++)
        dirs.push(v[i].clone().sub(v[j]).normalize());
      return dirs;
    })();
    const shatterLines = [];
    const burstLights = [];
    /* shared unit geometry for every frag/debris/pop-particle tetrahedron —
       they used to each get their own fresh TetrahedronGeometry (a GPU buffer
       upload) that was thrown away a moment later; scale the shared one instead */
    const UNIT_TET = new THREE.TetrahedronGeometry(1, 0);
    /* pools: shatter used to spawn+dispose a fresh PointLight and 6 fresh
       Line(geometry+material) objects on every hit AND every shard pop —
       up to ~9 lights and ~54 lines churned in/out of the scene per shatter.
       Adding/removing lights forces the renderer to recompute lit-material
       (MeshLambertMaterial) shader state, and the constant geometry alloc
       triggers GC pauses — together that's the stutter. Pre-allocate fixed
       pools once, like strobeLights already does, and just recycle them. */
    const BURST_LIGHT_POOL_SIZE = 6;
    const burstLightPool = [];
    for (let i=0;i<BURST_LIGHT_POOL_SIZE;i++){
      const L = new THREE.PointLight(0xffffff, 0, 70, 2);
      scene.add(L);
      burstLightPool.push(L);
    }
    let burstLightCursor = 0;
    const CRACK_LINE_POOL_SIZE = 36; // 6 dirs * up to 6 concurrent bursts
    const crackLinePool = [];
    /* GL lines are always 1px and additive ones vanish against a bright sky,
       so each crack is a solid unit bar (length along Y) scaled into place */
    const CRACK_BAR = new THREE.BoxGeometry(1, 1, 1);
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    for (let i=0;i<CRACK_LINE_POOL_SIZE;i++){
      const mat = new THREE.MeshBasicMaterial({transparent:true, opacity:0, depthWrite:false});
      const line = new THREE.Mesh(CRACK_BAR, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      crackLinePool.push(line);
    }
    let crackLineCursor = 0;
    /* tracer: the round itself, drawn muzzle to impact — a solid core in the
       mark colour inside a wider white sheath. The cone widens with distance
       so it holds its width on screen all the way to the hit */
    const TRACER_GEO = new THREE.CylinderGeometry(1, 0.02, 1, 6, 1, true).translate(0, 0.5, 0);
    const TRACER_POOL_SIZE = 4;
    const tracerPool = [];
    for (let i=0;i<TRACER_POOL_SIZE;i++){
      const core = new THREE.Mesh(TRACER_GEO, new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
      const sheath = new THREE.Mesh(TRACER_GEO, new THREE.MeshBasicMaterial({
        color:0xffffff, transparent:true, opacity:0.6, depthWrite:false, side:THREE.DoubleSide
      }));
      core.visible = sheath.visible = false;
      core.frustumCulled = sheath.frustumCulled = false;
      scene.add(core); scene.add(sheath);
      tracerPool.push({core, sheath, t0:0, w:0, live:false});
    }
    let tracerCursor = 0;
    const TRACER_LIFE = 0.34;
    function tracer(from, to, color){
      const tr = tracerPool[tracerCursor];
      tracerCursor = (tracerCursor + 1) % tracerPool.length;
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.normalize();
      tr.w = Math.min(4, Math.max(0.2, len*0.016));
      tr.len = len;
      tr.core.material.color.set(color);
      for (const m of [tr.core, tr.sheath]){
        m.position.copy(from);
        m.quaternion.setFromUnitVectors(Y_AXIS, dir);
        m.visible = true;
      }
      tr.t0 = performance.now();
      tr.live = true;
    }
    /* crack lines: not segments — each edge direction is drawn straight through
       the impact point out toward the horizon in both directions, so the shard
       reads as a fracture in the whole scene's geometry, not a local decal */
    function crackBurst(pos, color){
      const CRACK_LEN = 640;
      const rot = new THREE.Euler(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
      // bar thickness tracks range so a far hit cracks as loudly as a near one
      const w = Math.min(3, Math.max(0.25, camera.getWorldPosition(new THREE.Vector3()).distanceTo(pos)*0.016));
      TET_EDGE_DIRS.forEach((d, i)=>{
        const dir = d.clone().applyEuler(rot);
        const line = crackLinePool[crackLineCursor];
        crackLineCursor = (crackLineCursor + 1) % crackLinePool.length;
        line.position.copy(pos);
        line.quaternion.setFromUnitVectors(Y_AXIS, dir);
        line.material.color.set(i % 2 ? 0xffffff : color);
        line.material.opacity = 1;
        line.visible = true;
        shatterLines.push({line, w, len:CRACK_LEN*2, t0:performance.now(), life:0.6 + Math.random()*0.25});
      });
      const pl = burstLightPool[burstLightCursor];
      burstLightCursor = (burstLightCursor + 1) % burstLightPool.length;
      pl.color.set(color);
      pl.position.copy(pos);
      pl.intensity = 9;
      burstLights.push({light:pl, t0:performance.now(), life:0.3});
    }
    function fragBurst(pos, color){
      const frags = [];
      for (let i=0;i<8;i++){
        const m = new THREE.Mesh(UNIT_TET, new THREE.MeshBasicMaterial({color, transparent:true}));
        m.scale.setScalar(1.1+Math.random()*0.9);
        m.position.copy(pos);
        m.userData = {
          v:new THREE.Vector3((Math.random()-0.5)*14, Math.random()*8+2, (Math.random()-0.5)*14),
          spin:new THREE.Vector3(Math.random()*4, Math.random()*4, Math.random()*4)
        };
        scene.add(m);
        frags.push(m);
      }
      fragGroups.push({frags, t0:performance.now(), idx:0, nextTrig:0});
      crackBurst(pos, color);
      flash('#ffffff', 0.22);
    }
    function playFragPop(){
      if (!actx) return;
      playSample('glitch', actx.currentTime, 0.55, {rate:0.8 + Math.random()*0.8}); // each shard pop chews a glitch
    }

    /* debris */
    const debris = [];
    function burst(pos, color){
      for (let i=0;i<7;i++){
        const m = new THREE.Mesh(UNIT_TET, new THREE.MeshBasicMaterial({color, transparent:true}));
        m.scale.setScalar(0.5+Math.random()*0.5);
        m.position.copy(pos);
        m.userData = {
          v:new THREE.Vector3((Math.random()-0.5)*16,(Math.random()*10)+2,(Math.random()-0.5)*16),
          spin:new THREE.Vector3(Math.random()*6,Math.random()*6,Math.random()*6),
          life:1.4
        };
        scene.add(m);
        debris.push(m);
      }
    }

    /* ---------------------------------------------------------- viewmodel */
    const gun = new THREE.Group();
    const gunMats = [];
    function part(w,h,d,x,y,z,c){
      const mat = new THREE.MeshLambertMaterial({color:c, flatShading:true});
      gunMats.push(mat);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
      m.position.set(x,y,z); gun.add(m); return m;
    }
    /* psyops loudspeaker rig: amp body, grip, antenna, horn */
    part(0.2,0.2,0.42, 0,-0.03,-0.12, 0x24291c);   // amp body
    part(0.16,0.3,0.2, 0,-0.24,0.14, 0x171a12);    // grip
    part(0.03,0.28,0.03, 0.07,0.22,-0.02, 0x2f3524); // antenna
    part(0.08,0.08,0.22, 0,0,-0.4, 0x2f3524);      // horn throat
    const hornMat = new THREE.MeshLambertMaterial({color:0x1a1d16, flatShading:true, side:THREE.DoubleSide});
    gunMats.push(hornMat);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 9, 1, true), hornMat);
    horn.rotation.x = Math.PI/2; // open mouth faces forward
    horn.position.set(0, 0, -0.72);
    gun.add(horn);
    gun.position.set(0.28,-0.24,-0.55);
    gun.rotation.y = 0.06;
    camera.add(gun);

    /* ---------------------------------------------------------- audio */
    let actx = null, master = null, droneOsc = [], droneGain = null, noiseBuf = null, drift = null;
    let shelf = null, uiBus = null;
    /* mixer: eight channel strips between the voices and the master, laid out
       like the MIDImix that drives them (see the midi section). Each strip is
       lowpass -> level -> master with a post-fader send into one shared tempo
       delay; tune repitches the voice at trigger time. The state lives here so
       a knob moved before audio exists still lands when it does. */
    const STRIPS = ['kick', 'snr', 'hat', 'prc', 'shot', 'impact', 'glitch', 'drone'];
    const mix = {};
    STRIPS.forEach(s=>{ mix[s] = {level:1, tune:1, cut:20000, q:0.9, send:0, mute:false}; });
    let masterLevel = 0.85;
    let bpm = 128, STEP_T = 60/bpm/4;
    const bus = {}; // slot -> {flt, out, snd}
    let fxDelay = null, fxFb = null;
    const busIn = slot => bus[slot] ? bus[slot].flt : master;
    const tuneOf = slot => mix[slot] ? mix[slot].tune : 1;
    function applyStrip(s){
      const b = bus[s], m = mix[s];
      if (!b) return;
      const t = actx.currentTime;
      b.out.gain.setTargetAtTime(m.mute ? 0 : m.level, t, 0.02);
      b.flt.frequency.setTargetAtTime(m.cut, t, 0.02);
      b.flt.Q.setTargetAtTime(m.q, t, 0.02);
      b.snd.gain.setTargetAtTime(m.send, t, 0.02);
      // the hottest send drags the shared feedback up with it, to the edge of runaway
      const hot = Math.min(1, Math.max(...STRIPS.map(k=>mix[k].mute ? 0 : mix[k].send))/1.2);
      fxFb.gain.setTargetAtTime(0.45 + 0.47*hot, t, 0.05);
      if (s === 'drone'){
        const cents = 1200*Math.log2(m.tune);
        droneOsc.forEach(o=>o.detune.setTargetAtTime(cents, t, 0.05));
        if (droneSrc) droneSrc.playbackRate.setTargetAtTime(m.tune, t, 0.05);
      }
    }
    function applyMaster(){
      if (!actx) return;
      const t = actx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(masterLevel, t, 0.02);
    }
    function setTempo(v){
      bpm = Math.max(60, Math.min(200, v));
      STEP_T = 60/bpm/4;
      if (fxDelay) fxDelay.delayTime.setTargetAtTime(STEP_T*3, actx.currentTime, 0.05);
    }
    function initAudio(){
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.0;
      shelf = actx.createBiquadFilter(); shelf.type='lowpass'; shelf.frequency.value=5200;
      master.connect(shelf); shelf.connect(actx.destination);
      master.gain.linearRampToValueAtTime(masterLevel, actx.currentTime + 2.2);

      // send delay: a dotted eighth of the sequencer clock, darkening as it repeats
      fxDelay = actx.createDelay(1.5); fxDelay.delayTime.value = STEP_T*3;
      const fb = fxFb = actx.createGain(); fb.gain.value = 0.45;
      const fbLp = actx.createBiquadFilter(); fbLp.type='lowpass'; fbLp.frequency.value=2600;
      fxDelay.connect(fbLp); fbLp.connect(fb); fb.connect(fxDelay); fbLp.connect(master);
      STRIPS.forEach(s=>{
        const flt = actx.createBiquadFilter(); flt.type='lowpass'; flt.Q.value=mix[s].q;
        const out = actx.createGain(), snd = actx.createGain();
        flt.frequency.value = mix[s].cut;
        out.gain.value = mix[s].mute ? 0 : mix[s].level;
        snd.gain.value = mix[s].send;
        flt.connect(out); out.connect(master); out.connect(snd); snd.connect(fxDelay);
        bus[s] = {flt, out, snd};
      });

      noiseBuf = actx.createBuffer(1, actx.sampleRate*2, actx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i=0;i<nd.length;i++) nd[i] = Math.random()*2-1;

      uiBus = actx.createGain(); uiBus.gain.value = 0.5;
      uiBus.connect(actx.destination); // dry and close: bypasses the muffle shelf

      droneGain = actx.createGain(); droneGain.gain.value = 0.075;
      const lp = actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=280; lp.Q.value=6;
      droneGain.connect(lp); lp.connect(busIn('drone'));
      const root = PALETTES[0].root;
      [1, 1.005, 2.001, 3.002].forEach((mul,i)=>{
        const o = actx.createOscillator();
        o.type = i>1 ? 'triangle' : 'sawtooth';
        o.frequency.value = root*mul;
        o.detune.value = 1200*Math.log2(mix.drone.tune);
        const g = actx.createGain(); g.gain.value = i>1 ? 0.25 : 0.7;
        o.connect(g); g.connect(droneGain); o.start();
        droneOsc.push(o);
      });
      // wind bed
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = actx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=420; bp.Q.value=1.2;
      const ng = actx.createGain(); ng.gain.value = 0.035;
      n.connect(bp); bp.connect(ng); ng.connect(busIn('drone')); n.start();
      drift = bp;
      loadKit();
    }
    /* explicitly drop node references once their sound finishes — over a long
       autopilot session, hundreds of transient hits/drums otherwise leave the
       audio graph full of stopped-but-still-connected nodes and the mix bogs
       down. Attach the return value as .onended on that call's longest-lived
       source node. */
    function reap(...nodes){
      return ()=>{ nodes.forEach(nd=>{ try{ nd.disconnect(); }catch(e){} }); };
    }
    function retune(root){
      if (!actx) return;
      const t = actx.currentTime;
      const muls = [1, 1.005, 2.001, 3.002];
      droneOsc.forEach((o,i)=> o.frequency.exponentialRampToValueAtTime(root*muls[i], t+0.9));
      drift.frequency.exponentialRampToValueAtTime(280 + Math.random()*500, t+1.2);
    }
    const SCALE = [0,3,5,7,10,12,15,17,19,22];
    function playHit(n, pan, dist){
      if (!actx) return;
      const t = actx.currentTime;
      const root = PALETTES[palIndex % PALETTES.length].root * 4;
      const f = root * Math.pow(2, SCALE[n % SCALE.length]/12);
      const p = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
      if (p.pan) p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(busIn('impact'));

      const car = actx.createOscillator(); car.type='sine'; car.frequency.value=f;
      const mod = actx.createOscillator(); mod.type='sine'; mod.frequency.value=f*2.51;
      const mg = actx.createGain(); mg.gain.setValueAtTime(f*3.2, t);
      mg.gain.exponentialRampToValueAtTime(1, t+0.5);
      mod.connect(mg); mg.connect(car.frequency);
      const cg = actx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.34, t+0.006);
      cg.gain.exponentialRampToValueAtTime(0.0001, t+1.5);
      car.connect(cg); cg.connect(p);
      car.start(t); mod.start(t); car.stop(t+1.6); mod.stop(t+1.6);

      const sub = actx.createOscillator(); sub.type='sine';
      sub.frequency.setValueAtTime(f/2, t);
      sub.frequency.exponentialRampToValueAtTime(f/6, t+0.35);
      const sg = actx.createGain();
      sg.gain.setValueAtTime(0.4, t); sg.gain.exponentialRampToValueAtTime(0.0001, t+0.5);
      sub.connect(sg); sg.connect(p); sub.start(t); sub.stop(t+0.55);

      const n2 = actx.createBufferSource(); n2.buffer = noiseBuf;
      const hp = actx.createBiquadFilter(); hp.type='bandpass'; hp.frequency.value=f*3; hp.Q.value=2;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.14);
      n2.connect(hp); hp.connect(ng); ng.connect(p);
      n2.start(t); n2.stop(t+0.2);

      // distance echo
      const d = actx.createDelay(); d.delayTime.value = Math.min(0.45, dist/340 + 0.06);
      const dg = actx.createGain(); dg.gain.value = 0.28;
      cg.connect(d); d.connect(dg); dg.connect(busIn('impact'));
      car.onended = reap(p, car, mod, mg, cg, sub, sg, n2, hp, ng, d, dg);
    }
    /* -------- user sample kit: loaded from the "." settings panel -------
       sampleLib holds decoded buffers; sampleMap wires a lib index into each
       voice slot. A mapped slot plays the sample instead of the synth. */
    const sampleLib = []; // {name, buffer} — buffers pre-trimmed to <=5s on load
    const sampleMap = {shot:-1, impact:-1, kick:-1, snr:-1, hat:-1, prc:-1, glitch:-1, drone:-1, fx:-1, cine:-1};
    /* one-shot with a fixed ADSR cage: 8ms attack, decay to a 0.6 sustain,
       then a forced release so nothing rings past ~2s regardless of file length */
    const POOL = -2; // slot value meaning "random pick from this slot's pool"
    /* pool mode queries the folder by name: a slot only draws from files whose
       path (folders included, so "Kicks/01.wav" counts) reads like that voice.
       A slot nothing matches falls back to the whole pool. */
    const SLOT_MATCH = {
      shot:   /shot|gun|fire|rifle|pistol|laser|zap|pew/,
      impact: /impact|hit|boom|expl|crash|smash|thud|slam/,
      kick:   /kick|bass[ _-]?drum|(^|[^a-z])bd([^a-z]|$)/,
      snr:    /snare|snr|clap|rim|(^|[^a-z])sd([^a-z]|$)/,
      hat:    /hat|cymbal|ride|shaker|(^|[^a-z])hh([^a-z]|$)/,
      prc:    /perc|tom|conga|bongo|clave|cowbell|blip/,
      drone:  /drone|pad|amb|atmo|texture|loop/,
      glitch: /glitch|stutter|bitcrush/,
      fx:     /fx|click|beep|sweep|riser|(^|[^a-z])ui([^a-z]|$)/,
      cine:   /cine|braam|brass|trailer|horn|drop/
    };
    const slotPools = {}; // slot -> lib indices matching SLOT_MATCH, rebuilt on load
    /* pool mode deals from a shuffled bag per slot, so a voice never repeats
       until its whole pool has been heard, nor across a reshuffle */
    const slotBags = {}, lastPick = {};
    function rebuildSlotPools(){
      for (const slot in SLOT_MATCH){
        slotBags[slot] = null;
        slotPools[slot] = [];
        sampleLib.forEach((s, i)=>{
          // bundled-kit entries arrive already sorted; folder files are matched by name
          if (s.slot ? s.slot === slot : SLOT_MATCH[slot].test(s.path)) slotPools[slot].push(i);
        });
      }
    }
    /* bundled kit: public/samples/manifest.json, rolled by scripts/pick-samples.mjs.
       Loaded once audio exists; absent manifest just leaves the synths in place. */
    const KIT_SLOT = {snare:'snr', perc:'prc'}; // manifest category -> slot key
    async function loadKit(){
      let list;
      try {
        const res = await fetch('/samples/manifest.json');
        if (!res.ok) return;
        list = await res.json();
      } catch(err){ return; }
      await Promise.all(list.map(async it=>{
        try {
          const ab = await (await fetch('/samples/' + it.file)).arrayBuffer();
          const buffer = trimBuffer(await actx.decodeAudioData(ab), it.slot === 'drone' ? 40 : 5); // the bed loops whole
          sampleLib.push({name:it.name, buffer, slot:KIT_SLOT[it.slot] || it.slot, path:it.name.toLowerCase()});
        } catch(err){ /* skip undecodable files */ }
      }));
      rebuildSlotPools();
      refreshSlotOptions();
      if (sampleLib.length) setCount.textContent = sampleLib.length + ' bundled sample(s) loaded';
    }
    function resolveSampleIdx(slot, forcePool){
      const idx = sampleMap[slot];
      if ((idx === POOL || forcePool) && sampleLib.length){
        const pool = slotPools[slot];
        if (!pool || !pool.length) return (Math.random()*sampleLib.length)|0;
        let bag = slotBags[slot];
        if (!bag || !bag.length){
          bag = slotBags[slot] = pool.slice();
          for (let i = bag.length - 1; i > 0; i--){
            const j = (Math.random()*(i + 1))|0;
            [bag[i], bag[j]] = [bag[j], bag[i]];
          }
          const top = bag.length - 1;
          if (top > 0 && bag[top] === lastPick[slot]) [bag[0], bag[top]] = [bag[top], bag[0]];
        }
        return lastPick[slot] = bag.pop();
      }
      return idx;
    }
    /* o.out reroutes the voice (see hitBus), o.rate repitches it,
       o.pool forces a random pick from the slot's pool (shuffle) */
    function playSample(slot, t, vol, o = {}){
      const idx = resolveSampleIdx(slot, o.pool);
      if (idx < 0 || !sampleLib[idx] || !actx) return false;
      const buf = sampleLib[idx].buffer;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const rate = (o.rate || 1) * tuneOf(slot);
      src.playbackRate.value = rate;
      const g = actx.createGain();
      const dur = Math.min(buf.duration / rate, 2);
      const rel = Math.min(0.35, dur*0.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);           // A
      g.gain.exponentialRampToValueAtTime(vol*0.6, t + Math.min(0.18, dur*0.3)); // D -> S
      g.gain.setValueAtTime(vol*0.6, t + dur - rel);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);          // R
      src.connect(g); g.connect(o.out || busIn(slot));
      src.start(t); src.stop(t + dur + 0.02);
      src.onended = reap(src, g);
      return true;
    }
    /* a throwaway pan+level bus that places a voice where the shot landed:
       panned to its screen position, quieter with range */
    function hitBus(pan, dist){
      const g = actx.createGain();
      g.gain.value = Math.max(0.6, Math.min(1, 1 - dist/260));
      const p = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
      if (p.pan) p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(g); g.connect(busIn('impact'));
      setTimeout(reap(p, g), 2600); // outlives the 2s ADSR cage
      return p;
    }
    /* the thing that got shot answers back: impact on anything, snare on a kill.
       kind is 'target' | 'bird' | 'world' and repitches the pair */
    const HIT_RATE = {target:1, bird:1.5, world:0.75};
    function playStruck(kind, pan, dist){
      if (!actx) return;
      const t = actx.currentTime;
      const out = hitBus(pan, dist);
      const rate = HIT_RATE[kind] * (0.94 + Math.random()*0.12);
      const kill = kind !== 'world';
      if (!playSample('impact', t, kill ? 1.2 : 0.6, {out, rate})){
        const n = actx.createBufferSource(); n.buffer = noiseBuf;
        const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900*rate;
        const g = actx.createGain();
        g.gain.setValueAtTime(kill ? 0.3 : 0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
        n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t+0.14);
        n.onended = reap(n, f, g);
      }
      if (kill) playDrum(1, t, {out, rate});
    }
    /* the being's voice: a wounded two-saw wail through a falling formant, with
       an inharmonic bell on top. Each hit walks one step up the scale; the part
       struck picks the register (core low, rings mid, knot high) */
    const BEING_OCT = {core:1, ring:2, knot:4};
    function playBeing(ud, pan, dist){
      if (!actx) return;
      const t = actx.currentTime;
      const out = hitBus(pan, dist);
      const root = PALETTES[palIndex % PALETTES.length].root * 2;
      const semis = SCALE[beingHits % SCALE.length] + (ud.idx || 0)*7;
      const f = root * BEING_OCT[ud.part] * Math.pow(2, semis/12);
      playSample('impact', t, 0.35, {out, rate:0.5});

      const form = actx.createBiquadFilter(); form.type = 'bandpass'; form.Q.value = 5;
      form.frequency.setValueAtTime(Math.max(900, f*4), t);
      form.frequency.exponentialRampToValueAtTime(Math.max(260, f*1.2), t+1.3);
      const wg = actx.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.exponentialRampToValueAtTime(0.55, t+0.03);
      wg.gain.exponentialRampToValueAtTime(0.0001, t+1.7);
      form.connect(wg); wg.connect(out);
      const nodes = [form, wg];
      [1, 1.013].forEach(det=>{
        const o = actx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f*det, t);
        o.frequency.exponentialRampToValueAtTime(f*det*1.12, t+0.12);
        o.frequency.exponentialRampToValueAtTime(f*det*0.7, t+1.6);
        o.connect(form); o.start(t); o.stop(t+1.8);
        nodes.push(o);
      });
      let last = null;
      [1, 2.76, 5.4, 8.93].forEach((mul, i)=>{
        const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f*2*mul;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16/(i+1), t+0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t+2.0-i*0.35);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+2.1);
        nodes.push(o, g);
        last = o;
      });
      last.onended = reap(...nodes);
    }
    /* drone slot: loops the chosen sample under the world in place of the
       synth drone; crossfades so swapping never pops */
    let droneSrc = null, droneSampleGain = null, droneIdx = -1;
    function applyDroneSample(fresh){
      if (!actx) return;
      const t = actx.currentTime;
      if (droneSrc){
        const oldSrc = droneSrc, oldGain = droneSampleGain;
        oldSrc.onended = reap(oldSrc, oldGain);
        try { oldSrc.stop(t + 0.6); } catch(e){}
        droneSrc = null;
      }
      if (droneSampleGain){ droneSampleGain.gain.linearRampToValueAtTime(0, t + 0.6); droneSampleGain = null; }
      let idx = resolveSampleIdx('drone'); // pool mode re-rolls the bed each apply
      if (fresh && sampleMap.drone === POOL){ // never re-land on the bed that was playing
        const rest = (slotPools.drone || []).filter(i=>i !== droneIdx);
        if (rest.length) idx = rest[(Math.random()*rest.length)|0];
      }
      droneIdx = idx;
      if (idx < 0 || !sampleLib[idx]){
        if (droneGain) droneGain.gain.linearRampToValueAtTime(0.075, t + 0.8); // back to synth
        return;
      }
      if (droneGain) droneGain.gain.linearRampToValueAtTime(0, t + 0.8);
      const src = actx.createBufferSource();
      src.buffer = sampleLib[idx].buffer;
      src.loop = true;
      src.playbackRate.value = mix.drone.tune;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 1.2);
      src.connect(g); g.connect(busIn('drone'));
      src.start(t);
      droneSrc = src; droneSampleGain = g;
    }
    function playShot(isScoped){
      if (!actx) return;
      const t = actx.currentTime;
      const vary = 0.88 + Math.random()*0.24; // no two rounds leave at the same pitch
      if (playSample('shot', t, 0.5, {rate:vary})) return;
      const out = busIn('shot'), k = mix.shot.tune * vary;
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = (isScoped?900:1400)*k;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
      n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t+0.16);
      const o = actx.createOscillator(); o.type='square';
      o.frequency.setValueAtTime(160*k, t); o.frequency.exponentialRampToValueAtTime(38*k, t+0.1);
      const og = actx.createGain();
      og.gain.setValueAtTime(0.16, t); og.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
      o.connect(og); og.connect(out); o.start(t); o.stop(t+0.14);
      n.onended = reap(n, f, g, o, og);
    }

    const DRUM_SLOTS = ['kick', 'snr', 'hat', 'prc'];
    function playDrum(r, t, o = {}){
      if (!actx) return;
      if (playSample(DRUM_SLOTS[r], t, r === 0 ? 0.6 : 0.35, o)) return;
      const out = o.out || busIn(DRUM_SLOTS[r]), k = mix[DRUM_SLOTS[r]].tune * (o.synthRate || 1);
      if (r === 0){ // kick
        const o = actx.createOscillator(); o.type='sine';
        o.frequency.setValueAtTime(120*k, t); o.frequency.exponentialRampToValueAtTime(38*k, t+0.12);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.28);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+0.3);
        o.onended = reap(o, g);
      } else if (r === 1){ // snare
        const n = actx.createBufferSource(); n.buffer = noiseBuf;
        const f = actx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1800*k; f.Q.value=0.8;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
        n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t+0.2);
        const o = actx.createOscillator(); o.type='triangle'; o.frequency.value=190*k;
        const og = actx.createGain();
        og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
        o.connect(og); og.connect(out); o.start(t); o.stop(t+0.12);
        n.onended = reap(n, f, g, o, og);
      } else if (r === 2){ // hat
        const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 1.4*k;
        const f = actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=Math.min(12000, 6000*k);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
        n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t+0.07);
        n.onended = reap(n, f, g);
      } else { // perc blip tuned to the current palette root
        const root = PALETTES[palIndex % PALETTES.length].root * 8 * k;
        const o = actx.createOscillator(); o.type='square';
        o.frequency.setValueAtTime(root, t);
        o.frequency.exponentialRampToValueAtTime(root*0.5, t+0.09);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
        o.connect(g); g.connect(out); o.start(t); o.stop(t+0.14);
        o.onended = reap(o, g);
      }
    }

    /* ---------------------------------------------------------- controls */
    let yaw = 0, pitch = 0, recoil = 0;
    let wallTouch = false;
    const keys = {};
    const vel = new THREE.Vector3();
    let onGround = true;
    let scoped = false, fov = 78, fovTarget = 78, sway = 0;
    let hits = 0, shots = 0, lastShot = 0;

    const gate = $('#gate');
    const el = {
      hits:$('#hits'), acc:$('#acc'),
      shots:$('#shots'), range:$('#range'),
      pal:$('#pal'), alive:$('#alive'),
      bearing:$('#bearing'),
      scope:$('#scope'), cross:$('#cross'),
      flash:$('#flash'),
      drone:$('#drone'), dcoords:$('#dcoords'), dmark:$('#dmark'), dconv:$('#dconv'),
      hud:$('.hud')
    };
    const ticks = $('#ticks');
    for (let i=-5;i<=5;i++){
      if (!i) continue;
      const s = document.createElement('span');
      s.style.left = (i*3.1)+'cqmin'; s.style.top = '-3px';
      s.style.height = (i%2?5:9)+'px';
      ticks.appendChild(s);
    }

    const cvs = renderer.domElement;
    const modeEl = $('#mode');
    let locked = false, drag = false, dragged = 0, running = false;

    function look(dx, dy){
      const s = scoped ? 0.00042 : 0.0022;
      yaw   -= dx * s;
      pitch -= dy * s;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
    }
    function enter(viaPad){
      initAudio();
      if (actx.state === 'suspended') actx.resume();
      /* the world gets its own bed: leave the intro's behind on the cut */
      if (sampleMap.drone === POOL) applyDroneSample(true);
      running = true;
      if (introRaf) cancelAnimationFrame(introRaf);
      gate.classList.add('hide');
      if (viaPad){
        modeEl.textContent = 'controller'; // a pad press cannot take pointer lock, and does not need it
      } else if (cvs.requestPointerLock){
        try { cvs.requestPointerLock(); } catch(err){}
        setTimeout(()=>{ if (!locked && !orbital && !worldMode) modeEl.textContent = 'drag to look'; }, 400);
      } else {
        modeEl.textContent = 'drag to look';
      }
    }
    // no visible enter affordance: 1 jumps straight in (see keydown below)
    on(document, 'pointerlockerror', ()=>{ modeEl.textContent = 'drag to look'; });
    on(document, 'pointerlockchange', ()=>{
      locked = document.pointerLockElement === cvs;
      modeEl.textContent = creature ? creatureLabel() : locked ? 'mouse held, esc to release' : 'drag to look';
      if (!locked) scoped = false;
    });

    /* ---------------------------------------------------------- intro crawl
       field notes on the interface, typed on with a scramble-decode lag,
       crawling upward forever until ENTER is clicked. A few words are live —
       shoot them with the scope cursor and they redact into a black bar. */
    function ensureAudio(){ initAudio(); if (actx.state === 'suspended') actx.resume(); }
    const introGate = gate, introCrawl = $('#introCrawl'), introGhost = $('#introGhost'),
      introScope = $('#introScope'), introFlashEl = $('#introFlash');
    const INTRO_LINES = [
      {type:'h', text:'ON THE ABSTRACTION OF VIOLENCE'},
      {type:'p', text:'Abstract. This study examines the abstraction of violence: the means by which a military interface converts killing into an operation performed on a [SCREEN]. A drone feed, a gunsight, a tactical map — each sets a layer of symbols between the operator and the body, and it is the layer that makes the act possible.'},
      {type:'p', text:'Cinema has rehearsed this for decades. In Ender\'s Game a child destroys a species believing it a [GAME]; in WarGames the machine cannot tell a simulation from a launch; in Good Kill and Eye in the Sky the pilot commutes home from a war conducted by joystick.'},
      {type:'p', text:'We begin from a premise: the [SCOPE] is not an optical device but a classificatory one. Whatever enters the reticle has already been converted into a category.'},
      {type:'p', text:'Section 1. The [TARGET] is best understood as a compressed argument — a shape the operator is trained to recognize prior to any occasion for doubt.'},
      {type:'p', text:'The apparatus does not decide; it [RETUNES]. Each confirmed detection recalibrates the ground it was instructed to observe, and the observation becomes the terrain.'},
      {type:'p', text:'Section 2. We argue that an [ABSTRACTION] is not less consequential for being invisible; its efficacy as an instrument depends precisely on its invisibility.'},
      {type:'p', text:'The interface poses a single research question, indefinitely: is the object before it a [PATTERN], or a person?'},
      {type:'h', text:'SECTION 3 · THE GENRE AS TRAINING CORPUS'},
      {type:'p', text:'The first-person view constitutes the most rehearsed gesture in the history of images: millions of eyes aligned to one [CROSSHAIR], one grammar of certainty.'},
      {type:'p', text:'The Call of Duty series, on this reading, did not depict conflict; it scheduled it — a [FRANCHISE] calendar of adversaries, annually refreshed, regionally localized, pre-forgiven.'},
      {type:'p', text:'Military advisors were lent to the production; the production returned a cohort fluent in its [REPLAY] grammar prior to any institutional training.'},
      {type:'p', text:'Each lobby operates as a [SIMULATION] of consent: the respawn suspends consequence, and the scoreboard converts loss into a metric of progress.'},
      {type:'p', text:'We conclude that this, too, is a psychological operation — directed not at an adversary but at the viewer. The instrument you are presently holding was issued by it.'},
      {type:'p', text:'Method: aim at what you recognize. Record what remains when the recognizable is removed.'},
    ];
    const SCRAMBLE_GLYPHS = '!<>-_/\\[]{}=+*01#$%';
    const introReveal = []; // flat schedule: {el, t}
    let introTCursor = 650;
    const CHAR_MS = 13, LINE_GAP = 240;
    let kwCount = 0;
    function buildIntroLine(line){
      const div = document.createElement('div');
      div.className = 'iline ' + line.type;
      const parts = line.text.split(/(\[[A-Z]+\])/);
      parts.forEach(part=>{
        if (!part) return;
        const kwMatch = part.match(/^\[([A-Z]+)\]$/);
        const host = kwMatch ? document.createElement('span') : null;
        if (kwMatch){
          host.className = 'kw';
          const ki = kwCount++;
          host.dataset.ki = ki;
          [...kwMatch[1]].forEach(ch=>host.appendChild(buildChar(ch)));
          host.dataset.bar = '█'.repeat(kwMatch[1].length);
          on(host, 'click', ()=>shootKeyword(host, ki));
          div.appendChild(host);
        } else {
          [...part].forEach(ch=>div.appendChild(buildChar(ch)));
        }
      });
      return div;
    }
    function buildChar(ch){
      const s = document.createElement('span');
      s.className = 'ch';
      if (ch === ' '){
        s.classList.add('on');
        s.textContent = ' ';
      } else {
        s.classList.add('pending');
        s.textContent = SCRAMBLE_GLYPHS[(Math.random()*SCRAMBLE_GLYPHS.length)|0];
        introTCursor += CHAR_MS + Math.random()*10;
        introReveal.push({el:s, ch, t:introTCursor});
      }
      return s;
    }
    INTRO_LINES.forEach(line=>{
      introCrawl.appendChild(buildIntroLine(line));
      introTCursor += LINE_GAP;
    });
    function playKeywordShot(i){
      if (!actx) return;
      const t = actx.currentTime;
      const f = 520 * Math.pow(2, SCALE[(i*3+1) % SCALE.length]/12);
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f*0.4, t+0.16);
      const flt = actx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = f*1.6; flt.Q.value = 5;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t+0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
      o.connect(flt); flt.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.24);
      if (noiseBuf){
        const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 2.2;
        const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
        const ng = actx.createGain();
        ng.gain.setValueAtTime(0.14, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t+0.06);
        n.connect(hp); hp.connect(ng); ng.connect(uiBus); n.start(t); n.stop(t+0.07);
      }
    }
    /* clip each glyph into two triangular panes and fling them apart as
       position:fixed overlays — a real glass-shatter per letter, independent
       of the crawl's own scroll so the break reads clean underneath it */
    function shatterChar(baseSpan){
      const r = baseSpan.getBoundingClientRect();
      if (!r.width) return;
      const cs = getComputedStyle(baseSpan);
      const wrap = document.createElement('span');
      wrap.className = 'shardwrap';
      wrap.style.left = (r.left - viewOX)/viewS + 'px'; wrap.style.top = (r.top - viewOY)/viewS + 'px';
      wrap.style.width = r.width/viewS + 'px'; wrap.style.height = r.height/viewS + 'px';
      wrap.style.font = cs.font; wrap.style.lineHeight = cs.lineHeight;
      const txt = baseSpan.textContent;
      const mk = (clip, ang)=>{
        const s = document.createElement('span');
        s.className = 'shard'; s.textContent = txt; s.style.clipPath = clip;
        wrap.appendChild(s);
        const dx = Math.cos(ang)*(50+Math.random()*90), dy = Math.sin(ang)*(50+Math.random()*90) - 30;
        const dr = (Math.random()*260-130);
        requestAnimationFrame(()=>{
          s.style.transform = 'translate('+dx+'px,'+dy+'px) rotate('+dr+'deg)';
          s.style.opacity = '0';
        });
      };
      const baseAng = Math.random()*Math.PI*2;
      mk('polygon(0 0,100% 0,0 100%)', baseAng);
      mk('polygon(100% 0,100% 100%,0 100%)', baseAng+Math.PI);
      root.appendChild(wrap);
      setTimeout(()=>wrap.remove(), 560);
    }
    function shootKeyword(host, ki){
      if (host.classList.contains('hit') || host.classList.contains('redacted')) return;
      ensureAudio();
      playKeywordShot(ki);
      introFlashEl.style.transition = 'none'; introFlashEl.style.opacity = '0.88';
      requestAnimationFrame(()=>{
        introFlashEl.style.transition = 'opacity .38s ease-out'; introFlashEl.style.opacity = '0';
      });
      const chars = [...host.querySelectorAll('.ch')];
      chars.forEach(c=>{ shatterChar(c); c.classList.remove('pending'); c.classList.add('on'); });
      host.classList.add('hit');
      setTimeout(()=>host.classList.add('redacted'), 440);
    }
    /* ---------------------------------------------------------- glyph war
       the right-hand margin of the field notes: a roguelike nobody is playing.
       Two cohorts of glyphs garrison a dungeon, decree policy at each other and
       file reports on it in a script drawn fresh each visit — consistent enough
       to be a language, never translated. Returns its own per-frame step. */
    const glyphWar = (()=>{
      const cv = $('#introSim'), gx = cv.getContext('2d');
      const CW = 9, CH = 14, COLS = 40, ROWS = 32, MW = 38, MH = 20, MX = 1, MY = 2;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = COLS*CW*dpr; cv.height = ROWS*CH*dpr;
      cv.style.width = COLS*CW + 'px'; cv.style.height = ROWS*CH + 'px';
      gx.scale(dpr, dpr);
      gx.font = "11px 'Mesa043',ui-monospace,Menlo,Consolas,monospace";
      gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.lineCap = 'square';
      const rnd = n => (Math.random()*n)|0;

      /* the script: every glyph is one pen stroke wandering a 3x4 lattice,
         sometimes with a loose dot. Words are fixed runs of glyphs, so the same
         event always files the same sentence */
      const LX = [1.5, 4.5, 7.5], LY = [2.5, 5.5, 8.5, 11.5];
      const mkGlyph = ()=>{
        const segs = [];
        let x = rnd(3), y = rnd(4);
        for (let n = 3 + rnd(3), guard = 0; segs.length < n && guard < 40; guard++){
          const nx = x + rnd(3) - 1, ny = y + rnd(3) - 1;
          if (nx < 0 || nx > 2 || ny < 0 || ny > 3 || (nx === x && ny === y)) continue;
          segs.push([x, y, nx, ny]); x = nx; y = ny;
        }
        if (Math.random() < 0.3) segs.push([rnd(3), rnd(4)]);
        return segs;
      };
      const ALPHA = Array.from({length:30}, mkGlyph), DIGITS = Array.from({length:6}, mkGlyph);
      const G_LEAD = mkGlyph(), G_TROOP = mkGlyph(), G_CIV = [[1, 1, 1, 2], [1, 3]];
      const lexicon = {};
      const word = k => lexicon[k] || (lexicon[k] = Array.from({length:2 + rnd(4)}, ()=>ALPHA[rnd(30)]));
      const num = n => [...Math.max(0, n|0).toString(6)].map(d=>DIGITS[+d]); // they count in sixes
      const log = [];
      let typed = 0;
      /* a sentence: words by key, numbers, or ready-made glyph runs (names, sigils) */
      function say(...parts){
        const line = [];
        parts.forEach((p, i)=>{
          if (i) line.push(null);
          line.push(...(typeof p === 'string' ? word(p) : typeof p === 'number' ? num(p) : p));
        });
        log.push(line.slice(0, COLS - 3));
        if (log.length > 5) log.shift();
        typed = 0;
      }

      /* the dungeon: rooms and corridors, west to east */
      const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      let map = [], rooms = [], depth = 1, t = 0, noise = 0;
      const at = (x, y)=> x < 0 || y < 0 || x >= MW || y >= MH ? '#' : map[y*MW + x];
      function tunnel(a, b, vFirst){
        let x = a.cx, y = a.cy;
        const carve = ()=>{ if (map[y*MW + x] === '#') map[y*MW + x] = '.'; };
        const h = ()=>{ while (x !== b.cx){ x += Math.sign(b.cx - x); carve(); } };
        const v = ()=>{ while (y !== b.cy){ y += Math.sign(b.cy - y); carve(); } };
        if (vFirst){ v(); h(); } else { h(); v(); }
      }
      function dig(){
        do {
          map = new Array(MW*MH).fill('#'); rooms = [];
          for (let i=0;i<80 && rooms.length < 7;i++){
            const w = 4 + rnd(7), h = 3 + rnd(4);
            const x = 1 + rnd(MW - w - 2), y = 1 + rnd(MH - h - 2);
            if (rooms.some(r=> x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y)) continue;
            rooms.push({x, y, w, h, cx:x + (w >> 1), cy:y + (h >> 1)});
            for (let j=y;j<y+h;j++) for (let k=x;k<x+w;k++) map[j*MW + k] = Math.random() < 0.07 ? '"' : '.';
          }
        } while (rooms.length < 4);
        rooms.sort((a, b)=>a.cx - b.cx);
        for (let i=1;i<rooms.length;i++) tunnel(rooms[i-1], rooms[i], i % 2);
        for (let i=2;i<rooms.length;i+=2) tunnel(rooms[i-2], rooms[i], true); // a second way round, for flanking
        facs.forEach((F, f)=>{
          F.hq = rooms[f ? rooms.length - 1 : 0];
          const d = rooms[f ? rooms.length - 2 : 1];
          F.depot = [d.cx, d.cy];
          map[d.cy*MW + d.cx] = '=';
        });
      }

      /* the cohorts. Each keeps three books — force, supply, consent — and its
         commander reads them to pick the next decree */
      const POLICIES = ['march', 'march', 'cordon', 'levy', 'hold', 'parley'];
      const facs = [0, 1].map(f=>({f, policy:'hold', term:6 + f*9, said:false,
        force:0.6, supply:0.8, consent:0.6, sig:[f ? {g:G_LEAD, inv:true} : G_LEAD]}));
      let units = [];
      const fields = new Map();
      let shots = [];
      const unitAt = (x, y)=> units.find(u=>u.hp > 0 && u.x === x && u.y === y);
      const cheb = (a, b)=> Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      const nm = u => u.f === 1 ? u.name.map(g=>({g, inv:true})) : u.name;
      const spot = r=>{
        for (let i=0;i<40;i++){
          const x = r.x + rnd(r.w), y = r.y + rnd(r.h);
          if (!unitAt(x, y)) return [x, y];
        }
        return [r.cx, r.cy];
      };
      function muster(f, lead){
        const [x, y] = spot(f === 2 ? rooms[1 + rnd(rooms.length - 2)] : facs[f].hq);
        const u = {f, lead:!!lead, x, y, hp:lead ? 6 : 3, hit:0,
          name:Array.from({length:2 + rnd(2)}, ()=>ALPHA[rnd(30)])};
        units.push(u);
        return u;
      }
      function field(tx, ty){
        const k = ty*MW + tx;
        let d = fields.get(k);
        if (d) return d;
        d = new Int16Array(MW*MH).fill(-1); d[k] = 0;
        const q = [k];
        for (let i=0;i<q.length;i++){
          const c = q[i], cx = c % MW, cy = (c / MW)|0;
          for (const [dx, dy] of DIRS){
            const n = (cy + dy)*MW + cx + dx;
            if (d[n] === -1 && map[n] !== '#'){ d[n] = d[c] + 1; q.push(n); }
          }
        }
        fields.set(k, d);
        return d;
      }
      function step(u, tx, ty){
        const d = field(tx, ty);
        let best = d[u.y*MW + u.x], bx = u.x, by = u.y;
        if (best < 0) return;
        for (const [dx, dy] of DIRS){
          const nx = u.x + dx, ny = u.y + dy, v = d[ny*MW + nx];
          if (v >= 0 && v < best && !unitAt(nx, ny)){ best = v; bx = nx; by = ny; }
        }
        u.x = bx; u.y = by;
      }
      function hurt(u, v){
        v.hp--; v.hit = 2;
        if (v.hp > 0) return;
        if (at(v.x, v.y) !== '=') map[v.y*MW + v.x] = '%';
        say(nm(u), 'slay', nm(v));
      }
      function decree(F){
        const n = units.filter(u=>u.f === F.f).length, civs = units.some(u=>u.f === 2);
        let p;
        if (F.supply < 0.3) p = 'ration';
        else if (n < 4) p = civs ? 'levy' : 'hold';
        else if (F.consent < 0.25) p = 'parley';
        else do { p = POLICIES[rnd(POLICIES.length)]; } while (p === F.policy);
        F.policy = p; F.term = 28 + rnd(30); F.said = false;
        say(F.sig, 'decree', p, F.term);
      }
      function act(u){
        if (u.f === 2){ // the governed: drift about unless two soldiers stand over them
          u.held = units.filter(o=>o.f < 2 && cheb(o, u) === 1).length >= 2;
          if (!u.held && Math.random() < 0.4){
            const [dx, dy] = DIRS[rnd(8)];
            if (at(u.x + dx, u.y + dy) !== '#' && !unitAt(u.x + dx, u.y + dy)){ u.x += dx; u.y += dy; }
          }
          return;
        }
        const F = facs[u.f], pol = F.policy;
        let foe = null, civ = null;
        for (const o of units){
          if (o.hp <= 0 || o === u) continue;
          if (o.f === 1 - u.f && (!foe || cheb(o, u) < cheb(foe, u))) foe = o;
          if (o.f === 2 && (!civ || cheb(o, u) < cheb(civ, u))) civ = o;
        }
        if (foe && pol !== 'parley'){
          const dist = cheb(foe, u);
          if (dist === 1){ if (Math.random() < 0.55) hurt(u, foe); return; }
          // a clear rank or file to the enemy: shoot down it
          if (pol === 'march' && dist <= 6 && (foe.x === u.x || foe.y === u.y) && Math.random() < 0.35){
            const dx = Math.sign(foe.x - u.x), dy = Math.sign(foe.y - u.y), cells = [];
            let x = u.x + dx, y = u.y + dy;
            while ((x !== foe.x || y !== foe.y) && at(x, y) !== '#' && !unitAt(x, y)){ cells.push([x, y]); x += dx; y += dy; }
            if (x === foe.x && y === foe.y){
              shots.push({cells, ch:dx ? '-' : '|'});
              if (Math.random() < 0.5) hurt(u, foe);
              return;
            }
          }
        }
        if (pol === 'parley'){
          const them = units.find(o=>o.f === 1 - u.f && o.lead), mine = units.find(o=>o.f === u.f && o.lead);
          const to = u.lead ? them : mine;
          if (!to || to === u) return;
          if (cheb(to, u) > 2) return step(u, to.x, to.y);
          if (u.lead){
            F.consent = Math.min(1, F.consent + 0.012);
            if (!F.said){ F.said = true; say(F.sig, 'parley', facs[1 - u.f].sig); }
          }
          return;
        }
        if (u.lead || pol === 'hold') return step(u, F.hq.cx, F.hq.cy); // commanders lead from the rear
        if (pol === 'ration'){
          if (Math.max(Math.abs(F.depot[0] - u.x), Math.abs(F.depot[1] - u.y)) <= 1) F.supply = Math.min(1, F.supply + 0.03);
          else step(u, F.depot[0], F.depot[1]);
          return;
        }
        if ((pol === 'cordon' || pol === 'levy') && civ){
          if (cheb(civ, u) > 1) return step(u, civ.x, civ.y);
          if (pol === 'levy' && Math.random() < 0.15){ // conscripted on the spot
            civ.f = u.f; civ.hp = 3; civ.held = false;
            F.consent = Math.max(0, F.consent - 0.1);
            say(F.sig, 'levy', nm(civ));
          }
          return;
        }
        if (foe) step(u, foe.x, foe.y); else step(u, F.hq.cx, F.hq.cy);
      }
      function turn(){
        t++;
        fields.clear(); shots = [];
        for (const F of facs) if (--F.term <= 0) decree(F);
        for (const u of units.slice()) if (u.hp > 0) act(u);
        units = units.filter(u=>u.hp > 0);
        for (const F of facs){
          const mine = units.filter(u=>u.f === F.f);
          if (!mine.length){ // wiped out: the cohort is simply reissued
            muster(F.f, true); for (let i=0;i<4;i++) muster(F.f);
            F.supply = 0.8; F.consent = 0.5;
            say(F.sig, 'return');
          } else if (!mine.some(u=>u.lead)){
            mine[0].lead = true; mine[0].hp = 6;
            say(nm(mine[0]), 'succeed', F.sig);
          }
          F.force = Math.min(1, mine.length/9);
          F.supply = Math.max(0, F.supply - 0.0007*mine.length);
          if (F.supply === 0 && t % 14 === 0 && mine.length){
            const u = mine[rnd(mine.length)];
            u.hp--; u.hit = 2;
            say(nm(u), 'starve');
          }
          F.consent = Math.max(0, Math.min(1, F.consent +
            (F.policy === 'hold' ? 0.004 : F.policy === 'cordon' ? -0.005 : F.policy === 'march' ? -0.002 : 0)));
        }
        if (t % 8 === 0 && units.filter(u=>u.f === 2).length < 6) muster(2);
        if (t % 400 === 0){ // everyone goes one floor down and starts again
          depth++; noise = 5;
          dig();
          const old = units; units = [];
          for (const u of old){ [u.x, u.y] = spot(u.f === 2 ? rooms[1 + rnd(rooms.length - 2)] : facs[u.f].hq); units.push(u); }
          say('descend', depth);
        }
      }
      dig();
      facs.forEach(F=>{ muster(F.f, true); for (let i=0;i<5;i++) muster(F.f); });
      for (let i=0;i<6;i++) muster(2);
      say('open', depth);

      /* ---- drawing: ASCII for the place, the script for everything said about it */
      const chr = (ch, c, r, col)=>{ gx.fillStyle = col; gx.fillText(ch, c*CW + CW/2, r*CH + CH/2 + 0.5); };
      function glyph(g, c, r, col, inv){
        const ox = c*CW, oy = r*CH;
        if (inv){ gx.fillStyle = col; gx.fillRect(ox, oy, CW, CH); col = '#000'; }
        gx.strokeStyle = gx.fillStyle = col;
        gx.beginPath();
        for (const s of g){
          if (s.length === 2) gx.fillRect(ox + LX[s[0]] - 1, oy + LY[s[1]] - 1, 2, 2);
          else { gx.moveTo(ox + LX[s[0]], oy + LY[s[1]]); gx.lineTo(ox + LX[s[2]], oy + LY[s[3]]); }
        }
        gx.stroke();
      }
      function line(toks, c, r, col, limit = 99){
        toks.forEach((tk, i)=>{ if (tk && i < limit) glyph(tk.g || tk, c + i, r, col, !!tk.inv); });
      }
      const rule = r=>{ gx.fillStyle = '#444'; gx.fillRect(CW, r*CH + 7, (COLS - 2)*CW, 1); };
      function gauge(key, v, c, r){
        glyph(word(key)[0], c, r, '#888');
        for (let i=0;i<5;i++){
          gx.fillStyle = i < Math.round(v*5) ? '#ddd' : '#333';
          gx.fillRect((c + 1 + i)*CW + 1, r*CH + 4, CW - 2, 6);
        }
      }
      const LOG_COL = ['#eee', '#a0a0a0', '#7c7c7c', '#5c5c5c', '#444'];
      function draw(){
        gx.clearRect(0, 0, COLS*CW, ROWS*CH);
        line([...word('title'), null, ...word('ledger')], 1, 0, '#eee');
        const clock = [...num(depth), null, ...num(t)];
        line(clock, COLS - 1 - clock.length, 0, '#999');
        rule(1); rule(22); rule(26);
        for (let y=0;y<MH;y++) for (let x=0;x<MW;x++){
          const c = map[y*MW + x], cx = MX + x, cy = MY + y;
          if (noise > 0){ if (Math.random() < 0.5) chr(SCRAMBLE_GLYPHS[rnd(SCRAMBLE_GLYPHS.length)], cx, cy, '#666'); continue; }
          if (c === '#'){ if (DIRS.some(([dx, dy])=>at(x + dx, y + dy) !== '#')) chr('#', cx, cy, '#4c4c4c'); }
          else if (c === '.'){ gx.fillStyle = '#3c3c3c'; gx.fillRect(cx*CW + 4, cy*CH + 7, 1, 1); }
          else chr(c, cx, cy, c === '=' ? '#ccc' : c === '%' ? '#7a7a7a' : '#585858');
        }
        if (noise > 0) noise--;
        else {
          for (const s of shots) for (const [x, y] of s.cells) chr(s.ch, MX + x, MY + y, '#fff');
          for (const u of units){
            const c = MX + u.x, r = MY + u.y;
            if (u.hit > 0){ u.hit--; chr('*', c, r, '#fff'); continue; }
            if (u.f === 2){ glyph(G_CIV, c, r, u.held ? '#fff' : '#8c8c8c'); continue; }
            glyph(u.lead ? G_LEAD : G_TROOP, c, r, '#fff', u.f === 1);
            if (u.lead){ gx.fillStyle = '#fff'; gx.fillRect(c*CW, r*CH - 2, CW, 1); } // rank bar
          }
        }
        facs.forEach((F, f)=>{
          line([...F.sig, null, ...word(F.policy)], 1, 23 + f, '#eee');
          gauge('force', F.force, 14, 23 + f);
          gauge('supply', F.supply, 22, 23 + f);
          gauge('consent', F.consent, 30, 23 + f);
        });
        const civs = units.filter(u=>u.f === 2);
        line([G_CIV, null, ...num(civs.length), null, ...word('held'), null, ...num(civs.filter(u=>u.held).length)], 1, 25, '#8c8c8c');
        const top = 27 + 5 - log.length;
        log.forEach((ln, i)=>{
          const newest = i === log.length - 1;
          line(ln, 1, top + i, LOG_COL[log.length - 1 - i], newest ? typed : 99);
          if (newest){
            typed = Math.min(ln.length, typed + 2);
            if (t % 2){ gx.fillStyle = '#eee'; gx.fillRect((1 + typed)*CW + 1, (top + i)*CH + 2, CW - 3, CH - 4); }
          }
        });
      }
      let last = 0, beat = 0;
      return now=>{
        if (now - last < 80) return;
        last = now;
        if (++beat % 2 === 0) turn();
        draw();
      };
    })();

    let introRaf = 0, introStart = 0, introScrollY = 0, introGhostY = 0, introGhostSync = 0;
    let introHoldUntil = 0, introHeld = 0, introPrevNow = performance.now(); // stutter state
    const INTRO_SPEED = 18; // px/sec — slow crawl
    function introTick(now){
      introRaf = requestAnimationFrame(introTick);
      if (running) return;
      glyphWar(now);
      if (!introStart) introStart = now;
      const elapsed = now - introStart;
      // reveal / scramble pass
      for (const r of introReveal){
        if (r.el.classList.contains('on')) continue;
        if (elapsed >= r.t){
          r.el.classList.remove('pending'); r.el.classList.add('on'); r.el.textContent = r.ch;
        } else if ((now|0) % 55 < 17){
          r.el.textContent = SCRAMBLE_GLYPHS[(Math.random()*SCRAMBLE_GLYPHS.length)|0];
        }
      }
      // upward crawl; once the whole block has passed, hold and start the outro.
      // stutter: motion quantized to coarse steps plus brief random freezes,
      // so the crawl advances like a sticking film reel rather than gliding
      if (now >= introHoldUntil && Math.random() < 0.008)
        introHoldUntil = now + 120 + Math.random()*580; // random hitch
      if (now < introHoldUntil) introHeld += now - introPrevNow; // frozen frames don't advance the crawl
      introPrevNow = now;
      const wrapAt = introCrawl.scrollHeight + introGate.clientHeight + 60;
      const rawY = Math.max(0, (elapsed - introHeld)/1000*INTRO_SPEED);
      introScrollY = Math.min(Math.floor(rawY/3)*3, Math.max(1, wrapAt));
      introCrawl.style.transform = 'translateY(' + (-introScrollY) + 'px)';
      introGhostY += (introScrollY - introGhostY) * 0.05;
      introGhost.style.transform = 'translateY(' + (-introGhostY) + 'px)';
      if (now - introGhostSync > 220){ introGhostSync = now; introGhost.innerHTML = introCrawl.innerHTML; }
      if (introScrollY >= wrapAt && !introStrobing) introOutro();
      // random strobe revert: now and then the whole gate flips to negative
      // for a frame or two, sometimes twice in a row, like a film splice
      if (!introStrobing && now >= introFlickUntil && Math.random() < 0.0035) introFlicker(now);
    }
    let introFlickUntil = 0, introFlickTimers = [];
    function introFlicker(now){
      const twice = Math.random() < 0.4;
      const hold = 40 + Math.random()*80;
      introFlickUntil = now + 1500 + Math.random()*4000; // breathe between reverts
      introFlickTimers.forEach(clearTimeout); introFlickTimers = [];
      const flash = (at)=>{
        introFlickTimers.push(setTimeout(()=>{ if (!running){ introGate.classList.add('inv'); playIntroRevert(); } }, at));
        introFlickTimers.push(setTimeout(()=>introGate.classList.remove('inv'), at + hold));
      };
      flash(0);
      if (twice) flash(hold + 60 + Math.random()*90);
    }
    disposers.push(()=>introFlickTimers.forEach(clearTimeout));
    function playIntroRevert(){
      if (!actx || !noiseBuf) return;
      const t = actx.currentTime;
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 1.4;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
      n.connect(bp); bp.connect(g); g.connect(uiBus); n.start(t); n.stop(t+0.06);
      n.onended = reap(n, bp, g);
    }
    /* outro: 5 invert strobes with bouncing-ball timing — the gaps shrink
       like a ball settling ( .      .   .  .  . . ) — then hard-cut to mode 1 */
    let introStrobing = false;
    function introOutro(){
      introStrobing = true;
      const GAPS = [600, 420, 290, 200, 140]; // ms between flashes, decelerating
      const FLASH = 90; // how long each invert holds
      let t = 200;
      const timers = [];
      GAPS.forEach((gap, i)=>{
        t += gap;
        timers.push(setTimeout(()=>{ introGate.classList.add('inv'); playIntroRevert(); }, t));
        timers.push(setTimeout(()=>{
          introGate.classList.remove('inv');
          if (i === GAPS.length-1 && !running) enter(); // cut to mode 1
        }, t + FLASH));
      });
      disposers.push(()=>timers.forEach(clearTimeout));
    }
    introRaf = requestAnimationFrame(introTick);
    /* scope cursor with fake depth: the ring rides the cursor exactly, the
       full-screen h/v hairlines ease toward it a beat late and overshoot
       slightly with parallax, so the crosshair reads as a deeper plane */
    const introHairH = $('#introHairH'), introHairV = $('#introHairV');
    let introMX = viewW/2, introMY = viewH/2;
    let hairX = introMX, hairY = introMY;
    /* scope servo: a thin filtered-noise whine whose level and pitch ride the
       cursor speed, plus a dry ratchet click every ~22px of travel, so moving
       the reticle sounds like turning a stiff turret */
    let servoSrc = null, servoBp = null, servoG = null, servoVel = 0, servoDist = 0;
    function initServo(){
      if (servoSrc || !actx || !noiseBuf) return;
      servoSrc = actx.createBufferSource(); servoSrc.buffer = noiseBuf; servoSrc.loop = true;
      servoBp = actx.createBiquadFilter(); servoBp.type = 'bandpass'; servoBp.frequency.value = 900; servoBp.Q.value = 9;
      servoG = actx.createGain(); servoG.gain.value = 0;
      servoSrc.connect(servoBp); servoBp.connect(servoG); servoG.connect(uiBus); servoSrc.start();
    }
    function stopServo(){
      if (!servoSrc) return;
      try { servoSrc.stop(); } catch(err){}
      reap(servoSrc, servoBp, servoG)(); servoSrc = null;
    }
    disposers.push(stopServo);
    function playServoTick(){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(2400 + Math.random()*600, t);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.014);
      o.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.016);
      o.onended = reap(o, g);
    }
    on(document, 'mousemove', e=>{
      if (running) return;
      const nx = lx(e), ny = ly(e);
      const dx = nx - introMX, dy = ny - introMY;
      const d = Math.hypot(dx, dy);
      ensureAudio(); initServo();
      if (actx.state === 'running'){
        servoVel = Math.min(1, servoVel + d*0.03);
        servoDist += d;
        if (servoDist > 22){ servoDist = 0; playServoTick(); }
      }
      introMX = nx; introMY = ny;
      introScope.style.left = introMX + 'px';
      introScope.style.top = introMY + 'px';
      const s = 1 + ((introMY/viewH) - 0.5)*0.24; // lower on screen = "closer"
      introScope.style.transform = 'scale(' + s + ')';
    });
    function introHairTick(){
      if (!running){
        // parallax: hairlines aim slightly past the cursor from screen center
        const tx = introMX + (introMX - viewW/2)*0.06;
        const ty = introMY + (introMY - viewH/2)*0.06;
        hairX += (tx - hairX)*0.12;
        hairY += (ty - hairY)*0.12;
        introHairH.style.transform = 'translateY(' + hairY + 'px)';
        introHairV.style.transform = 'translateX(' + hairX + 'px)';
        if (servoG){
          servoVel *= 0.86; // decays fast once the hand stops
          const t = actx.currentTime;
          servoG.gain.setTargetAtTime(servoVel*0.11, t, 0.02);
          servoBp.frequency.setTargetAtTime(700 + servoVel*1400, t, 0.03);
        }
        requestAnimationFrame(introHairTick);
      } else stopServo();
    }
    requestAnimationFrame(introHairTick);

    on(window, 'mousemove', e=>{
      if (!running) return;
      if (locked) look(e.movementX, e.movementY);
      else if (drag){
        look(e.movementX, e.movementY);
        dragged += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
    });
    on(window, 'mousedown', e=>{
      if (!running) return;
      if (e.target.closest && e.target.closest('.seq,.m3,.settings,.destroy,.fleet')) return;
      if (mode3 || destroyMode || fleetMode) return;
      if (e.button === 2 && !orbital) scoped = true;
      if (e.button === 2 && orbital){ launchMissile(lx(e), ly(e), true); return; }
      if (locked){
        if (e.button === 0){
          if (orbital) launchMissile(viewW/2, viewH/2);
          else fire();
        }
        return;
      }
      drag = true; dragged = 0;
    });
    on(window, 'mouseup', e=>{
      if (e.target.closest && e.target.closest('.seq,.m3,.fleet')){ drag = false; return; }
      if (mode3 || fleetMode){ drag = false; return; }
      if (e.button === 2) scoped = false;
      if (!locked && running && e.button === 0 && drag && dragged < 8){
        if (orbital) launchMissile(lx(e), ly(e));
        else fire();
      }
      drag = false;
    });
    on(window, 'contextmenu', e=>e.preventDefault());

    /* touch: one finger looks, two fingers scope, a tap fires */
    let tx = 0, ty = 0, tMoved = 0, tStart = 0;
    on(cvs, 'touchstart', e=>{
      if (!running) return;
      e.preventDefault();
      const t = e.touches[0];
      tx = lx(t); ty = ly(t); tMoved = 0; tStart = performance.now();
      scoped = e.touches.length > 1;
    }, {passive:false});
    on(cvs, 'touchmove', e=>{
      if (!running) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = lx(t) - tx, dy = ly(t) - ty;
      tx = lx(t); ty = ly(t);
      tMoved += Math.abs(dx) + Math.abs(dy);
      look(dx * 1.6, dy * 1.6);
    }, {passive:false});
    on(cvs, 'touchend', e=>{
      if (!running) return;
      if (tMoved < 10 && performance.now() - tStart < 300){
        if (orbital) launchMissile(tx, ty);
        else fire();
      }
      if (!e.touches.length) scoped = false;
    }, {passive:false});
    on(window, 'keydown', e=>{ keys[e.code]=true; if(e.code==='Space') e.preventDefault(); });
    on(window, 'keyup', e=>keys[e.code]=false);
    /* display resolution: 'native' fills the window; a fixed entry renders the
       stage at exactly that pixel size and letterboxes it into the window */
    const RES_PRESETS = {'1792x768': [1792, 768]};
    let resMode = 'native';
    try { resMode = localStorage.getItem('scopeRes') || 'native'; } catch(err){}
    if (!RES_PRESETS[resMode]) resMode = 'native';
    function applyResolution(){
      const fixed = RES_PRESETS[resMode];
      const winW = window.innerWidth, winH = window.innerHeight;
      if (fixed){
        viewW = fixed[0]; viewH = fixed[1];
        viewS = Math.min(winW/viewW, winH/viewH);
        viewOX = (winW - viewW*viewS)/2; viewOY = (winH - viewH*viewS)/2;
        root.style.width = viewW + 'px'; root.style.height = viewH + 'px';
        root.style.transform = 'translate(' + viewOX + 'px,' + viewOY + 'px) scale(' + viewS + ')';
      } else {
        viewW = winW; viewH = winH; viewS = 1; viewOX = 0; viewOY = 0;
        root.style.width = ''; root.style.height = ''; root.style.transform = '';
      }
      /* a fixed resolution is exact: one drawing-buffer pixel per stage pixel */
      renderer.setPixelRatio(fixed ? 1 : Math.min(devicePixelRatio, 1.35));
      camera.aspect = viewW/viewH; camera.updateProjectionMatrix();
      renderer.setSize(viewW, viewH);
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(s.x, s.y);
      postMat.uniforms.res.value.set(s.x, s.y);
      fleetResize();
      if (destroyMode){ destroyCvs.width = viewW; destroyCvs.height = viewH; }
    }
    on(window, 'resize', applyResolution);

    /* ---------------------------------------------------------- world mode: sequencer + render modes */
    const seqEl = $('#seq');
    const seqGrid = $('#seqgrid');
    const STEPS = 16; // tempo (bpm / STEP_T) lives with the mixer state
    const TRACK_NAMES = ['KICK','SNR','HAT','PRC'];
    const pattern = [
      [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
      [0,0,0,1, 0,0,1,0, 0,1,0,0, 0,0,1,0]
    ];
    /* circular sequencer: four concentric rings of arcs around the scope */
    const SVGNS = 'http://www.w3.org/2000/svg';
    const RINGS = [[34,43],[46,55],[58,67],[70,79]]; // kick innermost → prc outermost
    const cellEls = [];
    function arcPath(r0, r1, a0, a1){
      const px = (r,a)=>Math.cos(a)*r, py = (r,a)=>Math.sin(a)*r;
      const f = (n)=>n.toFixed(2);
      return 'M' + f(px(r0,a0)) + ',' + f(py(r0,a0)) +
        ' L' + f(px(r1,a0)) + ',' + f(py(r1,a0)) +
        ' A' + r1 + ',' + r1 + ' 0 0 1 ' + f(px(r1,a1)) + ',' + f(py(r1,a1)) +
        ' L' + f(px(r0,a1)) + ',' + f(py(r0,a1)) +
        ' A' + r0 + ',' + r0 + ' 0 0 0 ' + f(px(r0,a0)) + ',' + f(py(r0,a0)) + ' Z';
    }
    /* observatory decoration layers, drawn under the cells */
    function deco(tag, attrs){
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      seqGrid.appendChild(e);
      return e;
    }
    for (let i=0;i<6;i++)
      deco('circle', {cx:0, cy:0, r:26 + i*13, class:'guide' + (i%2===0 ? ' dash' : '')});
    for (let i=0;i<128;i++){
      const a = (i/128)*Math.PI*2;
      const r1 = i%8===0 ? 90 : 86.5;
      deco('line', {x1:Math.cos(a)*84, y1:Math.sin(a)*84,
        x2:Math.cos(a)*r1, y2:Math.sin(a)*r1, class:'tick'+(i%8===0 ? ' maj' : '')});
    }
    for (let i=0;i<16;i++){
      const a = (i/16)*Math.PI*2 - Math.PI/2 + Math.PI/16;
      deco('line', {x1:Math.cos(a)*91, y1:Math.sin(a)*91,
        x2:Math.cos(a)*99, y2:Math.sin(a)*99, class:'ray'});
    }

    /* mode-3's 4th quadrant redraws this exact pattern/melPattern data as a
       spreadsheet: same source of truth, two skins. sheetCellEls/sheetMelEls
       mirror cellEls/melEls 1:1 so a toggle in either UI updates both. */
    const sheetCellEls = [];
    const sheetMelEls = [];
    const sheetColHeaders = [];
    const colLetter = (i)=>String.fromCharCode(67+i); // C..R for the 16 steps
    function setStep(r, c, v){
      pattern[r][c] = v;
      cellEls[r][c].classList.toggle('onn', !!v);
      sheetCellEls[r][c].classList.toggle('onn', !!v);
    }
    function setMelStep(c, v){
      melPattern[c] = v;
      melEls[c].classList.toggle('onn', !!v);
      sheetMelEls[c].classList.toggle('onn', !!v);
    }

    const cellMid = [];
    pattern.forEach((row, r)=>{
      const rowCells = [];
      const mids = [];
      row.forEach((v, c)=>{
        const a0 = -Math.PI/2 + (c/STEPS)*Math.PI*2 + 0.028;
        const a1 = -Math.PI/2 + ((c+1)/STEPS)*Math.PI*2 - 0.028;
        const am = (a0+a1)/2, rm = (RINGS[r][0]+RINGS[r][1])/2;
        mids.push([Math.cos(am)*rm, Math.sin(am)*rm]);
        const cell = document.createElementNS(SVGNS, 'path');
        cell.setAttribute('d', arcPath(RINGS[r][0], RINGS[r][1], a0, a1));
        cell.setAttribute('class', 'cell t'+r + (v?' onn':''));
        cell.addEventListener('click', ()=>setStep(r, c, pattern[r][c] ^ 1));
        seqGrid.appendChild(cell); rowCells.push(cell);
      });
      cellEls.push(rowCells);
      cellMid.push(mids);
      const lbl = document.createElementNS(SVGNS, 'text');
      lbl.setAttribute('class', 'tlab');
      lbl.setAttribute('x', -(RINGS[r][0] + (RINGS[r][1]-RINGS[r][0])/2));
      lbl.setAttribute('y', 1.6);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.textContent = TRACK_NAMES[r];
      seqGrid.appendChild(lbl);
    });

    /* melodic node ring: a fifth voice on a quiet ring of dots inside the drums */
    const melPattern = [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,1,0];
    const melEls = [];
    for (let c=0;c<STEPS;c++){
      const a = -Math.PI/2 + ((c+0.5)/STEPS)*Math.PI*2;
      const n = deco('circle', {class:'mnode' + (melPattern[c] ? ' onn' : ''),
        cx:Math.cos(a)*26, cy:Math.sin(a)*26, r:2});
      n.addEventListener('click', ()=>setMelStep(c, melPattern[c] ^ 1));
      melEls.push(n);
    }

    /* the drum machine, redrawn as a Sheet1 grid: same click surface,
       spreadsheet-cell aesthetic, for the mode-3 control room's 4th quadrant */
    const m3sheet = $('#m3sheet');
    const m3ref = $('#m3ref');
    const m3formula = $('#m3formula');
    function setRef(colTxt, rowTxt, label, v){
      m3ref.textContent = colTxt + rowTxt;
      m3formula.textContent = '=IF(' + label + rowTxt + ',"HIT","-")  ' + (v ? 'TRUE' : 'FALSE');
    }
    if (m3sheet){
      m3sheet.replaceChildren(); // effect re-runs must not stack a second grid
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headRow.appendChild(document.createElement('th')).className = 'corner';
      const trackHeadTh = document.createElement('th');
      trackHeadTh.className = 'corner';
      trackHeadTh.textContent = 'Track';
      headRow.appendChild(trackHeadTh);
      for (let c=0;c<STEPS;c++){
        const th = document.createElement('th');
        th.textContent = colLetter(c);
        headRow.appendChild(th);
        sheetColHeaders.push(th);
      }
      thead.appendChild(headRow);
      m3sheet.appendChild(thead);

      const tbody = document.createElement('tbody');
      TRACK_NAMES.forEach((name, r)=>{
        const tr = document.createElement('tr');
        const rn = document.createElement('td'); rn.className = 'rownum'; rn.textContent = String(r+2);
        const tn = document.createElement('td'); tn.className = 'track'; tn.textContent = name;
        tr.appendChild(rn); tr.appendChild(tn);
        const rowCells = [];
        for (let c=0;c<STEPS;c++){
          const td = document.createElement('td');
          td.className = 'cell' + (pattern[r][c] ? ' onn' : '');
          td.addEventListener('click', ()=>setStep(r, c, pattern[r][c] ^ 1));
          td.addEventListener('mouseenter', ()=>setRef(colLetter(c), String(r+2), name+'_', pattern[r][c]));
          tr.appendChild(td);
          rowCells.push(td);
        }
        sheetCellEls.push(rowCells);
        tbody.appendChild(tr);
      });
      const melRow = document.createElement('tr');
      melRow.className = 'mel';
      const mrn = document.createElement('td'); mrn.className = 'rownum'; mrn.textContent = String(TRACK_NAMES.length+2);
      const mtn = document.createElement('td'); mtn.className = 'track'; mtn.textContent = 'MEL';
      melRow.appendChild(mrn); melRow.appendChild(mtn);
      for (let c=0;c<STEPS;c++){
        const td = document.createElement('td');
        td.className = 'cell' + (melPattern[c] ? ' onn' : '');
        td.addEventListener('click', ()=>setMelStep(c, melPattern[c] ^ 1));
        td.addEventListener('mouseenter', ()=>setRef(colLetter(c), String(TRACK_NAMES.length+2), 'MEL_', melPattern[c]));
        melRow.appendChild(td);
        sheetMelEls.push(td);
      }
      tbody.appendChild(melRow);
      m3sheet.appendChild(tbody);
    }

    const seqPh = document.createElementNS(SVGNS, 'line');
    seqPh.setAttribute('class', 'ph');
    seqPh.setAttribute('x1', 0); seqPh.setAttribute('y1', -30);
    seqPh.setAttribute('x2', 0); seqPh.setAttribute('y2', -90);
    seqGrid.appendChild(seqPh);

    /* shuffle: while on, every hit draws a fresh sample + pitch, and each new
       cycle a different algorithm rewrites the whole pattern (drums + MEL).
       The hand-made pattern is snapshotted on enable and restored on disable. */
    let shuffleOn = false, shufAlgo = -1, shufSaved = null;
    const shufBtn = $('#shuf');
    shufBtn.classList.remove('on'); shufBtn.textContent = 'SHUFFLE'; // effect re-runs start clean
    const rnd = (n)=>(Math.random()*n)|0;
    const euclidRow = (k, rot)=>Array.from({length:STEPS}, (_, i)=>((i + rot)*k) % STEPS < k ? 1 : 0);
    const diceRow = (p)=>Array.from({length:STEPS}, ()=>Math.random() < p ? 1 : 0);
    const curRows = ()=>[...pattern.map(r=>r.slice()), melPattern.slice()];
    const SHUF_ALGOS = [
      ['EUCLID', ()=>[[3,3],[2,2],[5,7],[2,4],[3,4]].map(([lo, span])=>euclidRow(lo + rnd(span), rnd(STEPS)))],
      ['DICE', ()=>[0.25, 0.15, 0.5, 0.2, 0.3].map((p, r)=>{ const row = diceRow(p); if (!r) row[0] = 1; return row; })],
      ['MUTATE', ()=>curRows().map(row=>{ for (let i=0;i<3;i++) row[rnd(STEPS)] ^= 1; return row; })],
      ['ROTATE', ()=>curRows().map(row=>{ const n = 1 + rnd(STEPS-1); return row.map((_, i)=>row[(i + n) % STEPS]); })],
      ['BREAK', ()=>{
        const kick = diceRow(0.18); kick[0] = 1; kick[rnd(2) ? 10 : 6] = 1;
        const snr = diceRow(0.08); snr[4] = 1; snr[12] = 1;
        const div = [1, 2, 2, 4][rnd(4)];
        const hat = Array.from({length:STEPS}, (_, i)=>i % div === 0 || Math.random() < 0.15 ? 1 : 0);
        return [kick, snr, hat, diceRow(0.22), diceRow(0.3)];
      }]
    ];
    function reshuffle(){
      let a = rnd(SHUF_ALGOS.length);
      if (a === shufAlgo) a = (a + 1) % SHUF_ALGOS.length; // never the same algorithm twice running
      shufAlgo = a;
      const rows = SHUF_ALGOS[a][1]();
      for (let c=0;c<STEPS;c++){
        for (let r=0;r<4;r++) if (pattern[r][c] !== rows[r][c]) setStep(r, c, rows[r][c]);
        if (melPattern[c] !== rows[4][c]) setMelStep(c, rows[4][c]);
      }
      shufBtn.textContent = 'SHUFFLE · ' + SHUF_ALGOS[a][0];
    }
    function setShuffle(v){
      shuffleOn = v;
      shufBtn.classList.toggle('on', v);
      if (v){
        shufSaved = curRows();
        reshuffle();
      } else {
        if (shufSaved) for (let c=0;c<STEPS;c++){
          for (let r=0;r<4;r++) setStep(r, c, shufSaved[r][c]);
          setMelStep(c, shufSaved[4][c]);
        }
        shufSaved = null; shufAlgo = -1;
        shufBtn.textContent = 'SHUFFLE';
      }
    }
    on(shufBtn, 'click', ()=>{ setShuffle(!shuffleOn); shufBtn.blur(); });

    let snarePulse = 0, hatFlick = 0;
    /* the node ring's voice: a soft pluck tuned to the current world root */
    function playNode(s, t){
      if (!actx) return;
      const root = PALETTES[palIndex % PALETTES.length].root * 8;
      const deg = shuffleOn ? (Math.random()*SCALE.length)|0 : s % SCALE.length;
      const f = root * Math.pow(2, SCALE[deg]/12) * (shuffleOn ? [0.5, 1, 1, 2][(Math.random()*4)|0] : 1);
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const o2 = actx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f*1.005;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.6);
      o.connect(g); o2.connect(g); g.connect(master);
      o.start(t); o2.start(t); o.stop(t+0.65); o2.stop(t+0.65);
      o.onended = reap(o, o2, g);
    }

    function worldHit(r){
      if (r === 0){
        const a = Math.random()*Math.PI*2, rr = 10 + Math.random()*50;
        addRipple(camera.position.x + Math.cos(a)*rr, camera.position.z + Math.sin(a)*rr, 3.5);
      } else if (r === 1){
        snarePulse = 1;
        flash(cur.mark.getStyle(), 0.18);
      } else if (r === 2){
        hatFlick = 1;
      } else {
        for (let i=0;i<5;i++){
          const m = bGroup.children[(Math.random()*bGroup.children.length)|0];
          m.userData.pulse = 1;
        }
      }
    }

    /* fixed look: shadows + wire edges everywhere, then dithered */
    renderer.shadowMap.enabled = true;
    sun.castShadow = true;
    ground.receiveShadow = true;
    const wireMat = new THREE.LineBasicMaterial({color:0x081005, transparent:true, opacity:0.55});
    bGroup.children.forEach(o=>{
      o.castShadow = true; o.receiveShadow = true;
      o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 10), wireMat));
    });
    meats.forEach(o=>{
      o.castShadow = true; o.receiveShadow = true;
      o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 14), wireMat));
    });
    birds.forEach(b=>{ b.castShadow = true; });
    walkers.forEach(w=>{ w.castShadow = true; });
    targets.forEach(t=>{ t.castShadow = true; });

    /* dither post pass */
    const postCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(dbSize.x, dbSize.y);
    rt.texture.minFilter = THREE.NearestFilter;
    rt.texture.magFilter = THREE.NearestFilter;
    rt.depthTexture = new THREE.DepthTexture(dbSize.x, dbSize.y);
    const postMat = new THREE.ShaderMaterial({
      depthTest:false, depthWrite:false,
      uniforms:{ tDiffuse:{value:rt.texture}, tDepth:{value:rt.depthTexture},
        res:{value:new THREE.Vector2(dbSize.x, dbSize.y)}, xr:{value:0}, camY:{value:0},
        dk:{value:1}, bl:{value:0}, inv:{value:0}, noir:{value:0},
        /* V, the broken feed: amount, clock, which warp, which tone curve, seed */
        sz:{value:0}, szT:{value:0}, szL:{value:0}, szC:{value:0}, szS:{value:0} },
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader:`
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 res;
        uniform float xr; uniform float camY; uniform float dk; uniform float bl; uniform float inv; uniform float noir;
        uniform float sz; uniform float szT; uniform float szL; uniform float szC; uniform float szS;
        varying vec2 vUv;
        float bayer2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }
        float luma(vec3 v){ return dot(v, vec3(0.299, 0.587, 0.114)); }
        /* colour contrast: push saturation, then steepen around mid grey */
        vec3 grade(vec3 v){
          v = mix(vec3(luma(v)), v, 1.3);
          return clamp((v - 0.5)*1.35 + 0.5, 0.0, 1.0);
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float linZ(float z){
          float n = 0.1; float f = 2000.0;
          float zn = z*2.0 - 1.0;
          return (2.0*n*f)/(f + n - zn*(f - n));
        }
        /* the broken feed: one of five ways of mis-reading the frame, re-rolled
           on every cut, with the odd row slipping sideways underneath */
        vec2 szWarp(vec2 v){
          float rowH = 10.0 + 70.0*hash(vec2(szS, 1.0));
          float row = floor(v.y*res.y/rowH);
          float tear = step(0.95, hash(vec2(row, floor(szT*8.0) + szS*91.0)));
          v.x += tear*(hash(vec2(row, szS)) - 0.5)*0.12;
          if (szL < 0.5){
          } else if (szL < 1.5){
            v.x = 0.5 - abs(v.x - 0.5);                               // mirrored down the middle
          } else if (szL < 2.5){
            v = fract(v*(2.0 + floor(hash(vec2(szS, 3.0))*2.0)));     // a wall of monitors
          } else if (szL < 3.5){
            v.x += (vnoise(vec2(v.y*(6.0 + 20.0*szS), szT*2.0)) - 0.5)*0.12;   // slit scan
          } else {
            v.y = fract(v.y + szT*(hash(vec2(szS, 9.0)) - 0.5)*1.2);  // lost vertical hold
          }
          return abs(fract(v*0.5 + 0.5)*2.0 - 1.0);
        }
        void main(){
          vec2 wv = sz > 0.5 ? szWarp(vUv) : vUv;
          vec2 uv = (floor(wv*res/2.0)*2.0 + 1.0)/res;
          vec3 c = texture2D(tDiffuse, uv).rgb;
          if (xr > 0.002){
            float zc = linZ(texture2D(tDepth, uv).x);
            /* looking straight down, world height ~ camera height minus depth */
            float hgt = camY - zc;
            float hn = clamp((hgt + 14.0)/80.0, 0.0, 1.0);
            vec3 xc = vec3(pow(hn, 1.3));
            /* white-hot contacts: very bright pixels burn through, sky masked out */
            float lum = dot(c, vec3(0.299, 0.587, 0.114));
            float hot = smoothstep(0.80, 0.93, lum) * (1.0 - step(600.0, zc));
            xc = mix(xc, vec3(1.0), hot);
            c = mix(c, xc, xr);
          }
          c = mix(grade(c), c, xr);
          vec2 p = gl_FragCoord.xy/2.0;
          float d = bayer2(0.5*p)*0.25 + bayer2(p);
          d = d*0.8 - 0.5;
          float levels = 5.0;
          vec3 q = clamp(floor(c*levels + d + 0.5)/levels, 0.0, 1.0);
          /* dither fades out as the x-ray fades in */
          c = mix(q, c, xr);
          /* ink bleed, the print way: blur the scene's darks, then threshold the
             blur back to a hard edge — corners round off, shapes that sit close
             pool together, and the rim follows the paper grain. Skipped under
             the broken feed, whose threshold would flatten it anyway */
          if (sz < 0.5){
            vec2 ipx = vec2(1.0)/res;
            vec2 ip = floor(gl_FragCoord.xy/2.0);
            vec3 c0 = texture2D(tDiffuse, uv).rgb;
            float l0 = luma(c0);
            float sum = l0, wsum = 1.0, lo = l0, hi = l0;
            vec3 cLo = c0, cHi = c0;
            for (int i=1;i<=16;i++){
              float fi = float(i);
              float a = fi*2.39996;
              float w = 1.0 - 0.5*fi/16.0;
              vec3 t = texture2D(tDiffuse, uv + vec2(cos(a), sin(a))*sqrt(fi/16.0)*3.0*ipx).rgb;
              float lt = luma(t);
              sum += lt*w; wsum += w;
              if (lt < lo){ lo = lt; cLo = t; }
              if (lt > hi){ hi = lt; cHi = t; }
            }
            /* the threshold is local — halfway between the darkest and lightest
               neighbour — so only edges move and every surface keeps its own tone */
            float rng = hi - lo;
            float mid = lo + 0.58*rng;
            float fib = vnoise(ip/5.0)*0.6 + vnoise(ip/17.0)*0.4;
            float grit = hash(ip);
            float soft = sum/wsum + ((fib - 0.5)*0.16 + (grit - 0.5)*0.06)*rng;
            float inkS = step(soft, mid), inkO = step(l0, mid);
            vec3 moved = grade(inkS > 0.5 ? cLo : cHi);
            moved = clamp(floor(moved*levels + d + 0.5)/levels, 0.0, 1.0);
            /* the x-ray height map stays clean black and white; only strong
               edges bleed, so thin shapes like grass keep their outline */
            float gate = smoothstep(0.18, 0.40, rng) * abs(inkS - inkO) * (1.0 - xr);
            c = mix(c, moved, gate);
            c += (grit - 0.5)*0.04;
          }
          /* bloom: bright pixels spill outward — a little always, a lot while the strobe rig runs */
          if (bl > 0.002){
            vec2 px = vec2(1.0)/res;
            vec3 acc = vec3(0.0);
            acc += max(texture2D(tDiffuse, uv + vec2( 6.0, 0.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2(-6.0, 0.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2(0.0,  6.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2(0.0, -6.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2( 11.0, 11.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2(-11.0, 11.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2( 11.0,-11.0)*px).rgb - vec3(0.55), 0.0);
            acc += max(texture2D(tDiffuse, uv + vec2(-11.0,-11.0)*px).rgb - vec3(0.55), 0.0);
            /* top-down height map stays strictly black and white: desaturate the
               strobe bloom by the same xr factor that turned the scene grayscale */
            vec3 accBW = vec3(dot(acc, vec3(0.299, 0.587, 0.114)));
            acc = mix(acc, accBW, xr);
            c += acc * bl * 0.3;
          }
          if (sz > 0.002){
            /* all colour is thrown away: the feed is black and white, and the
               dither underneath turns the mid tones into a clean halftone */
            float l = luma(c), k;
            if (szC < 0.5) k = step(0.5, l);                                // pure black and white
            else if (szC < 1.5) k = clamp((l - 0.5)*2.2 + 0.5, 0.0, 1.0);   // hard greys
            else if (szC < 2.5) k = 1.0 - step(0.5, l);                     // negative
            else k = floor(l*3.0 + 0.5)/3.0;                                // four flat tones
            c = mix(c, vec3(k), sz);
          }
          if (noir > 0.002){
            /* rain turns the feed noir: colour drains, shadows crush to black,
               and the frame closes in from the corners */
            vec3 k = mix(c, vec3(luma(c)), 0.9);
            k = clamp((k - 0.5)*1.5 + 0.38, 0.0, 1.0) * 0.72;
            vec2 vq = vUv - 0.5;
            k *= 1.0 - smoothstep(0.12, 0.6, dot(vq, vq)*1.6)*0.75;
            c = mix(c, k, noir);
          }
          /* strobe invert: the darkened frame flips to its negative */
          c = clamp(c*dk, 0.0, 1.0);
          gl_FragColor = vec4(mix(c, 1.0 - c, inv), 1.0);
        }`
    });
    const postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), postMat));

    /* second camera for the mode-3 control room: the drone feed panel */
    const orbCam = new THREE.PerspectiveCamera(78, 1, 0.1, 2000);
    orbCam.rotation.order = 'YXZ';

    /* sequencer clock */
    /* worldMode = the drum-machine PANEL, opened only by M.
       autopilot = the underlying "sequencer drives terrain + gun" logic —
       worldMode always drives it, but mode3's tasking console also needs it
       running with the panel kept off-screen, hence the separate flag. */
    let worldMode = false, autopilot = false, autopilotForcedByMode3 = false;
    let step = 0, nextStep = 0;
    function stopAutopilotVisuals(){
      cellEls.forEach(row=>row.forEach(c=>c.classList.remove('play')));
    }
    function highlight(s){
      for (let r=0;r<4;r++) for (let c=0;c<STEPS;c++){
        cellEls[r][c].classList.toggle('play', c===s);
        sheetCellEls[r][c].classList.toggle('play', c===s);
      }
      for (let c=0;c<STEPS;c++){
        melEls[c].classList.toggle('hit', c===s && !!melPattern[c]);
        sheetMelEls[c].classList.toggle('play', c===s);
      }
      sheetColHeaders.forEach((th, c)=>th.classList.toggle('play', c===s));
      seqPh.setAttribute('transform', 'rotate(' + ((s+0.5)*22.5) + ')');
    }
    function setWorldMode(v){
      worldMode = v;
      autopilot = v || autopilotForcedByMode3;
      seqEl.classList.toggle('on', v);
      if (v){
        initAudio();
        if (actx.state === 'suspended') actx.resume();
        relockOnClose = document.pointerLockElement === cvs;
        if (relockOnClose) document.exitPointerLock();
        step = 0; nextStep = actx.currentTime + 0.1;
        modeEl.textContent = 'autopilot engaged, M to close';
      } else {
        if (!autopilot) stopAutopilotVisuals();
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
        /* closing hands the mouse back: if M took it from a held look, take it again */
        if (relockOnClose && !orbital && !fleetMode && !mode3 && !destroyMode && cvs.requestPointerLock){
          try {
            const p = cvs.requestPointerLock();
            if (p && p.catch) p.catch(()=>{});
          } catch(err){}
        }
        relockOnClose = false;
      }
    }
    let relockOnClose = false;
    /* orbital cannon mode */
    let orbital = false;
    const xrayMats = [...bldgMats, ...meatMats, birdMat, groundLambert];
    function setOrbital(v){
      orbital = v;
      scoped = false;
      xrayMats.forEach(mm=>{
        mm.transparent = v;
        mm.opacity = v ? (mm === groundLambert ? 0.5 : 0.3) : 1;
        mm.needsUpdate = true;
      });
      wireMat.visible = !v;
      grid.visible = !v;
      veg.visible = !v; // the feed stays bare ground and structures
      el.drone.classList.toggle('on', v);
      el.hud.classList.toggle('ro', v);
      targets.forEach(t=>{ t.material.color.set(v ? 0xffffff : cur.mark.getHex()); });
      if (v){
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        modeEl.textContent = 'orbital cannon, click to strike, 2 to descend';
      } else {
        camera.position.y = terrain(camera.position.x, camera.position.z) + 3.2;
        vel.set(0, 0, 0);
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
    }

    /* mode 4: the tasking console — every element is one of Bandura's mechanisms,
       and the console itself is the score: approvals quantize to an office tempo */
    let mode3 = false, resolvedCount = 0, toastT = 0;
    let m3Auto = false, m3Melody = 0, m3NextBeat = 0;
    const M3_BT = 60/72; // 72 BPM office clock
    const m3Queue = [];
    const m3El = $('#m3'), m3List = $('#m3list'), m3Open = $('#m3open'),
      m3Goal = $('#m3goal'), m3Toast = $('#m3toast'), m3AutoEl = $('#m3auto');
    on(m3AutoEl, 'change', e=>{ m3Auto = e.target.checked; });

    /* dry, close-mic'd UI instrument — tuned to the same scale as the war */
    function uiDing(n){
      if (!actx) return;
      const t = actx.currentTime;
      const f = 660 * Math.pow(2, SCALE[n % SCALE.length]/12);
      [[f, 0.22], [f*2, 0.07]].forEach(([ff, g0])=>{
        const o = actx.createOscillator(); o.type='sine'; o.frequency.value = ff;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(g0, t+0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t+0.5);
        o.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.55);
        o.onended = reap(o, g);
      });
    }
    function uiTick(i){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type='triangle'; o.frequency.value = 1500 + i*180;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.055, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
      o.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.06);
      o.onended = reap(o, g);
    }
    function uiMotif(){
      if (!actx) return;
      const t = actx.currentTime;
      if (playSample('fx', t, 0.3)) return;
      [[880, 0], [1108.7, 0.13]].forEach(([f, d])=>{
        const o = actx.createOscillator(); o.type='sine'; o.frequency.value = f;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t+d);
        g.gain.exponentialRampToValueAtTime(0.12, t+d+0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t+d+0.35);
        o.connect(g); g.connect(uiBus); o.start(t+d); o.stop(t+d+0.4);
        o.onended = reap(o, g);
      });
    }
    function uiShuffle(){
      if (!actx || !noiseBuf) return;
      const t = actx.currentTime;
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 1.6;
      const f = actx.createBiquadFilter(); f.type='highpass'; f.frequency.value = 3000;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
      n.connect(f); f.connect(g); g.connect(uiBus); n.start(t); n.stop(t+0.2);
      n.onended = reap(n, f, g);
    }
    const SECTORS = ['NE','NW','SE','SW','N','S','E','W'];
    const PRAISE = ['Nice pace!','Queue is looking clean.','Great work today.',
      "You're on a roll.",'Inbox zero energy.'];
    function m3ToastShow(msg){
      m3Toast.textContent = msg;
      m3Toast.classList.add('show');
      uiMotif();
      clearTimeout(toastT);
      toastT = setTimeout(()=>m3Toast.classList.remove('show'), 1800);
    }
    function strikeEntity(ent, onArrive){
      const from = ent.position.clone();
      from.x += (Math.random()-0.5)*40;
      from.z += (Math.random()-0.5)*40;
      from.y = 120;
      const m = new THREE.Mesh(missileGeo, missileMat);
      m.position.copy(from);
      scene.add(m);
      const dur = 1100;
      missiles.push({m, from, to:ent.position.clone(), ent, onArrive, t0:performance.now(), dur});
      return dur;
    }
    function m3Refresh(){
      m3List.replaceChildren();
      uiShuffle();
      const pool = [...targets, ...birds, ...walkers].filter(t=>t.userData.alive).slice(0, 6);
      pool.forEach((ent, idx)=>{
        const row = document.createElement('div'); row.className = 'm3-row';
        const id = 'TCK-' + (1000 + ((Math.random()*9000)|0));
        const conf = 94 + ((Math.random()*6)|0);
        /* tasks read as obscure shooter chores; the feed column names which
           quadrant (FPS operator view / topdown drone view) will show it land */
        const M3_TASKS = ent.userData.kind === 'bird' ? [
          'Declutter airspace layer', 'Archive transient signal',
          'Dismiss false-positive flyer', 'Close loitering track'
        ] : ent.userData.kind === 'walker' ? [
          'Flatten ground clutter', 'Merge duplicate footprint',
          'Clear pedestrian artifact', 'Resolve stray heading'
        ] : [
          'Recycle octahedron marker', 'Rebalance beacon geometry',
          'Reset lane waypoint', 'Recompute sightline mesh',
          'Compact anomaly cluster', 'Renormalize sector lighting'
        ];
        const kind = M3_TASKS[(Math.random()*M3_TASKS.length)|0];
        const feed = Math.random() < 0.5 ? 'FPS feed' : 'topdown feed';
        const left = document.createElement('div');
        left.innerHTML = '<div>' + id + ' · ' + kind + '</div>' +
          '<div class="meta">Sector ' + SECTORS[(Math.random()*8)|0] +
          ' · lands on ' + feed + ' · confidence ' + conf + '% · pre-reviewed ✓</div>' +
          '<div class="bar"><i></i></div>';
        const btn = document.createElement('button');
        btn.textContent = 'Approve';
        row.addEventListener('mouseenter', ()=>uiTick(idx));
        btn.addEventListener('click', ()=>{
          if (row.classList.contains('done')) return;
          row.classList.add('done', 'queued');
          btn.textContent = 'Queued';
          // credit toward the daily goal only lands with the strike itself
          m3Queue.push({ent, row, btn});
          const open = m3List.querySelectorAll('.m3-row:not(.done)').length;
          m3Open.textContent = open + ' open items';
          if (!open) setTimeout(m3Refresh, 4000);
        });
        row.appendChild(left); row.appendChild(btn);
        m3List.appendChild(row);
      });
      m3Open.textContent = pool.length + ' open items';
      m3List.scrollTop = 0; // fresh batch starts back at the top
    }
    function setMode3(v){
      mode3 = v;
      m3El.classList.toggle('on', v);
      if (v){
        initAudio();
        if (actx.state === 'suspended') actx.resume();
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        m3NextBeat = actx.currentTime + M3_BT;
        m3Refresh();
        // the operation runs behind the console — force the autopilot logic
        // on, but never the M-only drum-machine panel itself
        if (!autopilot){ autopilot = true; autopilotForcedByMode3 = true; step = 0; nextStep = actx.currentTime + 0.1; }
        el.hud.classList.add('mini');
        el.drone.classList.add('on', 'mini');
        /* the simulator runs in its quadrant: its voices, not its room hum */
        fleetAudioInit();
        fleetEl.classList.add('on', 'mini');
        fleetHands = 0; fleetAutoT = 2;
        modeEl.textContent = 'tasking console, 4 to close';
      } else {
        fleetEl.classList.remove('on', 'mini');
        fBoxing = false; fOrbiting = false; fHover = false; fleetBox.style.display = 'none';
        if (autopilotForcedByMode3 && !worldMode){
          autopilot = false; autopilotForcedByMode3 = false; stopAutopilotVisuals();
        }
        el.hud.classList.remove('mini');
        el.drone.classList.remove('mini');
        el.drone.classList.toggle('on', orbital);
        camera.aspect = viewW/viewH;
        camera.updateProjectionMatrix();
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
      // the world gets quiet and far away in here
      applyShelf();
    }
    /* one owner for the master muffle: the console and the command
       simulation close it down, the destroyer overlay always plays it open */
    function applyShelf(){
      if (!actx || !shelf) return;
      const t = actx.currentTime;
      const target = destroyMode ? 5200 : mode3 ? 700 : fleetMode ? 1600 : 5200;
      shelf.frequency.cancelScheduledValues(t);
      shelf.frequency.setTargetAtTime(target, t, 0.25);
    }


    /* ------------------------------------------------- mode 3: the command simulation
       Ender at the simulator on Eros: a dark room, a hologram of the fleet, the
       swarm around its homeworld, and the Device. An RTS over a holo-plane —
       drag to select, right-click to order, F fires the Little Doctor and the
       chain reaction walks the swarm. Every order, shot and loss is a voice;
       the drum machine (M) breathes through the stars and the grid. */
    let fleetMode = false;
    const fleetEl = $('#fleet'), fleetBox = $('#fleetBox'), fleetLog = $('#fleetLog'),
      fleetCountEl = $('#fleetCount'), fleetSwarmEl = $('#fleetSwarm'), fleetSelEl = $('#fleetSel'),
      fleetBanner = $('#fleetBanner'), fleetDevEl = $('#fleetDev');
    const fleetOv = $('#fleetOv'), fleetOvCtx = fleetOv.getContext('2d'), fleetAimEl = $('#fleetAim'),
      fleetFormEl = $('#fleetForm'), fleetClockEl = $('#fleetClock'), fleetRaidEl = $('#fleetRaid'),
      fleetRaidTxt = $('#fleetRaidTxt'), fleetRosterEl = $('#fleetRoster'), fleetDebrief = $('#fleetDebrief'),
      fleetPauseEl = $('#fleetPause');
    const fScene = new THREE.Scene();
    const fCam = new THREE.PerspectiveCamera(48, viewW/viewH, 1, 5000);
    const fOrbit = {yaw:0.55, pitch:0.95, dist:620, tyaw:0.55, tpitch:0.95, tdist:620,
      center:new THREE.Vector3(0, 0, 0), tcenter:new THREE.Vector3(0, 0, 0)};
    /* the simulator fills the window as mode 3, and the top-right quadrant of
       the mode-4 console: everything on screen is measured in this box */
    const fW = () => mode3 ? viewW/2 : viewW, fH = () => mode3 ? viewH/2 : viewH;
    const fX = e => lx(e) - (mode3 ? viewW/2 : 0);
    const fleetTagA = $('#fleetTagA'), fleetTagB = $('#fleetTagB'), fleetDevTxt = $('#fleetDevTxt');
    /* a printed chart, not a dark room: paper, one ink, and three spot colours —
       cobalt is yours, vermilion is theirs, violet is the Device */
    const F_PAPER = 0xe6e1d1, F_INK = 0x14161f, F_BLUE = 0x1c3cff, F_ALARM = 0xf0341c,
      F_DEV = 0x7a1cff, F_GRID = 0xaaa593;
    const OV = {paper:'#e6e1d1', ink:'#14161f', blue:'#1c3cff', red:'#f0341c', dev:'#7a1cff'};
    const HOLO_R = 320;

    /* dust: a sphere of ink specks far outside the table */
    {
      const N = 520, pos = new Float32Array(N*3);
      for (let i=0;i<N;i++){
        const u = Math.random()*2-1, a = Math.random()*Math.PI*2, r = 2600 + Math.random()*800;
        const s = Math.sqrt(1-u*u);
        pos[i*3] = Math.cos(a)*s*r; pos[i*3+1] = u*r; pos[i*3+2] = Math.sin(a)*s*r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      fScene.add(new THREE.Points(g, new THREE.PointsMaterial({color:F_INK, size:1, sizeAttenuation:false, transparent:true, opacity:0.4})));
    }
    const fStars = fScene.children[0];
    /* the table: a disc that shades toward its rim, so the dither has a
       gradient to chew on and the edge of the simulation reads as an edge */
    const fTable = new THREE.Mesh(new THREE.CircleGeometry(HOLO_R*1.42, 72).rotateX(-Math.PI/2),
      new THREE.ShaderMaterial({
        depthWrite:false,
        uniforms:{paper:{value:new THREE.Color(F_PAPER)}, pulse:{value:0}},
        vertexShader:`varying vec2 vU; void main(){ vU = uv;
          gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:`uniform vec3 paper; uniform float pulse; varying vec2 vU;
          void main(){
            float r = length(vU - 0.5)*2.0;
            float sh = 0.2*smoothstep(0.4, 1.0, r) + pulse*0.07*smoothstep(0.1, 1.0, r);
            gl_FragColor = vec4(paper*(1.0 - sh), 1.0);
          }`
      }));
    fTable.position.y = -0.5; fTable.renderOrder = -2;
    fScene.add(fTable);
    /* the holo-plane: the simulator's grid, drawn as line segments on y=0 */
    const fGridMat = new THREE.LineBasicMaterial({color:F_GRID, transparent:true, opacity:0.7});
    {
      const pts = [];
      for (let i=-HOLO_R;i<=HOLO_R;i+=32){
        pts.push(-HOLO_R,0,i, HOLO_R,0,i, i,0,-HOLO_R, i,0,HOLO_R);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      fScene.add(new THREE.LineSegments(g, fGridMat));
      /* a thin rim: the edge of what the simulator can show */
      const rim = [];
      for (let i=0;i<=96;i++){ const a = i/96*Math.PI*2; rim.push(Math.cos(a)*HOLO_R*1.42, 0, Math.sin(a)*HOLO_R*1.42); }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      fScene.add(new THREE.Line(rg, new THREE.LineBasicMaterial({color:F_INK})));
    }
    /* the homeworld, where the swarm nests: a lit ball, so it dithers round */
    const fPlanet = new THREE.Mesh(new THREE.IcosahedronGeometry(40, 3),
      new THREE.MeshLambertMaterial({color:F_ALARM}));
    fPlanet.position.set(0, 0, -190);
    fScene.add(fPlanet);
    const fPlanetShell = new THREE.Mesh(new THREE.IcosahedronGeometry(47, 1),
      new THREE.MeshBasicMaterial({color:F_INK, wireframe:true, transparent:true, opacity:0.55}));
    fPlanet.add(fPlanetShell);
    fScene.add(new THREE.AmbientLight(0xffffff, 0.3*Math.PI));
    const fSun = new THREE.DirectionalLight(0xffffff, 0.9*Math.PI);
    fSun.position.set(-260, 320, 180);
    fScene.add(fSun);

    const F_DRONES = 150;
    /* three hulls, three silhouettes: darts that fight, wedges that hit hard
       from range, and the flat carriers that hold the Device */
    const F_CLASS = {
      fighter:{name:'FIGHTER', n:16, hp:3, spd:44, rng:62, stand:40, rof:0.8, hit:0.42, rad:6, sep:11,
        geo:new THREE.ConeGeometry(3.6, 12, 4).rotateX(Math.PI/2).scale(1, 0.5, 1)},
      cruiser:{name:'CRUISER', n:6, hp:8, spd:25, rng:105, stand:78, rof:1.4, hit:0.75, rad:11, sep:16,
        geo:new THREE.CylinderGeometry(1.6, 5.6, 22, 4).rotateX(Math.PI/2).scale(1, 0.55, 1)},
      carrier:{name:'CARRIER', n:2, hp:12, spd:19, rng:0, stand:112, rof:0, hit:0, rad:13, sep:24,
        geo:mergeGeometries([new THREE.CylinderGeometry(10, 10, 3, 6), new THREE.BoxGeometry(3.5, 5, 26)])}
    };
    const F_CLASS_KEY = {KeyQ:'fighter', KeyE:'cruiser', KeyR:'carrier'};
    const shipMat = new THREE.MeshBasicMaterial({color:F_INK});
    const shipHurtMat = new THREE.MeshBasicMaterial({color:F_ALARM});
    const devCoreGeo = new THREE.OctahedronGeometry(3.4, 0);
    const devCoreMat = new THREE.MeshBasicMaterial({color:F_DEV});
    const droneGeo = new THREE.OctahedronGeometry(3, 0);
    const raidGeo = new THREE.TetrahedronGeometry(5.5, 0);
    const droneMat = new THREE.MeshBasicMaterial({color:F_ALARM});
    const droneHotMat = new THREE.MeshBasicMaterial({color:F_INK});
    const droneDoomMat = new THREE.MeshBasicMaterial({color:F_DEV});
    const fShips = [], fDrones = [];
    for (const cls in F_CLASS){
      const k = F_CLASS[cls];
      for (let i=0;i<k.n;i++){
        const m = new THREE.Mesh(k.geo, shipMat);
        m.userData = {alive:true, hp:k.hp, sel:false, goal:null, hunt:null, engage:false, queue:[],
          cool:Math.random(), hurt:0, idx:fShips.length, slot:i, cls, k, core:null};
        if (cls === 'carrier'){
          const core = new THREE.Mesh(devCoreGeo, devCoreMat);
          core.position.y = 7; m.add(core); m.userData.core = core;
        }
        fScene.add(m); fShips.push(m);
      }
    }
    const F_SHIPS = fShips.length;
    for (let i=0;i<F_DRONES;i++){
      const m = new THREE.Mesh(droneGeo, droneMat);
      m.userData = {alive:true, cool:Math.random()*2, hot:0, orbit:0, ang:0, lift:0, spd:0, doomed:false, raid:false, home:null};
      fScene.add(m); fDrones.push(m);
    }
    /* lasers and detonation shells: pooled, released = hidden, never disposed */
    const laserPool = [];
    for (let i=0;i<64;i++){
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const L = new THREE.Line(g, new THREE.LineBasicMaterial({color:F_BLUE, transparent:true, opacity:1}));
      L.visible = false; L.userData = {t0:0, life:0.14, busy:false};
      fScene.add(L); laserPool.push(L);
    }
    const shellGeo = new THREE.IcosahedronGeometry(1, 1);
    const shellPool = [];
    for (let i=0;i<96;i++){
      const m = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({color:F_DEV, wireframe:true, transparent:true, opacity:1}));
      m.visible = false; m.userData = {t0:0, life:0.45, r:40, busy:false};
      fScene.add(m); shellPool.push(m);
    }
    function fLaser(a, b, color){
      const L = laserPool.find(x=>!x.userData.busy) || laserPool[0];
      const p = L.geometry.attributes.position.array;
      p[0]=a.x; p[1]=a.y; p[2]=a.z; p[3]=b.x; p[4]=b.y; p[5]=b.z;
      L.geometry.attributes.position.needsUpdate = true;
      L.material.color.set(color); L.material.opacity = 1;
      L.visible = true; L.userData.busy = true; L.userData.t0 = performance.now();
    }
    function fShell(pos, r, color, life){
      const m = shellPool.find(x=>!x.userData.busy) || shellPool[0];
      m.position.copy(pos); m.scale.setScalar(1);
      m.material.color.set(color); m.material.opacity = 1;
      m.visible = true; m.userData.busy = true; m.userData.t0 = performance.now();
      m.userData.r = r; m.userData.life = life || 0.45;
    }

    /* ---- the simulator's own print pipeline ----
       the scene is drawn small (one texel per F_PX stage pixels, so every line
       is one fat pixel wide) and blown up by a pass that prints it: ink creeps
       out along the paper's fibre, every inked shape throws a soft aura and a
       drop shadow, the spot colours glow, and the lot is screened down to four
       steps between ink and paper — at stage resolution, so the fat pixels
       carry a fine grain instead of a fat one */
    const F_PX = 3;
    const frt = new THREE.WebGLRenderTarget(4, 4);
    /* linear, so the soft terms (bleed, aura, shadow) read between texels;
       the drawing itself is still fetched dead on texel centres and stays hard */
    frt.texture.minFilter = THREE.LinearFilter;
    frt.texture.magFilter = THREE.LinearFilter;
    const fleetPostMat = new THREE.ShaderMaterial({
      depthTest:false, depthWrite:false,
      uniforms:{ tLow:{value:frt.texture}, low:{value:new THREE.Vector2(4, 4)},
        paper:{value:new THREE.Color(F_PAPER)}, ink:{value:new THREE.Color(F_INK)},
        bk:{value:1}, fl:{value:0}, chg:{value:0} },
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader:`
        uniform sampler2D tLow; uniform vec2 low; uniform vec3 paper; uniform vec3 ink;
        uniform float bk; uniform float fl; uniform float chg;
        varying vec2 vUv;
        float bayer2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }
        float luma(vec3 v){ return dot(v, vec3(0.299, 0.587, 0.114)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        /* how much black ink a sample holds: dark and unsaturated. The spot
           colours are light, not ink — they glow instead of casting */
        float inkAt(vec3 t){
          float sat = max(t.r, max(t.g, t.b)) - min(t.r, min(t.g, t.b));
          return smoothstep(0.3, 0.7, 1.0 - luma(t)/luma(paper) - sat*0.8);
        }
        void main(){
          vec2 tx = 1.0/low;
          vec2 fp = vUv*low;
          vec2 cell = floor(fp);
          vec2 uv = (cell + 0.5)*tx;
          vec2 px = floor(gl_FragCoord.xy);
          vec3 c = texture2D(tLow, uv).rgb;
          /* the Device charging pulls the plates out of register */
          if (chg > 0.01){
            vec2 o = vec2(chg*1.6, 0.0)*tx;
            c.r = texture2D(tLow, uv + o).r;
            c.b = texture2D(tLow, uv - o).b;
          }
          float pl = luma(paper), jit = hash(px)*6.2832;
          /* the paper's fibre: long strands at texel scale, tooth at stage scale */
          float fib = vnoise(fp/3.0)*0.45 + vnoise(fp/11.0 + 7.3)*0.3 + vnoise(px/2.3 + 3.7)*0.25;
          /* ink follows the fibre, so everything soft is read through a lens the fibre bends */
          vec2 wuv = vUv + (vec2(vnoise(fp*1.7 + 3.1), vnoise(fp*1.7 + 9.7)) - 0.5)*2.0*tx;
          /* ink bleed: a point beside something darker takes it on — a lot at
             the edge, a feathered wash further out, most where the fibre is
             open — never the other way round */
          vec3 dark = c, soak = c;
          for (int i=0;i<12;i++){
            bool outer = i >= 6;
            float a = float(i)*1.0471976 + (outer ? 0.5236 : 0.0);
            vec3 t = texture2D(tLow, wuv + vec2(cos(a), sin(a))*(outer ? 2.8 : 1.3)*tx).rgb;
            dark = min(dark, mix(c, t, outer ? 0.6 : 1.0)); soak += t;
          }
          soak /= 13.0;
          float wet = smoothstep(0.05, 0.42, luma(c) - luma(dark))*(0.2 + 0.8*fib);
          c = mix(c, min(c, mix(soak, dark, 0.6)), clamp(wet, 0.0, 1.0));
          /* drop shadow: the ink above and to the left, blurred, falls on the paper here */
          float sh = 0.0;
          vec2 so = vec2(-2.4, 3.0)*tx;
          for (int i=0;i<9;i++){
            float fi = float(i);
            float a = fi*2.39996 + jit;
            float r = sqrt((fi + 0.5)/9.0)*3.4;
            sh += inkAt(texture2D(tLow, wuv + so + vec2(cos(a), sin(a))*r*tx).rgb);
          }
          sh /= 9.0;
          /* bloom: saturated colour spills a tinted halo onto the paper, and
             anything brighter than the paper burns through to white. The same
             taps weigh the ink around this point: its aura */
          vec3 gc = vec3(0.0); float hot = 0.0, au = 0.0;
          for (int i=0;i<18;i++){
            float fi = float(i);
            float a = fi*2.39996 + jit;
            float r = sqrt((fi + 0.5)/18.0)*9.0;
            vec3 t = texture2D(tLow, wuv + vec2(cos(a), sin(a))*r*tx).rgb;
            float sat = max(t.r, max(t.g, t.b)) - min(t.r, min(t.g, t.b));
            gc += t*sat*sat;
            hot += max(luma(t) - pl - 0.02, 0.0);
            au += inkAt(t);
          }
          gc /= 18.0; hot /= 18.0; au /= 18.0;
          /* aura and shadow are ink too: they stain the paper, heavier where it drinks */
          float pap = smoothstep(0.25, 0.7, luma(c)/pl);
          float stain = (sh*0.7 + au*0.45)*(0.5 + fib);
          c = mix(c, mix(ink, c, 0.2), clamp(stain, 0.0, 0.8)*pap);
          float gl = max(gc.r, max(gc.g, gc.b));
          vec3 tint = mix(gc/max(gl, 0.0001), vec3(1.0), 0.3);
          c = mix(c, tint, clamp(gl*bk*3.2, 0.0, 0.75)*smoothstep(0.2, 0.62, luma(c)));
          c += hot*bk*6.5;
          /* the sheet darkens toward its corners */
          c *= 1.0 - 0.13*smoothstep(0.46, 0.8, length(vUv - 0.5));
          /* the screen, one stage pixel to the dot and roughened so it reads
             as grain; measured against the paper so bare paper stays clean */
          vec3 v = c/paper;
          float h = max(min(v.r, min(v.g, v.b)) - 1.0, 0.0);
          v = min(v, vec3(1.0));
          float d = mix(bayer2(0.5*px)*0.25 + bayer2(px), hash(px + 17.0), 0.3) - 0.47;
          vec3 q = clamp(floor(v*3.0 + d + 0.5)/3.0, 0.0, 1.0);
          vec3 o = mix(ink, paper, q);
          o = mix(o, vec3(1.0), step(0.5, h*6.0 + d));
          /* a detonation prints the sheet in negative, dissolving back by the same screen */
          if (fl > 0.0 && d + 0.47 < fl) o = paper + ink - o;
          /* paper tooth */
          o *= 1.0 - 0.05*(fib - 0.5) - 0.035*(hash(gl_FragCoord.xy) - 0.5);
          gl_FragColor = vec4(o, 1.0);
        }`
    });
    const fleetPostScene = new THREE.Scene();
    fleetPostScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), fleetPostMat));
    /* the overlay canvas shares the texel grid: brackets, order lines, reach
       rings and the minimap are plotted pixel by pixel on top of the print */
    let ovW = 4, ovH = 4;
    function fleetResize(){
      ovW = Math.max(4, Math.round(viewW/F_PX)); ovH = Math.max(4, Math.round(viewH/F_PX));
      frt.setSize(ovW, ovH);
      fleetPostMat.uniforms.low.value.set(ovW, ovH);
      fleetOv.width = ovW; fleetOv.height = ovH;
    }
    function fleetRender(){
      renderer.setRenderTarget(frt);
      renderer.setClearColor(F_PAPER);
      renderer.clear();
      renderer.render(fScene, fCam);
      renderer.setRenderTarget(null);
      renderer.setClearColor(cur.fog);
    }

    /* ---- the simulator's voice: everything goes through fleetBus into master ---- */
    let fleetBus = null, fleetHum = null, fleetHumNodes = [];
    function fleetAudioInit(){
      ensureAudio();
      if (fleetBus) return;
      fleetBus = actx.createGain(); fleetBus.gain.value = 0.9;
      fleetBus.connect(master);
    }
    function fleetHumStart(){
      if (fleetHum) return;
      const t = actx.currentTime;
      fleetHum = actx.createGain(); fleetHum.gain.setValueAtTime(0.0001, t);
      fleetHum.gain.exponentialRampToValueAtTime(0.09, t+2.5);
      fleetHum.connect(fleetBus);
      [[48, 'sine', 0.8], [72.2, 'sine', 0.35], [96.5, 'triangle', 0.12]].forEach(([f, type, g])=>{
        const o = actx.createOscillator(); o.type = type; o.frequency.value = f;
        const og = actx.createGain(); og.gain.value = g;
        o.connect(og); og.connect(fleetHum); o.start(t);
        fleetHumNodes.push(o, og);
      });
      /* the room's air: slow-breathing filtered noise */
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5;
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = actx.createGain(); lg.gain.value = 500;
      lfo.connect(lg); lg.connect(bp.frequency);
      const ng = actx.createGain(); ng.gain.value = 0.22;
      n.connect(bp); bp.connect(ng); ng.connect(fleetHum); n.start(t); lfo.start(t);
      fleetHumNodes.push(n, bp, lfo, lg, ng);
    }
    function fleetHumStop(){
      if (!fleetHum) return;
      const t = actx.currentTime, hum = fleetHum, nodes = fleetHumNodes;
      hum.gain.cancelScheduledValues(t);
      hum.gain.setValueAtTime(Math.max(0.0001, hum.gain.value), t);
      hum.gain.exponentialRampToValueAtTime(0.0001, t+1.2);
      setTimeout(()=>{ nodes.forEach(nd=>{ try{ nd.stop && nd.stop(); }catch(e){} try{ nd.disconnect(); }catch(e){} }); hum.disconnect(); }, 1400);
      fleetHum = null; fleetHumNodes = [];
    }
    function fPan(x){
      const p = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
      if (p.pan) p.pan.value = Math.max(-1, Math.min(1, x/HOLO_R));
      p.connect(fleetBus);
      return p;
    }
    /* the simulator plays the same kit as the range: a sample voice, panned to
       where it happened on the table, through that slot's own mixer strip.
       False when the slot is still on its synth, so the caller's synth answers */
    function fKit(slot, x, vol, rate){
      if (sampleMap[slot] === -1 || !sampleLib.length) return false;
      const p = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
      if (p.pan) p.pan.value = Math.max(-1, Math.min(1, x/HOLO_R));
      p.connect(busIn(slot));
      setTimeout(reap(p), 2600); // outlives the 2s ADSR cage
      return playSample(slot, actx.currentTime, vol, {out:p, rate});
    }
    let fShotAt = 0, fHitAt = 0, fChainAt = 0; // a broadside is many guns: the kit is thinned to one voice per beat of these
    function fxSelect(n){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = 1400 + Math.min(n, 12)*60;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.03);
      o.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.04);
      o.onended = reap(o, g);
    }
    function fxOrder(x, attack){
      if (!actx) return;
      if (fKit('fx', x, 0.24, attack ? 0.8 : 1.25)) return;
      const t = actx.currentTime, p = fPan(x);
      const root = PALETTES[palIndex % PALETTES.length].root * 4;
      const f = attack ? root*1.5 : root*2;
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t+0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.35);
      o.connect(g); g.connect(p); o.start(t); o.stop(t+0.4);
      /* the acknowledgement: a lower second blip, like a console taking the order */
      const o2 = actx.createOscillator(); o2.type = attack ? 'sawtooth' : 'triangle'; o2.frequency.value = f/2;
      const g2 = actx.createGain();
      g2.gain.setValueAtTime(0.0001, t+0.09); g2.gain.exponentialRampToValueAtTime(0.14, t+0.1);
      g2.gain.exponentialRampToValueAtTime(0.0001, t+0.3);
      o2.connect(g2); g2.connect(p); o2.start(t+0.09); o2.stop(t+0.32);
      const d = actx.createDelay(); d.delayTime.value = 0.23;
      const dg = actx.createGain(); dg.gain.value = 0.3;
      g.connect(d); d.connect(dg); dg.connect(p);
      o.onended = reap(o, g, o2, g2, d, dg, p);
    }
    function fxLaser(x, friendly){
      if (!actx) return;
      /* scene 1's shot: the fleet's guns at pitch, the swarm's a few steps below */
      if (sampleMap.shot !== -1 && sampleLib.length){
        if (actx.currentTime - fShotAt < 0.05) return;
        fShotAt = actx.currentTime;
        if (fKit('shot', x, friendly ? 0.3 : 0.2, (friendly ? 1 : 0.7)*(0.88 + Math.random()*0.24))) return;
      }
      const t = actx.currentTime, p = fPan(x);
      const o = actx.createOscillator(); o.type = friendly ? 'sawtooth' : 'square';
      o.frequency.setValueAtTime(friendly ? 2400 : 900, t);
      o.frequency.exponentialRampToValueAtTime(friendly ? 320 : 140, t+0.09);
      const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 500;
      const g = actx.createGain();
      g.gain.setValueAtTime(friendly ? 0.07 : 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
      o.connect(f); f.connect(g); g.connect(p); o.start(t); o.stop(t+0.11);
      o.onended = reap(o, f, g, p);
    }
    function fxDroneDie(x, n){
      if (!actx) return;
      const t = actx.currentTime, p = fPan(x);
      const root = PALETTES[palIndex % PALETTES.length].root * 2;
      const f = root * Math.pow(2, SCALE[n % SCALE.length]/12);
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f*4, t); o.frequency.exponentialRampToValueAtTime(f, t+0.12);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t+0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.3);
      o.connect(g); g.connect(p); o.start(t); o.stop(t+0.32);
      /* the struck thing answers as it does on the range: impact, and a snare for the kill */
      const fresh = t - fHitAt > 0.04, rate = f/root*(0.94 + Math.random()*0.12);
      let hit = false;
      if (fresh){
        hit = fKit('impact', x, 0.55, rate);
        hit = fKit('snr', x, 0.3, rate) || hit;
        if (hit) fHitAt = t;
      }
      if (hit || (!fresh && sampleMap.impact !== -1)){ o.onended = reap(o, g, p); return; }
      const nz = actx.createBufferSource(); nz.buffer = noiseBuf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.09);
      nz.connect(bp); bp.connect(ng); ng.connect(p); nz.start(t); nz.stop(t+0.1);
      o.onended = reap(o, g, nz, bp, ng, p);
    }
    function fxShipLost(x){
      if (!actx) return;
      const t = actx.currentTime, p = fPan(x);
      fKit('impact', x, 0.9, 0.5);
      fKit('glitch', x, 0.4, 0.6 + Math.random()*0.3);
      const o = actx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(90, t+0.7);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.8);
      o.connect(g); g.connect(p); o.start(t); o.stop(t+0.85);
      const nz = actx.createBufferSource(); nz.buffer = noiseBuf; nz.playbackRate.value = 0.5;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.5);
      nz.connect(lp); lp.connect(ng); ng.connect(p); nz.start(t); nz.stop(t+0.55);
      o.onended = reap(o, g, nz, lp, ng, p);
    }
    function fxCharge(dur){
      if (!actx) return;
      const t = actx.currentTime;
      fKit('fx', 0, 0.4, 0.55);
      const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
      const o2 = actx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.6;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 9;
      f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(5200, t+dur);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t+dur*0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur+0.05);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(fleetBus);
      o.start(t); o2.start(t); o.stop(t+dur+0.1); o2.stop(t+dur+0.1);
      o.onended = reap(o, o2, f, g);
    }
    function fxChain(x, n){
      if (!actx) return;
      const t = actx.currentTime, p = fPan(x);
      const root = PALETTES[palIndex % PALETTES.length].root * 4;
      const f = root * Math.pow(2, (SCALE[n % SCALE.length] + 12*Math.floor(n/SCALE.length))/12);
      /* each link of the chain is a drum hit, walking up the scale with the tone;
         the first link is the Device itself, so it gets the gun */
      if (n === 0) fKit('shot', x, 0.6, 0.45);
      if (t - fChainAt > 0.04){
        fChainAt = t;
        fKit(n % 2 ? 'hat' : 'prc', x, 0.3, Math.min(3, Math.pow(2, SCALE[n % SCALE.length]/12)*(1 + Math.floor(n/SCALE.length)*0.25)));
      }
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = Math.min(f, 6000);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t+0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.4);
      o.connect(g); g.connect(p); o.start(t); o.stop(t+0.42);
      const d = actx.createDelay(); d.delayTime.value = 0.19;
      const dg = actx.createGain(); dg.gain.value = 0.35;
      g.connect(d); d.connect(dg); dg.connect(p);
      o.onended = reap(o, g, d, dg, p);
    }
    function fxBoom(){
      if (!actx) return;
      braam();
      fKit('kick', 0, 0.9, 0.6);
      fKit('impact', 0, 1.0, 0.4);
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(22, t+1.6);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t+2.2);
      o.connect(g); g.connect(fleetBus); o.start(t); o.stop(t+2.3);
      o.onended = reap(o, g);
    }
    function fxTick(){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = 2200;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.025);
      o.connect(g); g.connect(uiBus); o.start(t); o.stop(t+0.03);
      o.onended = reap(o, g);
    }

    /* ---- state ---- */
    let fleetT = 0, fleetNextTick = 0, fleetOver = 0, fleetWon = false, fleetTold = 0,
      fleetDevCool = 0, fleetDevCharge = 0, fleetDevAim = null, fleetDevSrc = null;
    let fleetKills = 0, fleetLost = 0, fleetBannerT = 0, fleetFlash = 0, fleetPaused = false;
    let fleetFired = 0, fleetChainCnt = 0, fleetChainBest = 0, fleetChainLive = false,
      fleetRaidT = 0, fleetRaidN = 0, fleetForm = 0;
    const F_FORMS = ['GRID', 'LINE', 'WEDGE', 'RING'];
    const F_RAID_EVERY = 24;
    const fleetGroups = {KeyZ:[], KeyX:[], KeyC:[]};
    const fleetChain = []; // scheduled detonations {pos, t, n}
    const setTxt = (node, s)=>{ if (node.textContent !== s) node.textContent = s; };
    /* roster: one row per hull class, with the key that selects it */
    const fleetRosterV = {};
    fleetRosterEl.replaceChildren();
    for (const code in F_CLASS_KEY){
      const cls = F_CLASS_KEY[code], row = document.createElement('div');
      row.className = 'fl-stat';
      const key = document.createElement('span'); key.className = 'key'; key.textContent = code.slice(3);
      const lab = document.createElement('span'); lab.className = 'k'; lab.textContent = ' ' + F_CLASS[cls].name + 'S ';
      const val = document.createElement('span'); val.className = 'v';
      row.append(key, lab, val);
      fleetRosterEl.appendChild(row);
      fleetRosterV[cls] = val;
    }
    function fleetLogLine(msg){
      const row = document.createElement('div');
      row.textContent = 'T+' + fleetT.toFixed(1).padStart(6, '0') + '  ' + msg;
      fleetLog.prepend(row);
      while (fleetLog.children.length > 9) fleetLog.lastChild.remove();
    }
    function fleetBannerShow(msg, hold){
      fleetBanner.textContent = msg;
      fleetBanner.classList.add('show');
      fleetBannerT = performance.now() + (hold || 2600);
    }
    function fleetReset(){
      fleetT = 0; fleetOver = 0; fleetWon = false; fleetTold = 0;
      fleetDevCool = 0; fleetDevCharge = 0; fleetDevAim = null; fleetDevSrc = null;
      fleetKills = 0; fleetLost = 0; fleetFired = 0; fleetChainCnt = 0; fleetChainBest = 0; fleetChainLive = false;
      fleetRaidT = 30; fleetRaidN = 0;
      fleetChain.length = 0;
      fleetPaused = false; fleetPauseEl.classList.remove('show');
      fleetDebrief.classList.remove('show');
      for (const g in fleetGroups) fleetGroups[g].length = 0;
      fPlanet.visible = true; fPlanet.scale.setScalar(1);
      /* fighters up front in two ranks, cruisers behind them, carriers at the back */
      fShips.forEach(m=>{
        const ud = m.userData, i = ud.slot;
        ud.alive = true; ud.hp = ud.k.hp; ud.sel = false; ud.goal = null; ud.hunt = null; ud.engage = false;
        ud.queue.length = 0; ud.hurt = 0;
        m.visible = true; m.material = shipMat;
        if (ud.cls === 'fighter') m.position.set((i%8 - 3.5)*16, 0, 176 + Math.floor(i/8)*16);
        else if (ud.cls === 'cruiser') m.position.set((i - 2.5)*26, 0, 216);
        else m.position.set((i - 0.5)*70, 0, 244);
        m.lookAt(m.position.x, 0, -1000);
      });
      /* the swarm is not one blob: a nest around the homeworld plus outlying
         formations, with gaps between them the chain reaction cannot cross */
      const nests = [{c:fPlanet.position, r0:64, r1:84, n:Math.floor(F_DRONES*0.4)}];
      for (let k=0;k<4;k++){
        const a = Math.PI*(0.15 + k*0.23) + Math.random()*0.2, rr = 150 + Math.random()*110;
        nests.push({c:new THREE.Vector3(Math.cos(a)*rr*(k%2 ? 1 : -1), 0, -40 + Math.sin(a)*rr*0.6 - 60), r0:6, r1:34, n:0});
      }
      fDrones.forEach((m, i)=>{
        const ud = m.userData;
        const nest = i < nests[0].n ? nests[0] : nests[1 + (i % 4)];
        ud.alive = true; ud.doomed = false; ud.raid = false; ud.hot = 0; ud.cool = Math.random()*2;
        m.visible = true; m.material = droneMat; m.geometry = droneGeo; m.scale.setScalar(1);
        ud.home = nest.c;
        ud.orbit = nest.r0 + Math.random()*(nest.r1 - nest.r0); ud.ang = Math.random()*Math.PI*2; ud.lift = (Math.random()-0.5)*22;
        ud.spd = (0.12 + Math.random()*0.18) * (Math.random() < 0.5 ? 1 : -1);
        m.position.set(nest.c.x + Math.cos(ud.ang)*ud.orbit, ud.lift, nest.c.z + Math.sin(ud.ang)*ud.orbit);
      });
      setTxt(fleetSelEl, '00');
      fleetLog.replaceChildren();
      fleetLogLine('SIMULATION LOADED · ' + F_SHIPS + ' SHIPS · ' + F_DRONES + ' CONTACTS');
      fleetLogLine('THE ENEMY’S GATE IS DOWN');
    }
    fleetReset();

    /* screen <-> hologram */
    const fRay = new THREE.Raycaster();
    const fPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const _ndc = new THREE.Vector2(), _hit = new THREE.Vector3(), _v = new THREE.Vector3();
    function fleetRayAt(sx, sy){
      _ndc.set(sx/fW()*2 - 1, -(sy/fH()*2 - 1));
      fRay.setFromCamera(_ndc, fCam);
      return fRay;
    }
    function fleetPointAt(sx, sy){
      const r = fleetRayAt(sx, sy);
      if (!r.ray.intersectPlane(fPlane, _hit)) return null;
      return _hit.clone();
    }
    function fleetDroneAt(sx, sy, tol){
      fleetRayAt(sx, sy);
      let best = null, bd = tol || 16;
      for (const d of fDrones){
        if (!d.userData.alive) continue;
        const dist = fRay.ray.distanceToPoint(d.position);
        if (dist < bd){ bd = dist; best = d; }
      }
      return best;
    }
    function fleetNearestDrone(pos, max){
      let best = null, bd = max;
      for (const d of fDrones){
        if (!d.userData.alive || d.userData.doomed) continue;
        const dd = d.position.distanceTo(pos);
        if (dd < bd){ bd = dd; best = d; }
      }
      return best;
    }
    function fleetSelected(){ return fShips.filter(s=>s.userData.alive && s.userData.sel); }
    function fleetSetSel(list, add){
      if (!add) fShips.forEach(s=>{ s.userData.sel = false; });
      list.forEach(s=>{ if (s.userData.alive) s.userData.sel = true; });
      const n = fleetSelected().length;
      setTxt(fleetSelEl, String(n).padStart(2, '0'));
      if (list.length) fxSelect(n);
    }
    /* where each ship of n stands, as [right, behind] of the order point */
    function fleetFormOffsets(n){
      const out = [], gap = 17, kind = F_FORMS[fleetForm];
      for (let i=0;i<n;i++){
        if (kind === 'LINE') out.push([(i - (n-1)/2)*gap, 0]);
        else if (kind === 'WEDGE'){ const r = Math.ceil(i/2); out.push([(i%2 ? 1 : -1)*r*gap*0.8, r*gap*0.8]); }
        else if (kind === 'RING'){ const a = i/n*Math.PI*2, r = Math.max(20, n*gap/6.28); out.push([Math.cos(a)*r, Math.sin(a)*r]); }
        else {
          const cols = Math.ceil(Math.sqrt(n));
          out.push([(i%cols - (cols-1)/2)*gap, (Math.floor(i/cols) - (Math.ceil(n/cols)-1)/2)*gap]);
        }
      }
      return out;
    }
    function fleetNextOrder(ud){
      const n = ud.queue.shift();
      if (!n) return;
      ud.hunt = n.hunt && n.hunt.userData.alive ? n.hunt : null;
      ud.goal = ud.hunt ? null : n.goal;
      ud.engage = !!ud.hunt;
    }
    /* add = shift held: the order joins the end of each ship's queue */
    function fleetOrder(pt, hunt, add){
      const sel = fleetSelected();
      if (!sel.length) return;
      sel.sort((a, b)=>b.userData.k.spd - a.userData.k.spd); // the fast hulls take the front
      _a.set(0, 0, 0);
      for (const s of sel) _a.add(s.position);
      _a.multiplyScalar(1/sel.length);
      /* the formation faces the way the group is being sent */
      let fx = pt.x - _a.x, fz = pt.z - _a.z;
      const fl = Math.hypot(fx, fz);
      if (fl < 1){ fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
      const offs = fleetFormOffsets(sel.length);
      sel.forEach((s, i)=>{
        const ud = s.userData, r = offs[i][0], b = offs[i][1];
        const goal = new THREE.Vector3(pt.x - fz*r - fx*b, 0, pt.z + fx*r - fz*b);
        goal.x = Math.max(-HOLO_R*1.3, Math.min(HOLO_R*1.3, goal.x));
        goal.z = Math.max(-HOLO_R*1.3, Math.min(HOLO_R*1.3, goal.z));
        if (add && (ud.goal || ud.hunt)) ud.queue.push({goal, hunt:hunt || null});
        else { ud.goal = hunt ? null : goal; ud.hunt = hunt || null; ud.engage = !!hunt; ud.queue.length = 0; }
      });
      fxOrder(pt.x, !!hunt);
      fleetLogLine((add ? 'QUEUE ' : '') + (hunt ? 'ENGAGE ' : 'MOVE ') + sel.length + ' → ' +
        String(Math.round(pt.x + HOLO_R)).padStart(3, '0') + '.' + String(Math.round(pt.z + HOLO_R)).padStart(3, '0'));
      fShell(pt, 10, hunt ? F_ALARM : F_BLUE, 0.35);
    }
    function fleetHalt(){
      const sel = fleetSelected();
      if (!sel.length) return;
      for (const s of sel){ const ud = s.userData; ud.goal = null; ud.hunt = null; ud.engage = false; ud.queue.length = 0; }
      fxTick();
      fleetLogLine('HOLD ' + sel.length);
    }
    function fleetKillDrone(d, n){
      const ud = d.userData;
      if (!ud.alive) return;
      ud.alive = false; d.visible = false; fleetKills++;
      if (n == null) fShell(d.position, 5, F_ALARM, 0.25);
      else { fleetChainCnt++; if (fleetChainCnt > fleetChainBest) fleetChainBest = fleetChainCnt; }
      fxDroneDie(d.position.x, n == null ? fleetKills : n);
    }
    /* the homeworld answers: every so often it hatches a raid that ignores the
       nests and comes straight for the fleet, a little larger each time */
    function fleetLaunchRaid(){
      const want = 8 + Math.min(8, fleetRaidN*2);
      let n = 0;
      for (const d of fDrones){
        if (n >= want) break;
        const ud = d.userData;
        if (ud.alive) continue;
        const a = Math.random()*Math.PI*2;
        ud.alive = true; ud.doomed = false; ud.hot = 0; ud.cool = 1 + Math.random()*2; ud.home = fPlanet.position;
        ud.orbit = 64 + Math.random()*20; ud.ang = a; ud.lift = (Math.random()-0.5)*22;
        d.position.set(fPlanet.position.x + Math.cos(a)*46, ud.lift, fPlanet.position.z + Math.sin(a)*46);
        d.visible = true; d.scale.setScalar(1);
        ud.raid = true; d.geometry = raidGeo; d.material = droneMat;
        n++;
      }
      /* nothing dead to hatch from: the nest itself breaks off */
      for (const d of fDrones){
        if (n >= want) break;
        const ud = d.userData;
        if (!ud.alive || ud.raid || ud.doomed || ud.home !== fPlanet.position) continue;
        ud.raid = true; d.geometry = raidGeo;
        n++;
      }
      if (!n) return;
      fleetRaidN++;
      fShell(fPlanet.position, 70, F_ALARM, 0.8);
      fxOrder(fPlanet.position.x, true);
      fleetLogLine('HOMEWORLD LAUNCH · RAID ' + String(fleetRaidN).padStart(2, '0') + ' · ' + n + ' CONTACTS');
    }
    /* the Device: a molecular disruption field that feeds on what it destroys.
       Only the carriers hold one, and the field has to start within their reach */
    const F_DEV_CHARGE = 0.9, F_DEV_COOL = 7, F_DEV_R = 42, F_DEV_RANGE = 150;
    function fleetCarrierNear(pt){
      let best = null, bd = Infinity;
      for (const s of fShips){
        if (!s.userData.alive || s.userData.cls !== 'carrier') continue;
        const dd = s.position.distanceTo(pt);
        if (dd < bd){ bd = dd; best = s; }
      }
      return best;
    }
    /* what the Device would lock onto from this point of the screen */
    function fleetAimAt(sx, sy){
      const d = fleetDroneAt(sx, sy, 28);
      if (d) return d.position.clone();
      const pt = fleetPointAt(sx, sy);
      if (!pt) return null;
      if (fPlanet.visible && fRay.ray.distanceToPoint(fPlanet.position) < 44) return fPlanet.position.clone(); // the homeworld itself is a target
      /* aimed at empty space: the field still wants something to eat, so it
         snaps to the nearest drone within reach of the point */
      const near = fleetNearestDrone(pt, 80);
      return near ? near.position.clone() : pt;
    }
    function fleetDevice(sx, sy){
      if (fleetOver || fleetDevCool > 0 || fleetDevCharge > 0) return;
      const pt = fleetAimAt(sx, sy);
      if (pt) fleetArm(pt);
    }
    function fleetArm(pt){
      const src = fleetCarrierNear(pt);
      if (!src){ fleetLogLine('DEVICE: NO CARRIER LEFT'); fxTick(); return; }
      const rng = src.position.distanceTo(pt);
      if (rng > F_DEV_RANGE){
        fleetLogLine('DEVICE: OUT OF REACH · ' + Math.round(rng) + ' > ' + F_DEV_RANGE);
        fxTick();
        fShell(pt, 8, F_ALARM, 0.3);
        return;
      }
      fleetDevAim = pt; fleetDevSrc = src; fleetDevCharge = F_DEV_CHARGE;
      fxCharge(F_DEV_CHARGE);
      fleetLogLine('DR. DEVICE ARMING · CARRIER ' + String(src.userData.slot + 1).padStart(2, '0'));
    }
    function fleetDetonate(pos, n){
      fShell(pos, F_DEV_R, F_DEV, 0.5);
      fxChain(pos.x, n);
      let hopped = 0;
      for (const d of fDrones){
        const ud = d.userData;
        if (!ud.alive || ud.doomed) continue;
        const dist = d.position.distanceTo(pos);
        if (dist < F_DEV_R){
          ud.doomed = true; d.material = droneDoomMat;
          fleetChain.push({pos:d.position.clone(), t:fleetT + 0.14 + dist*0.004, n:n+1, drone:d});
          hopped++;
        }
      }
      /* the field reaches the homeworld: it goes the way the drones went */
      if (fPlanet.visible && pos.distanceTo(fPlanet.position) < 44 + F_DEV_R*0.35){
        fPlanet.visible = false;
        fShell(fPlanet.position, 160, F_ALARM, 1.4);
        fShell(fPlanet.position, 420, F_DEV, 2.2);
        fShell(fPlanet.position, 260, 0xffffff, 1.0);
        fxBoom();
        fleetFlash = 1;
        fDrones.forEach(d=>{ if (d.userData.alive && !d.userData.doomed){ d.userData.doomed = true; d.material = droneDoomMat;
          fleetChain.push({pos:d.position.clone(), t:fleetT + 0.3 + d.position.distanceTo(fPlanet.position)*0.006, n:n+2, drone:d}); } });
        fleetLogLine('HOMEWORLD CONTACT · CHAIN UNBOUNDED');
      }
      return hopped;
    }

    /* ---- pixel overlay: plotted one texel at a time, no antialiasing ---- */
    const ovPx = (x, y, w, h)=> fleetOvCtx.fillRect(x|0, y|0, w || 1, h || 1);
    function ovLine(x0, y0, x1, y1, dash){
      const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy))|0;
      if (n > 1600) return;
      for (let i=0;i<=n;i++){
        if (dash && ((i/dash)|0) % 2) continue;
        const t = n ? i/n : 0;
        fleetOvCtx.fillRect((x0 + dx*t)|0, (y0 + dy*t)|0, 1, 1);
      }
    }
    const _p = new THREE.Vector3();
    function ovProj(v, out){
      _p.copy(v).project(fCam);
      if (_p.z > 1) return false;
      out[0] = (_p.x+1)/2*ovW; out[1] = (1-_p.y)/2*ovH;
      return true;
    }
    /* a dotted circle lying on the plane */
    function ovRing(c, r, n, ph){
      for (let i=0;i<n;i++){
        const a = i/n*Math.PI*2 + ph;
        _p.set(c.x + Math.cos(a)*r, 0, c.z + Math.sin(a)*r).project(fCam);
        if (_p.z < 1) fleetOvCtx.fillRect(((_p.x+1)/2*ovW)|0, ((1-_p.y)/2*ovH)|0, 1, 1);
      }
    }
    function ovMark(x, y){ ovPx(x-1, y-1); ovPx(x+1, y-1); ovPx(x, y); ovPx(x-1, y+1); ovPx(x+1, y+1); }
    const fMini = {x:0, y:0, s:1}; // the minimap's box, in overlay texels
    const MINI_SPAN = HOLO_R*2.9;
    const _oa = [0, 0], _ob = [0, 0];
    function fleetOverlay(){
      const g = fleetOvCtx;
      g.clearRect(0, 0, ovW, ovH);
      const devReady = !fleetDevCool && !fleetDevCharge && !fleetOver;
      /* how far the Device reaches from each carrier */
      g.fillStyle = OV.dev;
      let carriers = 0;
      for (const s of fShips){
        if (!s.userData.alive || s.userData.cls !== 'carrier') continue;
        carriers++;
        ovRing(s.position, F_DEV_RANGE, devReady ? 90 : 36, fleetT*0.12);
      }
      /* standing orders of whatever is selected: a dashed line to each stop */
      for (const s of fShips){
        const ud = s.userData;
        if (!ud.alive || !ud.sel || !ovProj(s.position, _oa)) continue;
        let px = _oa[0], py = _oa[1];
        const tgt = ud.hunt ? ud.hunt.position : ud.goal;
        if (tgt && ovProj(tgt, _ob)){
          g.fillStyle = ud.hunt ? OV.red : OV.blue;
          ovLine(px, py, _ob[0], _ob[1], 2); ovMark(_ob[0], _ob[1]);
          px = _ob[0]; py = _ob[1];
        }
        for (const q of ud.queue){
          if (!ovProj(q.hunt ? q.hunt.position : q.goal, _ob)) break;
          g.fillStyle = q.hunt ? OV.red : OV.blue;
          ovLine(px, py, _ob[0], _ob[1], 3); ovMark(_ob[0], _ob[1]);
          px = _ob[0]; py = _ob[1];
        }
      }
      /* brackets on the selected, a hull bar on the selected and the damaged */
      const zs = ovH*1.123/fOrbit.dist; // texels per world unit at the look point
      for (const s of fShips){
        const ud = s.userData;
        if (!ud.alive || !ovProj(s.position, _oa)) continue;
        const x = _oa[0]|0, y = _oa[1]|0, h = Math.max(3, Math.round(ud.k.rad*zs)) + 1;
        if (ud.sel){
          g.fillStyle = OV.blue;
          ovPx(x-h, y-h, 3, 1); ovPx(x-h, y-h, 1, 3); ovPx(x+h-2, y-h, 3, 1); ovPx(x+h, y-h, 1, 3);
          ovPx(x-h, y+h, 3, 1); ovPx(x-h, y+h-2, 1, 3); ovPx(x+h-2, y+h, 3, 1); ovPx(x+h, y+h-2, 1, 3);
        }
        if (ud.sel || ud.hp < ud.k.hp){
          const w = h*2 + 1, f = Math.max(1, Math.round(w*ud.hp/ud.k.hp));
          g.fillStyle = ud.hp/ud.k.hp > 0.4 ? OV.ink : OV.red;
          ovPx(x-h, y+h+2, f, 1);
          for (let i=f + (f%2);i<w;i+=2) ovPx(x-h+i, y+h+2);
        }
      }
      /* the Device's aim: the field it would open, and what is standing in it */
      let aimTxt = '';
      if ((fleetMode || fHover) && carriers && !fleetOver && (devReady || fleetDevCharge > 0)){
        const pt = fleetDevCharge > 0 ? fleetDevAim : fleetAimAt(fMx, fMy);
        if (pt){
          const src = fleetCarrierNear(pt), inR = src.position.distanceTo(pt) <= F_DEV_RANGE;
          let n = 0;
          for (const d of fDrones) if (d.userData.alive && !d.userData.doomed && d.position.distanceTo(pt) < F_DEV_R) n++;
          g.fillStyle = inR ? OV.dev : OV.red;
          ovRing(pt, F_DEV_R, 44, -fleetT*0.7);
          if (ovProj(pt, _oa)){
            const x = _oa[0]|0, y = _oa[1]|0;
            ovPx(x-4, y, 3, 1); ovPx(x+2, y, 3, 1); ovPx(x, y-4, 1, 3); ovPx(x, y+2, 1, 3);
            if (inR && ovProj(src.position, _ob)) ovLine(_ob[0], _ob[1], x, y, 4);
          }
          aimTxt = fleetDevCharge > 0 ? 'ARMING' : inR ? 'FIELD ' + String(n).padStart(2, '0') + ' · F TO FIRE' : 'OUT OF REACH';
          fleetAimEl.classList.toggle('bad', !inR);
        }
      }
      fleetAimEl.style.display = aimTxt ? 'block' : 'none';
      if (aimTxt){
        setTxt(fleetAimEl, aimTxt);
        fleetAimEl.style.left = (fMx + 16) + 'px'; fleetAimEl.style.top = (fMy + 14) + 'px';
      }
      /* minimap: the whole table from straight above */
      const mm = mode3 ? 44 : 60, mx0 = ovW - mm - 6, my0 = ovH - mm - (mode3 ? 6 : 36);
      fMini.x = mx0; fMini.y = my0; fMini.s = mm;
      const mk = mm/MINI_SPAN, mcx = mx0 + mm/2, mcy = my0 + mm/2;
      g.fillStyle = OV.paper; g.fillRect(mx0, my0, mm, mm);
      g.fillStyle = OV.ink;
      ovPx(mx0-1, my0-1, mm+2, 1); ovPx(mx0-1, my0+mm, mm+2, 1); ovPx(mx0-1, my0, 1, mm); ovPx(mx0+mm, my0, 1, mm);
      ovPx(mx0+1, my0+mm+1, mm+1, 1); ovPx(mx0+mm+1, my0+1, 1, mm+1); // a hard drop shadow
      if (fPlanet.visible){
        g.fillStyle = OV.red;
        const x = (mcx + fPlanet.position.x*mk)|0, y = (mcy + fPlanet.position.z*mk)|0;
        ovPx(x-2, y-1, 5, 3); ovPx(x-1, y-2, 3, 5);
      }
      g.fillStyle = OV.red;
      for (const d of fDrones) if (d.userData.alive) ovPx(mcx + d.position.x*mk, mcy + d.position.z*mk, d.userData.raid ? 2 : 1, d.userData.raid ? 2 : 1);
      for (const s of fShips){
        const ud = s.userData;
        if (!ud.alive) continue;
        const big = ud.cls === 'carrier' ? 3 : ud.cls === 'cruiser' ? 2 : 1;
        g.fillStyle = ud.cls === 'carrier' ? OV.dev : ud.sel ? OV.blue : OV.ink;
        ovPx(mcx + s.position.x*mk - (big >> 1), mcy + s.position.z*mk - (big >> 1), big, big);
      }
      /* where the camera is looking */
      g.fillStyle = OV.ink;
      const vx = (mcx + fOrbit.center.x*mk)|0, vy = (mcy + fOrbit.center.z*mk)|0;
      ovPx(vx-4, vy, 3, 1); ovPx(vx+2, vy, 3, 1); ovPx(vx, vy-4, 1, 3); ovPx(vx, vy+2, 1, 3);
    }
    /* stage pixel inside the simulator's box -> point on the table, if it is on the minimap */
    function fleetMiniAt(x, y){
      const sx = fW()/ovW, sy = fH()/ovH;
      const u = (x/sx - fMini.x)/fMini.s, v = (y/sy - fMini.y)/fMini.s;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return {x:(u - 0.5)*MINI_SPAN, z:(v - 0.5)*MINI_SPAN};
    }

    /* ---- input: the overlay owns the mouse in this mode ---- */
    let fBoxing = false, fBx0 = 0, fBy0 = 0, fBx1 = 0, fBy1 = 0, fOrbiting = false, fMiniDrag = false,
      fMx = viewW/2, fMy = viewH/2;
    /* in the console the simulator commands itself until a hand touches it;
       fHover is the pointer being over its quadrant, which is what gives it the keys */
    let fHover = false, fleetHands = 0, fleetAutoT = 2;
    const fleetLive = () => fleetMode || mode3;
    function fleetLookAt(m){
      fOrbit.tcenter.x = Math.max(-HOLO_R, Math.min(HOLO_R, m.x));
      fOrbit.tcenter.z = Math.max(-HOLO_R, Math.min(HOLO_R, m.z));
    }
    on(fleetEl, 'mousedown', e=>{
      if (!fleetLive() || !running) return;
      e.preventDefault();
      fleetHands = fleetT + 15;
      const x = fX(e), y = ly(e);
      if (e.button === 0){
        const m = fleetMiniAt(x, y);
        if (m){ fMiniDrag = true; fleetLookAt(m); return; }
        fBoxing = true; fBx0 = fBx1 = x; fBy0 = fBy1 = y; fleetBox.style.display = 'none';
      }
      else if (e.button === 1) fOrbiting = true;
      else if (e.button === 2){
        /* a right-click on the minimap is an order to that part of the table */
        const m = fleetMiniAt(x, y);
        if (m){ fleetOrder(new THREE.Vector3(m.x, 0, m.z), null, e.shiftKey); return; }
        const d = fleetDroneAt(x, y, 22);
        const pt = d ? d.position.clone() : fleetPointAt(x, y);
        if (pt) fleetOrder(pt, d, e.shiftKey);
      }
    });
    on(window, 'mousemove', e=>{
      if (!fleetLive()) return;
      fMx = fX(e); fMy = ly(e);
      fHover = fMx >= 0 && fMx <= fW() && fMy >= 0 && fMy <= fH();
      if (fMiniDrag){ const m = fleetMiniAt(fMx, fMy); if (m) fleetLookAt(m); }
      if (fBoxing){
        fBx1 = fMx; fBy1 = fMy;
        const w = Math.abs(fBx1-fBx0), h = Math.abs(fBy1-fBy0);
        if (w + h > 6){
          fleetBox.style.display = 'block';
          fleetBox.style.left = Math.min(fBx0, fBx1) + 'px'; fleetBox.style.top = Math.min(fBy0, fBy1) + 'px';
          fleetBox.style.width = w + 'px'; fleetBox.style.height = h + 'px';
        }
      }
      if (fOrbiting){ fOrbit.tyaw -= e.movementX*0.005; fOrbit.tpitch = Math.max(0.2, Math.min(1.5, fOrbit.tpitch + e.movementY*0.004)); }
    });
    on(window, 'mouseup', e=>{
      if (!fleetLive()) return;
      if (e.button === 1) fOrbiting = false;
      if (e.button === 0) fMiniDrag = false;
      if (e.button !== 0 || !fBoxing) return;
      fBoxing = false; fleetBox.style.display = 'none';
      const x = fX(e), y = ly(e), add = e.shiftKey, vw = fW(), vh = fH();
      const w = Math.abs(x-fBx0), h = Math.abs(y-fBy0);
      if (w + h <= 6){
        /* click: the ship nearest the cursor on screen, within a thumb's width */
        let best = null, bd = 22;
        for (const s of fShips){
          if (!s.userData.alive) continue;
          _v.copy(s.position).project(fCam);
          const sx = (_v.x+1)/2*vw, sy = (1-_v.y)/2*vh;
          const dd = Math.hypot(sx-x, sy-y);
          if (dd < bd){ bd = dd; best = s; }
        }
        if (best) fleetSetSel([best], add);
        else if (!add) fleetSetSel([], false);
        return;
      }
      const x0 = Math.min(fBx0, x), x1 = Math.max(fBx0, x), y0 = Math.min(fBy0, y), y1 = Math.max(fBy0, y);
      const picked = fShips.filter(s=>{
        if (!s.userData.alive) return false;
        _v.copy(s.position).project(fCam);
        const sx = (_v.x+1)/2*vw, sy = (1-_v.y)/2*vh;
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      });
      fleetSetSel(picked, add);
    });
    on(fleetEl, 'wheel', e=>{
      if (!fleetLive()) return;
      e.preventDefault();
      fOrbit.tdist = Math.max(120, Math.min(1100, fOrbit.tdist * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, {passive:false});
    const F_CMD_KEYS = new Set(['KeyF', 'Space', 'Escape', 'KeyQ', 'KeyE', 'KeyR', 'KeyZ', 'KeyX', 'KeyC', 'KeyG', 'KeyH', 'KeyV']);
    on(window, 'keydown', e=>{
      if (!(fleetMode || (mode3 && fHover)) || !running || e.repeat) return;
      const c = e.code;
      if (c === 'KeyP'){
        fleetPaused = !fleetPaused;
        fleetPauseEl.classList.toggle('show', fleetPaused);
        fxTick();
        return;
      }
      if (!F_CMD_KEYS.has(c)) return;
      fleetHands = fleetT + 15;
      if (c === 'KeyF') fleetDevice(fMx, fMy);
      else if (c === 'Space') fleetSetSel(fShips, false);
      else if (c === 'Escape') fleetSetSel([], false);
      else if (F_CLASS_KEY[c]) fleetSetSel(fShips.filter(s=>s.userData.cls === F_CLASS_KEY[c]), e.shiftKey);
      else if (fleetGroups[c]){
        /* shift stores the selection as a squad, the bare key calls it back */
        const name = 'SQUAD ' + c.slice(3);
        if (e.shiftKey){
          fleetGroups[c] = fleetSelected();
          fxTick();
          fleetLogLine(name + ' SET · ' + fleetGroups[c].length + ' SHIPS');
        } else if (fleetGroups[c].length) fleetSetSel(fleetGroups[c], false);
        else fleetLogLine(name + ' EMPTY · SHIFT+' + c.slice(3) + ' TO SET');
      }
      else if (c === 'KeyG'){
        fleetForm = (fleetForm + 1) % F_FORMS.length;
        fxTick();
        fleetLogLine('FORMATION · ' + F_FORMS[fleetForm]);
        /* idle ships take the new shape where they stand */
        const sel = fleetSelected();
        if (sel.length > 1 && sel.every(s=>!s.userData.goal && !s.userData.hunt)){
          _b.set(0, 0, 0);
          for (const s of sel) _b.add(s.position);
          fleetOrder(_b.multiplyScalar(1/sel.length).clone(), null, false);
        }
      }
      else if (c === 'KeyH') fleetHalt();
      else if (c === 'KeyV') fleetOrder(new THREE.Vector3(0, 0, 210), null, false); // fall back to the start line
    });
    /* nobody at the simulator: every few seconds the whole fleet is sent at the
       nearest contact, and the Device goes off as soon as anything is in reach */
    function fleetAuto(dt){
      fleetAutoT -= dt;
      if (fleetAutoT > 0) return;
      fleetAutoT = 5;
      const ships = fShips.filter(s=>s.userData.alive);
      if (!ships.length) return;
      _v.set(0, 0, 0);
      for (const s of ships) _v.add(s.position);
      _v.multiplyScalar(1/ships.length);
      const ready = !fleetDevCool && !fleetDevCharge;
      const tgt = fleetNearestDrone(_v, Infinity);
      fleetSetSel(ships, false);
      /* the homeworld goes first whenever a carrier can reach it */
      const src = fPlanet.visible ? fleetCarrierNear(fPlanet.position) : null;
      if (ready && src && src.position.distanceTo(fPlanet.position) < F_DEV_RANGE){ fleetArm(fPlanet.position.clone()); return; }
      if (!tgt){ if (fPlanet.visible) fleetOrder(fPlanet.position.clone().setZ(fPlanet.position.z + 120), null, false); return; }
      const near = fleetCarrierNear(tgt.position);
      if (ready && near && near.position.distanceTo(tgt.position) < F_DEV_RANGE) fleetArm(tgt.position.clone());
      else fleetOrder(tgt.position.clone(), tgt, false);
    }

    function setFleet(v){
      fleetMode = v;
      fleetEl.classList.toggle('on', v);
      el.hud.classList.toggle('fleet', v);
      if (v){
        fleetAudioInit();
        fleetHumStart();
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        fleetNextTick = actx.currentTime + 1;
        fleetBannerShow('COMMAND SIMULATION', 1800);
        modeEl.textContent = 'command simulation, 3 to close';
      } else {
        fleetHumStop();
        fBoxing = false; fOrbiting = false; fMiniDrag = false; fleetBox.style.display = 'none';
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
      /* the war is a hologram in here: muffle it, not silence it */
      applyShelf();
    }

    /* the after-action sheet: what the simulator scored, in Battle School's own ranks */
    function fleetDebriefShow(){
      let alive = 0;
      for (const s of fShips) if (s.userData.alive) alive++;
      const score = fleetWon ? Math.round(alive/F_SHIPS*60 + Math.max(0, 40 - fleetOver/4)) : 0;
      const rank = !fleetWon ? 'ICED' : score >= 80 ? 'COMMANDER' : score >= 62 ? 'TOON LEADER' : score >= 45 ? 'SOLDIER' : 'LAUNCHY';
      const rows = [
        ['RESULT', fleetWon ? 'HOMEWORLD BROKEN' : 'FLEET LOST'],
        ['TIME', fleetOver.toFixed(1) + 'S'],
        ['CONTACTS RESOLVED', String(fleetKills)],
        ['SHIPS LOST', fleetLost + ' / ' + F_SHIPS],
        ['DEVICE FIRINGS', String(fleetFired)],
        ['LONGEST CHAIN', String(fleetChainBest)],
        ['RATING', rank + ' · ' + String(score).padStart(3, '0')]
      ];
      const head = document.createElement('div'); head.className = 'fl-deb-h'; head.textContent = 'AFTER-ACTION REPORT';
      fleetDebrief.replaceChildren(head, ...rows.map(([k, v])=>{
        const row = document.createElement('div'); row.className = 'fl-deb-r';
        const a = document.createElement('span'); a.textContent = k;
        const b = document.createElement('span'); b.textContent = v;
        row.append(a, b);
        return row;
      }));
      fleetDebrief.classList.add('show');
    }

    /* ---- per frame ---- */
    const _a = new THREE.Vector3(), _b = new THREE.Vector3();
    function fleetUpdate(dt, time){
      /* camera: WASD pans the hologram, arrows orbit, everything eases */
      const pan = 260*dt;
      const cy = Math.cos(fOrbit.yaw), sy = Math.sin(fOrbit.yaw);
      let px = 0, pz = 0;
      const held = fleetMode || fHover; // in the console the keys belong to the operator unless the pointer is here
      if (held){ if (keys.KeyW) pz -= 1; if (keys.KeyS) pz += 1; if (keys.KeyA) px -= 1; if (keys.KeyD) px += 1; }
      if (px || pz){
        // same basis as walking: W is into the screen, D is screen-right, whatever the orbit
        fOrbit.tcenter.x += (px*cy + pz*sy)*pan; fOrbit.tcenter.z += (pz*cy - px*sy)*pan;
        fOrbit.tcenter.x = Math.max(-HOLO_R, Math.min(HOLO_R, fOrbit.tcenter.x));
        fOrbit.tcenter.z = Math.max(-HOLO_R, Math.min(HOLO_R, fOrbit.tcenter.z));
      }
      const turning = held && (keys.ArrowLeft || keys.ArrowRight);
      if (held){
        if (keys.ArrowLeft) fOrbit.tyaw += 1.4*dt; if (keys.ArrowRight) fOrbit.tyaw -= 1.4*dt;
        if (keys.ArrowUp) fOrbit.tpitch = Math.min(1.5, fOrbit.tpitch + 1*dt);
        if (keys.ArrowDown) fOrbit.tpitch = Math.max(0.2, fOrbit.tpitch - 1*dt);
      }
      if (!fOrbiting && !turning && !fleetPaused) fOrbit.tyaw += 0.025*dt; // the hologram turns slowly on its own
      if (mode3 && !fleetOver && !fleetPaused && fleetT > fleetHands) fleetAuto(dt);
      const k = 1 - Math.pow(0.002, dt);
      fOrbit.yaw += (fOrbit.tyaw - fOrbit.yaw)*k; fOrbit.pitch += (fOrbit.tpitch - fOrbit.pitch)*k;
      fOrbit.dist += (fOrbit.tdist - fOrbit.dist)*k; fOrbit.center.lerp(fOrbit.tcenter, k);
      fCam.aspect = viewW/viewH; fCam.updateProjectionMatrix();
      const chg = fleetDevCharge > 0 ? 1 - fleetDevCharge/F_DEV_CHARGE : 0;
      const shake = fleetPaused ? 0 : chg*2.5;
      fCam.position.set(
        fOrbit.center.x + Math.sin(fOrbit.yaw)*Math.cos(fOrbit.pitch)*fOrbit.dist + (Math.random()-0.5)*shake,
        fOrbit.center.y + Math.sin(fOrbit.pitch)*fOrbit.dist + (Math.random()-0.5)*shake,
        fOrbit.center.z + Math.cos(fOrbit.yaw)*Math.cos(fOrbit.pitch)*fOrbit.dist);
      fCam.lookAt(fOrbit.center);
      fCam.updateMatrixWorld();

      if (!fleetPaused) fleetSim(dt, time);

      fleetFlash = Math.max(0, fleetFlash - dt*1.7);
      const u = fleetPostMat.uniforms;
      u.fl.value = fleetFlash; u.chg.value = chg; u.bk.value = 1 + snarePulse*0.5 + chg*0.9;
      fleetHud();
      fleetOverlay();
      if (fleetBannerT && performance.now() > fleetBannerT){ fleetBanner.classList.remove('show'); fleetBannerT = 0; }

      /* pooled transients */
      const nowMs = performance.now();
      for (const L of laserPool){
        if (!L.userData.busy) continue;
        const kk = 1 - (nowMs - L.userData.t0)/1000/L.userData.life;
        if (kk <= 0){ L.visible = false; L.userData.busy = false; continue; }
        L.material.opacity = kk;
      }
      for (const m of shellPool){
        if (!m.userData.busy) continue;
        const age = (nowMs - m.userData.t0)/1000, kk = age/m.userData.life;
        if (kk >= 1){ m.visible = false; m.userData.busy = false; continue; }
        m.scale.setScalar(1 + m.userData.r*Math.sqrt(kk));
        m.material.opacity = 1 - kk;
      }
    }

    /* readouts: counted fresh every frame so they hold while the clock is stopped */
    function fleetHud(){
      /* name the two sides where they stand: the fleet's centre, the homeworld's pole */
      const vw = fW(), vh = fH();
      const count = {fighter:0, cruiser:0, carrier:0};
      let alive = 0, swarm = 0;
      _a.set(0, 0, 0);
      for (const s of fShips) if (s.userData.alive){ _a.add(s.position); alive++; count[s.userData.cls]++; }
      for (const d of fDrones) if (d.userData.alive) swarm++;
      fleetTagA.style.display = alive ? 'block' : 'none';
      if (alive){
        _a.multiplyScalar(1/alive).project(fCam);
        fleetTagA.style.left = ((_a.x+1)/2*vw) + 'px'; fleetTagA.style.top = ((1-_a.y)/2*vh) + 'px';
      }
      fleetTagB.style.display = fPlanet.visible ? 'block' : 'none';
      if (fPlanet.visible){
        _a.copy(fPlanet.position); _a.y += 50; _a.project(fCam);
        fleetTagB.style.left = ((_a.x+1)/2*vw) + 'px'; fleetTagB.style.top = ((1-_a.y)/2*vh) + 'px';
      }
      setTxt(fleetCountEl, String(alive).padStart(2, '0'));
      setTxt(fleetSwarmEl, String(swarm).padStart(3, '0'));
      for (const cls in count) setTxt(fleetRosterV[cls], String(count[cls]).padStart(2, '0') + '/' + String(F_CLASS[cls].n).padStart(2, '0'));
      setTxt(fleetFormEl, F_FORMS[fleetForm]);
      setTxt(fleetClockEl, 'T+' + fleetT.toFixed(1).padStart(6, '0') + ' · KILLS ' + String(fleetKills).padStart(3, '0'));

      fleetDevEl.style.width = (!count.carrier ? 0 : fleetDevCharge > 0 ? (1 - fleetDevCharge/F_DEV_CHARGE)*100 : (1 - fleetDevCool/F_DEV_COOL)*100) + '%';
      fleetDevEl.classList.toggle('arm', fleetDevCharge > 0);
      fleetDevEl.classList.toggle('ready', !!count.carrier && fleetDevCool === 0 && fleetDevCharge === 0);
      setTxt(fleetDevTxt, !count.carrier ? 'OFFLINE' : fleetDevCharge > 0 ? 'ARMING'
        : fleetDevCool > 0 ? 'RECHARGING ' + Math.ceil(fleetDevCool) + 'S' : root.classList.contains('help') ? 'READY · PRESS F' : 'READY');
      fleetRaidEl.style.width = (fPlanet.visible ? (1 - Math.max(0, fleetRaidT)/Math.max(F_RAID_EVERY, 30))*100 : 0) + '%';
      setTxt(fleetRaidTxt, fPlanet.visible ? Math.ceil(Math.max(0, fleetRaidT)) + 'S' : 'NONE');
    }

    function fleetSim(dt, time){
      fleetT += dt;
      /* the drum machine breathes through the room */
      fStars.material.opacity = 0.3 + hatFlick*0.5;
      fGridMat.opacity = 0.6 + snarePulse*0.4;
      fTable.material.uniforms.pulse.value = snarePulse + (fleetDevCharge > 0 ? 1 - fleetDevCharge/F_DEV_CHARGE : 0)*2;
      fPlanet.rotation.y += dt*0.08;
      fPlanetShell.rotation.x += dt*0.05;
      fPlanetShell.scale.setScalar(1 + snarePulse*0.08);

      /* simulator clock: a soft tick every two seconds, like a room that is counting */
      if (actx && fleetNextTick && actx.currentTime >= fleetNextTick){
        fleetNextTick += 2;
        if (actx.currentTime - fleetNextTick > 4) fleetNextTick = actx.currentTime + 2;
        fxTick();
      }

      if (fPlanet.visible && !fleetOver){
        fleetRaidT -= dt;
        if (fleetRaidT <= 0){ fleetRaidT = F_RAID_EVERY; fleetLaunchRaid(); }
      }

      /* the Device: charge, then fire from the carrier that armed it */
      const devReady = fleetDevCool === 0 && fleetDevCharge === 0;
      if (fleetDevCharge > 0){
        fleetDevCharge -= dt;
        if (fleetDevCharge <= 0){
          fleetDevCharge = 0; fleetDevCool = F_DEV_COOL;
          if (fleetDevSrc && fleetDevSrc.userData.alive){
            fLaser(fleetDevSrc.position, fleetDevAim, F_DEV);
            fleetChainCnt = 0; fleetFired++;
            const hopped = fleetDetonate(fleetDevAim, 0);
            fleetChainLive = true;
            fleetLogLine('DEVICE FIRED · ' + hopped + ' IN FIELD');
            fleetFlash = Math.max(fleetFlash, 0.4);
          } else fleetLogLine('DEVICE LOST WITH ITS CARRIER');
        }
      } else if (fleetDevCool > 0) fleetDevCool = Math.max(0, fleetDevCool - dt);

      /* the chain reaction walks the swarm, one hop per scheduled time */
      for (let i=fleetChain.length-1;i>=0;i--){
        const c = fleetChain[i];
        if (fleetT < c.t) continue;
        fleetChain.splice(i, 1);
        if (c.drone) fleetKillDrone(c.drone, c.n);
        fleetDetonate(c.pos, c.n);
      }
      if (fleetChainLive && !fleetChain.length){
        fleetChainLive = false;
        fleetLogLine('CHAIN RESOLVED · ' + fleetChainCnt + ' CONTACTS');
        if (fleetChainCnt >= 12 && !fleetOver && fPlanet.visible) fleetBannerShow('CHAIN ×' + fleetChainCnt, 1400);
      }

      /* ships */
      let alive = 0, carriers = 0;
      for (const s of fShips){
        const ud = s.userData, kc = ud.k;
        if (!ud.alive) continue;
        alive++;
        if (ud.cls === 'carrier'){
          carriers++;
          /* the Device's core: steady when ready, small while it recharges, wild while it arms */
          ud.core.rotation.y += dt*2;
          ud.core.scale.setScalar(fleetDevCharge > 0 && s === fleetDevSrc ? 1.2 + Math.random()*1.2 : devReady ? 1 + snarePulse*0.3 : 0.45);
        }
        if (ud.hunt && !ud.hunt.userData.alive){
          ud.hunt = null; ud.goal = null;
          if (ud.queue.length) fleetNextOrder(ud);
          else if (ud.engage) ud.hunt = fleetNearestDrone(s.position, 170); // an engage order carries on to the next contact
          if (!ud.hunt && !ud.queue.length) ud.engage = false;
        }
        const tgt = ud.hunt ? ud.hunt.position : ud.goal;
        if (tgt){
          _a.subVectors(tgt, s.position); _a.y = 0;
          /* a ship sent after a contact holds off at its own fighting distance */
          const dist = _a.length(), stop = ud.hunt ? kc.stand : 1.5;
          if (dist > stop){
            _a.multiplyScalar(Math.min(dist - stop, kc.spd*dt)/dist);
            s.position.add(_a);
            if (_a.lengthSq() > 1e-8){ _b.copy(s.position).add(_a); s.lookAt(_b); }
          } else if (ud.hunt) s.lookAt(tgt.x, s.position.y, tgt.z);
          else { ud.goal = null; fleetNextOrder(ud); }
        }
        /* separation: ships nudge apart instead of stacking */
        for (const o of fShips){
          if (o === s || !o.userData.alive) continue;
          _a.subVectors(s.position, o.position); _a.y = 0;
          const dd = _a.length(), min = (kc.sep + o.userData.k.sep)/2;
          if (dd < min && dd > 0.001){ _a.multiplyScalar((min-dd)/dd*0.5*dt*6); s.position.add(_a); }
        }
        /* guns: the nearest drone in range, on a cooldown */
        ud.cool -= dt;
        if (kc.rng && ud.cool <= 0){
          const gt = fleetNearestDrone(s.position, kc.rng);
          if (gt){
            ud.cool = kc.rof*(0.85 + Math.random()*0.3);
            fLaser(s.position, gt.position, F_BLUE);
            fxLaser(s.position.x, true);
            if (Math.random() < kc.hit) fleetKillDrone(gt);
            else { gt.userData.hot = 1; gt.material = droneHotMat; }
          }
        }
        if (ud.hurt > 0){ ud.hurt -= dt*4; if (ud.hurt <= 0){ ud.hurt = 0; s.material = shipMat; } }
      }
      /* drones: nest around the homeworld, swarm anything that comes near, bite back */
      let swarm = 0;
      for (const d of fDrones){
        const ud = d.userData;
        if (!ud.alive) continue;
        swarm++;
        let near = null, bd = ud.raid ? Infinity : 150;
        for (const s of fShips){ if (!s.userData.alive) continue; const dd = s.position.distanceTo(d.position); if (dd < bd){ bd = dd; near = s; } }
        if (near && !ud.doomed){
          _a.subVectors(near.position, d.position);
          if (bd > 26){ _a.normalize().multiplyScalar((ud.raid ? 30 : 17)*dt); d.position.add(_a); }
          ud.cool -= dt;
          if (bd < 48 && ud.cool <= 0){
            ud.cool = 1.4 + Math.random()*1.2;
            fLaser(d.position, near.position, F_ALARM);
            fxLaser(d.position.x, false);
            if (Math.random() < (ud.raid ? 0.2 : 0.14)){
              const su = near.userData;
              su.hp--; su.hurt = 1; near.material = shipHurtMat;
              if (su.hp <= 0){
                su.alive = false; near.visible = false; su.sel = false; fleetLost++;
                fShell(near.position, 14 + su.k.rad, F_INK, 0.6);
                fxShipLost(near.position.x);
                fleetLogLine(su.k.name + ' ' + String(su.slot+1).padStart(2, '0') + ' LOST');
                setTxt(fleetSelEl, String(fleetSelected().length).padStart(2, '0'));
              }
            }
          }
        } else {
          ud.ang += ud.spd*dt;
          _a.set(ud.home.x + Math.cos(ud.ang)*ud.orbit, ud.lift + Math.sin(time*0.7 + ud.ang)*3, ud.home.z + Math.sin(ud.ang)*ud.orbit);
          d.position.lerp(_a, Math.min(1, dt*1.5));
        }
        d.rotation.x += dt*1.3; d.rotation.y += dt*0.9;
        if (ud.hot > 0 && !ud.doomed){ ud.hot -= dt*5; if (ud.hot <= 0){ ud.hot = 0; d.material = droneMat; } }
        if (ud.doomed) d.scale.setScalar(1 + Math.random()*0.6); else if (d.scale.x !== 1) d.scale.setScalar(1);
      }

      /* ends: the simulation finishes, and then starts again */
      if (!fleetOver){
        if (!fPlanet.visible && !swarm && !fleetChain.length){
          fleetOver = fleetT; fleetWon = true;
          fleetBannerShow('SIMULATION COMPLETE', 3200);
          fleetLogLine('ALL CONTACTS RESOLVED · ' + alive + ' SHIPS RETURNING');
        } else if (!alive){
          fleetOver = fleetT;
          fleetBannerShow('FLEET LOST', 3000);
          fleetLogLine('FLEET LOST · SIMULATION RESETTING');
        } else if (!carriers && fleetDevCharge === 0){
          /* no carrier, no Device, and nothing else can break the homeworld */
          fleetOver = fleetT;
          fleetBannerShow('DEVICE LOST', 3000);
          fleetLogLine('CARRIERS LOST · NO DEVICE · SIMULATION RESETTING');
        }
      } else {
        const since = fleetT - fleetOver;
        if (fleetTold < 1 && since > 1.4){ fleetTold = 1; fleetDebriefShow(); }
        if (fleetTold < 2 && since > 3.6){
          fleetTold = 2;
          if (fleetWon){ fleetBannerShow('IT WASN’T A GAME', 3600); fleetLogLine('IT WASN’T A GAME'); uiMotif(); }
        }
        if (since > 10.5){
          fleetReset();
          fleetBannerShow('SIMULATION LOADED', 1600);
        }
      }
    }

    /* ---------------------------------------------------- "." settings panel
       audio driver/output routing plus the user sample kit: pick a folder,
       every audio file in it (recursively) is decoded, trimmed to 5s, and
       becomes assignable to shot / impact / drums / drone. */
    let settingsOpen = false;
    const setEl = $('#settings'), setSink = $('#setSink'), setFolder = $('#setFolder'),
      setCount = $('#setCount'), setSlots = $('#setSlots');
    const SLOT_DEFS = [
      ['shot',   'SHOOTING · FIRE'],
      ['impact', 'SHOOTING · IMPACT FX'],
      ['kick',   'KICK'],
      ['snr',    'SNARE'],
      ['hat',    'HIHAT'],
      ['prc',    'PERC'],
      ['glitch', 'GLITCH · SHARDS'],
      ['drone',  'DRONE BED (LOOPED)'],
      ['fx',     'UI / FX'],
      ['cine',   'CINEMATIC (BRAAM)'],
    ];
    const slotSelects = {};
    SLOT_DEFS.forEach(([key, label])=>{
      const wrap = document.createElement('div');
      wrap.className = 'set-slot';
      const lab = document.createElement('label'); lab.textContent = label;
      const sel = document.createElement('select');
      sel.appendChild(new Option('synth (default)', '-1'));
      sel.addEventListener('change', ()=>{
        ensureAudio();
        sampleMap[key] = parseInt(sel.value, 10);
        if (key === 'drone') applyDroneSample();
        else playSample(key, actx.currentTime, 0.4); // audition on assign
      });
      wrap.appendChild(lab); wrap.appendChild(sel);
      setSlots.appendChild(wrap);
      slotSelects[key] = sel;
    });
    function refreshSlotOptions(){
      SLOT_DEFS.forEach(([key])=>{
        const sel = slotSelects[key];
        const cur = sel.value;
        sel.replaceChildren(new Option('synth (default)', '-1'));
        if (sampleLib.length){
          const n = (slotPools[key] || []).length;
          sel.appendChild(new Option(n ? 'random (' + n + ' matched by name)' : 'random (whole pool)', '-2'));
        }
        sampleLib.forEach((s, i)=>sel.appendChild(new Option(s.name, String(i))));
        if (cur !== '-1' && [...sel.options].some(o=>o.value===cur)){
          sel.value = cur;
        } else if ((slotPools[key] || []).length){
          /* a fresh pool wires every untouched slot it has matches for to random-pick;
             slots nothing matched stay on the synth */
          sel.value = '-2';
          sampleMap[key] = POOL;
          if (key === 'drone') applyDroneSample();
        } else {
          sel.value = '-1';
        }
      });
    }
    async function refreshSinks(){
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const devs = await navigator.mediaDevices.enumerateDevices();
      const outs = devs.filter(d=>d.kind === 'audiooutput');
      setSink.replaceChildren();
      outs.forEach((d, i)=>setSink.appendChild(
        new Option(d.label || ('Output ' + (i+1)), d.deviceId)));
      if (!outs.length) setSink.appendChild(new Option('default', ''));
    }
    on(setSink, 'change', async ()=>{
      ensureAudio();
      if (typeof actx.setSinkId === 'function'){
        try { await actx.setSinkId(setSink.value === 'default' ? '' : setSink.value); }
        catch(err){ setCount.textContent = 'output switch failed: ' + err.message; }
      } else {
        setCount.textContent = 'this browser cannot route AudioContext output (needs setSinkId)';
      }
    });
    const AUDIO_EXT = /\.(wav|mp3|ogg|oga|flac|m4a|aac|aif|aiff|webm)$/i;
    function trimBuffer(buf, MAX_S = 5){
      if (buf.duration <= MAX_S) return buf;
      const len = Math.floor(MAX_S * buf.sampleRate);
      const out = actx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
      for (let c=0;c<buf.numberOfChannels;c++)
        out.getChannelData(c).set(buf.getChannelData(c).subarray(0, len));
      return out;
    }
    const MAX_POOL = 320; // bound the pool (200-400) so a huge folder can't hang the decoder
    on(setFolder, 'change', async e=>{
      ensureAudio();
      const found = [...e.target.files].filter(f=>AUDIO_EXT.test(f.name));
      const files = found.slice(0, MAX_POOL);
      const capped = found.length > files.length;
      setCount.textContent = 'decoding ' + files.length + ' file(s)' +
        (capped ? ' (capped from ' + found.length + ')' : '') + '…';
      let ok = 0;
      for (const f of files){ // decoded and pushed one at a time, never all at once
        try {
          const buf = await actx.decodeAudioData(await f.arrayBuffer());
          sampleLib.push({name: f.name.replace(/\.[^.]+$/, ''), buffer: trimBuffer(buf),
            path: (f.webkitRelativePath || f.name).replace(/\.[^.]+$/, '').toLowerCase()});
          ok++;
          setCount.textContent = 'decoding ' + ok + '/' + files.length + '…';
        } catch(err){ /* skip undecodable files */ }
      }
      setCount.textContent = ok + ' sample(s) loaded' + (capped ? ', pool capped at ' + MAX_POOL : '') +
        ' (max 5s each, ADSR-capped at 2s on trigger)';
      rebuildSlotPools();
      refreshSlotOptions();
    });
    function setSettings(v){
      settingsOpen = v;
      setEl.classList.toggle('on', v);
      if (v){
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        refreshSinks();
      }
    }
    on($('#setClose'), 'click', ()=>setSettings(false));

    /* ---------------------------------------------------- midi: AKAI MIDImix
       any channel. The eight columns are the mixer strips in STRIPS order
       (kick snr hat prc shot hits glitch drone):
         knob rows   top TUNE (+-2 oct, centre detent) · mid FILTER · low DELAY SEND
         fader       strip level        master fader   output level
         MUTE        mute the strip (lit while muted)
         REC ARM     play the strip's voice by hand
         BANK < >    tempo -/+ 2 bpm
       Two presets are built in (the same pair as facefaceface's perform.scd).
       It starts on "bitwig" and switches by itself on the first control that
       only exists in the other one (the two share cc 16-19, 30, 31 and 46-54,
       so those alone can't tell them apart):
         factory  what the MIDImix sends out of the box
         bitwig   the akai-midimix-bitwig preset: knob rows cc 30-37 / 38-45 /
                  46-53, faders cc 92-99, master cc 54, MUTE cc 12-19,
                  REC ARM cc 2-9
       Knobs and faders only speak when moved: SEND ALL on the unit dumps the
       whole surface at once. */
    const setMidi = $('#setMidi'), setMidiMap = $('#setMidiMap');
    // the controls in map order: 3 knob rows, faders, master, mutes, rec arms, bank
    const MIDI_CTL = [];
    ['tune', 'cut', 'send', 'level'].forEach(p=>{ for (let i = 0; i < 8; i++) MIDI_CTL.push([p, i]); });
    MIDI_CTL.push(['master', 0]);
    ['mute', 'arm'].forEach(p=>{ for (let i = 0; i < 8; i++) MIDI_CTL.push([p, i]); });
    MIDI_CTL.push(['bankL', 0], ['bankR', 0]);
    const midiRun = (from, n)=>Array.from({length:n}, (_, i)=>'cc' + (from + i));
    const MIDI_PRESETS = {
      factory: [
        16, 20, 24, 28, 46, 50, 54, 58, // knob row 1
        17, 21, 25, 29, 47, 51, 55, 59, // knob row 2
        18, 22, 26, 30, 48, 52, 56, 60, // knob row 3
        19, 23, 27, 31, 49, 53, 57, 61, // faders
        62 // master
      ].map(n=>'cc' + n)
        .concat([1, 4, 7, 10, 13, 16, 19, 22].map(n=>'note' + n)) // mute
        .concat([3, 6, 9, 12, 15, 18, 21, 24].map(n=>'note' + n)) // rec arm
        .concat(['note25', 'note26']), // bank left / right
      // everything but the bank buttons is a cc, in plain runs
      bitwig: midiRun(30, 24).concat(midiRun(92, 8), ['cc54'], midiRun(12, 8), midiRun(2, 8), ['note25', 'note26'])
    };
    let midiPreset = 'bitwig', midiLookup = {};
    try { if (MIDI_PRESETS[localStorage.getItem('scopeMidiMap')]) midiPreset = localStorage.getItem('scopeMidiMap'); } catch(err){}
    function midiUse(name){
      midiPreset = name;
      midiLookup = {};
      MIDI_PRESETS[name].forEach((k, i)=>{ midiLookup[k] = i; });
      setMidiMap.textContent = 'map: ' + name.toUpperCase() + ' — click to switch (it also switches by itself)';
      try { localStorage.setItem('scopeMidiMap', name); } catch(err){}
    }
    midiUse(midiPreset);
    on(setMidiMap, 'click', ()=>midiUse(midiPreset === 'bitwig' ? 'factory' : 'bitwig'));
    // the lights always answer to these notes, whatever preset the buttons are on
    const muteNote = i => 1 + i*3, armNote = i => 3 + i*3;
    const STRIP_LABEL = {kick:'KICK', snr:'SNARE', hat:'HAT', prc:'PERC', shot:'SHOT', impact:'HITS', glitch:'GLITCH', drone:'DRONE'};
    let midiAccess = null, midiDead = false, midiNames = '';
    const midiSay = msg => {
      setMidi.textContent = (midiNames || 'no controller') + (msg ? ' — ' + msg : '');
      mmxStatus.textContent = setMidi.textContent;
    };
    function midiLed(note, lit){
      if (!midiAccess) return;
      midiAccess.outputs.forEach(out=>{
        if (/midi ?mix/i.test(out.name || '')) try { out.send([0x90, note, lit ? 127 : 0]); } catch(err){}
      });
    }
    function midiTrigger(i){
      ensureAudio();
      const t = actx.currentTime;
      if (i < 4) playDrum(i, t);
      else if (i === 4) playShot(false);
      else if (i === 5) playStruck('world', 0, 0);
      else if (i === 6) playSample('glitch', t, 0.3, {rate:0.8 + Math.random()*0.8});
      else applyDroneSample(); // re-rolls the bed when the drone slot is on random
    }
    // a bound control moved; d2 is 0-127 (buttons: anything above 0 is a press)
    function midiAct(p, i, d2){
      const v = d2/127;
      if (p === 'master'){
        masterLevel = v*v*1.2;
        applyMaster();
        midiSay('MASTER ' + Math.round(v*100) + '%');
        return;
      }
      if (p === 'bankL' || p === 'bankR'){
        if (!d2) return;
        setTempo(bpm + (p === 'bankR' ? 2 : -2));
        midiSay('TEMPO ' + bpm);
        return;
      }
      const s = STRIPS[i], m = mix[s];
      if (p === 'mute'){
        if (!d2) return;
        m.mute = !m.mute;
        if (actx) applyStrip(s);
        midiLed(muteNote(i), m.mute);
        midiSay(STRIP_LABEL[s] + (m.mute ? ' MUTED' : ' LIVE'));
        return;
      }
      if (p === 'arm'){
        if (!d2) return;
        midiTrigger(i);
        mmxFlash(i);
        midiSay(STRIP_LABEL[s] + ' TRIG');
        return;
      }
      let txt;
      if (p === 'level'){ m.level = v*v*1.5; txt = 'LEVEL ' + Math.round(m.level*100) + '%'; } // unity near 80% of travel
      else if (p === 'tune'){
        m.tune = Math.abs(d2 - 64) < 3 ? 1 : Math.pow(4, (d2 - 64)/63);
        txt = 'TUNE x' + m.tune.toFixed(2);
      }
      else if (p === 'cut'){
        /* a resonant sweep kept under the master muffle so the whole travel
           is audible; the last few degrees snap fully open and flat */
        const open = v > 0.97;
        m.cut = open ? 20000 : 40*Math.pow(150, v);
        m.q = open ? 0.9 : 4 + 14*(1 - v); // dB of peak at the cutoff
        txt = 'FILTER ' + (open ? 'OPEN' : Math.round(m.cut) + 'Hz');
      }
      else { m.send = v*1.2; txt = 'DELAY ' + Math.round(v*100) + '%'; }
      if (actx) applyStrip(s);
      midiSay(STRIP_LABEL[s] + ' ' + txt);
    }
    function onMidi(e){
      const [st, d1, d2] = e.data;
      const kind = st & 0xf0;
      if (kind !== 0xb0 && kind !== 0x90) return;
      const key = (kind === 0xb0 ? 'cc' : 'note') + d1;
      let idx = midiLookup[key];
      // not in this preset but in the other one: the device is on that one
      if (idx === undefined){
        const other = Object.keys(MIDI_PRESETS).find(k=>k !== midiPreset && MIDI_PRESETS[k].includes(key));
        if (!other) return;
        midiUse(other);
        idx = midiLookup[key];
      }
      midiAct(MIDI_CTL[idx][0], MIDI_CTL[idx][1], d2);
    }
    function midiBind(){
      const names = [];
      midiAccess.inputs.forEach(inp=>{ inp.onmidimessage = e=>{ onMidi(e); mmxDraw(); }; names.push(inp.name); });
      midiNames = names.join(', ');
      midiSay(names.length ? 'listening' : 'plug in the MIDImix');
      STRIPS.forEach((s, i)=>{ midiLed(muteNote(i), mix[s].mute); midiLed(armNote(i), false); });
    }
    if (navigator.requestMIDIAccess){
      navigator.requestMIDIAccess().then(acc=>{
        if (midiDead) return;
        midiAccess = acc;
        acc.onstatechange = midiBind; // hot-plug
        midiBind();
      }, ()=>{ setMidi.textContent = 'midi permission denied — allow it in the site settings and reload'; });
    } else {
      setMidi.textContent = 'this browser has no Web MIDI (use Chrome or Edge)';
    }
    disposers.push(()=>{
      midiDead = true;
      if (!midiAccess) return;
      midiAccess.onstatechange = null;
      midiAccess.inputs.forEach(inp=>{ inp.onmidimessage = null; });
    });

    /* "," midimix map: the controller drawn the way it sits on the desk, each
       control labelled with what it drives and tracking the live mix state.
       Every cell carries its travel as --v (0..1); the css turns that into a
       knob angle or a fader height. */
    const mmxEl = $('#mmx'), mmxGrid = $('#mmxGrid'), mmxStatus = $('#mmxStatus');
    let mmxOpen = false, mmxMaster = null;
    const mmxRef = {tune:[], cut:[], send:[], mute:[], trig:[], level:[]};
    const MMX_KNOB = '<i class="mmx-knob"><b></b></i><span class="mmx-val"></span>';
    const MMX_FADER = '<i class="mmx-fader"><b></b></i><span class="mmx-val"></span>';
    const MMX_SIDE = {
      name: 'MASTER',
      tune: '<i class="mmx-btn">BANK ◂</i><span class="mmx-val">TEMPO −2</span>',
      cut: '<i class="mmx-btn">BANK ▸</i><span class="mmx-val">TEMPO +2</span>',
      send: '<span class="mmx-val" id="mmxBpm"></span>',
      level: MMX_FADER};
    mmxGrid.innerHTML = ''; // a remount rebuilds the surface rather than stacking a second one
    const mmxCell = (cls, html)=>{
      const d = document.createElement('div');
      d.className = 'mmx-cell ' + cls;
      d.innerHTML = html || '';
      mmxGrid.appendChild(d);
      return d;
    };
    [['', 'name'], ['TUNE', 'tune'], ['FILTER', 'cut'], ['DELAY', 'send'],
     ['MUTE', 'mute'], ['REC ARM', 'trig'], ['LEVEL', 'level']].forEach(([label, key])=>{
      mmxCell('lab', label);
      STRIPS.forEach((s, i)=>{
        if (key === 'name') mmxCell('name', STRIP_LABEL[s]);
        else mmxRef[key][i] = mmxCell(key, key === 'mute' || key === 'trig' ? '<i class="mmx-btn"></i>'
          : key === 'level' ? MMX_FADER : MMX_KNOB);
      });
      const side = mmxCell(key, MMX_SIDE[key]);
      if (key === 'level') mmxMaster = side;
    });
    const mmxBpm = $('#mmxBpm');
    const mmxSet = (cell, v, txt)=>{
      cell.style.setProperty('--v', Math.max(0, Math.min(1, v)));
      cell.lastChild.textContent = txt;
    };
    // inverts the curves in onMidi so the drawing matches the physical surface
    function mmxDraw(){
      if (!mmxOpen) return;
      STRIPS.forEach((s, i)=>{
        const m = mix[s];
        mmxSet(mmxRef.tune[i], (64 + 63*Math.log2(m.tune)/2)/127, 'x' + m.tune.toFixed(2));
        mmxSet(mmxRef.cut[i], m.cut >= 20000 ? 1 : Math.log(m.cut/40)/Math.log(150),
          m.cut >= 20000 ? 'open' : m.cut >= 1000 ? (m.cut/1000).toFixed(1) + 'k' : Math.round(m.cut) + 'Hz');
        mmxSet(mmxRef.send[i], m.send/1.2, Math.round(m.send/1.2*100) + '%');
        mmxSet(mmxRef.level[i], Math.sqrt(m.level/1.5), Math.round(m.level*100) + '%');
        mmxRef.mute[i].classList.toggle('lit', m.mute);
      });
      mmxSet(mmxMaster, Math.sqrt(masterLevel/1.2), Math.round(masterLevel*100) + '%');
      mmxBpm.textContent = bpm + ' BPM';
    }
    function mmxFlash(i){
      const c = mmxRef.trig[i];
      c.classList.add('hit');
      setTimeout(()=>c.classList.remove('hit'), 140);
    }
    function setMmx(v){
      mmxOpen = v;
      mmxEl.classList.toggle('on', v);
      if (v){ mmxStatus.textContent = setMidi.textContent; mmxDraw(); }
    }
    on($('#mmxClose'), 'click', ()=>setMmx(false));

    /* ------------------------------------------------- mode 5: destroyer
       a metagame in the lineage of Desktop Destroyer: 5 freezes the live
       render into a screenshot, and the player defaces the game itself —
       cracks, bullet holes, glitch smears — each hit with its own noise. */
    let destroyMode = false, destroyTool = 'hammer', destroySpray = 0;
    const destroyEl = $('#destroy'), destroyCvs = $('#destroyCanvas');
    const bratEl = $('#brat'), bratWord = $('#bratWord');
    const dctx = destroyCvs.getContext('2d');

    /* resolution select lives in the settings panel; wired here because a
       resolution change also has to resize the destroyer canvas */
    const setRes = $('#setRes');
    setRes.value = resMode;
    on(setRes, 'change', ()=>{
      resMode = setRes.value;
      try { localStorage.setItem('scopeRes', resMode); } catch(err){}
      applyResolution();
    });
    applyResolution();
    function setDestroy(v){
      destroyMode = v;
      destroyEl.classList.toggle('on', v);
      if (v){
        ensureAudio();
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        /* live overlay: the game keeps running underneath; the damage layer
           is transparent and just accumulates marks on top of it */
        destroyCvs.width = viewW; destroyCvs.height = viewH;
        dctx.clearRect(0, 0, destroyCvs.width, destroyCvs.height);
        destroyPrev = performance.now();
        destroyRaf = requestAnimationFrame(destroyTick);
        modeEl.textContent = 'destroyer engaged, 4 to exit';
      } else {
        cancelAnimationFrame(destroyRaf);
        setBrat(false);
        virusSites.length = 0;
        droneAgent = null;
        destroyDroneEl.classList.remove('on');
        destroyStrobeEl.classList.remove('on');
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
      applyShelf();
    }
    function noiseHit(kind){
      if (!actx) return;
      const t = actx.currentTime;
      if (kind === 'glitch' && playSample('glitch', t, 0.4)) return;
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const f = actx.createBiquadFilter();
      const g = actx.createGain();
      if (kind === 'hammer'){
        n.playbackRate.value = 0.5; f.type = 'lowpass'; f.frequency.value = 900;
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
      } else if (kind === 'gun'){
        n.playbackRate.value = 1.8; f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
        g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.07);
      } else {
        n.playbackRate.value = 3.0; f.type = 'highpass'; f.frequency.value = 3200;
        g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.3);
      }
      n.connect(f); f.connect(g); g.connect(uiBus); n.start(t); n.stop(t+0.35);
    }
    function drawCrack(x, y){
      dctx.save();
      dctx.strokeStyle = 'rgba(10,10,10,0.9)';
      for (let i=0;i<7;i++){
        const a = Math.random()*Math.PI*2;
        let px = x, py = y;
        dctx.lineWidth = 1.6;
        dctx.beginPath(); dctx.moveTo(px, py);
        for (let s=0;s<5;s++){
          px += Math.cos(a + (Math.random()-0.5)*1.2) * (8 + Math.random()*26);
          py += Math.sin(a + (Math.random()-0.5)*1.2) * (8 + Math.random()*26);
          dctx.lineTo(px, py);
        }
        dctx.stroke();
      }
      dctx.fillStyle = 'rgba(0,0,0,0.85)';
      dctx.beginPath(); dctx.arc(x, y, 4 + Math.random()*3, 0, Math.PI*2); dctx.fill();
      dctx.restore();
    }
    function drawHole(x, y){
      dctx.save();
      const r = 4 + Math.random()*3;
      const grad = dctx.createRadialGradient(x, y, 0, x, y, r*3);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.4, 'rgba(60,60,60,0.6)');
      grad.addColorStop(1, 'rgba(120,120,120,0)');
      dctx.fillStyle = grad;
      dctx.beginPath(); dctx.arc(x, y, r*3, 0, Math.PI*2); dctx.fill();
      dctx.fillStyle = '#000';
      dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI*2); dctx.fill();
      dctx.restore();
    }
    function drawGlitch(x, y){
      /* grab horizontal slices of the LIVE render and smear them sideways —
         frozen misregistered strips of the game hang over the moving game */
      const src = renderer.domElement;
      /* WebGL buffer isn't preserved between frames — redraw the last post
         pass right now so the pixels are actually there to copy */
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCam);
      const sy2 = src.height / viewH;
      for (let i=0;i<6;i++){
        const yy = y - 30 + Math.random()*60;
        const h = 3 + Math.random()*10;
        const shift = (Math.random()-0.5)*160;
        dctx.drawImage(src, 0, yy*sy2, src.width, h*sy2, shift, yy, viewW, h);
      }
      dctx.save();
      dctx.globalCompositeOperation = 'screen';
      dctx.fillStyle = 'rgba(255,0,60,0.25)';
      dctx.fillRect(0, y - 20 + Math.random()*10, destroyCvs.width, 14 + Math.random()*24);
      dctx.restore();
    }
    /* hammer strobe: two fast whole-screen inverts per blow */
    const destroyStrobeEl = $('#destroyStrobe');
    let destroyStrobeTimers = [];
    function destroyStrobe(){
      destroyStrobeTimers.forEach(clearTimeout);
      destroyStrobeTimers = [0, 90, 180, 270].map((d, i)=>setTimeout(()=>{
        destroyStrobeEl.classList.toggle('on', i % 2 === 0);
      }, d));
    }
    disposers.push(()=>destroyStrobeTimers.forEach(clearTimeout));
    /* virus: infection sites that keep eating outward until mode 4 closes */
    const virusSites = [];
    function drawVirusFrame(dt){
      for (const s of virusSites){
        s.r = Math.min(s.max, s.r + dt*26);
        for (let i=0;i<6;i++){
          const a = Math.random()*Math.PI*2;
          const rr = s.r * (0.55 + Math.random()*0.45);
          const x = s.x + Math.cos(a)*rr, y = s.y + Math.sin(a)*rr;
          dctx.fillStyle = Math.random() < 0.82 ? 'rgba(0,0,0,0.9)' : 'rgba(124,255,43,0.55)';
          dctx.beginPath();
          dctx.arc(x, y, 2 + Math.random()*5, 0, Math.PI*2);
          dctx.fill();
        }
        if (Math.random() < dt*1.5) noiseHit('glitch'); // intermittent chewing
      }
    }
    /* drone agent: flies in from an edge and strafes the screen, leaving a
       trail of holes and glitch tears until its run expires */
    const destroyDroneEl = $('#destroyDrone');
    let droneAgent = null;
    function spawnDroneAgent(){
      const fromLeft = Math.random() < 0.5;
      droneAgent = {
        x: fromLeft ? -40 : viewW + 40, y: Math.random()*viewH*0.6 + 40,
        tx: Math.random()*viewW, ty: Math.random()*viewH*0.7 + 60,
        life: 4.5, fire: 0
      };
      destroyDroneEl.classList.add('on');
      braam();
    }
    function drawDroneFrame(dt){
      const d = droneAgent;
      if (!d) return;
      d.life -= dt;
      const dx = d.tx - d.x, dy = d.ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 30){ d.tx = Math.random()*viewW; d.ty = Math.random()*viewH*0.8; }
      const sp = 380;
      d.x += dx/Math.max(1, dist)*sp*dt;
      d.y += dy/Math.max(1, dist)*sp*dt;
      destroyDroneEl.style.transform = 'translate(' + d.x + 'px,' + d.y + 'px) translate(-50%,-50%) rotate(' + (Math.atan2(dy, dx)*57.3) + 'deg)';
      d.fire -= dt;
      if (d.fire <= 0){
        d.fire = 0.08;
        drawHole(d.x + (Math.random()-0.5)*46, d.y + 14 + Math.random()*30);
        if (Math.random() < 0.25) drawGlitch(d.x, d.y);
        noiseHit('gun');
      }
      if (d.life <= 0){ droneAgent = null; destroyDroneEl.classList.remove('on'); }
    }
    let destroyRaf = 0, destroyPrev = 0;
    function destroyTick(now){
      if (!destroyMode) return;
      destroyRaf = requestAnimationFrame(destroyTick);
      const dt = Math.min(0.05, (now - destroyPrev)/1000);
      destroyPrev = now;
      drawVirusFrame(dt);
      drawDroneFrame(dt);
    }
    function destroyHit(x, y){
      if (destroyTool === 'hammer'){ drawCrack(x, y); noiseHit('hammer'); destroyStrobe(); }
      else if (destroyTool === 'gun'){ drawHole(x, y); noiseHit('gun'); }
      else if (destroyTool === 'virus'){
        virusSites.push({x, y, r: 8, max: 120 + Math.random()*140});
        noiseHit('glitch');
      }
      else { drawGlitch(x, y); noiseHit('glitch'); }
    }
    on(destroyEl, 'mousedown', e=>{
      if (!destroyMode) return;
      destroyHit(lx(e), ly(e));
      if (destroyTool === 'gun') destroySpray = 1; // hold to spray
    });
    on(window, 'mouseup', ()=>{ destroySpray = 0; });
    on(destroyEl, 'mousemove', e=>{
      if (destroyMode && destroySpray && Math.random() < 0.5) destroyHit(lx(e), ly(e));
    });
    /* T: toggles the BRAT-style cover naming the current tool. It strobes
       red/white on the way in, then stays up until T (or leaving mode 4). */
    let bratOn = false, bratTimers = [];
    function bratLabel(){
      bratWord.textContent = destroyTool === 'gun' ? 'machine gun' : destroyTool;
    }
    function setBrat(v){
      bratOn = v;
      bratTimers.forEach(clearTimeout); bratTimers = [];
      bratEl.classList.toggle('on', v); bratEl.classList.remove('inv');
      if (!v) return;
      bratLabel();
      for (let i=1;i<=6;i++)
        bratTimers.push(setTimeout(()=>bratEl.classList.toggle('inv'), i*110));
    }
    disposers.push(()=>bratTimers.forEach(clearTimeout));

    /* strobe: 0 wakes the strobe rig */
    let strobe = false, strobeK = 1, dkV = 1, bloomV = 0;
    function setStrobe(v){
      strobe = v;
      if (v){
        initAudio();
        if (actx.state === 'suspended') actx.resume();
        braam();
        modeEl.textContent = 'strobe engaged, 0 to stop';
      } else {
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
    }

    /* B, first scene only: the operator's body is swapped for a low being that
       scuttles through the grass. Every so often it is lifted off the ground
       and becomes a spy robot hanging over the field, then is dropped back.
       Neither body carries the loudspeaker: one calls, the other only watches. */
    let creature = false, creatureSky = false, creatureT = 0, eyeH = 3.2, lastCall = 0;
    const spyEl = $('#spy'), spyData = $('#spydata');
    const claws = new THREE.Group();
    [-1, 1].forEach(side=>{
      const leg = new THREE.Group();
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.56), chromeMat());
      shin.position.z = -0.24;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.3, 4), chromeMat());
      claw.rotation.x = -Math.PI/2 - 0.5; // hooks forward and down
      claw.position.set(0, -0.07, -0.62);
      leg.add(shin, claw);
      leg.position.set(side*0.4, -0.34, -0.42);
      leg.rotation.y = -side*0.28;
      leg.userData = {side};
      claws.add(leg);
    });
    claws.visible = false;
    camera.add(claws);
    const rig = new THREE.Group();
    const rigMat = new THREE.MeshLambertMaterial({color:0x171a12, flatShading:true});
    const rotors = [];
    [-1, 1].forEach(side=>{
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.07), rigMat);
      arm.position.set(side*0.62, 0.42, -0.9);
      arm.rotation.z = side*0.22;
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.012, 0.06), rigMat);
      rotor.position.set(side*0.9, 0.52, -0.9);
      rig.add(arm, rotor);
      rotors.push(rotor);
    });
    rig.visible = false;
    camera.add(rig);
    function morphTone(up){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(up ? 70 : 520, t);
      o.frequency.exponentialRampToValueAtTime(up ? 520 : 70, t+0.9);
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(up ? 300 : 2400, t);
      f.frequency.exponentialRampToValueAtTime(up ? 2400 : 300, t+0.9);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t+0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t+1.1);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t+1.15);
      o.onended = reap(o, f, g);
    }
    const creatureLabel = ()=> creatureSky ? 'spy robot, observing' : 'ground being, B to return';
    function setCreatureSky(v){
      creatureSky = v;
      creatureT = v ? 9 + Math.random()*5 : 13 + Math.random()*9;
      spyEl.classList.toggle('on', v);
      morphTone(v);
      modeEl.textContent = creatureLabel();
    }
    function setCreature(v){
      if (creature === v) return;
      const wasSky = creatureSky;
      creature = v; creatureSky = false; scoped = false;
      creatureT = 8 + Math.random()*4; // the first lift comes early
      el.hud.classList.toggle('cr', v);
      spyEl.classList.remove('on');
      if (v || wasSky) morphTone(false);
      modeEl.textContent = v ? creatureLabel() : (locked ? 'mouse held, esc to release' : 'drag to look');
    }
    function creatureCall(){
      const now = performance.now();
      if (creatureSky || now - lastCall < 700) return;
      lastCall = now;
      playBeing({part:'knot'}, 0, 6);
    }

    /* R, first scene only: rain comes in over the field and thickens the air.
       One pooled mesh of streaks kept in a box round the camera; the draw
       range is the intensity, so it arrives and leaves a drop at a time.
       Streaks are thin camera-facing quads, not lines: the ink bleed in the
       post pass swallows anything a pixel wide. */
    const RAIN_N = 2600, RAIN_R = 45, RAIN_LO = 22, RAIN_H = 64, RAIN_LEN = 2.6, RAIN_HW = 0.045;
    const RAIN_WIND = 0.14; // sideways lean per unit of fall
    let rain = false, rainK = 0, rainGain = null;
    const rainDrop = new Float32Array(RAIN_N*3);
    const rainSpd = new Float32Array(RAIN_N);
    const rainPos = new Float32Array(RAIN_N*12);
    const rainIdx = new Uint16Array(RAIN_N*6);
    for (let i=0;i<RAIN_N;i++){
      rainDrop[i*3] = (Math.random()*2 - 1)*RAIN_R;
      rainDrop[i*3+1] = Math.random()*RAIN_H - RAIN_LO;
      rainDrop[i*3+2] = (Math.random()*2 - 1)*RAIN_R;
      rainSpd[i] = 46 + Math.random()*22;
      rainIdx.set([i*4, i*4+1, i*4+2, i*4+2, i*4+1, i*4+3], i*6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    rainGeo.setIndex(new THREE.BufferAttribute(rainIdx, 1));
    rainGeo.setDrawRange(0, 0);
    const rainLines = new THREE.Mesh(rainGeo, new THREE.MeshBasicMaterial(
      {color:0xffffff, transparent:true, opacity:0.8, depthWrite:false, fog:false, side:THREE.DoubleSide}));
    rainLines.frustumCulled = false;
    rainLines.visible = false;
    scene.add(rainLines);
    function setRain(v){
      if (rain === v) return;
      rain = v;
      if (v) ensureAudio();
      if (actx){
        if (!rainGain && v){
          const n = actx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
          const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
          const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
          rainGain = actx.createGain(); rainGain.gain.value = 0.0001;
          n.connect(hp); hp.connect(lp); lp.connect(rainGain); rainGain.connect(master);
          n.start();
        }
        if (rainGain) rainGain.gain.setTargetAtTime(v ? 0.022 : 0.0001, actx.currentTime, v ? 2.5 : 0.8);
      }
      if (!creature && !boss) modeEl.textContent = v ? 'rain, R to clear'
        : (locked ? 'mouse held, esc to release' : 'drag to look');
    }
    function updateRain(dt){
      rainK += ((rain ? 1 : 0) - rainK) * Math.min(1, dt*0.9);
      const n = Math.floor(RAIN_N*rainK);
      rainLines.visible = n > 0 && !orbital;
      if (!rainLines.visible) return;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, W = RAIN_R*2;
      // the camera's right vector, flattened: each streak is widened along it
      const me = camera.matrixWorld.elements;
      const rl = Math.hypot(me[0], me[2]) || 1;
      const rx = me[0]/rl*RAIN_HW, rz = me[2]/rl*RAIN_HW;
      const lx = RAIN_LEN*RAIN_WIND;
      for (let i=0;i<n;i++){
        const j = i*3, k = i*12, fall = rainSpd[i]*dt;
        let x = rainDrop[j] + fall*RAIN_WIND, y = rainDrop[j+1] - fall, z = rainDrop[j+2];
        // wrap round the camera so the box follows without anything popping in front
        x = cx + ((((x - cx + RAIN_R) % W) + W) % W) - RAIN_R;
        z = cz + ((((z - cz + RAIN_R) % W) + W) % W) - RAIN_R;
        y = cy + ((((y - cy + RAIN_LO) % RAIN_H) + RAIN_H) % RAIN_H) - RAIN_LO;
        rainDrop[j] = x; rainDrop[j+1] = y; rainDrop[j+2] = z;
        rainPos[k] = x - rx; rainPos[k+1] = y; rainPos[k+2] = z - rz;
        rainPos[k+3] = x + rx; rainPos[k+4] = y; rainPos[k+5] = z + rz;
        rainPos[k+6] = x + lx - rx; rainPos[k+7] = y - RAIN_LEN; rainPos[k+8] = z - rz;
        rainPos[k+9] = x + lx + rx; rainPos[k+10] = y - RAIN_LEN; rainPos[k+11] = z + rz;
      }
      rainGeo.setDrawRange(0, n*6);
      rainGeo.attributes.position.needsUpdate = true;
    }

    /* V, first scene only: the feed loses its mind, quietly. All colour goes;
       the picture is cut to hard black and white, mis-read a different way on
       each cut (mirrored, tiled, slipped), strobed now and then, and sometimes
       seen through a camera that is not the operator's, while a log nobody
       asked for writes itself down the margins. */
    let schizo = false, szK = 0, szCutT = 0, szBurst = 0, szCamOn = false;
    let szStrobeT = 0, szStrobeHz = 6, szStrobeBlk = false;
    const szU = postMat.uniforms;
    const szCam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    const szCvs = $('#sz'), szCtx = szCvs.getContext('2d');
    const SZ_FONT = 'px Mesa043, ui-monospace, Consolas, monospace';
    const SZ_SMALL = 11 + SZ_FONT, SZ_ROW = 14, SZ_PAD = 22;
    const SZ_DRAW = 1/30; // the log is redrawn at 30Hz whatever the picture runs at
    const SZ_SAY = [
      'WHO APPROVED THIS', 'IT IS ONLY A NUMBER', 'THE NUMBER IS LOOKING BACK', 'NOT MY HAND',
      'YOU WERE NEVER HERE', 'THEY ARE COUNTING YOU', 'THE SIGNAL IS LYING', 'DO NOT LOOK AT THE FIELD',
      'THE FIELD IS LOOKING', 'SAME TARGET SAME TARGET SAME', 'WHO IS HOLDING THE MOUSE',
      'OBJECT / NOT PERSON / OBJECT', 'IT WAS ALREADY DECIDED', 'LISTEN', 'THE ABSTRACTION IS THE WEAPON',
      'ERR NO OPERATOR FOUND', 'CONTACT IS ONLY A WORD', 'THEY CAN HEAR THE COUNT', 'YOU ARE NOT RESPONSIBLE',
      'CONFIRM CONFIRM CONFIRM', 'WAKE UP', 'IS THIS LIVE', 'NO ONE IS WATCHING', 'EVERYONE IS WATCHING',
      'WHOSE VOICE IS THIS', 'IT SAID YOUR NAME'
    ];
    const SZ_CLASS = ['PERSON', 'OBJECT', 'THREAT', 'NOISE', 'YOU', 'NULL', 'TARGET', 'SELF', 'NOBODY'];
    const SZ_LABEL = ['LAT', 'LON', 'ALT', 'BRG', 'RNG', 'CONF', 'T+', 'ID', 'HZ', 'ERR', 'PID', 'SEQ', 'ACK', 'VEL', 'CNT', 'MEM'];
    const szLists = [walkers, targets, birds];
    const szPick = a => a[(Math.random()*a.length)|0];
    const szHex = n => { let o = ''; for (let i=0;i<n;i++) o += '0123456789ABCDEF'[(Math.random()*16)|0]; return o; };
    const szNum = (v, w, d) => (v < 0 ? '-' : '+') + Math.abs(v).toFixed(d).padStart(w, '0');
    let szCols = [], szFloat = [], szBig = null, szTick = null, szDrawT = 0;
    /* one line of the log: memory, the operator's real telemetry, a voice,
       the real score, a contact that may not exist, or just digits */
    function szLine(kind){
      const p = camera.position;
      if (kind === 0){ let o = '0x' + szHex(6) + ' '; for (let i=0;i<8;i++) o += ' ' + szHex(2); return o; }
      if (kind === 1) return 'POS ' + szNum(p.x, 6, 1) + ' ' + szNum(p.y, 5, 1) + ' ' + szNum(p.z, 6, 1) +
        '  YAW ' + (((yaw*57.2958) % 360 + 360) % 360).toFixed(1).padStart(5, '0');
      if (kind === 2) return szPick(SZ_SAY);
      if (kind === 3) return 'CONFIRMED ' + String(hits).padStart(3, '0') + '  SHOTS ' + String(shots).padStart(3, '0') +
        '  T+' + (performance.now()/1000).toFixed(2).padStart(8, '0');
      if (kind === 4) return 'TRK ' + szHex(2) + '  BRG ' + String((Math.random()*360)|0).padStart(3, '0') +
        '  RNG ' + String((Math.random()*900)|0).padStart(4, '0') + 'M  ' + szPick(SZ_CLASS) + ' ' + Math.random().toFixed(2);
      let o = ''; for (let i=0;i<6;i++) o += String((Math.random()*1e6)|0).padStart(6, '0') + ' ';
      return o;
    }
    /* every cut the log is laid out again, but always on the same plain grid:
       columns hang from the four corners, numbers drift level across the
       middle, one ticker runs along an edge */
    function szLayout(){
      const W = viewW, H = viewH, r = Math.random;
      const rows = Math.max(4, Math.floor((H*0.5 - SZ_PAD*2)/SZ_ROW));
      szCols = [];
      for (let slot=0;slot<4;slot++){
        if (szCols.length >= 2 && r() < 0.45) continue;
        const n = 4 + (r()*(rows - 3)|0);
        szCols.push({ right:slot & 1, x:slot & 1 ? W - SZ_PAD : SZ_PAD,
          y:slot & 2 ? H - SZ_PAD*2 - n*SZ_ROW : SZ_PAD*2, rows:n, kind:(r()*6)|0,
          rate:r() < 0.2 ? 40 : 3 + r()*14, acc:1, lines:[] });
      }
      szTick = null;
      if (r() < 0.6){
        szTick = { y:r() < 0.5 ? 4 : H - 18, v:(r() < 0.5 ? -1 : 1)*(120 + r()*360), x:0, w:0, s:'' };
        for (let i=0;i<16;i++) szTick.s += szLine(r() < 0.25 ? 2 : 5) + '   ';
      }
      if (r() < 0.35 || !szFloat.length){
        szFloat = [];
        const m = 4 + (r()*6|0);
        for (let i=0;i<m;i++){
          const fs = i === 0 && r() < 0.5 ? 44 + (r()*40|0) : 11;
          szFloat.push({ x:r()*W, y:H*(0.2 + r()*0.6), vx:(r() < 0.5 ? -1 : 1)*(20 + r()*140), font:fs + SZ_FONT,
            lab:szPick(SZ_LABEL), v:r()*1e4, dv:(r() - 0.5)*(r() < 0.3 ? 9e4 : 300), d:(r()*4)|0 });
        }
      }
      szBig = null;
      if (r() < 0.25){
        const fs = (H*(0.07 + r()*0.09))|0;
        szBig = { s:szPick(SZ_SAY), t:0.3 + r()*0.6, font:fs + SZ_FONT, y:H*(0.25 + r()*0.45) };
      }
    }
    function szBlip(){
      const t = actx.currentTime;
      if (playSample('glitch', t, 0.32, {rate:0.5 + Math.random()*1.6})) return;
      const o = actx.createOscillator(); o.type = 'square';
      o.frequency.value = 60*Math.pow(2, Math.random()*6);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random()*0.09);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.15);
      o.onended = reap(o, g);
    }
    function szCut(){
      const r = Math.random;
      /* about half the cuts leave the frame straight and half the tone pure black and white */
      szU.szL.value = r() < 0.45 ? 0 : 1 + (r()*4|0);
      szU.szC.value = r() < 0.5 ? 0 : 1 + (r()*3|0);
      szU.szS.value = r();
      /* held shots, with the odd short stutter */
      if (szBurst > 0){ szBurst--; szCutT = 0.08 + r()*0.08; }
      else if (r() < 0.12){ szBurst = 2 + (r()*3|0); szCutT = 0.1; }
      else szCutT = 0.8 + r()*r()*3.2;
      if (r() < 0.12){
        szStrobeT = 0.3 + r()*0.4; szStrobeHz = 4 + r()*4; szStrobeBlk = r() < 0.5;
        strobeThump();
      }
      /* a third of the cuts are seen from somewhere else, looking at something */
      szCamOn = r() < 0.3;
      if (szCamOn){
        const a = r()*Math.PI*2, d = 8 + r()*70, p = camera.position;
        szCam.position.set(p.x + Math.cos(a)*d, 0, p.z + Math.sin(a)*d);
        szCam.position.y = terrain(szCam.position.x, szCam.position.z) + 1 + r()*r()*60;
        let look = p, seen = 0;
        for (const w of walkers) if (w.userData.alive && r() < 1/++seen) look = w.position;
        szCam.lookAt(seen && r() < 0.6 ? look : p);
        szCam.rotateZ((r() - 0.5)*0.4);
        szCam.fov = r() < 0.3 ? 14 + r()*10 : 50 + r()*40;
        szCam.aspect = viewW/viewH;
        szCam.updateProjectionMatrix();
      }
      if (actx && r() < 0.5) szBlip();
      szLayout();
    }
    function setSchizo(v){
      if (schizo === v) return;
      schizo = v;
      szCvs.classList.toggle('on', v);
      el.hud.classList.toggle('sz', v); // the operator's own readouts make way for the log
      if (v){
        ensureAudio();
        szK = 1; szCutT = 0; szBurst = 0; szDrawT = SZ_DRAW;
      } else {
        szCamOn = false; szStrobeT = 0;
      }
      if (!creature && !boss) modeEl.textContent = v ? 'feed corrupted, V to restore'
        : (locked ? 'mouse held, esc to release' : 'drag to look');
    }
    function updateSchizo(dt, time){
      szK = schizo ? 1 : Math.max(0, szK - dt*4);
      szU.sz.value = szK;
      if (!schizo) return;
      szU.szT.value = time % 600;
      szCutT -= dt;
      if (szCutT <= 0) szCut();
      if (szStrobeT > 0){
        szStrobeT -= dt;
        const lit = (time*szStrobeHz) % 1 < 0.5;
        szU.inv.value = lit ? 1 : 0;
        if (szStrobeBlk && !lit) szU.dk.value = 0.04;
      }
    }
    const _szV = new THREE.Vector3();
    function drawSchizo(frameDt, time, cam){
      if (!schizo) return;
      szDrawT += frameDt;
      if (szDrawT < SZ_DRAW) return;
      const dt = Math.min(szDrawT, 0.1);
      szDrawT = 0;
      const W = viewW, H = viewH, g = szCtx;
      if (szCvs.width !== W || szCvs.height !== H){ szCvs.width = W; szCvs.height = H; }
      else g.clearRect(0, 0, W, H);
      g.textBaseline = 'top';
      g.fillStyle = g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.font = SZ_SMALL;
      for (const c of szCols){
        c.acc += dt*c.rate;
        for (let n = Math.min(c.acc|0, c.rows); n > 0; n--) c.lines.push(szLine(c.kind));
        c.acc -= c.acc|0;
        if (c.lines.length > c.rows) c.lines.splice(0, c.lines.length - c.rows);
        g.textAlign = c.right ? 'right' : 'left';
        g.globalAlpha = 0.7;
        const last = c.lines.length - 1;
        for (let i=0;i<last;i++) g.fillText(c.lines[i], c.x, c.y + i*SZ_ROW);
        g.globalAlpha = 1;
        if (last >= 0) g.fillText(c.lines[last], c.x, c.y + last*SZ_ROW);
      }
      g.textAlign = 'left';
      if (szTick){
        const k = szTick;
        if (!k.w) k.w = g.measureText(k.s).width;
        k.x = ((k.x + k.v*dt) % k.w + k.w) % k.w;
        g.fillText(k.s, -k.x, k.y);
        if (k.w - k.x < W) g.fillText(k.s, k.w - k.x, k.y);
      }
      /* everything alive in frame gets a box, a range, and a class that will
         not settle; each box is wired back to one of the logs */
      let nT = 0;
      scan: for (const list of szLists) for (const t of list){
        if (!t.userData.alive) continue;
        _szV.copy(t.position).project(cam);
        if (_szV.z > 1 || Math.abs(_szV.x) > 1 || Math.abs(_szV.y) > 1) continue;
        const x = Math.round((_szV.x*0.5 + 0.5)*W), y = Math.round((0.5 - _szV.y*0.5)*H);
        const d = cam.position.distanceTo(t.position);
        const s = Math.round(Math.max(16, Math.min(200, 900/d)));
        g.strokeRect(x - s/2 + 0.5, y - s/2 + 0.5, s, s);
        g.fillText('ID ' + (4096 + nT*611).toString(16).toUpperCase() + '  ' + d.toFixed(1) + 'M', x + s/2 + 5, y - s/2);
        g.fillText(SZ_CLASS[((time*2 + nT*3)|0) % SZ_CLASS.length] + ' ' + (0.5 + 0.5*Math.sin(time*3 + nT)).toFixed(2),
          x + s/2 + 5, y - s/2 + SZ_ROW);
        const c = szCols[nT % szCols.length];
        g.globalAlpha = 0.3;
        g.beginPath(); g.moveTo(x, y - s/2); g.lineTo(c.x, c.y); g.stroke();
        g.globalAlpha = 1;
        if (++nT >= 10) break scan;
      }
      for (const f of szFloat){
        f.x = ((f.x + f.vx*dt) % W + W) % W;
        f.v += f.dv*dt;
        g.font = f.font;
        g.fillText(f.lab + ' ' + f.v.toFixed(f.d), f.x, f.y);
      }
      if (szBig && (szBig.t -= dt) > 0){
        g.font = szBig.font; g.textAlign = 'center';
        g.fillText(szBig.s, W/2, szBig.y, W - SZ_PAD*2);
        g.textAlign = 'left';
      }
    }

    /* 1/2/3/4 are exclusive VIEWS (3d / topdown / command simulation /
       4-quadrant console) — pressing one closes whichever other is open, and
       none of them touch the drum machine. M is the only thing that
       opens/closes the drum machine (worldMode); it can be toggled underneath
       any view. 5 is the destroyer overlay on top of whatever is showing. */
    function setView(n){
      if (creature) setCreature(false);
      if (n !== 1 && boss) setBoss(false);
      if (n !== 1 && rain) setRain(false);
      if (n !== 1 && schizo) setSchizo(false);
      if (n === 5){
        /* destroyer is an overlay, not a view: keep whatever is showing;
           from the plain 3d view it defaults to the mode-4 control room */
        if (!orbital && !mode3 && !fleetMode) setMode3(true);
        setDestroy(true);
        return;
      }
      if (destroyMode) setDestroy(false);
      if (n !== 2 && orbital) setOrbital(false);
      if (n !== 3 && fleetMode) setFleet(false);
      if (n !== 4 && mode3) setMode3(false);
      if (n === 2) setOrbital(true);
      if (n === 3) setFleet(true);
      if (n === 4) setMode3(true);
    }
    on(window, 'keydown', e=>{
      if (e.repeat) return;
      if (e.key === '?') root.classList.toggle('help'); // instructions stay hidden until asked for
      if (!running){
        if (e.code === 'Digit1') enter();
        else if (e.code === 'Period') setSettings(!settingsOpen); // settings reachable before entering
        else if (e.code === 'Comma') setMmx(!mmxOpen);
        return;
      } // 1 skips the intro
      if (e.code === 'Digit1') setView(1);
      if (e.code === 'Digit2') setView(orbital ? 1 : 2);
      if (e.code === 'Digit3') setView(fleetMode ? 1 : 3);
      if (e.code === 'Digit4') setView(mode3 ? 1 : 4);
      if (e.code === 'Digit5'){ if (destroyMode) setDestroy(false); else setView(5); }
      if (e.code === 'KeyM') setWorldMode(!worldMode);
      if (e.code === 'KeyB' && !orbital && !fleetMode && !mode3 && !destroyMode) setCreature(!creature);
      if (e.code === 'KeyG' && !orbital && !fleetMode && !mode3 && !destroyMode) setBoss(!boss);
      if (e.code === 'KeyR' && !orbital && !fleetMode && !mode3 && !destroyMode) setRain(!rain);
      if (e.code === 'KeyV' && !orbital && !fleetMode && !mode3 && !destroyMode) setSchizo(!schizo);
      if (e.code === 'Digit0') setStrobe(!strobe);
      if (e.code === 'Period') setSettings(!settingsOpen);
      if (e.code === 'Comma') setMmx(!mmxOpen);
      if (destroyMode){
        if (e.code === 'KeyQ') destroyTool = 'hammer';
        if (e.code === 'KeyW') destroyTool = 'gun';
        if (e.code === 'KeyE') destroyTool = 'glitch';
        if (e.code === 'KeyR') destroyTool = 'virus';
        if (e.code === 'KeyY') spawnDroneAgent();
        if (e.code === 'KeyT') setBrat(!bratOn);
        else if (bratOn) bratLabel(); // keep the cover in step with Q/W/E/R
      }
    });

    /* ---------------------------------------------------------- firing */
    const ray = new THREE.Raycaster();
    const dirV = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    function fire(){
      if (creature){ creatureCall(); return; }
      const now = performance.now();
      if (now - lastShot < 480) return;
      lastShot = now;
      shots++;
      recoil += scoped ? 0.022 : 0.06;
      playShot(scoped);
      if (actx) playDrum(0, actx.currentTime); // every shot lands a kick

      camera.getWorldDirection(dirV);
      if (!scoped){
        dirV.x += (Math.random()-0.5)*0.035;
        dirV.y += (Math.random()-0.5)*0.035;
        dirV.z += (Math.random()-0.5)*0.035;
        dirV.normalize();
      }
      ray.set(camera.getWorldPosition(new THREE.Vector3()), dirV);
      const live = [...targets, ...birds, ...walkers].filter(t=>t.userData.alive);
      const hitT = ray.intersectObjects(live, false);
      const hitW = ray.intersectObjects([ground, ...bGroup.children], false);
      const dT = hitT.length ? hitT[0].distance : Infinity;
      const dW = hitW.length ? hitW[0].distance : Infinity;
      const hitB = being.visible ? ray.intersectObjects(beingParts, false) : [];
      const dB = hitB.length ? hitB[0].distance : Infinity;

      // draw the round: from the horn (or just under the eye when scoped) to whatever it struck
      const dHit = Math.min(dT, dW, dB);
      const muzzle = gun.visible ? horn.getWorldPosition(new THREE.Vector3())
        : ray.ray.origin.clone().addScaledVector(camera.up, -0.35);
      tracer(muzzle, ray.ray.origin.clone().addScaledVector(dirV, dHit < Infinity ? dHit : 900), cur.mark.getHex());

      if (dB < dT && dB < dW){
        // the being takes the round, cries out, and stays where it is
        const h = hitB[0];
        beingHurt = 1;
        beingHits++;
        hits++;
        const local = h.point.clone().project(camera);
        playBeing(h.object.userData, local.x, dB);
        crackBurst(h.point, cur.mark.getHex());
        burst(h.point, 0xffffff);
        flash('#ffffff', 0.25);
        el.range.textContent = String(Math.round(dB)).padStart(3,'0');
      } else if (dT < dW){
        const t = hitT[0].object;
        killThing(t, now);
        addRipple(t.position.x, t.position.z, 5.5);
        // sky and land turn over
        palIndex++;
        setPalette(palIndex, false);
        retune(PALETTES[palIndex % PALETTES.length].root);
        const local = t.position.clone().project(camera);
        playStruck(t.userData.kind === 'bird' ? 'bird' : 'target', local.x, dT);
        flash(cur.mark.getStyle(), 0.22);
        el.range.textContent = String(Math.round(dT)).padStart(3,'0');
      } else if (dW < Infinity){
        addRipple(hitW[0].point.x, hitW[0].point.z, 1.4);
        playStruck('world', 0, dW);
        el.range.textContent = String(Math.round(dW)).padStart(3,'0');
      } else {
        el.range.textContent = 'INF';
      }
      updateStats();
    }
    let flashV = 0;
    function flash(color, amt){ el.flash.style.background = color; flashV = amt; }

    /* ---------------------------------------------------------- missiles */
    function killThing(t, now){
      t.userData.alive = false;
      t.visible = false;
      if (t.userData.arrow) t.userData.arrow.visible = false;
      t.userData.respawn = now + (t.userData.kind==='bird'
        ? 4000 + Math.random()*4000 : 1500 + Math.random()*1400);
      hits++;
      fragBurst(t.position, cur.mark.getHex());
    }
    function updateStats(){
      el.hits.textContent = String(hits).padStart(3,'0');
      el.shots.textContent = String(shots).padStart(3,'0');
      el.acc.textContent = Math.round(hits/shots*100)+'%';
      el.pal.textContent = String((palIndex % PALETTES.length)+1).padStart(2,'0');
    }
    const missiles = [];
    const missileGeo = new THREE.ConeGeometry(0.5, 3.2, 5);
    missileGeo.rotateX(Math.PI/2); // nose along +Z
    const missileMat = new THREE.MeshBasicMaterial({color:0xffffff});
    const ndc = new THREE.Vector2();

    /* leaflets: the non-kinetic payload */
    let converted = 0;
    const leaflets = [];
    const leafletGeo = new THREE.PlaneGeometry(1.6, 0.8);
    const WORDS = ['SURRENDER','GO HOME','LAY DOWN','THE SKY IS PAINT','YOU ARE LOVED','DEFECT','NOTHING TO WIN'];
    const leafletMats = WORDS.map(w=>{
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const cx2 = cv.getContext('2d');
      cx2.fillStyle = '#f2f2ea'; cx2.fillRect(0, 0, 128, 64);
      cx2.fillStyle = '#131313';
      cx2.font = 'bold ' + (w.length > 10 ? 11 : 16) + 'px monospace';
      cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
      cx2.fillText(w, 64, 32);
      return new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),
        side:THREE.DoubleSide, transparent:true});
    });
    function pacify(t, now){
      t.userData.alive = false;
      t.userData.respawn = now + 9000 + Math.random()*5000;
      if (t.userData.arrow) t.userData.arrow.visible = false;
      t.userData.pacified = now;
    }
    function rustle(){
      if (!actx) return;
      const t = actx.currentTime;
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 0.7;
      const f = actx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=2400; f.Q.value=0.6;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t+0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t+1.7);
    }
    function leafletBurst(point){
      const now = performance.now();
      let conv = 0;
      for (const t of [...targets, ...birds, ...walkers]){
        if (t.userData.alive && t.position.distanceTo(point) < 18){ pacify(t, now); conv++; }
      }
      converted += conv;
      for (let i=0;i<26;i++){
        const m = new THREE.Mesh(leafletGeo, leafletMats[(Math.random()*leafletMats.length)|0].clone());
        m.position.set(point.x+(Math.random()-0.5)*10, point.y+14+Math.random()*8,
          point.z+(Math.random()-0.5)*10);
        m.rotation.set(Math.random()*6.28, Math.random()*6.28, 0);
        m.userData = {vy:-(1.5+Math.random()*1.5), ph:Math.random()*6.28,
          life:9+Math.random()*3, sx:(Math.random()-0.5)*1.5, sz:(Math.random()-0.5)*1.5};
        scene.add(m); leaflets.push(m);
      }
      if (conv){
        palIndex++;
        setPalette(palIndex, false);
        retune(PALETTES[palIndex % PALETTES.length].root);
        playHit(hits + converted, 0, 60);
      }
      rustle();
      flash('#ffffff', 0.15);
      if (el.dconv) el.dconv.textContent = 'CONV ' + String(converted).padStart(3,'0');
    }
    function launchMissile(cx, cy, leaflet){
      ndc.set((cx/viewW)*2 - 1, -(cy/viewH)*2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(
        [ground, ...bGroup.children, ...[...targets, ...birds, ...walkers].filter(t=>t.userData.alive)], false);
      let to;
      if (hit.length) to = hit[0].point.clone();
      else {
        const o = ray.ray.origin, d = ray.ray.direction;
        to = o.clone().addScaledVector(d, d.y < -0.001 ? -o.y/d.y : 60);
      }
      const from = camera.position.clone();
      from.x += (Math.random()-0.5)*10;
      from.z += (Math.random()-0.5)*10;
      from.y -= 5;
      const m = new THREE.Mesh(missileGeo, missileMat);
      m.position.copy(from);
      scene.add(m);
      missiles.push({m, from, to, leaflet:!!leaflet, t0:performance.now(), dur:600 + to.distanceTo(from)*1.1});
      playShot(false);
      if (actx) playDrum(0, actx.currentTime);
    }
    function boom(){
      if (!actx) return;
      const t = actx.currentTime;
      if (playSample('impact', t, 1.1)) return;
      const o = actx.createOscillator(); o.type='sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(24, t+0.5);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.8);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.85);
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const f = actx.createBiquadFilter(); f.type='lowpass';
      f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(200, t+0.6);
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.6);
      n.connect(f); f.connect(ng); ng.connect(master); n.start(t); n.stop(t+0.65);
    }
    /* strobe mode: cinematic braam + slow world strobe */
    function braam(){
      if (!actx) return;
      const t = actx.currentTime;
      if (playSample('cine', t, 0.7)) return;
      const root = 55;
      [1, 1.494, 2.01, 0.5].forEach((mul, i)=>{
        const o = actx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = root*mul*(1 + (Math.random()-0.5)*0.012);
        const f = actx.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(1800, t+1.2);
        f.frequency.exponentialRampToValueAtTime(240, t+4);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(i===3 ? 0.4 : 0.15, t+0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t+4.5);
        o.connect(f); f.connect(g); g.connect(master);
        o.start(t); o.stop(t+4.6);
        o.onended = reap(o, f, g);
      });
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(200, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t+1.4);
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.2, t+1.2);
      ng.gain.exponentialRampToValueAtTime(0.0001, t+2.2);
      n.connect(bp); bp.connect(ng); ng.connect(master);
      n.start(t); n.stop(t+2.3);
      n.onended = reap(n, bp, ng);
    }
    function strobeHit(i){
      if (!actx) return;
      const t = actx.currentTime;
      const f = 220 * Math.pow(2, SCALE[i % SCALE.length]/12);
      const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.3);
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = f*4; bp.Q.value = 3;
      const ng = actx.createGain();
      ng.gain.setValueAtTime(0.12, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
      n.connect(bp); bp.connect(ng); ng.connect(master); n.start(t); n.stop(t+0.15);
      o.onended = reap(o, g, n, bp, ng);
    }
    function strobeThump(){
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(64, t);
      o.frequency.exponentialRampToValueAtTime(28, t+0.32);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.4);
      o.connect(g); g.connect(master); o.start(t); o.stop(t+0.45);
      o.onended = reap(o, g);
    }
    function explode(point){
      const now = performance.now();
      burst(point, cur.mark.getHex());
      addRipple(point.x, point.z, 6.5);
      let killed = 0;
      for (const t of [...targets, ...birds, ...walkers]){
        if (t.userData.alive && t.position.distanceTo(point) < 15){ killThing(t, now); killed++; }
      }
      shots++;
      if (killed){
        palIndex++;
        setPalette(palIndex, false);
        retune(PALETTES[palIndex % PALETTES.length].root);
        playDrum(1, actx.currentTime, {out:hitBus(point.clone().project(camera).x, camera.position.distanceTo(point))});
      }
      boom();
      flash(cur.mark.getStyle(), killed ? 0.5 : 0.25);
      el.range.textContent = String(Math.round(camera.position.distanceTo(point))).padStart(3,'0');
      updateStats();
    }

    /* ---------------------------------------------------------- gamepad
       every connected pad is merged into one: left stick moves, right stick
       looks, triggers/bumpers fire and scope, d-pad switches views. A lone
       sideways Joy-Con only has one stick, so it drives tank-style: x turns,
       y walks, SR fires, SL scopes. */
    const PAD_DEAD = 0.15, PAD_BTNS = 17; // standard-mapping button count
    const padAxis = v => Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v)*PAD_DEAD)/(1 - PAD_DEAD);
    const padClamp = v => Math.max(-1, Math.min(1, v));
    const pad = {mx:0, my:0, ax:0, ay:0, lone:false,
      down:new Array(PAD_BTNS).fill(false), was:new Array(PAD_BTNS).fill(false)};
    const padHit = i => pad.down[i] && !pad.was[i];
    function pollPad(){
      pad.mx = pad.my = pad.ax = pad.ay = 0;
      pad.lone = false;
      for (let i=0;i<PAD_BTNS;i++){ pad.was[i] = pad.down[i]; pad.down[i] = false; }
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of list){
        if (!gp || !gp.connected) continue;
        const a = gp.axes;
        if (/joy-con \((l|r)\)/i.test(gp.id)){
          pad.lone = true;
          pad.ax += padAxis(a[0] || 0); pad.my += padAxis(a[1] || 0);
        } else {
          pad.mx += padAxis(a[0] || 0); pad.my += padAxis(a[1] || 0);
          pad.ax += padAxis(a[2] || 0); pad.ay += padAxis(a[3] || 0);
        }
        for (let i=0;i<PAD_BTNS && i<gp.buttons.length;i++)
          if (gp.buttons[i].pressed || gp.buttons[i].value > 0.3) pad.down[i] = true;
      }
      pad.mx = padClamp(pad.mx); pad.my = padClamp(pad.my);
      pad.ax = padClamp(pad.ax); pad.ay = padClamp(pad.ay);
    }
    /* mode 4 has no mouse to point with: the look stick steers this cursor instead */
    const DESTROY_TOOLS = ['hammer', 'gun', 'glitch', 'virus'];
    let padCX = viewW/2, padCY = viewH/2;
    const padCursor = document.createElement('div');
    padCursor.style.cssText = 'position:absolute;left:0;top:0;width:18px;height:18px;margin:-11px 0 0 -11px;' +
      'border:2px solid #fff;border-radius:50%;mix-blend-mode:difference;pointer-events:none;display:none';
    destroyEl.appendChild(padCursor);
    disposers.push(()=>padCursor.remove());
    function padControls(dt){
      pollPad();
      if (padHit(8)) setSettings(!settingsOpen);
      if (!running){
        if (padHit(9) || padHit(0)) enter(true);
        return;
      }
      if (padHit(12)) setView(1);
      if (padHit(15)) setView(orbital ? 1 : 2);
      if (padHit(13)) setView(fleetMode ? 1 : 3);
      if (padHit(14)) setView(mode3 ? 1 : 4);
      if (padHit(11)){ if (destroyMode) setDestroy(false); else setView(5); }
      if (padHit(3)) setWorldMode(!worldMode);
      if (padHit(2)) setStrobe(!strobe);

      const trig = pad.down[7] || pad.down[5], trigHit = padHit(7) || padHit(5);
      const aim = pad.down[6] || pad.down[4], aimHit = padHit(6) || padHit(4);
      if (!aim && (pad.was[6] || pad.was[4])) scoped = false;
      padCursor.style.display = destroyMode && (padCursor.style.display === 'block' || pad.ax || pad.ay || trig) ? 'block' : 'none';
      if (destroyMode){
        padCX = Math.max(0, Math.min(viewW, padCX + pad.ax*900*dt));
        padCY = Math.max(0, Math.min(viewH, padCY + (pad.lone ? pad.my : pad.ay)*900*dt));
        padCursor.style.transform = 'translate(' + padCX + 'px,' + padCY + 'px)';
        if (padHit(1)){
          destroyTool = DESTROY_TOOLS[(DESTROY_TOOLS.indexOf(destroyTool) + 1) % DESTROY_TOOLS.length];
          if (bratOn) bratLabel();
        }
        // same feel as the mouse: one blow per press, the gun sprays while held
        if (trigHit || (trig && destroyTool === 'gun' && Math.random() < 0.3)) destroyHit(padCX, padCY);
        return;
      }
      const ks = (scoped ? 0.35 : 2.6) * dt;
      yaw -= pad.ax*Math.abs(pad.ax) * ks;
      if (!pad.lone) pitch = Math.max(-1.45, Math.min(1.45, pitch - pad.ay*Math.abs(pad.ay) * ks*0.75));
      if (mode3){
        if (padHit(0)){
          const btn = m3List.querySelector('.m3-row:not(.done) button');
          if (btn) btn.click();
        }
      } else if (orbital){
        if (trigHit) launchMissile(viewW/2, viewH/2);
        if (aimHit) launchMissile(viewW/2, viewH/2, true);
      } else {
        if (aimHit) scoped = true;
        if (trig) fire();
      }
    }

    /* ---------------------------------------------------------- loop */
    let prev = performance.now();
    let raf = 0;
    function tick(){
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - prev)/1000);
      prev = now;
      const time = now/1000;

      /* sequencer clock */
      if (autopilot && actx){
        // after a long RAF stall (hidden tab), skip missed steps instead of bursting them
        if (actx.currentTime - nextStep > 0.5) nextStep = actx.currentTime + 0.05;
        while (nextStep < actx.currentTime + 0.12){
          const s = step % STEPS;
          if (shuffleOn && s === 0 && step > 0) reshuffle();
          for (let r=0;r<4;r++) if (pattern[r][s]){
            if (shuffleOn){
              // a new sample from the slot's pool and a new pitch (±5 semitones) on every hit
              const rate = Math.pow(2, (Math.random()*10 - 5)/12);
              playDrum(r, nextStep, {pool:true, rate, synthRate:rate});
            } else playDrum(r, nextStep);
            worldHit(r);
          }
          if (melPattern[s]) playNode(s, nextStep);
          if (s === 0 && step > 0){
            palIndex++;
            setPalette(palIndex, false);
            retune(PALETTES[palIndex % PALETTES.length].root);
            el.pal.textContent = String((palIndex % PALETTES.length)+1).padStart(2,'0');
          }
          highlight(s);
          step++; nextStep += STEP_T;
        }
      }
      /* mode 3 office clock: one queued approval fires per beat */
      if (actx && m3NextBeat && actx.currentTime >= m3NextBeat){
        m3NextBeat += M3_BT;
        if (actx.currentTime - m3NextBeat > 2) m3NextBeat = actx.currentTime + M3_BT;
        const job = m3Queue.shift();
        if (job){
          uiDing(m3Melody++);
          const dur = strikeEntity(job.ent, ()=>{
            job.btn.textContent = 'Resolved ✓';
            resolvedCount++;
            m3Goal.textContent = 'Daily goal ' + resolvedCount + '/12';
            if (resolvedCount % 3 === 0) m3ToastShow(PRAISE[(Math.random()*PRAISE.length)|0]);
            if (mode3){
              m3El.classList.add('hit');
              setTimeout(()=>m3El.classList.remove('hit'), 200);
            }
          });
          job.btn.textContent = 'Resolving…';
          job.row.classList.remove('queued');
          // keep the working row in frame as the queue advances
          job.row.scrollIntoView({behavior:'smooth', block:'nearest'});
          const barWrap = job.row.querySelector('.bar');
          if (barWrap){
            barWrap.style.opacity = 1;
            const bar = barWrap.firstChild;
            bar.style.transition = 'width ' + dur + 'ms linear';
            requestAnimationFrame(()=>{ bar.style.width = '100%'; });
          }
        } else if (m3Auto && mode3){
          const btn = m3List.querySelector('.m3-row:not(.done) button');
          if (btn) btn.click();
        }
      }

      snarePulse *= Math.pow(0.001, dt);
      hatFlick *= Math.pow(0.0001, dt);
      for (const m of bGroup.children){
        const p = m.userData.pulse || 0;
        if (p > 0.01){ m.scale.y = 1 + p*0.35; m.userData.pulse = p*Math.pow(0.001, dt); }
        else if (m.scale.y !== 1) m.scale.y = 1;
      }
      for (const s of spinners){
        s.rotation.x += s.userData.spin.x*dt;
        s.rotation.y += s.userData.spin.y*dt;
      }
      for (const m of meats){
        m.scale.setScalar(1 + Math.sin(time*1.3 + m.userData.phase)*0.07 + snarePulse*0.45);
      }

      /* palette easing */
      if (target){
        const k = 1 - Math.pow(0.0015, dt);
        for (const key in cur) cur[key].lerp(target[key], k);
        scene.fog.color.copy(cur.fog);
        renderer.setClearColor(cur.fog);
        bldgMats.forEach(m=>{
          const t = m.userData.tier;
          m.color.copy(t<0.45 ? cur.b0 : t<0.82 ? cur.b1 : cur.b2);
        });
        /* plants take the accents, not the ground tone, so they stand off it */
        grassMat.color.copy(cur.gHi).lerp(WHITE, 0.2);
        bushMat.color.copy(cur.b1);
        leafMat.color.copy(cur.b2);
        pineMat.color.copy(cur.mark).lerp(cur.gLo, 0.3);
        trunkMat.color.copy(cur.gLo).multiplyScalar(0.3);
        beamMat.color.copy(cur.mark);
        wireMat.color.copy(cur.gLo).multiplyScalar(0.45);
        grid.material.color.copy(cur.gLo).multiplyScalar(0.35);
        meatMats.forEach(m=>{
          m.color.copy(cur.mark).lerp(cur.skyBot, 0.35);
          m.emissive.copy(cur.mark).multiplyScalar(0.25);
        });
        targets.forEach(t=>{
          if (!orbital) t.material.color.copy(cur.mark);
          t.userData.wire.material.color.copy(cur.gLo);
        });
      }

      /* keyboard aiming, for when the mouse will not cooperate */
      const kTurn = (keys.ArrowLeft?1:0) - (keys.ArrowRight?1:0);
      const kPitch = (keys.ArrowUp?1:0) - (keys.ArrowDown?1:0);
      if (kTurn || kPitch){
        const ks = (scoped ? 0.28 : 1.5) * dt;
        yaw += kTurn * ks;
        pitch = Math.max(-1.45, Math.min(1.45, pitch + kPitch * ks));
      }
      if (keys.Enter || (keys.KeyF && !(mode3 && fHover))) fire(); // over the simulator quadrant F is the Device
      padControls(dt);

      /* movement */
      let speed = (keys.ShiftLeft||keys.ShiftRight||pad.down[10] ? 22 : 12);
      let fwd = (keys.KeyW?1:0) - (keys.KeyS?1:0) - pad.my;
      let str = (keys.KeyD?1:0) - (keys.KeyA?1:0) + pad.mx;
      const padJump = pad.down[0] && !mode3 && !destroyMode;
      if (creature){
        scoped = false;
        creatureT -= dt;
        if (creatureT <= 0) setCreatureSky(!creatureSky);
        speed = creatureSky ? 18 : speed + 4; // the being skitters; the robot drifts
      }
      eyeH += ((creature && !creatureSky ? 1.2 : 3.2) - eyeH) * Math.min(1, dt*6);

      /* autopilot: the player is a bot while the sequencer runs */
      if (autopilot && !orbital){
        let best = null, bd = Infinity;
        for (const t of [...targets, ...birds, ...walkers]) if (t.userData.alive){
          const d = t.position.distanceTo(camera.position);
          if (d < bd){ bd = d; best = t; }
        }
        if (best){
          const dx = best.position.x - camera.position.x;
          const dy = best.position.y - camera.position.y;
          const dz = best.position.z - camera.position.z;
          const tYaw = Math.atan2(-dx, -dz);
          const tPitch = Math.atan2(dy, Math.hypot(dx, dz));
          const dYaw = ((tYaw - yaw + Math.PI*3) % (Math.PI*2)) - Math.PI;
          yaw += dYaw * Math.min(1, dt*1.1);
          pitch += (tPitch - pitch) * Math.min(1, dt*1.1);
          pitch = Math.max(-1.45, Math.min(1.45, pitch));
          speed = 4.5;
          fwd = bd > 55 ? 1 : bd < 22 ? -0.4 : 0.25;
          str = Math.sin(time*0.25)*0.5;
          if (onGround && Math.random() < dt*0.05){ vel.y = 10.5; onGround = false; }
          if (Math.abs(dYaw) < 0.07 && Math.abs(tPitch - pitch) < 0.07) fire();
        }
      }
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const wish = new THREE.Vector3(str*cy - fwd*sy, 0, -str*sy - fwd*cy);
      // a stick is analog: only clamp it to full speed, never push a half-tilt up to it
      const analog = (pad.mx || pad.my) && !(autopilot && !orbital);
      if (wish.lengthSq() > (analog ? 1 : 0)) wish.normalize();
      const mult = scoped ? 0.35 : 1;
      vel.x += (wish.x*speed*mult - vel.x) * Math.min(1, dt*11);
      vel.z += (wish.z*speed*mult - vel.z) * Math.min(1, dt*11);
      if (orbital){
        speed = 60;
        vel.y = 0;
      } else if (creatureSky){
        vel.y = 0;
        onGround = false;
      } else {
        vel.y -= 30*dt;
        if (creature && vel.y < -34) vel.y = -34; // the drop back down is a fall, not a crash
        if (onGround && (keys.Space || padJump)) { vel.y = creature ? 14 : 10.5; onGround = false; }
        // pressed against a wall: spacebar scrambles upward in pulses
        else if (wallTouch && (keys.Space || padJump) && vel.y < 2) vel.y = 11.5;
      }

      camera.position.x += vel.x*dt;
      camera.position.z += vel.z*dt;
      camera.position.y += vel.y*dt;

      /* keep inside the field */
      const lim = SIZE/2 - 8;
      camera.position.x = Math.max(-lim, Math.min(lim, camera.position.x));
      camera.position.z = Math.max(-lim, Math.min(lim, camera.position.z));

      /* solid architecture: hard walls, walkable roofs (spires stay unclimbable points) */
      wallTouch = false;
      let roofY = -Infinity;
      for (const b of bossAway ? NONE : boxes){ // nothing to walk into while the city is in the air
        const dx = camera.position.x - b.x, dz = camera.position.z - b.z;
        const px = b.hw + 0.9 - Math.abs(dx), pz = b.hd + 0.9 - Math.abs(dz);
        if (px <= 0 || pz <= 0) continue;
        const feet = camera.position.y - eyeH;
        if (feet > b.top + 0.8) continue; // clear above it
        if (!b.spire && feet >= b.top - 0.5){
          if (vel.y <= 0.01) roofY = Math.max(roofY, b.top); // land on the roof
          continue;
        }
        if (px < pz) camera.position.x += Math.sign(dx)*px;
        else camera.position.z += Math.sign(dz)*pz;
        wallTouch = true;
      }
      if (roofY > -Infinity){
        camera.position.y = roofY + eyeH;
        vel.y = 0;
        onGround = true;
      }

      const gh = terrain(camera.position.x, camera.position.z) + eyeH;
      if (!orbital && camera.position.y <= gh){ camera.position.y = gh; vel.y = 0; onGround = true; }
      if (creatureSky){
        const hover = Math.max(gh + 40, 58) + Math.sin(time*0.9)*1.2;
        camera.position.y += (hover - camera.position.y) * Math.min(1, dt*1.4);
      }
      if (orbital){
        camera.position.y += (130 - camera.position.y) * Math.min(1, dt*2.5);
        pitch += (-1.45 - pitch) * Math.min(1, dt*4);
      }
      scene.fog.density += ((orbital ? 0.0025 : boss ? 0.004 : creatureSky ? 0.0045 : 0.0085) + rainK*0.004 - scene.fog.density) * Math.min(1, dt*3);
      postMat.uniforms.xr.value += ((orbital ? 1 : 0) - postMat.uniforms.xr.value) * Math.min(1, dt*3);
      postMat.uniforms.camY.value = camera.position.y;
      const xrv = postMat.uniforms.xr.value;

      /* strobe rig: scattered colored lights firing in sequence, drifting in orbits */
      for (let i=0;i<strobeLights.length;i++){
        const L = strobeLights[i];
        const lu = L.userData;
        if (strobe){
          lu.ang += dt*lu.orbit;
          L.position.x = Math.cos(lu.ang)*lu.rad;
          L.position.z = Math.sin(lu.ang)*lu.rad;
          L.position.y = terrain(L.position.x, L.position.z) + lu.h;
          const cyc = (time/1.6 + lu.ph) % 1;
          if (cyc < 0.16){
            L.intensity = lu.peak*0.2; // pools of colour in the dark, not a floodlit field
            if (!lu.was){
              if (i === 0) strobeThump();
              strobeHit(i); // every flash sounds: light and tone locked together
            }
            lu.was = true;
          } else {
            L.intensity *= Math.pow(0.0001, dt);
            lu.was = false;
          }
        } else if (L.intensity > 0.1){
          L.intensity *= Math.pow(0.0001, dt);
        } else L.intensity = 0;
      }
      /* global light sinks close to black and breathes with the cycle, and blooms */
      const sPulse = Math.pow(Math.sin(time*Math.PI*2/1.6)*0.5 + 0.5, 2);
      strobeK += ((strobe ? 0.12 + 0.3*sPulse : 1) - strobeK) * Math.min(1, dt*8);
      /* under rain the fill light drops away faster than the key: hard, low-key shadows */
      sun.intensity = 0.9*Math.PI*strobeK*(1 - 0.3*rainK);
      amb.intensity = 0.45*Math.PI*(0.2 + 0.8*strobeK)*(1 - 0.6*rainK);
      postMat.uniforms.noir.value = orbital ? 0 : rainK;
      dkV += ((strobe ? 0.5 + 0.3*sPulse : 1) - dkV) * Math.min(1, dt*10);
      postMat.uniforms.dk.value = dkV;
      /* two hard negative blinks on the thump that opens each cycle, like the hammer */
      const sCyc = (time/1.6) % 1;
      postMat.uniforms.inv.value = strobe && (sCyc < 0.05 || (sCyc > 0.09 && sCyc < 0.14)) ? 1 : 0;
      bloomV += ((strobe ? 1 : 0) - bloomV) * Math.min(1, dt*2.5);
      postMat.uniforms.bl.value = Math.max(0.3, bloomV);
      updateSchizo(dt, time);

      /* drone feed readouts */
      if (orbital || mode3){
        const cy = orbital ? camera.position.y : 130;
        const dms = (v)=>{
          const dg = Math.floor(v), mf = (v-dg)*60, mn = Math.floor(mf);
          return String(dg).padStart(3,'0') + '° ' + String(mn).padStart(2,'0') + "' "
            + ((mf-mn)*60).toFixed(3) + '"';
        };
        const hdg = ((-yaw*180/Math.PI)%360+360)%360;
        el.dcoords.textContent =
          dms(26.810 + camera.position.z*0.0004) + ' N\n' +
          dms(95.297 + camera.position.x*0.0004) + ' W\n' +
          'SPD ' + String(Math.round(Math.hypot(vel.x, vel.z)*1.94)).padStart(3,'0') +
          ' KTS  HDG ' + String(Math.round(hdg)).padStart(3,'0') + ' T\n' +
          'ALT ' + Math.round(cy*30) + ' FT.';
        el.dmark.style.top = Math.min(100, cy/300*100) + '%';
        el.dmark.textContent = Math.round(cy) + 'm ▸';
      }

      /* aim */
      fovTarget = scoped ? 13 : creatureSky ? 48 : creature ? 100 : 78;
      fov += (fovTarget - fov) * Math.min(1, dt*13);
      camera.fov = fov; camera.updateProjectionMatrix();
      recoil *= Math.pow(0.02, dt);
      sway += dt * (scoped ? 1.1 : 2.4);
      const breath = scoped ? 0.0016 + Math.min(0.004, (Math.abs(vel.x)+Math.abs(vel.z))*0.0009) : 0;
      camera.rotation.y = yaw + Math.sin(sway*0.7)*breath*1.6;
      camera.rotation.x = pitch + recoil + Math.sin(sway)*breath;

      el.scope.classList.toggle('on', scoped);
      /* the being's body: a scuttle that rolls the head and walks the forelegs;
         the robot only sways on its rotors */
      const gait = creature && !creatureSky ? Math.min(1, Math.hypot(vel.x, vel.z)/10) : 0;
      camera.rotation.z = creatureSky ? Math.sin(time*0.6)*0.015 : Math.sin(sway*4)*0.022*gait;
      claws.visible = creature && !creatureSky;
      rig.visible = creatureSky;
      if (claws.visible) for (const leg of claws.children){
        const ph = sway*4 + (leg.userData.side > 0 ? Math.PI : 0);
        leg.rotation.x = Math.sin(ph)*0.3*gait + (onGround ? 0 : -0.35);
        leg.position.y = -0.34 + Math.max(0, Math.cos(ph))*0.07*gait;
      }
      if (rig.visible) for (const r of rotors) r.rotation.y += dt*55;

      el.cross.style.opacity = (scoped || orbital || creature) ? 0 : 0.85;
      gun.visible = !scoped && !orbital && !creature;
      gun.position.y = -0.24 + Math.sin(sway*2.2)*0.012*(wish.lengthSq()?1:0.25);
      gun.position.x = 0.28 + Math.sin(sway*1.1)*0.008;
      gun.rotation.x = -recoil*3;

      /* terrain heights never change; only colors refresh while a palette lerp is fresh */
      const gDirty = (now - lastPal) < 4500;
      if (gDirty)
      for (let i=0;i<vCount;i++){
        const h = baseH[i];
        const k = Math.max(0, Math.min(1, (h+9)/24));
        const t2 = 0.45 + k*0.2; // near-uniform: one color with a faint height shade
        gCol.setXYZ(i,
          cur.gLo.r + (cur.gHi.r - cur.gLo.r)*t2,
          cur.gLo.g + (cur.gHi.g - cur.gLo.g)*t2,
          cur.gLo.b + (cur.gHi.b - cur.gLo.b)*t2);
      }
      if (gDirty){ gCol.needsUpdate = true; }

      /* targets */
      let aliveN = 0, near = null, nearD = Infinity;
      for (const t of boss ? NONE : targets){ // the boss moves its own parts
        if (t.userData.alive){
          aliveN++;
          const ud = t.userData;
          t.position.x += ud.vel.x*dt;
          t.position.z += ud.vel.z*dt;
          if (Math.abs(t.position.x) > 130) ud.vel.x *= -1;
          if (Math.abs(t.position.z) > 130) ud.vel.z *= -1;
          const gy = terrain(t.position.x, t.position.z);
          // eased, so a target let go by the boss sinks back to its hover
          t.position.y += (gy + ud.hover + Math.sin(time*0.9 + ud.phase)*1.4 - t.position.y) * Math.min(1, dt*6);
          ud.beam.scale.y = (t.position.y - gy) + 1.5;
          t.rotation.y += dt*0.8; t.rotation.x += dt*0.45;
          const s = (1 + Math.sin(time*3 + ud.phase)*0.05) * (1 + snarePulse*0.35) * (1 + xrv*1.2);
          t.scale.setScalar(s);
          ud.halo.lookAt(camera.position);
          ud.arrow.position.copy(t.position);
          _dir.copy(ud.vel).normalize();
          ud.arrow.setDirection(_dir);
          ud.arrow.setLength(3 + ud.vel.length()*0.3, 1.4, 0.7);
          const d = t.position.distanceTo(camera.position);
          if (d < nearD){ nearD = d; near = t; }
        } else {
          if (t.userData.pacified){
            const age = (now - t.userData.pacified)/1000;
            if (age < 3){ t.position.y += dt*3; t.rotation.y += dt*0.3; }
            else { t.visible = false; t.userData.pacified = 0; }
          }
          if (now > t.userData.respawn) placeTarget(t);
        }
      }

      /* birds: flock toward a wandering leader, arrows show velocity */
      leader.set(Math.sin(time*0.11)*120, 26 + Math.sin(time*0.23)*12, Math.cos(time*0.17)*120);
      for (const b of boss ? NONE : birds){
        const ud = b.userData;
        if (!ud.alive){
          if (ud.pacified){
            const age = (now - ud.pacified)/1000;
            if (age < 3){ b.position.y += dt*4; }
            else { b.visible = false; ud.pacified = 0; }
          }
          if (now > ud.respawn){
            ud.alive = true; b.visible = true; ud.arrow.visible = true;
            const a = Math.random()*Math.PI*2;
            b.position.set(Math.cos(a)*190, 30 + Math.random()*15, Math.sin(a)*190);
          }
          continue;
        }
        _dir.copy(leader).sub(b.position).normalize();
        ud.v.addScaledVector(_dir, 9*dt);
        for (const o of birds){
          if (o === b || !o.userData.alive) continue;
          const d2 = b.position.distanceToSquared(o.position);
          if (d2 < 16 && d2 > 0.01){
            _dir.copy(b.position).sub(o.position).normalize();
            ud.v.addScaledVector(_dir, 22*dt);
          }
        }
        ud.v.x += (Math.random()-0.5)*4*dt;
        ud.v.y += (Math.random()-0.5)*3*dt;
        ud.v.z += (Math.random()-0.5)*4*dt;
        const sp = ud.v.length();
        if (sp > 24) ud.v.multiplyScalar(24/sp);
        else if (sp < 10 && sp > 0.001) ud.v.multiplyScalar(10/sp);
        b.position.addScaledVector(ud.v, dt);
        const floor = terrain(b.position.x, b.position.z) + 6;
        if (b.position.y < floor){ b.position.y = floor; ud.v.y = Math.abs(ud.v.y)*0.5 + 2; }
        if (b.position.y > 70) ud.v.y -= 8*dt;
        _dir.copy(b.position).add(ud.v);
        b.lookAt(_dir);
        b.scale.setScalar(1 + xrv*1.8);
        ud.arrow.position.copy(b.position);
        _dir.copy(ud.v).normalize();
        ud.arrow.setDirection(_dir);
        ud.arrow.setLength(2 + ud.v.length()*0.15, 1.0, 0.5);
      }

      /* herd: the same flock pinned to the terrain, arrows show velocity */
      herdLead.set(Math.sin(time*0.07 + 2)*95, 0, Math.cos(time*0.09)*95);
      for (const w of boss ? NONE : walkers){
        const ud = w.userData;
        if (!ud.alive){
          if (ud.pacified){
            const age = (now - ud.pacified)/1000;
            if (age < 3){ w.position.y += dt*3; }
            else { w.visible = false; ud.pacified = 0; }
          }
          if (now > ud.respawn){
            ud.alive = true; w.visible = true; ud.arrow.visible = true;
            const a = Math.random()*Math.PI*2;
            w.position.set(Math.cos(a)*150, 0, Math.sin(a)*150);
          }
          continue;
        }
        _dir.copy(herdLead).sub(w.position); _dir.y = 0; _dir.normalize();
        ud.v.addScaledVector(_dir, 5*dt);
        for (const o of walkers){
          if (o === w || !o.userData.alive) continue;
          const d2 = w.position.distanceToSquared(o.position);
          if (d2 < 25 && d2 > 0.01){
            _dir.copy(w.position).sub(o.position).normalize();
            ud.v.addScaledVector(_dir, 14*dt);
          }
        }
        ud.v.x += (Math.random()-0.5)*5*dt;
        ud.v.z += (Math.random()-0.5)*5*dt;
        ud.v.y = 0;
        const sp = ud.v.length();
        if (sp > 9) ud.v.multiplyScalar(9/sp);
        else if (sp < 3 && sp > 0.001) ud.v.multiplyScalar(3/sp);
        w.position.addScaledVector(ud.v, dt);
        // walls turn it aside
        for (const b of boxes){
          const dx = w.position.x - b.x, dz = w.position.z - b.z;
          const px = b.hw + 1.4 - Math.abs(dx), pz = b.hd + 1.4 - Math.abs(dz);
          if (px <= 0 || pz <= 0) continue;
          if (px < pz){ w.position.x += Math.sign(dx)*px; ud.v.x = Math.sign(dx)*Math.abs(ud.v.x); }
          else { w.position.z += Math.sign(dz)*pz; ud.v.z = Math.sign(dz)*Math.abs(ud.v.z); }
        }
        // dropped by the boss, it falls; otherwise it is already on the ground
        w.position.y = Math.max(terrain(w.position.x, w.position.z), w.position.y - 50*dt);
        _dir.copy(w.position).add(ud.v);
        w.lookAt(_dir);
        w.scale.setScalar(1 + xrv*1.8);
        ud.arrow.position.copy(w.position);
        ud.arrow.position.y += 1.5;
        _dir.copy(ud.v).normalize();
        ud.arrow.setDirection(_dir);
        ud.arrow.setLength(2 + ud.v.length()*0.3, 1.0, 0.5);
      }
      if (boss) for (const t of targets) if (t.userData.alive){
        aliveN++;
        const d = t.position.distanceTo(camera.position);
        if (d < nearD){ nearD = d; near = t; }
      }
      el.alive.textContent = String(aliveN).padStart(2,'0');
      if (creatureSky){
        const hdg = ((-yaw*180/Math.PI)%360+360)%360;
        spyData.textContent = 'ALT ' + String(Math.round(camera.position.y)).padStart(3,'0') + ' M\n' +
          'HDG ' + String(Math.round(hdg)).padStart(3,'0') + ' T\n' +
          'SUBJECTS ' + String(aliveN).padStart(2,'0');
      }

      being.visible = !orbital; // it would sit between the cannon and the ground
      updateBeing(time, dt);
      updateBoss(time, dt, now);
      updateRain(dt);

      if (near){
        const rel = Math.atan2(near.position.x - camera.position.x, near.position.z - camera.position.z);
        let off = ((rel - (yaw + Math.PI)) + Math.PI*3) % (Math.PI*2) - Math.PI;
        const arrow = Math.abs(off) < 0.14 ? 'AHEAD' : (off > 0 ? '<<' : '>>');
        el.bearing.textContent = arrow + ' ' + Math.round(nearD) + 'M';
      } else el.bearing.textContent = '---';

      /* leaflets */
      for (let i=leaflets.length-1;i>=0;i--){
        const L = leaflets[i];
        const lu = L.userData;
        lu.life -= dt;
        if (lu.life <= 0){ scene.remove(L); L.material.dispose(); leaflets.splice(i, 1); continue; }
        const gy = terrain(L.position.x, L.position.z) + 0.25;
        if (L.position.y > gy){
          lu.ph += dt*3.2;
          L.position.y += lu.vy*dt;
          L.position.x += (lu.sx + Math.sin(lu.ph)*1.2)*dt;
          L.position.z += (lu.sz + Math.cos(lu.ph*0.8)*1.2)*dt;
          L.rotation.x = Math.sin(lu.ph)*0.9;
          L.rotation.y += dt*0.6;
          L.rotation.z = Math.cos(lu.ph*0.7)*0.5;
        } else {
          L.position.y = gy;
        }
        if (lu.life < 1.5) L.material.opacity = lu.life/1.5;
      }

      /* missiles */
      for (let i=missiles.length-1;i>=0;i--){
        const ms = missiles[i];
        const k = (now - ms.t0)/ms.dur;
        if (k >= 1){
          scene.remove(ms.m);
          missiles.splice(i, 1);
          const pt = ms.ent && ms.ent.userData.alive ? ms.ent.position.clone() : ms.to;
          if (ms.leaflet) leafletBurst(pt);
          else explode(pt);
          if (ms.onArrive) ms.onArrive();
          continue;
        }
        ms.m.position.lerpVectors(ms.from, ms.to, k*k);
        ms.m.lookAt(ms.to);
      }

      /* fragment sequencer groups */
      for (let gi=fragGroups.length-1;gi>=0;gi--){
        const g = fragGroups[gi];
        const age = (now - g.t0)/1000;
        if (age < 0.35){
          for (const f of g.frags){
            if (!f) continue;
            f.userData.v.y -= 12*dt;
            f.position.addScaledVector(f.userData.v, dt);
            f.rotation.x += f.userData.spin.x*dt;
            f.rotation.z += f.userData.spin.z*dt;
          }
        } else {
          for (const f of g.frags){ if (f) f.rotation.y += dt*0.6; }
          if (!g.nextTrig) g.nextTrig = now + 420;
          if (now >= g.nextTrig){
            while (g.idx < g.frags.length && !g.frags[g.idx]) g.idx++;
            if (g.idx >= g.frags.length){ fragGroups.splice(gi, 1); continue; }
            const f = g.frags[g.idx];
            playFragPop();
            flash('#ffffff', 0.05); // each trigger barely blinks the screen
            crackBurst(f.position, f.material.color.getHex()); // each pop cracks its own fan of lines
            for (let pi=0;pi<3;pi++){
              const p = new THREE.Mesh(UNIT_TET, new THREE.MeshBasicMaterial({color:0xffffff, transparent:true}));
              p.scale.setScalar(0.3+Math.random()*0.4);
              p.position.copy(f.position);
              p.userData = {v:new THREE.Vector3((Math.random()-0.5)*8, 3+Math.random()*4, (Math.random()-0.5)*8),
                spin:new THREE.Vector3(4, 4, 4), life:0.45};
              scene.add(p); debris.push(p);
            }
            scene.remove(f); f.material.dispose();
            g.frags[g.idx] = null;
            g.idx++;
            g.nextTrig = now + 220;
            if (g.idx >= g.frags.length) fragGroups.splice(gi, 1);
          }
        }
      }

      /* debris */
      for (let i=debris.length-1;i>=0;i--){
        const d = debris[i];
        d.userData.life -= dt;
        d.userData.v.y -= 26*dt;
        d.position.addScaledVector(d.userData.v, dt);
        d.rotation.x += d.userData.spin.x*dt;
        d.rotation.z += d.userData.spin.z*dt;
        d.material.opacity = Math.max(0, d.userData.life/1.4);
        if (d.userData.life <= 0){ scene.remove(d); d.material.dispose(); debris.splice(i,1); }
      }

      /* crack lines: true infinite-reading edges, drawn through the impact point
         rather than as local segments — they just fade, geometry never moves.
         lines/lights are pooled (see burstLightPool/crackLinePool above), so
         "release" just means hide/zero it, never remove-from-scene or dispose */
      for (let i=shatterLines.length-1;i>=0;i--){
        const s = shatterLines[i];
        const age = (now - s.t0)/1000;
        const k = Math.max(0, 1 - age/s.life);
        // full strength for the first half, then thins out rather than just fading
        const kw = Math.min(1, k*2);
        s.line.material.opacity = Math.min(1, k*1.6);
        s.line.scale.set(s.w*kw, s.len, s.w*kw);
        if (age >= s.life){
          s.line.visible = false;
          shatterLines.splice(i, 1);
        }
      }
      for (const tr of tracerPool){
        if (!tr.live) continue;
        const k = 1 - (now - tr.t0)/1000/TRACER_LIFE;
        if (k <= 0){ tr.live = false; tr.core.visible = tr.sheath.visible = false; continue; }
        const cw = tr.w*Math.min(1, k*1.5);
        tr.core.scale.set(cw*0.5, tr.len, cw*0.5);
        tr.sheath.scale.set(cw, tr.len, cw);
        tr.sheath.material.opacity = 0.6*k;
      }
      for (let i=burstLights.length-1;i>=0;i--){
        const b = burstLights[i];
        const age = (now - b.t0)/1000;
        const k = Math.max(0, 1 - age/b.life);
        b.light.intensity = 9*k*k;
        if (age >= b.life){ b.light.intensity = 0; burstLights.splice(i, 1); }
      }

      /* flash decay */
      if (flashV > 0){ flashV -= dt*2.2; el.flash.style.opacity = Math.max(0, flashV); }

      skyMat.uniforms.top.value = cur.skyTop;
      skyMat.uniforms.bot.value = cur.skyBot;
      skyMat.uniforms.tme.value = time;
      grid.material.opacity = 0.14 + Math.sin(time*0.5)*0.05 + hatFlick*0.5;

      if (fleetMode){
        /* the command simulation: its own scene, its own print pipeline */
        fleetUpdate(dt, time);
        fleetRender();
        renderer.render(fleetPostScene, postCam);
      } else if (mode3){
        /* control room: operator view top-left, drone feed bottom-left,
           command simulation top-right (the DOM console sits bottom-right) */
        const W = viewW/2, H = viewH/2;
        renderer.setScissorTest(false);
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, viewW, viewH);
        renderer.setClearColor(0x0a0b09);
        renderer.clear();
        /* pass A: mode 1, the operator */
        camera.aspect = W/H; camera.updateProjectionMatrix();
        renderer.setRenderTarget(rt);
        renderer.setClearColor(cur.fog);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        postMat.uniforms.xr.value = 0;
        renderer.setViewport(0, H, W, H);
        renderer.setScissor(0, H, W, H);
        renderer.setScissorTest(true);
        renderer.render(postScene, postCam);
        /* pass B: mode 2, the feed above the operator */
        orbCam.aspect = W/H; orbCam.updateProjectionMatrix();
        orbCam.position.set(camera.position.x, 130, camera.position.z);
        orbCam.rotation.x = -1.45;
        orbCam.rotation.y = yaw;
        renderer.setScissorTest(false);
        renderer.setRenderTarget(rt);
        renderer.clear();
        /* the agents are single pixels from 130m up in a half-res quad —
           inflate them for this render pass only so the feed reads their motion */
        for (const b of birds) if (b.userData.alive) b.scale.multiplyScalar(3.5);
        for (const w of walkers) if (w.userData.alive) w.scale.multiplyScalar(2.5);
        being.visible = false; // hangs below the feed camera and would blot it out
        veg.visible = false;
        renderer.render(scene, orbCam);
        being.visible = !orbital;
        veg.visible = !orbital;
        for (const b of birds) if (b.userData.alive) b.scale.multiplyScalar(1/3.5);
        for (const w of walkers) if (w.userData.alive) w.scale.multiplyScalar(1/2.5);
        renderer.setRenderTarget(null);
        postMat.uniforms.xr.value = 1;
        postMat.uniforms.camY.value = 130;
        renderer.setViewport(0, 0, W, H);
        renderer.setScissor(0, 0, W, H);
        renderer.setScissorTest(true);
        renderer.render(postScene, postCam);
        /* pass C: mode 3, the command simulation, top-right */
        fleetUpdate(dt, time);
        renderer.setScissorTest(false);
        fleetRender();
        renderer.setViewport(W, H, W, H);
        renderer.setScissor(W, H, W, H);
        renderer.setScissorTest(true);
        renderer.render(fleetPostScene, postCam);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, viewW, viewH);
      } else if (szK > 0.002){
        /* the broken feed: sometimes through a camera that is not the operator's */
        const cam = szCamOn ? szCam : camera;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCam);
        drawSchizo(dt, time, cam);
      } else {
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(postScene, postCam);
      }
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      disposers.forEach(d => d());
      if (document.pointerLockElement === cvs) document.exitPointerLock();
      if (actx) actx.close();
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      rt.dispose();
      renderer.dispose();
      cvs.remove();
      ticks.replaceChildren();
      seqGrid.replaceChildren();
    };
  }, []);

  return (
    <div ref={rootRef} className="app">
      <div id="stage"></div>

      <div className="hud">
        <div className="readout tl">
          <span className="k">confirmed</span><span className="big" id="hits">000</span>
        </div>
        <div className="readout tr">
          <span className="k">precision</span> <span className="v" id="acc">--</span><br />
          <span className="k">shots</span> <span className="v" id="shots">000</span><br />
          <span className="k">range</span> <span className="v" id="range">---</span>
        </div>
        <div className="readout bl">
          <span className="k">world state</span> <span className="v" id="pal">01</span><br />
          <span className="k">contracts open</span> <span className="v" id="alive">00</span><br />
          <span className="k">nearest</span> <span className="v" id="bearing">---</span>
        </div>
        <div className="readout br"><span id="mode">standby</span></div>
        <div className="cross" id="cross"></div>
        <div className="scope" id="scope">
          <div className="ring"></div>
          <div className="h"></div><div className="v2"></div>
          <div className="ticks" id="ticks"></div>
          <div className="dot"></div>
          <div className="tag" id="scopetag">x6.0</div>
        </div>
      </div>
      <div className="flash" id="flash"></div>

      <div className="drone" id="drone">
        <div className="d-tl">
          <div className="d-call"><span className="d-sig">&#9646;&#9646;&#9647;</span>SHADOW-1</div>
          <div className="d-off">OFFLINE</div>
          <div className="d-coords" id="dcoords"></div>
        </div>
        <div className="d-tr"><span className="d-box">THERMAL</span><span className="d-norm">NORM</span></div>
        <div className="d-ret">
          <div className="c1"></div><div className="c2"></div>
          <span className="t tn"></span><span className="t ts"></span>
          <span className="t tw"></span><span className="t te"></span>
          <span className="cd"></span>
          <span className="cx cxn"></span><span className="cx cxs"></span>
          <span className="cx cxw"></span><span className="cx cxe"></span>
        </div>
        <div className="d-scale">
          <div className="bar"></div>
          <span className="tick" style={{top:0}}></span>
          <span className="tick" style={{top:'50%'}}></span>
          <span className="tick" style={{bottom:0}}></span>
          <span className="lab" style={{top:'-4px'}}>0m</span>
          <span className="lab" style={{top:'calc(50% - 5px)'}}>150m</span>
          <span className="lab" style={{bottom:'-4px'}}>300m</span>
          <span id="dmark">-- &#9656;</span>
        </div>
        <div className="d-bl">GEOPOINT<br/>INS NAV 0.42<br/>TDK COR<br/><span id="dconv">CONV 000</span></div>
        <div className="d-mm"><span>LTM</span><span>40MM</span><span>25MM</span></div>
      </div>

      <div className="fleet" id="fleet">
        <canvas className="fl-ov" id="fleetOv"></canvas>
        <div className="fl-box" id="fleetBox"></div>
        <div className="fl-tl">
          <div className="fl-title">COMMAND SIMULATION</div>
          <div className="fl-sub">BATTLE SCHOOL &middot; EROS &middot; THIRD INVASION</div>
          <div className="fl-obj">OBJECTIVE &middot; BREAK THE HOMEWORLD</div>
          <div className="fl-stat"><span className="k">your ships</span> <span className="v" id="fleetCount">00</span></div>
          <div className="fl-stat foe"><span className="k">contacts</span> <span className="v" id="fleetSwarm">000</span></div>
          <div className="fl-stat"><span className="k">selected</span> <span className="v" id="fleetSel">00</span></div>
          <div className="fl-roster" id="fleetRoster"></div>
          <div className="fl-stat"><span className="key hint">G</span> <span className="k">formation</span> <span className="v" id="fleetForm">GRID</span></div>
        </div>
        <div className="fl-tr">
          <div className="k">DR. DEVICE &middot; <span id="fleetDevTxt">READY</span></div>
          <div className="fl-meter"><i id="fleetDev"></i></div>
          <div className="k fl-gap">NEXT LAUNCH &middot; <span id="fleetRaidTxt">--</span></div>
          <div className="fl-meter foe"><i id="fleetRaid"></i></div>
          <div className="fl-clock" id="fleetClock">T+0000.0</div>
        </div>
        <div className="fl-tag" id="fleetTagA">YOUR FLEET</div>
        <div className="fl-tag foe" id="fleetTagB">HOMEWORLD</div>
        <div className="fl-aim" id="fleetAim"></div>
        <div className="fl-log" id="fleetLog"></div>
        <div className="fl-banner" id="fleetBanner"></div>
        <div className="fl-pause" id="fleetPause">CLOCK STOPPED<span className="hint"> &middot; P TO RESUME</span></div>
        <div className="fl-debrief" id="fleetDebrief"></div>
        <div className="fl-hud">
          <div className="fl-steps">
            <span><span className="key">DRAG</span> SELECT</span>
            <span><span className="key">RIGHT-CLICK</span> MOVE / ENGAGE</span>
            <span><span className="key">SHIFT</span> QUEUE WAYPOINT</span>
            <span><span className="key">F</span> FIRE DEVICE</span>
            <span><span className="key">SPACE</span> ALL</span>
            <span><span className="key">Q</span><span className="key">E</span><span className="key">R</span> BY CLASS</span>
            <span><span className="key">Z</span><span className="key">X</span><span className="key">C</span> SQUADS</span>
            <span><span className="key">H</span> HOLD</span>
            <span><span className="key">V</span> FALL BACK</span>
            <span><span className="key">P</span> STOP CLOCK</span>
          </div>
          <div className="fl-cam">
            MODE 3 &middot; <span className="key">WASD</span> PAN &middot; <span className="key">ARROWS</span>/MIDDLE-DRAG ORBIT
            &middot; WHEEL ZOOM &middot; CLICK MAP TO JUMP &middot; SHIFT+<span className="key">Z/X/C</span> SET SQUAD &middot; <span className="key">3</span> EXIT
          </div>
        </div>
      </div>

      <div className="spy" id="spy">
        <i className="s-c tl"></i><i className="s-c tr"></i><i className="s-c bl"></i><i className="s-c br"></i>
        <div className="s-tl"><span className="s-rec">&#9679;</span> REC &middot; UNIT-7<br/>OBSERVE ONLY</div>
        <div className="s-bl" id="spydata"></div>
      </div>

      <canvas className="sz" id="sz"></canvas>

      <div className="m3" id="m3">
        <div className="m3-frames">
          <div className="fr t"><span className="lab">Mode 1 &middot; Operator</span></div>
          <div className="fr b"><span className="lab">Mode 2 &middot; Shadow-1 Feed</span></div>
          <div className="fr r"><span className="lab">Mode 3 &middot; Command Sim<span className="hint"> &middot; drag &middot; right-click &middot; F</span></span></div>
        </div>

        <div className="m3-quad br">
          <div className="m3-sheet">
            <div className="m3-sheet-bar">
              <span className="file">DRUM_PATTERN.xlsx</span>
              <span className="tab">Sheet1</span>
            </div>
            <div className="m3-sheet-fx">
              <span className="m3-sheet-ref" id="m3ref">A1</span>
              <span className="m3-sheet-fxicon">fx</span>
              <span className="m3-sheet-formula" id="m3formula"></span>
            </div>
            <div className="m3-sheet-grid">
              <table id="m3sheet"></table>
            </div>
          </div>
          <div className="m3-app">
            <div className="m3-head">
              <div>
                <div className="m3-title">TaskQueue</div>
                <div className="m3-sub" id="m3open">0 open items</div>
              </div>
              <div className="m3-right">
                <div className="m3-goal" id="m3goal">Daily goal 0/12</div>
                <label className="m3-auto">
                  <input type="checkbox" id="m3auto" /> Auto-approve <span>(recommended)</span>
                </label>
              </div>
            </div>
            <div className="m3-list" id="m3list"></div>
            <div className="m3-foot">
              All items are pre-reviewed by the system. Approval is a formality.<br/>
              You are not responsible for outcomes.
            </div>
          </div>
        </div>
        <div className="m3-toast" id="m3toast"></div>
      </div>

      <div className="seq" id="seq">
        <svg id="seqgrid" viewBox="-100 -100 200 200"></svg>
        <div className="cap">WORLD SEQUENCER &middot; AUTOPILOT<span className="hint"> &mdash; M CLOSE &middot; TAP ARCS</span></div>
        <button className="shuf" id="shuf" type="button">SHUFFLE</button>
      </div>

      <div className="destroy" id="destroy">
        <canvas id="destroyCanvas"></canvas>
        <div className="destroy-strobe" id="destroyStrobe"></div>
        <div className="destroy-drone" id="destroyDrone">◆</div>
        <div className="destroy-hud">
          MODE 5 · DESKTOP DESTROYER — CLICK TO DAMAGE · <span className="key">Q</span> HAMMER
          · <span className="key">W</span> MACHINE GUN · <span className="key">E</span> GLITCH
          · <span className="key">R</span> VIRUS · <span className="key">Y</span> DRONE
          · <span className="key">T</span> COVER ON/OFF · <span className="key">5</span> EXIT
        </div>
      </div>
      <div className="brat" id="brat"><span id="bratWord">hammer</span></div>

      <div className="settings" id="settings">
        <div className="set-card">
          <div className="set-head">
            <span className="set-title">SETTINGS</span>
            <span className="set-close" id="setClose">[ . ] CLOSE</span>
          </div>
          <div className="set-row">
            <label>RESOLUTION</label>
            <select id="setRes" defaultValue="native">
              <option value="native">WINDOW (NATIVE)</option>
              <option value="1792x768">1792 × 768</option>
            </select>
          </div>
          <div className="set-row">
            <label>OUTPUT DEVICE</label>
            <select id="setSink"></select>
          </div>
          <div className="set-row">
            <label>MIDI · AKAI MIDIMIX</label>
            <span className="set-note" id="setMidi">waiting for midi permission…</span>
            <span className="set-note" id="setMidiMap" style={{cursor:'pointer'}}></span>
            <span className="set-note">columns: KICK · SNARE · HAT · PERC · SHOT · HITS · GLITCH · DRONE — knobs: TUNE / FILTER / DELAY — fader: LEVEL — MUTE mutes — REC ARM triggers — BANK ◂ ▸ tempo — press , for the full map</span>
          </div>
          <div className="set-row">
            <label>SAMPLE FOLDER</label>
            <div className="set-file">
              <input type="file" id="setFolder" webkitdirectory="" directory="" multiple />
              <span className="set-note" id="setCount">no samples loaded — folder is scanned recursively, files trimmed to 5s</span>
            </div>
          </div>
          <div className="set-grid" id="setSlots"></div>
        </div>
      </div>

      <div className="mmx" id="mmx">
        <div className="mmx-card">
          <div className="set-head">
            <span className="set-title">MIDIMIX MAP</span>
            <span className="set-close" id="mmxClose">[ , ] CLOSE</span>
          </div>
          <span className="set-note" id="mmxStatus">waiting for midi permission…</span>
          <div className="mmx-grid" id="mmxGrid"></div>
          <dl className="mmx-legend">
            <dt>COLUMNS</dt><dd>one mixer strip each: KICK · SNARE · HAT · PERC are the drum machine, SHOT is the rifle, HITS is whatever a round strikes, GLITCH the glitch samples, DRONE the bed under everything</dd>
            <dt>TUNE</dt><dd>top knob — repitches the voice, two octaves down to two octaves up; centre is the original pitch</dd>
            <dt>FILTER</dt><dd>middle knob — resonant lowpass sweep from 40Hz; it whistles harder the further left it goes, fully right is wide open</dd>
            <dt>DELAY</dt><dd>bottom knob — how much of the strip feeds the shared tempo delay (dotted eighth echoes); the hottest send also pushes the feedback toward runaway</dd>
            <dt>MUTE</dt><dd>silences the strip; the button stays lit while muted</dd>
            <dt>REC ARM</dt><dd>plays the strip&rsquo;s voice by hand; on DRONE it re-rolls the bed sample</dd>
            <dt>LEVEL</dt><dd>fader — strip volume, unity at about 80% of travel, a little boost above</dd>
            <dt>MASTER</dt><dd>right-hand fader — output volume of the whole mix</dd>
            <dt>BANK ◂ ▸</dt><dd>tempo down / up 2 bpm (60 to 200); the delay time follows</dd>
            <dt>SEND ALL</dt><dd>on the unit — transmits every knob and fader position at once, so this map matches the hardware. SOLO is unused</dd>
          </dl>
        </div>
      </div>

      <div className="gate" id="gate">
        <div className="introBg">
          <div className="introLens" />
          <div className="introHalftone" />
          <div className="introScan" />
          <div className="introGrain" />
        </div>
        <div className="introCrawlWrap">
          <div className="introGhost" id="introGhost" />
          <div className="introCrawl" id="introCrawl" />
        </div>
        <div className="introSim"><canvas id="introSim" /></div>
        <div className="introFlash" id="introFlash" />
        <div className="introHairH" id="introHairH" />
        <div className="introHairV" id="introHairV" />
        <div className="introScope" id="introScope">
          <svg viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="15" />
            <line x1="26" y1="2" x2="26" y2="14" />
            <line x1="26" y1="38" x2="26" y2="50" />
            <line x1="2" y1="26" x2="14" y2="26" />
            <line x1="38" y1="26" x2="50" y2="26" />
          </svg>
        </div>
      </div>
    </div>
  );
}
