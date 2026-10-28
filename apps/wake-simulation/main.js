import './helpers.js';

(async function(){
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2');
  if(!gl){ alert('WebGL2 required'); return; }

  // helpers
  function fetchText(url){ return fetch(url).then(r=>{ if(!r.ok) throw new Error(r.statusText); return r.text() }); }
  function compileShader(src, type){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function createProgram(vsSrc, fsSrc){ const p = gl.createProgram(); gl.attachShader(p, compileShader(vsSrc, gl.VERTEX_SHADER)); gl.attachShader(p, compileShader(fsSrc, gl.FRAGMENT_SHADER)); gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

  // load shaders
  const surfVS = await fetchText('./surface.vert.glsl');
  const surfFS = await fetchText('./surface.frag.glsl');
  const modelVS = await fetchText('./model.vert.glsl');
  const modelFS = await fetchText('./model.frag.glsl');

  // UI elements
  const resEl = document.getElementById('res');
  const resLabel = document.getElementById('resLabel');
  const psEl = document.getElementById('ps');
  const psLabel = document.getElementById('psLabel');
  const ampEl = document.getElementById('amp');
  const ampLabel = document.getElementById('ampLabel');
  const spdEl = document.getElementById('spd');
  const spdLabel = document.getElementById('spdLabel');
  const modeEl = document.getElementById('mode');

  // notes sidebar: static content in HTML (non-editable by users)
  const notesContent = document.getElementById('notesContent');
  // load external notes file (edit apps/wake-simulation/notes.html)
  if(notesContent){
    try{ fetchText('./notes.html').then(txt=>{ notesContent.innerHTML = txt; }).catch(()=>{}); }catch(e){}
  }

  // boat controls in the UI (sliders removed; position follows path or is set programmatically)

  // path editor UI
  const overlay = document.getElementById('overlay');
  const toggleEditBtn = document.getElementById('toggleEdit');
  const playPathBtn = document.getElementById('playPath');
  const clearPathBtn = document.getElementById('clearPath');
  const pathSpeedEl = document.getElementById('pathSpeed');
  const pathSpeedLabel = document.getElementById('pathSpeedLabel');

  // spline state
  let controlPoints = []; // [{x,z}]
  let isEditMode = false;
  let dragging = false;
  let dragIndex = -1;
  let pathSamples = []; // world vec3 samples along spline
  let pathLengths = []; // cumulative lengths
  let pathTotalLength = 0;
  let follow = false;
  let followDistance = 0;
  let pathSpeed = parseFloat(pathSpeedEl.value) || 1.0; // units per second

  pathSpeedEl.addEventListener('input', ()=>{ pathSpeed = parseFloat(pathSpeedEl.value); pathSpeedLabel.textContent = pathSpeed.toFixed(1); });
  pathSpeedLabel.textContent = pathSpeed.toFixed(1);
  toggleEditBtn.addEventListener('click', ()=>{ isEditMode = !isEditMode; toggleEditBtn.textContent = isEditMode ? 'Exit Edit' : 'Edit Path'; overlay.style.pointerEvents = isEditMode ? 'auto' : 'none'; });
  playPathBtn.addEventListener('click', ()=>{ follow = !follow; playPathBtn.textContent = follow ? 'Pause' : 'Play'; });
  clearPathBtn.addEventListener('click', ()=>{ controlPoints = []; rebuildPath(); });

  // overlay sizing
  function resizeOverlay(){ overlay.width = window.innerWidth; overlay.height = window.innerHeight; overlay.style.width = window.innerWidth+'px'; overlay.style.height = window.innerHeight+'px'; }
  resizeOverlay();

  // helpers to map world <-> screen using proj/view
  const invPV = mat4.create();
  function computeInvPV(){ const pv = mat4.create(); mat4.mul(pv, projMat, viewMat); mat4.invert(invPV, pv); }
  function worldToScreen(pt){ // pt = [x,y,z]
    const v = vec4.fromValues(pt[0], pt[1], pt[2], 1.0);
    vec4.transformMat4(v, v, projMat); vec4.transformMat4(v, v, viewMat); // incorrect order earlier; do pv
    // Actually compute clip by pv = proj * view * pos
    const pv = vec4.fromValues(pt[0], pt[1], pt[2], 1.0);
    vec4.transformMat4(pv, pv, viewMat);
    vec4.transformMat4(pv, pv, projMat);
    const ndc = [pv[0]/pv[3], pv[1]/pv[3]];
    const x = (ndc[0] * 0.5 + 0.5) * overlay.width;
    const y = ( -ndc[1] * 0.5 + 0.5) * overlay.height;
    return [x,y];
  }

  function screenToWorld(x,y){ // return intersection with y=0 plane
    const ndcX = (x / overlay.width) * 2 - 1;
    const ndcY = -((y / overlay.height) * 2 - 1);
    // near and far in NDC
    const nearN = vec4.fromValues(ndcX, ndcY, -1, 1);
    const farN = vec4.fromValues(ndcX, ndcY, 1, 1);
    const inv = mat4.create(); mat4.mul(inv, projMat, viewMat); mat4.invert(inv, inv);
    const nearW = vec4.create(); const farW = vec4.create();
    vec4.transformMat4(nearW, nearN, inv); vec4.transformMat4(farW, farN, inv);
    for(let i=0;i<3;i++){ nearW[i] /= nearW[3]; farW[i] /= farW[3]; }
    const dir = [farW[0]-nearW[0], farW[1]-nearW[1], farW[2]-nearW[2]];
    const t = (0 - nearW[1]) / dir[1];
    const wx = nearW[0] + dir[0]*t; const wz = nearW[2] + dir[2]*t;
    return [wx, wz];
  }

  // overlay interactions
  const octx = overlay.getContext('2d');
  overlay.addEventListener('pointerdown', (e)=>{
    if(!isEditMode) return;
    const rect = overlay.getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    // find nearest control point within threshold
    let nearest = -1; let ndist = 12;
    for(let i=0;i<controlPoints.length;i++){ const p = controlPoints[i]; const s = worldToScreen([p.x, 0, p.z]); const dx = s[0]-x, dy = s[1]-y; const d = Math.hypot(dx,dy); if(d < ndist){ ndist = d; nearest = i; } }
    if(nearest >= 0){ dragIndex = nearest; dragging = true; }
    else{ const [wx,wz] = screenToWorld(x,y); controlPoints.push({x:wx,z:wz}); rebuildPath(); }
  });
  overlay.addEventListener('pointermove', (e)=>{
    if(!isEditMode || !dragging || dragIndex<0) return;
    const rect = overlay.getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const [wx,wz] = screenToWorld(x,y); controlPoints[dragIndex].x = wx; controlPoints[dragIndex].z = wz; rebuildPath();
  });
  overlay.addEventListener('pointerup', ()=>{ dragging=false; dragIndex=-1; });
  overlay.addEventListener('pointerleave', ()=>{ dragging=false; dragIndex=-1; });

  function rebuildPath(){
    // sample Catmull-Rom
    pathSamples = []; pathLengths = [];
    if(controlPoints.length < 2){ pathTotalLength = 0; return; }
    const samplesPerSeg = 24;
    let prev = null; let acc = 0;
    for(let i=0;i<controlPoints.length-1;i++){
      const p0 = controlPoints[Math.max(0,i-1)];
      const p1 = controlPoints[i];
      const p2 = controlPoints[i+1];
      const p3 = controlPoints[Math.min(controlPoints.length-1,i+2)];
      for(let s=0;s<samplesPerSeg;s++){
        const t = s / samplesPerSeg;
        const pt = catmullRom(p0,p1,p2,p3,t);
        const world = [pt.x, -0.08, pt.z];
        if(prev){ const d = Math.hypot(world[0]-prev[0], world[1]-prev[1], world[2]-prev[2]); acc += d; pathLengths.push(acc); }
        else pathLengths.push(0);
        pathSamples.push(world);
        prev = world;
      }
    }
    // final point
    const last = controlPoints[controlPoints.length-1]; const final = [last.x, -0.08, last.z]; if(prev){ const d = Math.hypot(final[0]-prev[0], final[1]-prev[1], final[2]-prev[2]); acc += d; pathLengths.push(acc); } else pathLengths.push(0); pathSamples.push(final);
    pathTotalLength = acc;
  }

  function catmullRom(p0, p1, p2, p3, t, alpha = 0.5) {
    // Boundary clamping for missing endpoints
    if (!p0) p0 = p1;
    if (!p3) p3 = p2;

    // Helper to compute knot time delta based on distance^alpha
    function getKnotInterval(a, b) {
        if (a.x === b.x && a.z === b.z) return 0.0001; // Avoid divide-by-zero for identical points
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        return Math.pow(dx * dx + dz * dz, alpha * 0.5); // (distance^2)^(alpha/2) = distance^alpha
    }

    // Calculate knot times t0, t1, t2, t3
    const t0 = 0;
    const t1 = t0 + getKnotInterval(p0, p1);
    const t2 = t1 + getKnotInterval(p1, p2);
    const t3 = t2 + getKnotInterval(p2, p3);

    // Map the local parameter t (0..1) to the actual knot time within [t1, t2]
    const targetT = t1 + t * (t2 - t1);

    // Barry and Goldman's pyramidal formulation
    function interpolate(pA, pB, tA, tB) {
        if (Math.abs(tB - tA) < 1e-6) return { x: pA.x, z: pA.z };
        const factor = (targetT - tA) / (tB - tA);
        return {
        x: (1 - factor) * pA.x + factor * pB.x,
        z: (1 - factor) * pA.z + factor * pB.z
        };
    }

    // First level of interpolation
    const A1 = interpolate(p0, p1, t0, t1);
    const A2 = interpolate(p1, p2, t1, t2);
    const A3 = interpolate(p2, p3, t2, t3);

    // Second level of interpolation
    const B1 = interpolate(A1, A2, t0, t2);
    const B2 = interpolate(A2, A3, t1, t3);

    // Final point on curve
    return interpolate(B1, B2, t1, t2);
    }

  function drawOverlay(){
    octx.clearRect(0,0,overlay.width,overlay.height);
    octx.lineWidth = 2; octx.strokeStyle = 'rgba(150,220,255,0.9)'; octx.fillStyle = 'rgba(30,140,200,0.95)';
    // draw path samples
    if(pathSamples.length>0){ octx.beginPath(); for(let i=0;i<pathSamples.length;i++){ const s = worldToScreen(pathSamples[i]); if(i===0) octx.moveTo(s[0],s[1]); else octx.lineTo(s[0],s[1]); } octx.stroke(); }
    // draw control points
    for(let i=0;i<controlPoints.length;i++){ const p = controlPoints[i]; const s = worldToScreen([p.x,0,p.z]); octx.beginPath(); octx.arc(s[0],s[1],6,0,Math.PI*2); octx.fill(); octx.fillStyle='rgba(255,255,255,0.9)'; octx.fill(); octx.fillStyle='rgba(30,140,200,0.95)'; }
  }

  // keyboard shortcuts: Enter finishes editing, Escape stops following
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      if(isEditMode){ isEditMode = false; toggleEditBtn.textContent = 'Edit Path'; overlay.style.pointerEvents = 'none'; rebuildPath(); }
    }
    if(e.key === 'Escape'){
      if(follow){ follow = false; playPathBtn.textContent = 'Play'; }
      if(isEditMode){ isEditMode = false; toggleEditBtn.textContent = 'Edit Path'; overlay.style.pointerEvents = 'none'; }
    }
  });


  let RES = parseInt(resEl.value);
  let pointSize = parseFloat(psEl.value);
  let amplitude = parseFloat(ampEl.value);
  let speed = parseFloat(spdEl.value);
  let renderMode = modeEl.value || 'filled';
  // model/boat position (world X, Y, Z)
  let boatPos = [0.0, 0.0, 0.0];


  resEl.addEventListener('input', ()=>{ resLabel.textContent = resEl.value });
  psEl.addEventListener('input', ()=>{ psLabel.textContent = psEl.value });
  ampEl.addEventListener('input', ()=>{ ampLabel.textContent = ampEl.value });
  spdEl.addEventListener('input', ()=>{ spdLabel.textContent = spdEl.value });
  resEl.addEventListener('change', ()=>{ RES = parseInt(resEl.value); buildGrid(); });
  psEl.addEventListener('change', ()=>{ pointSize = parseFloat(psEl.value); });
  ampEl.addEventListener('change', ()=>{ amplitude = parseFloat(ampEl.value); });
  spdEl.addEventListener('change', ()=>{ speed = parseFloat(spdEl.value); });
  modeEl.addEventListener('change', ()=>{ renderMode = modeEl.value; });
  // boat position is controlled by the path editor or code; X/Z sliders removed from UI.


  // build surface program
  const surfProg = createProgram(surfVS, surfFS);
  gl.useProgram(surfProg);
  const aPosLoc = gl.getAttribLocation(surfProg, 'a_pos');
  const uTime = gl.getUniformLocation(surfProg, 'u_time');
  const uAmp = gl.getUniformLocation(surfProg, 'u_amp');
  const uFreq = gl.getUniformLocation(surfProg, 'u_freq');
  const uSpeed = gl.getUniformLocation(surfProg, 'u_speed');
  
  const uWaveCount = gl.getUniformLocation(surfProg, 'u_waveCount');
  const uWaveOrigins = gl.getUniformLocation(surfProg, 'u_waveOrigins');
  const uWaveAmps = gl.getUniformLocation(surfProg, 'u_waveAmps');
  const uWaveRadii = gl.getUniformLocation(surfProg, 'u_waveRadii');
  const uWaveSigma = gl.getUniformLocation(surfProg, 'u_waveSigma');
  const uWaveDecay = gl.getUniformLocation(surfProg, 'u_waveDecay');
  const uView = gl.getUniformLocation(surfProg, 'u_view');
  const uProj = gl.getUniformLocation(surfProg, 'u_proj');
  const uPointSize = gl.getUniformLocation(surfProg, 'u_pointSize');

  // buffers
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(aPosLoc);
  gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
  const eboTris = gl.createBuffer();
  const eboLines = gl.createBuffer();
  let triCount = 0; let lineCount = 0; let vertexCount = 0;

  function buildGrid(){
    const res = RES; const size = 5.0;
    const data = new Float32Array(res * res * 2);
    let i = 0;
    for(let y=0;y<res;y++) for(let x=0;x<res;x++){
      const sx = (x / (res-1)) * 2 - 1; const sy = (y / (res-1)) * 2 - 1;
      data[i++] = sx * size; data[i++] = sy * size;
    }
    const triIndices = new Uint32Array((res-1)*(res-1)*6);
    let ti = 0;
    for(let y=0;y<res-1;y++) for(let x=0;x<res-1;x++){
      const i0 = y*res + x; const i1 = i0+1; const i2 = i0+res; const i3 = i2+1;
      triIndices[ti++]=i0; triIndices[ti++]=i2; triIndices[ti++]=i1;
      triIndices[ti++]=i1; triIndices[ti++]=i2; triIndices[ti++]=i3;
    }
    const lines = [];
    for(let y=0;y<res;y++) for(let x=0;x<res;x++){
      const idx=y*res+x; if(x<res-1) lines.push(idx, idx+1); if(y<res-1) lines.push(idx, idx+res);
    }
    const lineIndices = new Uint32Array(lines);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); vertexCount = res*res;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboTris); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triIndices, gl.STATIC_DRAW); triCount = triIndices.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lineIndices, gl.STATIC_DRAW); lineCount = lineIndices.length;
  }

  // camera
  const viewMat = mat4.create(); const projMat = mat4.create();
  // orbit camera state
  const camTarget = [0,0,0];
  let camRadius = 7.0;
  let camYaw = 0.0; // around Y
  let camPitch = 0.6; // up/down
  let isCamDragging = false;
  let lastCamX = 0, lastCamY = 0;

  function updateCamera(){
    // spherical -> cartesian
    const x = camTarget[0] + camRadius * Math.sin(camYaw) * Math.cos(camPitch);
    const y = camTarget[1] + camRadius * Math.sin(camPitch);
    const z = camTarget[2] + camRadius * Math.cos(camYaw) * Math.cos(camPitch);
    mat4.lookAt(viewMat, [x,y,z], camTarget, [0,1,0]);
    const aspect = canvas.clientWidth / canvas.clientHeight;
    mat4.perspective(projMat, Math.PI/4, aspect, 0.1, 100.0);
    gl.uniformMatrix4fv(uView, false, viewMat);
    gl.uniformMatrix4fv(uProj, false, projMat);
  }

  // pointer controls for orbit camera
  canvas.addEventListener('pointerdown', (e)=>{
    // don't rotate when overlay is in edit mode
    if(overlay && overlay.style.pointerEvents === 'auto') return;
    isCamDragging = true; lastCamX = e.clientX; lastCamY = e.clientY; canvas.setPointerCapture?.(e.pointerId);
  });
  window.addEventListener('pointermove', (e)=>{
    if(!isCamDragging) return;
    const dx = e.clientX - lastCamX; const dy = e.clientY - lastCamY;
    lastCamX = e.clientX; lastCamY = e.clientY;
    camYaw -= dx * 0.005;
    camPitch += dy * 0.005;
    const maxPitch = Math.PI*0.5 - 0.05; camPitch = Math.max(-maxPitch, Math.min(maxPitch, camPitch));
  });
  window.addEventListener('pointerup', (e)=>{ isCamDragging = false; try{ canvas.releasePointerCapture?.(e.pointerId); }catch(_){} });
  // wheel to zoom
  canvas.addEventListener('wheel', (e)=>{ e.preventDefault(); camRadius *= (1 + e.deltaY * 0.001); camRadius = Math.max(2.0, Math.min(50.0, camRadius)); }, {passive:false});

  function resize(){ const dpr = window.devicePixelRatio || 1; canvas.width = Math.floor(canvas.clientWidth * dpr); canvas.height = Math.floor(canvas.clientHeight * dpr); gl.viewport(0,0,canvas.width,canvas.height); updateCamera(); }
  window.addEventListener('resize', ()=>{ canvas.style.width = window.innerWidth+'px'; canvas.style.height = window.innerHeight+'px'; resize(); });
  canvas.style.width = window.innerWidth+'px'; canvas.style.height = window.innerHeight+'px';

  // model setup
  let modelLoaded=false, modelVAO=null, modelIndexCount=0, modelProgram=null; const modelTransform=mat4.create();
  
  async function loadOBJ(url){
    const src = await fetchText(url);
    const positions=[]; const normals=[]; const vertices=[]; const indices=[]; const indexMap=new Map();
    function getKey(vi,ni){return vi+'/'+ni}
    const lines = src.split(/\r?\n/);
    for(const line of lines){ const t=line.trim(); if(!t||t.startsWith('#')) continue; const p=line.split(/\s+/); if(p[0]==='v') positions.push([+p[1],+p[2],+p[3]]); else if(p[0]==='vn') normals.push([+p[1],+p[2],+p[3]]); else if(p[0]==='f'){ const face=p.slice(1).map(token=>{const parts=token.split('/'); return {v:parseInt(parts[0],10)-1, n: parts[2]?parseInt(parts[2],10)-1:-1};}); if(face.length===3){ for(const comp of face){ const key=getKey(comp.v,comp.n); if(!indexMap.has(key)){ const pos=positions[comp.v]; const nrm=comp.n>=0?normals[comp.n]:[0,0,0]; const idx=vertices.length/6; vertices.push(pos[0],pos[1],pos[2],nrm[0],nrm[1],nrm[2]); indexMap.set(key,idx);} indices.push(indexMap.get(key)); }} else if(face.length>3){ for(let i=1;i<face.length-1;i++){ const comps=[face[0],face[i],face[i+1]]; for(const comp of comps){ const key=getKey(comp.v,comp.n); if(!indexMap.has(key)){ const pos=positions[comp.v]; const nrm=comp.n>=0?normals[comp.n]:[0,0,0]; const idx=vertices.length/6; vertices.push(pos[0],pos[1],pos[2],nrm[0],nrm[1],nrm[2]); indexMap.set(key,idx);} indices.push(indexMap.get(key)); } } } } }
    let needNormals=false; for(let i=0;i<vertices.length;i+=6){ if(vertices[i+3]===0&&vertices[i+4]===0&&vertices[i+5]===0){ needNormals=true; break;} }
    if(needNormals){ const nbuf=new Float32Array(vertices.length/6*3); for(let i=0;i<indices.length;i+=3){ const i0=indices[i]*6,i1=indices[i+1]*6,i2=indices[i+2]*6; const ax=vertices[i1]-vertices[i0], ay=vertices[i1+1]-vertices[i0+1], az=vertices[i1+2]-vertices[i0+2]; const bx=vertices[i2]-vertices[i0], by=vertices[i2+1]-vertices[i0+1], bz=vertices[i2+2]-vertices[i0+2]; const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx; const aIdx=indices[i], bIdx=indices[i+1], cIdx=indices[i+2]; nbuf[aIdx*3+0]+=nx; nbuf[aIdx*3+1]+=ny; nbuf[aIdx*3+2]+=nz; nbuf[bIdx*3+0]+=nx; nbuf[bIdx*3+1]+=ny; nbuf[bIdx*3+2]+=nz; nbuf[cIdx*3+0]+=nx; nbuf[cIdx*3+1]+=ny; nbuf[cIdx*3+2]+=nz; } for(let i=0;i<vertices.length/6;i++){ const nx=nbuf[i*3+0], ny=nbuf[i*3+1], nz=nbuf[i*3+2]; const l=Math.hypot(nx,ny,nz)||1; vertices[i*6+3]=nx/l; vertices[i*6+4]=ny/l; vertices[i*6+5]=nz/l; } }
    return {vertices:new Float32Array(vertices), indices:new Uint32Array(indices)};
  }

  function createModelProgramFromSources(vsSrc, fsSrc){ return createProgram(vsSrc, fsSrc); }

  async function loadModel(){
    try{
      const url = '../models/Fishing Boat VI.obj';
      const mesh = await loadOBJ(url);
      modelProgram = createModelProgramFromSources(modelVS, modelFS);
      modelVAO = gl.createVertexArray(); gl.bindVertexArray(modelVAO);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      const posLoc = gl.getAttribLocation(modelProgram, 'a_position'); const nLoc = gl.getAttribLocation(modelProgram, 'a_normal');
      gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc,3,gl.FLOAT,false,24,0);
      gl.enableVertexAttribArray(nLoc); gl.vertexAttribPointer(nLoc,3,gl.FLOAT,false,24,12);
      modelIndexCount = mesh.indices.length;
      // defer transform to render loop so UI/positioning can update dynamically
      mat4.identity(modelTransform);
      modelLoaded = true;
    }catch(err){ console.error('Failed to load model',err); }
  }

  buildGrid(); resize();
  loadModel();

  gl.useProgram(surfProg);
  gl.uniform1f(uFreq, 10.0);
  gl.uniform1f(uWaveSigma, 0.12);
  gl.uniform1f(uWaveDecay, 1.8);

  let start = performance.now();
  let lastNow = start;
  // waves
  const MAX_WAVES = 16;
  const waves = []; // {origin:[x,z], amp, baseRadius, spawnOdo}
  let boatPrevPos = [boatPos[0], boatPos[2]];
  let boatOdo = 0;
  let boatYaw = 0;
  let lastWaveSpawnTime = 0;
  let lastWaveSpawnOdo = 0;
  const waveSpawnDistance = 0.6; // meters between wave spawns (only when moving)
  function frame(now){
    const t = (now - start) * 0.001;
    const dt = (now - lastNow) * 0.001;
    lastNow = now;
    // update camera matrices from orbit params
    updateCamera();
    // update path-following
    if(follow && pathTotalLength > 0){
      followDistance += pathSpeed * dt;
      // wrap
      if(followDistance > pathTotalLength) followDistance = followDistance % pathTotalLength;
      // find sample index
      let idx = 0;
      while(idx < pathLengths.length && pathLengths[idx] < followDistance) idx++;
      if(idx === 0){ boatPos[0] = pathSamples[0][0]; boatPos[2] = pathSamples[0][2]; }
      else if(idx >= pathSamples.length){ const p = pathSamples[pathSamples.length-1]; boatPos[0]=p[0]; boatPos[2]=p[2]; }
      else{
        const a = pathSamples[idx-1]; const b = pathSamples[idx];
        const la = pathLengths[idx-1]; const lb = pathLengths[idx];
        const seg = Math.max(1e-6, lb - la);
        const tt = (followDistance - la) / seg;
        boatPos[0] = a[0] * (1-tt) + b[0] * tt;
        boatPos[2] = a[2] * (1-tt) + b[2] * tt;
      }
    }
    gl.clearColor(0.01,0.03,0.06,1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    // update boat odometer and yaw (face velocity)
    const dx = boatPos[0] - boatPrevPos[0]; const dz = boatPos[2] - boatPrevPos[1]; const dMove = Math.hypot(dx, dz);
    if(dMove > 1e-6){ boatYaw = Math.atan2(dx, dz); }
    boatOdo += dMove; boatPrevPos[0] = boatPos[0]; boatPrevPos[1] = boatPos[2];

    // spawn wave when boat has moved a certain distance since last spawn
    if(dMove > 1e-5 && (boatOdo - lastWaveSpawnOdo) > waveSpawnDistance){ lastWaveSpawnTime = t; lastWaveSpawnOdo = boatOdo; const w = { origin: [boatPos[0], boatPos[2]], amp: amplitude * 0.6, baseRadius: 0.01, spawnOdo: boatOdo }; waves.push(w); if(waves.length > MAX_WAVES) waves.shift(); }

    // prepare wave uniform arrays
    const wc = waves.length;
    const originsFlat = new Float32Array(MAX_WAVES * 2);
    const ampsFlat = new Float32Array(MAX_WAVES);
    const radiiFlat = new Float32Array(MAX_WAVES);
    for(let i=0;i<waves.length;i++){ const w=waves[i]; originsFlat[i*2+0]=w.origin[0]; originsFlat[i*2+1]=w.origin[1]; ampsFlat[i]=w.amp; const curRadius = w.baseRadius + (boatOdo - w.spawnOdo) / 3.0; radiiFlat[i]=curRadius; }

    gl.uniform1f(uTime, t); gl.uniform1f(uAmp, amplitude); gl.uniform1f(uSpeed, speed); gl.uniform1f(uPointSize, pointSize);
    gl.uniform1i(uWaveCount, wc);
    if(wc>0){ gl.uniform2fv(uWaveOrigins, originsFlat); gl.uniform1fv(uWaveAmps, ampsFlat); gl.uniform1fv(uWaveRadii, radiiFlat); }
    gl.bindVertexArray(vao);
    if(renderMode === 'filled'){ gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboTris); gl.drawElements(gl.TRIANGLES, triCount, gl.UNSIGNED_INT, 0); }
    else if(renderMode === 'wireframe'){ gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines); gl.lineWidth(1.0); gl.drawElements(gl.LINES, lineCount, gl.UNSIGNED_INT, 0); }
    else if(renderMode === 'points'){ gl.drawArrays(gl.POINTS, 0, vertexCount); }

    if(modelLoaded && modelProgram){
      gl.useProgram(modelProgram);
      const muModel = gl.getUniformLocation(modelProgram, 'u_model');
      const muView = gl.getUniformLocation(modelProgram, 'u_view');
      const muProj = gl.getUniformLocation(modelProgram, 'u_proj');
      const muLight = gl.getUniformLocation(modelProgram, 'u_light');
      // update model transform from boat position and yaw so it faces its velocity
      const qrot = quat.create(); quat.setAxisAngle(qrot, [0,1,0], boatYaw);
      mat4.fromRotationTranslationScale(modelTransform, qrot, [boatPos[0], boatPos[1], boatPos[2]], [0.1,0.1,0.1]);
      gl.uniformMatrix4fv(muModel, false, modelTransform); gl.uniformMatrix4fv(muView, false, viewMat); gl.uniformMatrix4fv(muProj, false, projMat); gl.uniform3fv(muLight, [5.0,6.0,5.0]);
      gl.bindVertexArray(modelVAO);
      gl.drawElements(gl.TRIANGLES, modelIndexCount, gl.UNSIGNED_INT, 0);
      gl.useProgram(surfProg);
    }

    // draw overlay UI (spline + handles)
    drawOverlay();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
