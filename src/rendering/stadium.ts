import * as THREE from 'three';
import { CFG } from '../config/constants';
import { world } from './scene';
import { makePitchTexture } from './pitchTexture';

/** Builds the full stadium: pitch, stands, floodlights, goals and ad boards. */
export function buildStadium(): void {
  buildPitch();
  buildAdBoards();
  buildStands();
  buildFloodlights();
  buildGoal(-1);
  buildGoal(1);
}

function buildPitch(): void {
  const pitchMat = new THREE.MeshStandardMaterial({ map: makePitchTexture(), roughness: 0.92, metalness: 0 });
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(2 * CFG.halfL, 2 * CFG.halfW), pitchMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  world.add(pitch);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * CFG.halfL + 10, 2 * CFG.halfW + 10),
    new THREE.MeshStandardMaterial({ color: '#13632a', roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  world.add(apron);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 200),
    new THREE.MeshStandardMaterial({ color: '#0a0f17', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  world.add(ground);
}

function buildAdBoards(): void {
  const grp = new THREE.Group();
  const len = 2 * CFG.halfL + 2;
  const wid = 2 * CFG.halfW + 2;
  const h = 1.1;
  const mk = (w: number, col: string): THREE.Mesh =>
    new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.25),
      new THREE.MeshStandardMaterial({ color: '#0c1118', emissive: new THREE.Color(col), emissiveIntensity: 0.6, roughness: 0.6 }),
    );
  let b: THREE.Mesh;
  b = mk(len, '#39ff14');
  b.position.set(0, h / 2, wid / 2);
  grp.add(b);
  b = mk(len, '#39ff14');
  b.position.set(0, h / 2, -wid / 2);
  grp.add(b);
  b = mk(wid, '#ff2d55');
  b.rotation.y = Math.PI / 2;
  b.position.set(len / 2, h / 2, 0);
  grp.add(b);
  b = mk(wid, '#1e90ff');
  b.rotation.y = Math.PI / 2;
  b.position.set(-len / 2, h / 2, 0);
  grp.add(b);
  world.add(grp);
}

function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0e16';
  g.fillRect(0, 0, 256, 128);
  const cols = ['#ff2d55', '#1e90ff', '#ffce2e', '#eaf2ff', '#39ff14', '#9aa7bd', '#c44'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = 0.5 + Math.random() * 0.5;
    g.fillRect(Math.random() * 256, Math.random() * 128, 2.4, 2.4);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 3);
  return t;
}

function buildStands(): void {
  const tex = crowdTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, emissive: '#0b1018', emissiveIntensity: 0.25 });
  const base = new THREE.MeshStandardMaterial({ color: '#10151f', roughness: 1 });
  const mkSide = (z: number): void => {
    const grp = new THREE.Group();
    const tier = new THREE.Mesh(new THREE.PlaneGeometry(2 * CFG.halfL + 22, 11), mat);
    tier.position.set(0, 7, z * (CFG.halfW + 12));
    tier.rotation.x = z > 0 ? -Math.PI / 2.35 : Math.PI / 2.35;
    tier.rotation.y = z > 0 ? 0 : Math.PI;
    grp.add(tier);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2 * CFG.halfL + 22, 3, 1.2), base);
    wall.position.set(0, 1.5, z * (CFG.halfW + 6));
    grp.add(wall);
    world.add(grp);
  };
  mkSide(1);
  mkSide(-1);
  const mkEnd = (x: number): void => {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(2 * CFG.halfW + 10, 9), mat);
    t.position.set(x * (CFG.halfL + 11), 6, 0);
    t.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
    world.add(t);
  };
  mkEnd(1);
  mkEnd(-1);
}

function buildFloodlights(): void {
  const poleMat = new THREE.MeshStandardMaterial({ color: '#222a36', roughness: 0.7, metalness: 0.3 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#fffbe6', emissive: '#fff2bf', emissiveIntensity: 1.6 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = sx * (CFG.halfL + 10);
      const pz = sz * (CFG.halfW + 12);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 26, 8), poleMat);
      pole.position.set(px, 13, pz);
      world.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), headMat);
      head.position.set(px, 25, pz);
      head.lookAt(0, 0, 0);
      world.add(head);
      const pl = new THREE.PointLight('#fff4d6', 0.5, 120, 2);
      pl.position.set(px, 24, pz);
      world.add(pl);
    }
}

/** sx=-1 home goal (left), +1 away goal (right). */
function buildGoal(sx: number): void {
  const grp = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, emissive: '#223', emissiveIntensity: 0.1 });
  const r = 0.13;
  const w = CFG.goalHalf;
  const h = CFG.goalH;
  const d = CFG.goalDepth;
  const gx = sx * CFG.halfL;
  const post = (z: number): void => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), postMat);
    m.position.set(gx, h / 2, z);
    m.castShadow = true;
    grp.add(m);
  };
  post(-w);
  post(w);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * w, 10), postMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(gx, h, 0);
  bar.castShadow = true;
  grp.add(bar);

  // The net drapes from the crossbar back and DOWN to the ground — the classic
  // goal profile. No full-height vertical back posts (those read as two poles
  // standing out of the goal); the back is held by angled struts to the turf.
  const bx = gx + sx * d; // back of the goal (outward, away from the pitch)
  const netMat = new THREE.MeshBasicMaterial({ color: '#dfe8f5', wireframe: true, transparent: true, opacity: 0.22, side: THREE.DoubleSide });

  // corner points: front-top (crossbar ends), front-bottom (post feet), back-bottom (on ground)
  const FTL = new THREE.Vector3(gx, h, -w);
  const FTR = new THREE.Vector3(gx, h, w);
  const FBL = new THREE.Vector3(gx, 0, -w);
  const FBR = new THREE.Vector3(gx, 0, w);
  const BBL = new THREE.Vector3(bx, 0, -w);
  const BBR = new THREE.Vector3(bx, 0, w);

  // angled back struts (crossbar end → back-ground corner) + a ground bar across the back
  const strut = (a: THREE.Vector3, b: THREE.Vector3, rad: number): void => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1e-3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 8), postMat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    m.castShadow = true;
    grp.add(m);
  };
  strut(FTL, BBL, r * 0.6);
  strut(FTR, BBR, r * 0.6);
  strut(BBL, BBR, r * 0.6);

  // wireframe net: sloping roof/back panel + two triangular sides (goal mouth open)
  const panel = (pts: THREE.Vector3[]): void => {
    const pos: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) {
      pos.push(pts[0].x, pts[0].y, pts[0].z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    grp.add(new THREE.Mesh(geo, netMat));
  };
  panel([FTL, FTR, BBR, BBL]); // roof sloping down to the back
  panel([FTL, FBL, BBL]); // left side triangle
  panel([FTR, FBR, BBR]); // right side triangle

  world.add(grp);
}
