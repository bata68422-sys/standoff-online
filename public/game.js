import * as THREE from 'three';

let ws = null;
let playerId = null;
let gameCode = null;
let myNick = 'Player';
let scene, camera, renderer;
let otherPlayers = {};
let ground, sky;
let obstacles3d = [];
let walls3d = [];
let state = null;
let yaw = 0, pitch = 0;
let keys = { w: false, a: false, s: false, d: false, space: false, f: false };
let shooting = false;
let lastInputSend = 0;
let animFrameId = null;
let pointerLocked = false;
let playerColors = ['#ff4757', '#4a6cf7', '#27ae60', '#ffa502'];
let lobbyCheckInterval = null;

function getWsUrl() {
  const p = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${p}//${window.location.host}`;
}

function connect() {
  ws = new WebSocket(getWsUrl());
  ws.onopen = () => console.log('connected');
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}

function showError(text) {
  const el = document.getElementById('error-msg');
  el.textContent = text; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function handleMsg(msg) {
  if (msg.type === 'error') { showError(msg.message); return; }

  if (msg.type === 'created') {
    playerId = msg.playerId;
    gameCode = msg.code;
    state = msg.state;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('game-code').textContent = msg.code;
    updateLobbyPlayers(state);
    lobbyCheckInterval = setInterval(() => {
      if (state && state.state === 'playing') {
        clearInterval(lobbyCheckInterval);
        startGame();
      }
    }, 500);
    if (state.state === 'playing') { clearInterval(lobbyCheckInterval); startGame(); }
    return;
  }

  if (msg.type === 'joined') {
    playerId = msg.playerId;
    gameCode = msg.code;
    state = msg.state;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('game-code').textContent = msg.code;
    updateLobbyPlayers(state);
    if (state.state === 'playing') startGame();
    return;
  }

  if (msg.type === 'state') {
    state = msg.state;
    if (state.state === 'playing') {
      if (lobbyCheckInterval) { clearInterval(lobbyCheckInterval); lobbyCheckInterval = null; }
      const lobby = document.getElementById('lobby');
      if (!lobby.classList.contains('hidden')) {
        lobby.classList.add('hidden');
        startGame();
      }
      updateScoreboard();
      updateHealth();
      updateAmmo();
      updatePlayers();
      updateBullets();
    }
    return;
  }

  if (msg.type === 'event') {
    if (msg.data) {
      if (msg.data.type === 'kill') {
        addKillFeed(msg.data.killerId, msg.data.victimId);
      }
      if (msg.data.type === 'bullet_hit') {
        addBulletImpact(msg.data.x, msg.data.y, msg.data.z);
      }
      if (msg.data.type === 'hit' || msg.data.type === 'knife_hit') {
        updateHealth();
        updateAmmo();
      }
    }
    state = msg.state;
    return;
  }

  if (msg.type === 'game_over') {
    state = msg.state;
    showGameOver(msg.winnerId);
    return;
  }

  if (msg.type === 'player_left') {
    state = msg.state;
    if (!state || Object.keys(state.players).length < 2) {
      if (document.getElementById('lobby').classList.contains('hidden') && document.getElementById('menu').classList.contains('hidden')) {
        document.getElementById('menu').classList.remove('hidden');
        document.getElementById('lobby').classList.add('hidden');
        document.getElementById('hud').classList.add('hidden');
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        showError('Противник покинул игру');
      }
    }
    return;
  }
}

function updateLobbyPlayers(s) {
  if (!s) return;
  const html = Object.values(s.players).map((p, i) => {
    const c = playerColors[i % playerColors.length];
    return `<div style="color:${c}">● ${p.nickname} ${p.id === playerId ? '(вы)' : ''}</div>`;
  }).join('');
  document.getElementById('lobby-players').innerHTML = html || '<div style="color:#666">Ожидание игроков...</div>';
}

function startGame() {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('start-btn').classList.remove('hidden');
  document.getElementById('start-btn').textContent = '🔫 Кликни чтобы играть';
  document.getElementById('start-btn').onclick = () => {
    document.getElementById('start-btn').classList.add('hidden');
    initGame();
  };
}

function initGame() {
  if (!scene) initScene();
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('start-btn').classList.add('hidden');
  renderer.domElement.requestPointerLock();
  gameLoop();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 25, 55);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.6, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.prepend(renderer.domElement);

  const ambLight = new THREE.AmbientLight(0x404060, 0.5);
  scene.add(ambLight);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -20;
  dirLight.shadow.camera.right = 20;
  dirLight.shadow.camera.top = 20;
  dirLight.shadow.camera.bottom = -20;
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.4);
  scene.add(hemiLight);

  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x8a7a5a, roughness: 1.0, metalness: 0.0,
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(40, 40, 0x444466, 0x333355);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  makeObstacles();
  makeWalls();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = !!document.pointerLockElement;
  });

  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  });

  document.addEventListener('mousedown', e => {
    if (e.button === 0 && pointerLocked) shooting = true;
  });
  document.addEventListener('mouseup', e => {
    if (e.button === 0) shooting = false;
  });

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'ц') keys.w = true;
    if (k === 'a' || k === 'ф') keys.a = true;
    if (k === 's' || k === 'ы') keys.s = true;
    if (k === 'd' || k === 'в') keys.d = true;
    if (e.key === ' ') { e.preventDefault(); keys.space = true; }
    if (k === 'f' || k === 'а') keys.f = true;
  });
  document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'ц') keys.w = false;
    if (k === 'a' || k === 'ф') keys.a = false;
    if (k === 's' || k === 'ы') keys.s = false;
    if (k === 'd' || k === 'в') keys.d = false;
    if (e.key === ' ') { keys.space = false; }
    if (k === 'f' || k === 'а') keys.f = false;
  });
}

