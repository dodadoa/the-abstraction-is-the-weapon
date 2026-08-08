'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

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

    /* ---------------------------------------------------------- three setup */
    const stage = $('#stage');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(78, innerWidth/innerHeight, 0.1, 2000);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 3.2, 0);
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    renderer.setSize(innerWidth, innerHeight);
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
    /* crack lines: not segments — each edge direction is drawn straight through
       the impact point out toward the horizon in both directions, so the shard
       reads as a fracture in the whole scene's geometry, not a local decal */
    function crackBurst(pos, color){
      const CRACK_LEN = 640;
      const rot = new THREE.Euler(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
      TET_EDGE_DIRS.forEach((d, i)=>{
        const dir = d.clone().applyEuler(rot);
        const a = pos.clone().addScaledVector(dir, -CRACK_LEN);
        const b = pos.clone().addScaledVector(dir, CRACK_LEN);
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const mat = new THREE.LineBasicMaterial({
          color:i % 2 ? 0xffffff : color, transparent:true, opacity:0.95,
          blending:THREE.AdditiveBlending, depthWrite:false
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        shatterLines.push({line, t0:performance.now(), life:0.32 + Math.random()*0.18});
      });
      const pl = new THREE.PointLight(color, 9, 70, 2);
      pl.position.copy(pos);
      scene.add(pl);
      burstLights.push({light:pl, t0:performance.now(), life:0.3});
    }
    function fragBurst(pos, color){
      const frags = [];
      for (let i=0;i<8;i++){
        const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.5+Math.random()*0.6),
          new THREE.MeshBasicMaterial({color, transparent:true}));
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
      flash('#ffffff', 0.7);
    }
    function playFragNote(i, pos){
      if (!actx) return;
      const t = actx.currentTime;
      const root = PALETTES[palIndex % PALETTES.length].root * 8;
      const f = root * Math.pow(2, SCALE[(i*2+2) % SCALE.length]/12);
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const flt = actx.createBiquadFilter(); flt.type = 'bandpass';
      flt.frequency.value = f*2; flt.Q.value = 4;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t+0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.35);
      const pan = actx.createStereoPanner ? actx.createStereoPanner() : actx.createGain();
      if (pan.pan){
        const ndc2 = pos.clone().project(camera);
        pan.pan.value = Math.max(-1, Math.min(1, ndc2.x));
      }
      o.connect(flt); flt.connect(g); g.connect(pan); pan.connect(master);
      o.start(t); o.stop(t+0.4);
    }

    /* debris */
    const debris = [];
    function burst(pos, color){
      for (let i=0;i<7;i++){
        const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.5+Math.random()*0.5),
          new THREE.MeshBasicMaterial({color, transparent:true}));
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
    function initAudio(){
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.0;
      shelf = actx.createBiquadFilter(); shelf.type='lowpass'; shelf.frequency.value=5200;
      master.connect(shelf); shelf.connect(actx.destination);
      master.gain.linearRampToValueAtTime(0.85, actx.currentTime + 2.2);

      noiseBuf = actx.createBuffer(1, actx.sampleRate*2, actx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i=0;i<nd.length;i++) nd[i] = Math.random()*2-1;

      uiBus = actx.createGain(); uiBus.gain.value = 0.5;
      uiBus.connect(actx.destination); // dry and close: bypasses the muffle shelf

      droneGain = actx.createGain(); droneGain.gain.value = 0.075;
      const lp = actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=280; lp.Q.value=6;
      droneGain.connect(lp); lp.connect(master);
      const root = PALETTES[0].root;
      [1, 1.005, 2.001, 3.002].forEach((mul,i)=>{
        const o = actx.createOscillator();
        o.type = i>1 ? 'triangle' : 'sawtooth';
        o.frequency.value = root*mul;
        const g = actx.createGain(); g.gain.value = i>1 ? 0.25 : 0.7;
        o.connect(g); g.connect(droneGain); o.start();
        droneOsc.push(o);
      });
      // wind bed
      const n = actx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = actx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=420; bp.Q.value=1.2;
      const ng = actx.createGain(); ng.gain.value = 0.035;
      n.connect(bp); bp.connect(ng); ng.connect(master); n.start();
      drift = bp;
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
      p.connect(master);

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
      cg.connect(d); d.connect(dg); dg.connect(master);
    }
    function playShot(isScoped){
      if (!actx) return;
      const t = actx.currentTime;
      const n = actx.createBufferSource(); n.buffer = noiseBuf;
      const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = isScoped?900:1400;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t+0.16);
      const o = actx.createOscillator(); o.type='square';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(38, t+0.1);
      const og = actx.createGain();
      og.gain.setValueAtTime(0.16, t); og.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
      o.connect(og); og.connect(master); o.start(t); o.stop(t+0.14);
    }

    function playDrum(r, t){
      if (!actx) return;
      if (r === 0){ // kick
        const o = actx.createOscillator(); o.type='sine';
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t+0.12);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.28);
        o.connect(g); g.connect(master); o.start(t); o.stop(t+0.3);
      } else if (r === 1){ // snare
        const n = actx.createBufferSource(); n.buffer = noiseBuf;
        const f = actx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1800; f.Q.value=0.8;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
        n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t+0.2);
        const o = actx.createOscillator(); o.type='triangle'; o.frequency.value=190;
        const og = actx.createGain();
        og.gain.setValueAtTime(0.22, t); og.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
        o.connect(og); og.connect(master); o.start(t); o.stop(t+0.12);
      } else if (r === 2){ // hat
        const n = actx.createBufferSource(); n.buffer = noiseBuf; n.playbackRate.value = 1.4;
        const f = actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=6000;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.05);
        n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t+0.07);
      } else { // perc blip tuned to the current palette root
        const root = PALETTES[palIndex % PALETTES.length].root * 8;
        const o = actx.createOscillator(); o.type='square';
        o.frequency.setValueAtTime(root, t);
        o.frequency.exponentialRampToValueAtTime(root*0.5, t+0.09);
        const g = actx.createGain();
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
        o.connect(g); g.connect(master); o.start(t); o.stop(t+0.14);
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
      s.style.left = (i*3.1)+'vmin'; s.style.top = '-3px';
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
    function enter(){
      initAudio();
      if (actx.state === 'suspended') actx.resume();
      running = true;
      gate.classList.add('hide');
      if (cvs.requestPointerLock){
        try { cvs.requestPointerLock(); } catch(err){}
        setTimeout(()=>{ if (!locked && !orbital && !worldMode) modeEl.textContent = 'drag to look'; }, 400);
      } else {
        modeEl.textContent = 'drag to look';
      }
    }
    on(gate, 'click', enter);
    on(document, 'pointerlockerror', ()=>{ modeEl.textContent = 'drag to look'; });
    on(document, 'pointerlockchange', ()=>{
      locked = document.pointerLockElement === cvs;
      modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      if (!locked) scoped = false;
    });

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
      if (e.target.closest && e.target.closest('.seq,.m3')) return;
      if (mode3) return;
      if (e.button === 2 && !orbital) scoped = true;
      if (e.button === 2 && orbital){ launchMissile(e.clientX, e.clientY, true); return; }
      if (locked){
        if (e.button === 0){
          if (orbital) launchMissile(innerWidth/2, innerHeight/2);
          else fire();
        }
        return;
      }
      drag = true; dragged = 0;
    });
    on(window, 'mouseup', e=>{
      if (e.target.closest && e.target.closest('.seq,.m3')){ drag = false; return; }
      if (mode3){ drag = false; return; }
      if (e.button === 2) scoped = false;
      if (!locked && running && e.button === 0 && drag && dragged < 8){
        if (orbital) launchMissile(e.clientX, e.clientY);
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
      tx = t.clientX; ty = t.clientY; tMoved = 0; tStart = performance.now();
      scoped = e.touches.length > 1;
    }, {passive:false});
    on(cvs, 'touchmove', e=>{
      if (!running) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - tx, dy = t.clientY - ty;
      tx = t.clientX; ty = t.clientY;
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
    on(window, 'resize', ()=>{
      camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      rt.setSize(s.x, s.y);
      postMat.uniforms.res.value.set(s.x, s.y);
    });

    /* ---------------------------------------------------------- world mode: sequencer + render modes */
    const seqEl = $('#seq');
    const seqGrid = $('#seqgrid');
    const STEPS = 16, BPM = 128, STEP_T = 60/BPM/4;
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

    let snarePulse = 0, hatFlick = 0;
    /* the node ring's voice: a soft pluck tuned to the current world root */
    function playNode(s, t){
      if (!actx) return;
      const root = PALETTES[palIndex % PALETTES.length].root * 8;
      const f = root * Math.pow(2, SCALE[s % SCALE.length]/12);
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const o2 = actx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f*1.005;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t+0.6);
      o.connect(g); o2.connect(g); g.connect(master);
      o.start(t); o2.start(t); o.stop(t+0.65); o2.stop(t+0.65);
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
        dk:{value:1}, bl:{value:0} },
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader:`
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 res;
        uniform float xr; uniform float camY; uniform float dk; uniform float bl;
        varying vec2 vUv;
        float bayer2(vec2 a){ a = floor(a); return fract(a.x/2.0 + a.y*a.y*0.75); }
        float linZ(float z){
          float n = 0.1; float f = 2000.0;
          float zn = z*2.0 - 1.0;
          return (2.0*n*f)/(f + n - zn*(f - n));
        }
        void main(){
          vec2 uv = (floor(vUv*res/2.0)*2.0 + 1.0)/res;
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
          vec2 p = gl_FragCoord.xy/2.0;
          float d = bayer2(0.5*p)*0.25 + bayer2(p);
          d = d*0.8 - 0.5;
          float levels = 5.0;
          vec3 q = clamp(floor(c*levels + d + 0.5)/levels, 0.0, 1.0);
          /* dither fades out as the x-ray fades in */
          c = mix(q, c, xr);
          /* strobe bloom: bright pixels spill outward while the rig runs */
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
          gl_FragColor = vec4(c*dk, 1.0);
        }`
    });
    const postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), postMat));

    /* second camera for the mode-3 control room: the drone feed panel */
    const orbCam = new THREE.PerspectiveCamera(78, 1, 0.1, 2000);
    orbCam.rotation.order = 'YXZ';

    /* sequencer clock */
    let worldMode = false, step = 0, nextStep = 0;
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
      seqEl.classList.toggle('on', v);
      if (v){
        initAudio();
        if (actx.state === 'suspended') actx.resume();
        if (document.pointerLockElement === cvs) document.exitPointerLock();
        step = 0; nextStep = actx.currentTime + 0.1;
        modeEl.textContent = 'autopilot engaged, 1 to close';
      } else {
        cellEls.forEach(row=>row.forEach(c=>c.classList.remove('play')));
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
    }
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

    /* mode 3: the tasking console — every element is one of Bandura's mechanisms,
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
    }
    function uiMotif(){
      if (!actx) return;
      const t = actx.currentTime;
      [[880, 0], [1108.7, 0.13]].forEach(([f, d])=>{
        const o = actx.createOscillator(); o.type='sine'; o.frequency.value = f;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t+d);
        g.gain.exponentialRampToValueAtTime(0.12, t+d+0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t+d+0.35);
        o.connect(g); g.connect(uiBus); o.start(t+d); o.stop(t+d+0.4);
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
      const pool = [...targets, ...birds].filter(t=>t.userData.alive).slice(0, 6);
      pool.forEach((ent, idx)=>{
        const row = document.createElement('div'); row.className = 'm3-row';
        const id = 'TCK-' + (1000 + ((Math.random()*9000)|0));
        const conf = 94 + ((Math.random()*6)|0);
        const kind = ent.userData.kind === 'bird' ? 'Transient signal' : 'Anomaly cluster';
        const left = document.createElement('div');
        left.innerHTML = '<div>' + id + ' · ' + kind + '</div>' +
          '<div class="meta">Sector ' + SECTORS[(Math.random()*8)|0] +
          ' · flagged by system · confidence ' + conf + '% · pre-reviewed ✓</div>' +
          '<div class="bar"><i></i></div>';
        const btn = document.createElement('button');
        btn.textContent = 'Approve';
        row.addEventListener('mouseenter', ()=>uiTick(idx));
        btn.addEventListener('click', ()=>{
          if (row.classList.contains('done')) return;
          row.classList.add('done', 'queued');
          btn.textContent = 'Queued';
          m3Queue.push({ent, row, btn});
          resolvedCount++;
          m3Goal.textContent = 'Daily goal ' + resolvedCount + '/12';
          if (resolvedCount % 3 === 0) m3ToastShow(PRAISE[(Math.random()*PRAISE.length)|0]);
          const open = m3List.querySelectorAll('.m3-row:not(.done)').length;
          m3Open.textContent = open + ' open items';
          if (!open) setTimeout(m3Refresh, 4000);
        });
        row.appendChild(left); row.appendChild(btn);
        m3List.appendChild(row);
      });
      m3Open.textContent = pool.length + ' open items';
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
        if (!worldMode) setWorldMode(true); // the operation runs behind the console
        seqEl.classList.remove('on');       // clock keeps ticking, panel stays out of frame
        el.hud.classList.add('mini');
        el.drone.classList.add('on', 'mini');
        modeEl.textContent = 'tasking console, 3 to close';
      } else {
        if (worldMode) seqEl.classList.add('on');
        el.hud.classList.remove('mini');
        el.drone.classList.remove('mini');
        el.drone.classList.toggle('on', orbital);
        camera.aspect = innerWidth/innerHeight;
        camera.updateProjectionMatrix();
        modeEl.textContent = locked ? 'mouse held, esc to release' : 'drag to look';
      }
      // the world gets quiet and far away in here
      if (actx && shelf) shelf.frequency.linearRampToValueAtTime(v ? 700 : 5200, actx.currentTime + 0.8);
    }

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

    on(window, 'keydown', e=>{
      if (e.repeat) return;
      if (e.code === 'Digit1') setWorldMode(!worldMode);
      if (e.code === 'Digit2') setOrbital(!orbital);
      if (e.code === 'Digit3') setMode3(!mode3);
      if (e.code === 'Digit0') setStrobe(!strobe);
    });

    /* ---------------------------------------------------------- firing */
    const ray = new THREE.Raycaster();
    const dirV = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    function fire(){
      const now = performance.now();
      if (now - lastShot < 480) return;
      lastShot = now;
      shots++;
      recoil += scoped ? 0.022 : 0.06;
      playShot(scoped);

      camera.getWorldDirection(dirV);
      if (!scoped){
        dirV.x += (Math.random()-0.5)*0.035;
        dirV.y += (Math.random()-0.5)*0.035;
        dirV.z += (Math.random()-0.5)*0.035;
        dirV.normalize();
      }
      ray.set(camera.getWorldPosition(new THREE.Vector3()), dirV);
      const live = [...targets, ...birds].filter(t=>t.userData.alive);
      const hitT = ray.intersectObjects(live, false);
      const hitW = ray.intersectObjects([ground, ...bGroup.children], false);
      const dT = hitT.length ? hitT[0].distance : Infinity;
      const dW = hitW.length ? hitW[0].distance : Infinity;

      if (dT < dW){
        const t = hitT[0].object;
        killThing(t, now);
        addRipple(t.position.x, t.position.z, 5.5);
        // sky and land turn over
        palIndex++;
        setPalette(palIndex, false);
        retune(PALETTES[palIndex % PALETTES.length].root);
        const local = t.position.clone().project(camera);
        playHit(hits-1, local.x, dT);
        flash(cur.mark.getStyle(), 0.5);
        el.range.textContent = String(Math.round(dT)).padStart(3,'0');
      } else if (dW < Infinity){
        addRipple(hitW[0].point.x, hitW[0].point.z, 1.4);
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
      for (const t of [...targets, ...birds]){
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
      ndc.set((cx/innerWidth)*2 - 1, -(cy/innerHeight)*2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(
        [ground, ...bGroup.children, ...[...targets, ...birds].filter(t=>t.userData.alive)], false);
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
    }
    function boom(){
      if (!actx) return;
      const t = actx.currentTime;
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
    }
    function explode(point){
      const now = performance.now();
      burst(point, cur.mark.getHex());
      addRipple(point.x, point.z, 6.5);
      let killed = 0;
      for (const t of [...targets, ...birds]){
        if (t.userData.alive && t.position.distanceTo(point) < 15){ killThing(t, now); killed++; }
      }
      shots++;
      if (killed){
        palIndex++;
        setPalette(palIndex, false);
        retune(PALETTES[palIndex % PALETTES.length].root);
        playHit(hits-1, 0, camera.position.distanceTo(point));
      }
      boom();
      flash(cur.mark.getStyle(), killed ? 0.5 : 0.25);
      el.range.textContent = String(Math.round(camera.position.distanceTo(point))).padStart(3,'0');
      updateStats();
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
      if (worldMode && actx){
        // after a long RAF stall (hidden tab), skip missed steps instead of bursting them
        if (actx.currentTime - nextStep > 0.5) nextStep = actx.currentTime + 0.05;
        while (nextStep < actx.currentTime + 0.12){
          const s = step % STEPS;
          for (let r=0;r<4;r++) if (pattern[r][s]){ playDrum(r, nextStep); worldHit(r); }
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
            if (mode3){
              m3El.classList.add('hit');
              setTimeout(()=>m3El.classList.remove('hit'), 200);
            }
          });
          job.btn.textContent = 'Resolving…';
          job.row.classList.remove('queued');
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
      if (keys.Enter || keys.KeyF) fire();

      /* movement */
      let speed = (keys.ShiftLeft||keys.ShiftRight ? 22 : 12);
      let fwd = (keys.KeyW?1:0) - (keys.KeyS?1:0);
      let str = (keys.KeyD?1:0) - (keys.KeyA?1:0);

      /* autopilot: the player is a bot while the sequencer runs */
      if (worldMode && !orbital){
        let best = null, bd = Infinity;
        for (const t of [...targets, ...birds]) if (t.userData.alive){
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
      if (wish.lengthSq()) wish.normalize();
      const mult = scoped ? 0.35 : 1;
      vel.x += (wish.x*speed*mult - vel.x) * Math.min(1, dt*11);
      vel.z += (wish.z*speed*mult - vel.z) * Math.min(1, dt*11);
      if (orbital){
        speed = 60;
        vel.y = 0;
      } else {
        vel.y -= 30*dt;
        if (onGround && keys.Space) { vel.y = 10.5; onGround = false; }
        // pressed against a wall: spacebar scrambles upward in pulses
        else if (wallTouch && keys.Space && vel.y < 2) vel.y = 11.5;
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
      for (const b of boxes){
        const dx = camera.position.x - b.x, dz = camera.position.z - b.z;
        const px = b.hw + 0.9 - Math.abs(dx), pz = b.hd + 0.9 - Math.abs(dz);
        if (px <= 0 || pz <= 0) continue;
        const feet = camera.position.y - 3.2;
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
        camera.position.y = roofY + 3.2;
        vel.y = 0;
        onGround = true;
      }

      const gh = terrain(camera.position.x, camera.position.z) + 3.2;
      if (!orbital && camera.position.y <= gh){ camera.position.y = gh; vel.y = 0; onGround = true; }
      if (orbital){
        camera.position.y += (130 - camera.position.y) * Math.min(1, dt*2.5);
        pitch += (-1.45 - pitch) * Math.min(1, dt*4);
      }
      scene.fog.density += ((orbital ? 0.0025 : 0.0085) - scene.fog.density) * Math.min(1, dt*3);
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
            L.intensity = lu.peak;
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
      /* global light breathes with the cycle — never fully dark — and blooms */
      const sPulse = Math.pow(Math.sin(time*Math.PI*2/1.6)*0.5 + 0.5, 2);
      strobeK += ((strobe ? 0.55 + 0.5*sPulse : 1) - strobeK) * Math.min(1, dt*8);
      sun.intensity = 0.9*Math.PI*strobeK;
      amb.intensity = 0.45*Math.PI*(0.55 + 0.45*strobeK);
      dkV += ((strobe ? 0.85 + 0.35*sPulse : 1) - dkV) * Math.min(1, dt*10);
      postMat.uniforms.dk.value = dkV;
      bloomV += ((strobe ? 1 : 0) - bloomV) * Math.min(1, dt*2.5);
      postMat.uniforms.bl.value = bloomV;

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
      fovTarget = scoped ? 13 : 78;
      fov += (fovTarget - fov) * Math.min(1, dt*13);
      camera.fov = fov; camera.updateProjectionMatrix();
      recoil *= Math.pow(0.02, dt);
      sway += dt * (scoped ? 1.1 : 2.4);
      const breath = scoped ? 0.0016 + Math.min(0.004, (Math.abs(vel.x)+Math.abs(vel.z))*0.0009) : 0;
      camera.rotation.y = yaw + Math.sin(sway*0.7)*breath*1.6;
      camera.rotation.x = pitch + recoil + Math.sin(sway)*breath;

      el.scope.classList.toggle('on', scoped);
      el.cross.style.opacity = (scoped || orbital) ? 0 : 0.85;
      gun.visible = !scoped && !orbital;
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
      for (const t of targets){
        if (t.userData.alive){
          aliveN++;
          const ud = t.userData;
          t.position.x += ud.vel.x*dt;
          t.position.z += ud.vel.z*dt;
          if (Math.abs(t.position.x) > 130) ud.vel.x *= -1;
          if (Math.abs(t.position.z) > 130) ud.vel.z *= -1;
          const gy = terrain(t.position.x, t.position.z);
          t.position.y = gy + ud.hover + Math.sin(time*0.9 + ud.phase)*1.4;
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
      for (const b of birds){
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
      el.alive.textContent = String(aliveN).padStart(2,'0');

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
            playFragNote(g.idx, f.position);
            flash('#ffffff', 0.16); // each trigger blinks the screen
            crackBurst(f.position, f.material.color.getHex()); // each pop cracks its own fan of lines
            for (let pi=0;pi<3;pi++){
              const p = new THREE.Mesh(new THREE.TetrahedronGeometry(0.3+Math.random()*0.4),
                new THREE.MeshBasicMaterial({color:0xffffff, transparent:true}));
              p.position.copy(f.position);
              p.userData = {v:new THREE.Vector3((Math.random()-0.5)*8, 3+Math.random()*4, (Math.random()-0.5)*8),
                spin:new THREE.Vector3(4, 4, 4), life:0.45};
              scene.add(p); debris.push(p);
            }
            scene.remove(f); f.geometry.dispose(); f.material.dispose();
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
        if (d.userData.life <= 0){ scene.remove(d); d.geometry.dispose(); d.material.dispose(); debris.splice(i,1); }
      }

      /* crack lines: true infinite-reading edges, drawn through the impact point
         rather than as local segments — they just fade, geometry never moves */
      for (let i=shatterLines.length-1;i>=0;i--){
        const s = shatterLines[i];
        const age = (now - s.t0)/1000;
        const k = Math.max(0, 1 - age/s.life);
        s.line.material.opacity = k*k*0.95;
        if (age >= s.life){
          scene.remove(s.line); s.line.geometry.dispose(); s.line.material.dispose();
          shatterLines.splice(i, 1);
        }
      }
      for (let i=burstLights.length-1;i>=0;i--){
        const b = burstLights[i];
        const age = (now - b.t0)/1000;
        const k = Math.max(0, 1 - age/b.life);
        b.light.intensity = 9*k*k;
        if (age >= b.life){ scene.remove(b.light); burstLights.splice(i, 1); }
      }

      /* flash decay */
      if (flashV > 0){ flashV -= dt*2.2; el.flash.style.opacity = Math.max(0, flashV); }

      skyMat.uniforms.top.value = cur.skyTop;
      skyMat.uniforms.bot.value = cur.skyBot;
      skyMat.uniforms.tme.value = time;
      grid.material.opacity = 0.14 + Math.sin(time*0.5)*0.05 + hatFlick*0.5;

      if (mode3){
        /* control room: operator view top-left, drone feed bottom-left */
        const W = innerWidth/2, H = innerHeight/2;
        renderer.setScissorTest(false);
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, innerWidth, innerHeight);
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
        renderer.render(scene, orbCam);
        renderer.setRenderTarget(null);
        postMat.uniforms.xr.value = 1;
        postMat.uniforms.camY.value = 130;
        renderer.setViewport(0, 0, W, H);
        renderer.setScissor(0, 0, W, H);
        renderer.setScissorTest(true);
        renderer.render(postScene, postCam);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, innerWidth, innerHeight);
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
    <div ref={rootRef}>
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

      <div className="m3" id="m3">
        <div className="m3-frames">
          <div className="fr t"><span className="lab">Mode 1 &middot; Operator</span></div>
          <div className="fr b"><span className="lab">Mode 2 &middot; Shadow-1 Feed</span></div>
        </div>

        <div className="m3-quad tr">
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
        </div>

        <div className="m3-quad br">
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
        <div className="cap">WORLD SEQUENCER &middot; AUTOPILOT &mdash; 1 CLOSE &middot; TAP ARCS</div>
      </div>

      <div className="gate" id="gate">
        <div className="card">
          <h1>THE ABSTRACTION IS THE WEAPON</h1>
          <p><span className="key">WASD</span> walk. <span className="key">SHIFT</span> hurry. <span className="key">SPACE</span> hop &mdash; hold it against a wall to scramble up and stand on the roof.</p>
          <p><span className="key">MOUSE</span> look. If the browser refuses to hide the cursor, drag instead. The corner tells you which mode you got.</p>
          <p><span className="key">RIGHT MOUSE</span> hold to glass the horizon. <span className="key">LEFT MOUSE</span> fire, or <span className="key">ARROWS</span> to turn if the mouse is being difficult.</p>
          <p>Targets are the spinning octahedrons on the pale beams. The corner readout gives you a bearing to the closest one.</p>
          <p>Every confirmed hit retunes the ground and repaints the sky. The drone follows. That is the whole instrument.</p>
          <p><span className="key">1</span> opens the world sequencer: a drum machine that shakes the terrain while an autopilot takes your gun. White arrows show where everything is headed.</p>
          <p><span className="key">2</span> ascends to the orbital feed: <span className="key">LEFT CLICK</span> calls a missile down. <span className="key">RIGHT CLICK</span> drops leaflets instead; whatever reads them lays down its arms.</p>
          <p><span className="key">3</span> opens the tasking console. It is the most comfortable way to do the worst thing.</p>
          <p><span className="key">0</span> strikes the braam and wakes the strobe rig: nine colored lights circling the dome, flashing in turn.</p>
          <div className="go">CLICK TO ENTER</div>
        </div>
      </div>
    </div>
  );
}
