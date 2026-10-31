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

function _createOutlineMeshForSingle(mesh, scene, color, thickness, addToScene) {
  const geo = mesh.geometry.clone();
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const outlineMesh = new THREE.Mesh(geo, mat);
  outlineMesh.position.copy(mesh.position);
  outlineMesh.rotation.copy(mesh.rotation);
  outlineMesh.scale.copy(mesh.scale).multiplyScalar(1 + thickness * 0.02);
  outlineMesh.renderOrder = -1;

  // Store reference on original
  if (!mesh.userData.outline) {
    mesh.userData.outline = outlineMesh;
  }

  if (addToScene && scene) {
    scene.add(outlineMesh);
  }
}

// Export the helper so it works
export { _createOutlineMesh as createOutlineMesh };
