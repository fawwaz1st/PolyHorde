import * as THREE from 'three/webgpu';

// Cel-shading outline via TSL
export function addOutline(mesh, scene, color = 0x000000, thickness = 1, addToScene = true) {
  _createOutlineMesh(mesh, scene, color, thickness, addToScene);
}

// Traditional inverted-hull outline (works with all materials)
function _createOutlineMesh(original, scene, color, thickness, addToScene) {
  if (original.type === 'Group') {
    // Apply to children
    original.children.forEach(child => {
      if (child.isMesh) {
        _createOutlineMeshForSingle(child, scene, color, thickness, addToScene);
      }
    });
    return;
  }
  _createOutlineMeshForSingle(original, scene, color, thickness, addToScene);
}

// Material outline di-share global (dulu 1 material + geometry.clone() per mesh = boros draw/compile)
let _sharedOutlineMat = null;
function _outlineMaterial(color) {
  if (!_sharedOutlineMat || _sharedOutlineMat.color.getHex() !== color) {
    _sharedOutlineMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
  }
  return _sharedOutlineMat;
}

function _createOutlineMeshForSingle(mesh, scene, color, thickness) {
  // Geometry di-reuse (bukan clone) — hemat memori & vertex buffer
  const mat = _outlineMaterial(color);
  const outlineMesh = new THREE.Mesh(mesh.geometry, mat);
  // Parent ke mesh asli: outline otomatis ikut transform (dulu disalin sekali & jadi salah posisi)
  outlineMesh.position.set(0, 0, 0);
  outlineMesh.rotation.set(0, 0, 0);
  outlineMesh.scale.setScalar(1 + thickness * 0.02);
  outlineMesh.renderOrder = -1;
  outlineMesh.userData.isOutline = true;
  mesh.add(outlineMesh);
  if (!mesh.userData.outline) mesh.userData.outline = outlineMesh;
}

// Export the helper so it works
export { _createOutlineMesh as createOutlineMesh };