function makeObstacles() {
  const obsData = [
    { x: 0, z: -4, w: 5, h: 1.5, d: 1 },
    { x: 0, z: 4, w: 5, h: 1.5, d: 1 },
    { x: -9, z: 0, w: 2, h: 2, d: 2 },
    { x: 9, z: 0, w: 2, h: 2, d: 2 },
    { x: -5, z: -9, w: 3, h: 2, d: 3 },
    { x: 5, z: -9, w: 3, h: 2, d: 3 },
    { x: -5, z: 9, w: 3, h: 2, d: 3 },
    { x: 5, z: 9, w: 3, h: 2, d: 3 },
    { x: -3, z: -3, w: 1, h: 2, d: 3 },
    { x: 3, z: -3, w: 1, h: 2, d: 3 },
    { x: -3, z: 3, w: 1, h: 2, d: 3 },
    { x: 3, z: 3, w: 1, h: 2, d: 3 },
  ];
  for (const o of obsData) {
    const g = new THREE.BoxGeometry(o.w, o.h, o.d);
    const m = new THREE.MeshStandardMaterial({
      color: 0x8a7a5a, roughness: 0.9, metalness: 0.0,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(o.x, o.h / 2, o.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edges = new THREE.EdgesGeometry(g);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x555577 }));
    line.position.copy(mesh.position);
    scene.add(line);

    obstacles3d.push(mesh);
  }
}

function makeWalls() {
  const half = 15;
  const wallH = 3;
  const wallData = [
    { x: 0, z: -half, w: half * 2, d: 0.5 },
    { x: 0, z: half, w: half * 2, d: 0.5 },
    { x: -half, z: 0, w: 0.5, d: half * 2 },
    { x: half, z: 0, w: 0.5, d: half * 2 },
  ];
  for (const w of wallData) {
    const g = new THREE.BoxGeometry(w.w, wallH, w.d);
    const m = new THREE.MeshStandardMaterial({
      color: 0x6a5a4a, roughness: 0.9, metalness: 0.0,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(w.x, wallH / 2, w.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    walls3d.push(mesh);
  }

  const floorMarkers = [
    { x: -12, z: -12, c: 0x4a6cf720 },
    { x: 12, z: 12, c: 0xff475720 },
  ];
  for (const fm of floorMarkers) {
    const g2 = new THREE.PlaneGeometry(2, 2);
    const m2 = new THREE.MeshBasicMaterial({ color: fm.c, transparent: true, depthWrite: false });
    const m2m = new THREE.Mesh(g2, m2);
    m2m.rotation.x = -Math.PI / 2;
    m2m.position.set(fm.x, 0.02, fm.z);
    scene.add(m2m);
  }
}

let gunMesh = null;
function makeGun() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x444466, metalness: 0.8, roughness: 0.3 })
  );
  body.position.set(0, -0.08, -0.3);
  group.add(body);

  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.1, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x555577, metalness: 0.5, roughness: 0.5 })
  );
  handle.position.set(0, -0.12, -0.15);
  group.add(handle);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.025, 0.25, 8),
    new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.9, roughness: 0.2 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.06, -0.5);
  group.add(barrel);

  group.position.set(0.3, -0.15, -0.4);
  return group;
}

