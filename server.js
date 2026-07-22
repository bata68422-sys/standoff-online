const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const THREE = require('three');

const app = express();
app.use(express.static('public'));
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

const MAP_SIZE = 30;
const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.8;
const PLAYER_SPEED = 7;
const SHOOT_COOLDOWN = 300;
const DAMAGE = 20;
const MAX_HEALTH = 100;
const KILLS_TO_WIN = 5;
const RESPAWN_TIME = 2000;
const MAX_AMMO = 12;
const RELOAD_TIME = 1500;
const BULLET_SPEED = 40;
const BULLET_LIFETIME = 1000;

const obstacles = [
  { x: 0, z: 0, w: 3, h: 2, d: 3 },
  { x: -7, z: -7, w: 3, h: 2, d: 3 },
  { x: 7, z: -7, w: 3, h: 2, d: 3 },
  { x: -7, z: 7, w: 3, h: 2, d: 3 },
  { x: 7, z: 7, w: 3, h: 2, d: 3 },
  { x: 0, z: -11, w: 6, h: 2, d: 1.5 },
  { x: 0, z: 11, w: 6, h: 2, d: 1.5 },
  { x: -11, z: 0, w: 1.5, h: 2, d: 6 },
  { x: 11, z: 0, w: 1.5, h: 2, d: 6 },
];

function boxOverlap(ax, az, aw, ad, bx, bz, bw, bd) {
  return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(az - bz) < (ad + bd) / 2;
}

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = '';
  for (let i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
}

const GRAVITY = 20;
let games = {};

class Game {
  constructor() {
    this.code = generateCode();
    this.players = {};
    this.bullets = [];
    this.bulletId = 0;
    this.state = 'waiting';
    this.killsToWin = KILLS_TO_WIN;
    this.startTime = Date.now();
    this.winner = null;
  }

  addPlayer(ws, nickname) {
    const ids = Object.keys(this.players);
    if (ids.length >= 4) return null;
    const id = Math.random().toString(36).substr(2, 6);
    const spawns = [{ x: -12, z: -12 }, { x: 12, z: 12 }, { x: -12, z: 12 }, { x: 12, z: -12 }];
    const spawn = spawns[ids.length];
    const p = {
      id, ws, nickname: nickname || 'Player',
      x: spawn.x, y: PLAYER_HEIGHT / 2, z: spawn.z,
      yaw: ids.length === 0 ? 0 : Math.PI,
      pitch: 0,
      health: MAX_HEALTH, maxHealth: MAX_HEALTH,
      kills: 0, deaths: 0,
      lastShootTime: 0,
      ammo: MAX_AMMO, maxAmmo: MAX_AMMO, reloading: false, reloadStartTime: 0,
      respawnAt: 0,
      alive: true,
      onGround: true,
      vy: 0,
      input: { fwd: 0, strafe: 0 },
    };
    this.players[id] = p;
    if (Object.keys(this.players).length >= 2) this.state = 'playing';
    return p;
  }

  removePlayer(id) {
    delete this.players[id];
    if (Object.keys(this.players).length < 2) this.state = 'waiting';
  }

  getPlayerByWs(ws) {
    for (const id in this.players) {
      if (this.players[id].ws === ws) return this.players[id];
    }
    return null;
  }

  tick(dt) {
    if (this.state !== 'playing' || dt > 0.1) return [];

    const events = [];
    const now = Date.now();

    for (const id in this.players) {
      const p = this.players[id];
      if (!p.alive) {
        if (p.respawnAt > 0 && now >= p.respawnAt) {
          const spawns = [{ x: -12, z: -12 }, { x: 12, z: 12 }, { x: -12, z: 12 }, { x: 12, z: -12 }];
          const idx = Object.keys(this.players).indexOf(id);
          const s = spawns[idx % spawns.length];
          p.x = s.x; p.z = s.z; p.y = PLAYER_HEIGHT / 2;
          p.health = MAX_HEALTH;
          p.alive = true;
          p.ammo = p.maxAmmo;
          p.reloading = false;
          p.respawnAt = 0;
          p.vy = 0;
          p.onGround = true;
          events.push({ type: 'respawn', playerId: id, x: p.x, z: p.z });
        }
        continue;
      }

      let dx = 0, dz = 0;
      if (p.input.fwd !== 0) { dx += Math.sin(p.yaw) * p.input.fwd; dz += Math.cos(p.yaw) * p.input.fwd; }
      if (p.input.strafe !== 0) { dx += Math.sin(p.yaw + Math.PI / 2) * p.input.strafe; dz += Math.cos(p.yaw + Math.PI / 2) * p.input.strafe; }
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { dx /= len; dz /= len; }

      const speed = PLAYER_SPEED * dt;
      let nx = p.x + dx * speed;
      let nz = p.z + dz * speed;

      nx = Math.max(-MAP_SIZE / 2 + PLAYER_RADIUS, Math.min(MAP_SIZE / 2 - PLAYER_RADIUS, nx));
      nz = Math.max(-MAP_SIZE / 2 + PLAYER_RADIUS, Math.min(MAP_SIZE / 2 - PLAYER_RADIUS, nz));

      for (const obs of obstacles) {
        const half = PLAYER_RADIUS;
        const hw = obs.w / 2 + half;
        const hd = obs.d / 2 + half;
        if (Math.abs(nx - obs.x) < hw && Math.abs(nz - obs.z) < hd) {
          if (Math.abs(p.x - obs.x) >= hw) {
            nx = p.x;
          } else {
            nz = p.z;
          }
        }
      }

      for (const oid in this.players) {
        if (oid === id) continue;
        const op = this.players[oid];
        if (!op.alive) continue;
        const dist = Math.sqrt((nx - op.x) ** 2 + (nz - op.z) ** 2);
        if (dist < PLAYER_RADIUS * 2) {
          if (dx !== 0 || dz !== 0) {
            const angle = Math.atan2(nz - op.z, nx - op.x);
            nx = p.x + Math.cos(angle) * 0.05;
            nz = p.z + Math.sin(angle) * 0.05;
          }
        }
      }

      p.x = nx; p.z = nz;

      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= PLAYER_HEIGHT / 2) {
        p.y = PLAYER_HEIGHT / 2;
        p.vy = 0;
        p.onGround = true;
      }

      if (p.input.jump && p.onGround) {
        p.vy = 7;
        p.onGround = false;
      }
      p.input.jump = false;
    }

