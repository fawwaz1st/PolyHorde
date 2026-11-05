import * as THREE from 'three/webgpu';

// Cel-shading outline: inverted hull, material & geometry di-share
export function addOutline(mesh, color = 0x000000, thickness = 1) {
  _createOutlineMesh(mesh, color, thickness);
}

function _createOutlineMesh(original, color, thickness) {
  if (original.type === 'Group') {
    original.children.forEach(child => {
      if (child.isMesh) _createOutlineMeshForSingle(child, color, thickness);
    });
    return;
  }
  _createOutlineMeshForSingle(original, color, thickness);
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

function _createOutlineMeshForSingle(mesh, color, thickness) {
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