function createPlayerModel(color) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 8, 16), bodyMat);
  body.position.y = 0.5;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.7 })
  );
  head.position.y = 0.95;
  head.castShadow = true;
  group.add(head);

  const gunMat = new THREE.MeshStandardMaterial({ color: 0x444466, metalness: 0.8, roughness: 0.3 });
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
  gun.position.set(0, 0.5, -0.3);
  group.add(gun);

  return group;
}

function getColorForPlayer(id) {
  if (!state || !state.players) return playerColors[0];
  const ids = Object.keys(state.players).sort();
  const idx = ids.indexOf(id);
  return playerColors[idx >= 0 ? idx % playerColors.length : 0];
}

function getNickForPlayer(id) {
  if (!state || !state.players || !state.players[id]) return '?';
  return state.players[id].nickname;
}

function updatePlayers() {
  if (!state || !state.players) return;

  const currentIds = new Set(Object.keys(state.players));

  for (const id in otherPlayers) {
    if (!currentIds.has(id)) {
      scene.remove(otherPlayers[id].group);
      if (otherPlayers[id].label) scene.remove(otherPlayers[id].label);
      delete otherPlayers[id];
    }
  }

  for (const id in state.players) {
    if (id === playerId) continue;
    const pd = state.players[id];
    if (!pd.alive) {
      if (otherPlayers[id]) {
        otherPlayers[id].group.visible = false;
        if (otherPlayers[id].label) otherPlayers[id].label.visible = false;
      }
      continue;
    }

    if (!otherPlayers[id]) {
      const color = getColorForPlayer(id);
      const model = createPlayerModel(color);
      scene.add(model);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(getNickForPlayer(id), 128, 42);

      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const label = new THREE.Sprite(spriteMat);
      label.scale.set(2, 0.5, 1);
      scene.add(label);

      otherPlayers[id] = { group: model, label };
    } else {
      otherPlayers[id].group.visible = true;
      if (otherPlayers[id].label) otherPlayers[id].label.visible = true;
    }

    const p = otherPlayers[id];
    p.group.position.set(pd.x, pd.y - 0.5, pd.z);
    p.group.rotation.y = pd.yaw;

    if (p.label) {
      p.label.position.set(pd.x, pd.y + 1.3, pd.z);
    }
  }
}

function updateScoreboard() {
  if (!state || !state.players) return;
  const sorted = Object.values(state.players).sort((a, b) => b.kills - a.kills);
  const html = sorted.map((p, i) => {
    const isMe = p.id === playerId;
    const color = getColorForPlayer(p.id);
    return `<div style="color:${color}">${isMe ? '▸ ' : ''}${p.nickname}: 🥇 ${p.kills} / ${p.deaths}</div>`;
  }).join('');
  document.getElementById('score-entries').innerHTML = html;
  document.getElementById('kills-to-win').textContent = `До победы: ${state.killsToWin} голд`;
}

function updateHealth() {
  if (!state || !state.players || !state.players[playerId]) return;
  const me = state.players[playerId];
  const pct = Math.max(0, me.health / me.maxHealth * 100);
  const bar = document.getElementById('health-bar');
  bar.style.width = Math.max(0, me.alive ? pct : 0) + '%';
  if (!me.alive) bar.style.background = '#333';
  else if (pct > 60) bar.style.background = '#27ae60';
  else if (pct > 30) bar.style.background = '#ffa502';
  else bar.style.background = '#ff4757';
  document.getElementById('health-text').textContent = me.alive ? Math.ceil(me.health) : '0';
}

function updateAmmo() {
  if (!state || !state.players || !state.players[playerId]) return;
  const me = state.players[playerId];
  document.getElementById('ammo-count').textContent = `${me.ammo} / ${me.maxAmmo}`;
  const rel = document.getElementById('reload-indicator');
  if (me.reloading) rel.classList.remove('hidden');
  else rel.classList.add('hidden');
}

let bulletMeshes = {};
function updateBullets() {
  if (!state || !state.bullets) return;
  const currentIds = new Set(state.bullets.map(b => b.id));
  for (const id in bulletMeshes) {
    if (!currentIds.has(Number(id))) {
      scene.remove(bulletMeshes[id]);
      delete bulletMeshes[id];
    }
  }
  const color = new THREE.Color(0xffff44);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0.8 });
  for (const b of state.bullets) {
    if (!bulletMeshes[b.id]) {
      const geo = new THREE.SphereGeometry(0.08, 6, 6);
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      bulletMeshes[b.id] = mesh;
    }
    bulletMeshes[b.id].position.set(b.x, b.y, b.z);
  }
}

