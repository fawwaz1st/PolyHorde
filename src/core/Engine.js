import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

// Engine: renderer + scene + camera + post-processing (bloom + res scale)
export class Engine {
  constructor(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // shadow statis (semua caster statis)
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070f);
    this.scene.fog = new THREE.FogExp2(0x07070f, 0.014);

    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(0, 1.7, 0);
    this.scene.add(this.camera);

    this.pipeline = null;
    this._postReady = false;
  }

  async init() {
    await this.renderer.init();
    // Post-processing: bloom (emisi)
    try {
      const scenePass = pass(this.scene, this.camera);
      const sceneColor = scenePass.getTextureNode('output');
      const bloomPass = bloom(scenePass, 0.85, 0.4, 0.55);
      const outputNode = sceneColor.add(bloomPass);
      this.pipeline = new THREE.RenderPipeline(this.renderer, outputNode);
      if (typeof bloomPass.setResolutionScale === 'function') bloomPass.setResolutionScale(0.35);
      if (typeof scenePass.setResolutionScale === 'function') scenePass.setResolutionScale(0.85);
      this._postReady = true;
    } catch (e) {
      console.warn('post-processing tidak tersedia:', e);
    }
    // Warm-up pipeline
    try { if (this.pipeline) this.pipeline.render(); } catch {}
    return this;
  }

  render() {
    if (this._postReady && this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
