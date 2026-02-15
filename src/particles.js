import * as THREE from 'three';

const MAX_PARTICLES = 800;
const _burstColor = new THREE.Color();

export function createParticles(scene) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // Pre-allocate particle pool to avoid GC
  let count = 0;
  const pool = new Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    pool[i] = {
      px: 0, py: -100, pz: 0,
      vx: 0, vy: 0, vz: 0,
      r: 0, g: 0, b: 0,
      life: 0, maxLife: 0, size: 0,
    };
  }

  function burst(position, color, burstCount) {
    const c = _burstColor.setHex(color);
    for (let i = 0; i < burstCount; i++) {
      if (count >= MAX_PARTICLES) {
        // Overwrite oldest
        count = MAX_PARTICLES;
        // Find particle with least life
        let minIdx = 0;
        let minLife = pool[0].life;
        for (let j = 1; j < MAX_PARTICLES; j++) {
          if (pool[j].life < minLife) {
            minLife = pool[j].life;
            minIdx = j;
          }
        }
        const p = pool[minIdx];
        p.px = position.x + (Math.random() - 0.5) * 0.2;
        p.py = position.y + (Math.random() - 0.5) * 0.2;
        p.pz = position.z + (Math.random() - 0.5) * 0.2;
        p.vx = (Math.random() - 0.5) * 6;
        p.vy = (Math.random() - 0.5) * 6;
        p.vz = (Math.random() - 0.5) * 6;
        p.r = c.r; p.g = c.g; p.b = c.b;
        p.life = 0.3 + Math.random() * 0.5;
        p.maxLife = p.life;
        p.size = 0.05 + Math.random() * 0.15;
      } else {
        const p = pool[count];
        p.px = position.x + (Math.random() - 0.5) * 0.2;
        p.py = position.y + (Math.random() - 0.5) * 0.2;
        p.pz = position.z + (Math.random() - 0.5) * 0.2;
        p.vx = (Math.random() - 0.5) * 6;
        p.vy = (Math.random() - 0.5) * 6;
        p.vz = (Math.random() - 0.5) * 6;
        p.r = c.r; p.g = c.g; p.b = c.b;
        p.life = 0.3 + Math.random() * 0.5;
        p.maxLife = p.life;
        p.size = 0.05 + Math.random() * 0.15;
        count++;
      }
    }
  }

  return { points, geometry, pool, burst, getCount: () => count, setCount: (n) => { count = n; } };
}

export function updateParticles(particleSystem, dt) {
  const { geometry, pool, getCount, setCount } = particleSystem;
  const posArr = geometry.attributes.position.array;
  const colArr = geometry.attributes.color.array;
  const sizeArr = geometry.attributes.size.array;

  let count = getCount();

  // Update particles — swap-and-pop dead ones
  for (let i = count - 1; i >= 0; i--) {
    const p = pool[i];
    p.life -= dt;
    if (p.life <= 0) {
      // Swap with last active particle
      count--;
      if (i < count) {
        pool[i] = pool[count];
        pool[count] = p;
      }
      continue;
    }

    // Integrate position (no clone/alloc)
    p.px += p.vx * dt;
    p.py += p.vy * dt;
    p.pz += p.vz * dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.vz *= 0.95;
    p.vy -= 3 * dt;
  }

  setCount(count);

  // Write ONLY active particles to buffers (not all 800)
  for (let i = 0; i < count; i++) {
    const p = pool[i];
    const alpha = p.life / p.maxLife;
    const i3 = i * 3;

    posArr[i3] = p.px;
    posArr[i3 + 1] = p.py;
    posArr[i3 + 2] = p.pz;

    colArr[i3] = p.r * alpha;
    colArr[i3 + 1] = p.g * alpha;
    colArr[i3 + 2] = p.b * alpha;

    sizeArr[i] = p.size * alpha;
  }

  // Use draw range instead of zeroing inactive entries
  geometry.setDrawRange(0, count);

  if (count > 0) {
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
  }
}