    for (const id in this.players) {
      const p = this.players[id];
      if (p.alive && p.reloading && now - p.reloadStartTime >= RELOAD_TIME) {
        p.ammo = p.maxAmmo;
        p.reloading = false;
        events.push({ type: 'reload', playerId: id, ammo: p.ammo });
      }
    }

    for (const id in this.players) {
      const p = this.players[id];
      if (!p.alive || !p.input.shooting) continue;
      if (p.reloading) continue;
      if (now - p.lastShootTime < SHOOT_COOLDOWN) continue;
      if (p.ammo <= 0) {
        p.reloading = true;
        p.reloadStartTime = now;
        events.push({ type: 'reload_start', playerId: id });
        continue;
      }
      p.lastShootTime = now;
      p.ammo--;
      p.input.shooting = false;

      const dir = new THREE.Vector3(0, 0, -1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
      dir.applyQuaternion(q);
      const origin = new THREE.Vector3(p.x, p.y + 0.5, p.z);

      if (p.ammo <= 0) {
        p.reloading = true;
        p.reloadStartTime = now;
        events.push({ type: 'reload_start', playerId: id });
      }

      const bullet = {
        id: this.bulletId++,
        x: origin.x, y: origin.y, z: origin.z,
        dx: dir.x * BULLET_SPEED, dy: dir.y * BULLET_SPEED, dz: dir.z * BULLET_SPEED,
        shooterId: id,
        createdAt: now,
      };
      this.bullets.push(bullet);

      let hitId = null;
      let hitDist = Infinity;

      for (const tid in this.players) {
        if (tid === id) continue;
        const t = this.players[tid];
        if (!t.alive) continue;
        const toTarget = new THREE.Vector3(t.x - origin.x, t.y - origin.y, t.z - origin.z);
        const proj = toTarget.dot(dir);
        if (proj < 0 || proj > 50) continue;
        const closest = origin.clone().add(dir.clone().multiplyScalar(proj));
        const dist = closest.distanceTo(new THREE.Vector3(t.x, t.y, t.z));
        const hitRadius = PLAYER_RADIUS + 0.3;
        if (dist < hitRadius && proj < hitDist) {
          hitDist = proj;
          hitId = tid;
        }
      }

      if (hitId && hitDist < 50) {
        const target = this.players[hitId];
        target.health -= DAMAGE;
        events.push({ type: 'hit', shooterId: id, targetId: hitId, damage: DAMAGE, health: target.health, bulletId: bullet.id });
        events.push({ type: 'bullet_hit', bulletId: bullet.id, x: target.x, y: target.y + 0.5, z: target.z });

        if (target.health <= 0) {
          target.alive = false;
          target.respawnAt = now + RESPAWN_TIME;
          p.kills++;
          target.deaths++;
          events.push({ type: 'kill', killerId: id, victimId: hitId });
          if (p.kills >= KILLS_TO_WIN) {
            this.state = 'finished';
            this.winner = id;
            events.push({ type: 'game_over', winnerId: id });
          }
        }
      }
    }

    const newBullets = [];
    for (const b of this.bullets) {
      b.life = (b.life !== undefined ? b.life : BULLET_LIFETIME) - dt * 1000;
      if (b.life <= 0) continue;
      const step = BULLET_SPEED * dt;
      let bx = b.x + (b.dx / BULLET_SPEED) * step;
      let by = b.y + (b.dy / BULLET_SPEED) * step;
      let bz = b.z + (b.dz / BULLET_SPEED) * step;

      let hitWall = false;
      if (Math.abs(bx) > MAP_SIZE / 2 || Math.abs(bz) > MAP_SIZE / 2) hitWall = true;
      for (const obs of obstacles) {
        if (Math.abs(bx - obs.x) < obs.w / 2 && Math.abs(bz - obs.z) < obs.d / 2 && by < obs.h) {
          hitWall = true; break;
        }
      }
      if (hitWall) {
        events.push({ type: 'bullet_hit', bulletId: b.id, x: bx, y: by, z: bz });
        continue;
      }

      for (const tid in this.players) {
        if (tid === b.shooterId) continue;
        const t = this.players[tid];
        if (!t.alive) continue;
        const dist = Math.sqrt((bx - t.x) ** 2 + (bz - t.z) ** 2);
        if (dist < PLAYER_RADIUS + 0.3 && Math.abs(by - (t.y + 0.5)) < 0.8) {
          events.push({ type: 'bullet_hit', bulletId: b.id, x: bx, y: by, z: bz });
          break;
        }
      }

      b.x = bx; b.y = by; b.z = bz;
      newBullets.push(b);
    }
    this.bullets = newBullets;

    return events;
  }