function addBulletImpact(x, y, z) {
  const geo = new THREE.SphereGeometry(0.15, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const start = Date.now();
  function fade() {
    const t = (Date.now() - start) / 300;
    if (t >= 1) { scene.remove(mesh); return; }
    mat.opacity = 0.6 * (1 - t);
    mesh.scale.setScalar(1 + t * 2);
    requestAnimationFrame(fade);
  }
  fade();
}

function addKillFeed(killerId, victimId) {
  const killer = getNickForPlayer(killerId);
  const victim = getNickForPlayer(victimId);
  const el = document.createElement('div');
  el.className = 'kill-entry';
  const kColor = getColorForPlayer(killerId);
  const vColor = getColorForPlayer(victimId);
  el.innerHTML = `<span style="color:${kColor}">${killer}</span> 🔫 <span style="color:${vColor}">${victim}</span>`;
  document.getElementById('kill-feed').appendChild(el);
  setTimeout(() => el.remove(), 3000);
  announceKill(killer, kColor, killerId === playerId);
}

let announceTimeout = null;
function announceKill(name, color, isMe) {
  const el = document.getElementById('kill-announce');
  el.classList.remove('hidden', 'gold', 'kill', 'headshot');
  if (isMe) {
    el.textContent = 'ГОЛДА!';
    el.className = 'gold';
  } else {
    el.textContent = `${name} УБИЛ!`;
    el.className = 'kill';
    el.style.color = color;
  }
  if (announceTimeout) clearTimeout(announceTimeout);
  announceTimeout = setTimeout(() => { el.classList.add('hidden'); }, 1500);
}

function showGameOver(winnerId) {
  const overlay = document.getElementById('game-over-overlay');
  overlay.classList.remove('hidden');
  const title = document.getElementById('result-title');
  if (winnerId === playerId) {
    title.textContent = '🏆 Вы победили!';
    title.style.color = '#ffd700';
  } else {
    const nick = getNickForPlayer(winnerId);
    title.textContent = `💀 ${nick} победил!`;
    title.style.color = '#ff4757';
  }
  document.getElementById('play-again-btn').onclick = () => {
    overlay.classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    for (const id in otherPlayers) {
      scene.remove(otherPlayers[id].group);
      if (otherPlayers[id].label) scene.remove(otherPlayers[id].label);
    }
    otherPlayers = {};
    for (const id in bulletMeshes) { scene.remove(bulletMeshes[id]); }
    bulletMeshes = {};
  };
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;
  let fwd = 0, strafe = 0;
  if (keys.w) fwd = 1;
  else if (keys.s) fwd = -1;
  if (keys.a) strafe = -1;
  else if (keys.d) strafe = 1;
  ws.send(JSON.stringify({
    type: 'input', fwd, strafe, yaw, pitch, shooting,
    jump: keys.space, knife: keys.f,
  }));
  if (keys.f) keys.f = false;
}

function gameLoop() {
  animFrameId = requestAnimationFrame(gameLoop);

  const now = Date.now();
  if (now - lastInputSend > 50) {
    sendInput();
    lastInputSend = now;
  }

  if (pointerLocked && camera) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    camera.quaternion.copy(q);

    if (state && state.players && state.players[playerId]) {
      const me = state.players[playerId];
      camera.position.set(me.x, me.y + 0.2, me.z);
    }

    if (!gunMesh) {
      gunMesh = makeGun();
      camera.add(gunMesh);
      scene.add(camera);
    }
  }

  renderer.render(scene, camera);
}

document.getElementById('create-btn').addEventListener('click', () => {
  const nick = document.getElementById('nickname-input').value.trim() || 'Player';
  myNick = nick;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'create', nickname: nick }));
  else showError('Нет соединения');
});

document.getElementById('join-btn').addEventListener('click', () => {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  const nick = document.getElementById('nickname-input').value.trim() || 'Player';
  myNick = nick;
  if (!code || code.length !== 4) return showError('Введите код 4 символа');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'join', code, nickname: nick }));
  else showError('Нет соединения');
});

document.getElementById('code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('join-btn').click();
});
document.getElementById('nickname-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('create-btn').click();
});

connect();
