// Mount Aholo3D-generated PBR GLB furniture in A102 living room while keeping
// original BIM element bounding boxes, physics records, and raycast pick meshes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

const SPECS = [
  {
    id: 'e159',
    url: './assets/aholo/sofa.glb',
    sourceLabel: 'Aholo3D 图生 3D PBR 模型 · 布艺三人沙发',
    rotY: 0,
  },
  {
    id: 'e158',
    url: './assets/aholo/sofa.glb',
    sourceLabel: 'Aholo3D 图生 3D PBR 模型 · 布艺三人沙发 (复用实例)',
    rotY: Math.PI / 2,
  },
  {
    id: 'e162',
    url: './assets/aholo/coffee_table.glb',
    sourceLabel: 'Aholo3D 图生 3D PBR 模型 · 双层木质茶几',
    rotY: 0,
  },
];

function hideReplacedTriangles(extras, extraMeshes, elements) {
  const srcIdx = extras?.furniture?.geometry?.index?.array;
  const targetMesh = extraMeshes?.furniture;
  if (!srcIdx || !targetMesh || !elements.length) return;
  const drawIdx = srcIdx.slice();
  for (const e of elements) {
    if (e.t0 == null || e.t1 == null) continue;
    drawIdx.fill(0, e.t0 * 3, e.t1 * 3);
  }
  targetMesh.geometry.setIndex(new THREE.BufferAttribute(drawIdx, 1));
}

function fitToBox(root, targetMin, targetMax, rotY) {
  const pivot = new THREE.Group();
  const wrapper = new THREE.Group();
  wrapper.rotation.y = rotY;
  wrapper.add(root);
  pivot.add(wrapper);
  pivot.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(wrapper);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawCenter = rawBox.getCenter(new THREE.Vector3());

  const targetSize = new THREE.Vector3(
    targetMax[0] - targetMin[0],
    targetMax[1] - targetMin[1],
    targetMax[2] - targetMin[2],
  );
  const targetCenter = new THREE.Vector3(
    (targetMin[0] + targetMax[0]) / 2,
    targetMin[1],
    (targetMin[2] + targetMax[2]) / 2,
  );

  // Preserve uniform sofa proportion by height/length fit, while matching coffee-table footprint.
  const sx = targetSize.x / (rawSize.x || 1);
  const sy = targetSize.y / (rawSize.y || 1);
  const sz = targetSize.z / (rawSize.z || 1);
  wrapper.scale.set(sx, sy, sz);
  wrapper.position.set(
    targetCenter.x - rawCenter.x * sx,
    targetCenter.y - rawBox.min.y * sy,
    targetCenter.z - rawCenter.z * sz,
  );
  pivot.updateMatrixWorld(true);
  return pivot;
}

/**
 * Load Aholo GLBs, align them to replaced BIM furniture boxes, and register
 * overlays/opacity/clipping so combustion, radiation, card and sliders work identically.
 */
export async function mountAholoAssets({ meta, extras, extraMeshes, objects, cut, scene, renderer }) {
  const group = new THREE.Group();
  group.name = 'aholo-furniture';
  scene.add(group);

  const materials = [];
  const replaced = [];

  try {
    const loader = new GLTFLoader();
    const cache = new Map();
    const loadGltf = (url) => {
      if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
      return cache.get(url);
    };

    await Promise.all(SPECS.map(async (spec) => {
      const rec = objects.byId.get(spec.id);
      const el = rec?.element ?? meta.elements[Number(spec.id.slice(1))];
      if (!el) return;

      const gltf = await loadGltf(spec.url);
      const cloneRoot = gltf.scene.clone(true);
      let firstMesh = null;

      cloneRoot.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const origMats = Array.isArray(node.material) ? node.material : [node.material];
        const clonedMats = origMats.map((m) => {
          const mat = m.clone();
          mat.clippingPlanes = cut ? [cut] : [];
          // Soften specular glare under the 7.5 directional daylight and keep natural fabric/wood tone.
          if (mat.roughness != null) mat.roughness = Math.max(0.72, mat.roughness);
          if (mat.metalness != null) mat.metalness = Math.min(0.05, mat.metalness);
          materials.push(mat);
          return mat;
        });
        node.material = Array.isArray(node.material) ? clonedMats : clonedMats[0];
        if (!firstMesh) firstMesh = node;
      });

      const fitted = fitToBox(cloneRoot, el.min, el.max, spec.rotY);
      group.add(fitted);
      fitted.updateMatrixWorld(true);

      el.aholoSource = spec.sourceLabel;
      el._aholoMesh = firstMesh;
      replaced.push(el);
    }));

    hideReplacedTriangles(extras, extraMeshes, replaced);
    if (renderer?.shadowMap) renderer.shadowMap.needsUpdate = true;
  } catch (err) {
    console.warn('[aholo] Failed to mount Aholo GLB assets cleanly:', err);
  }

  return {
    group,
    materials,
    setOpacity(o) {
      const shown = o > 0.005;
      const solid = o >= 0.99;
      group.visible = shown;
      group.renderOrder = solid ? 0 : 1;
      for (const m of materials) {
        m.opacity = solid ? 1 : o;
        m.transparent = !solid;
        m.depthWrite = solid;
        m.needsUpdate = true;
      }
    },
  };
}