  getState() {
    const pState = {};
    for (const id in this.players) {
      const p = this.players[id];
      pState[id] = {
        id, nickname: p.nickname, kills: p.kills, deaths: p.deaths,
        x: p.x, y: p.y, z: p.z,
        yaw: p.yaw, pitch: p.pitch,
        health: p.health, maxHealth: p.maxHealth,
        alive: p.alive,
        ammo: p.ammo, maxAmmo: p.maxAmmo, reloading: p.reloading,
      };
    }
    return {
      code: this.code, state: this.state, mapSize: MAP_SIZE,
      players: pState, obstacles, winner: this.winner,
      killsToWin: this.killsToWin,
      bullets: this.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z })),
    };
  }
}

function send(ws, d) { if (ws.readyState === 1) ws.send(JSON.stringify(d)); }

function broadcast(game, d) {
  for (const id in game.players) {
    send(game.players[id].ws, d);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, ...data } = msg;

    if (type === 'create') {
      const game = new Game();
      const p = game.addPlayer(ws, data.nickname);
      if (!p) return send(ws, { type: 'error', message: 'Cannot create' });
      games[game.code] = game;
      send(ws, { type: 'created', code: game.code, playerId: p.id, state: game.getState() });
      return;
    }

    if (type === 'join') {
      const game = games[data.code];
      if (!game) return send(ws, { type: 'error', message: 'Игра не найдена' });
      if (Object.keys(game.players).length >= 4) return send(ws, { type: 'error', message: 'Максимум 4 игрока' });
      const p = game.addPlayer(ws, data.nickname);
      if (!p) return send(ws, { type: 'error', message: 'Не удалось присоединиться' });
      send(ws, { type: 'joined', code: game.code, playerId: p.id, state: game.getState() });
      broadcast(game, { type: 'state', state: game.getState() });
      return;
    }

    const game = findGame(ws);
    if (!game) return;
    const p = game.getPlayerByWs(ws);
    if (!p) return;

    if (type === 'input') {
      p.input.fwd = data.fwd || 0;
      p.input.strafe = data.strafe || 0;
      p.input.shooting = data.shooting || false;
      p.input.jump = data.jump || false;
      if (data.yaw !== undefined) p.yaw = data.yaw;
      if (data.pitch !== undefined) p.pitch = Math.max(-1.5, Math.min(1.5, data.pitch));
    }
  });

  ws.on('close', () => {
    const game = findGame(ws);
    if (game) {
      const p = game.getPlayerByWs(ws);
      if (p) {
        game.removePlayer(p.id);
        broadcast(game, { type: 'player_left', playerId: p.id, state: game.getState() });
        if (Object.keys(game.players).length === 0) delete games[game.code];
      }
    }
  });
});

function findGame(ws) {
  for (const code in games) {
    if (games[code].getPlayerByWs(ws)) return games[code];
  }
  return null;
}

setInterval(() => {
  const dt = 1 / 30;
  for (const code in games) {
    const game = games[code];
    const events = game.tick(dt);
    for (const ev of events) {
      if (ev.type === 'game_over') {
        broadcast(game, { type: 'game_over', winnerId: ev.winnerId, state: game.getState() });
    } else {
      broadcast(game, { type: 'event', data: ev, state: game.getState() });
    }
    }
    if (game.state === 'playing') {
      broadcast(game, { type: 'state', state: game.getState() });
    }
  }
}, 1000 / 30);

server.listen(PORT, () => console.log(`Server on port ${PORT}`));