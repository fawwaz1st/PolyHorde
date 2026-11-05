// Input: keyboard, mouse, pointer lock — state + consumed per-frame
export class Input {
  constructor(canvas) {
    this.keys = Object.create(null);
    this._just = Object.create(null);
    this.mouse = { dx: 0, dy: 0, left: false, _just: false };
    this.isLocked = false;
    this.onLock = null;
    this.onUnlock = null;

    this._kd = (e) => { if (!this.keys[e.code]) this._just[e.code] = true; this.keys[e.code] = true; };
    this._ku = (e) => { this.keys[e.code] = false; };
    this._mm = (e) => { if (this.isLocked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } };
    this._md = (e) => { if (e.button === 0) { this.mouse.left = true; this.mouse._just = true; } };
    this._mu = (e) => { if (e.button === 0) this.mouse.left = false; };
    this._plc = () => {
      const locked = !!document.pointerLockElement;
      this.isLocked = locked;
      if (locked) this.onLock?.(); else { this.mouse.left = false; this.onUnlock?.(); }
    };
    document.addEventListener('keydown', this._kd);
    document.addEventListener('keyup', this._ku);
    document.addEventListener('mousemove', this._mm);
    document.addEventListener('mousedown', this._md);
    document.addEventListener('mouseup', this._mu);
    document.addEventListener('pointerlockchange', this._plc);
  }
  isDown(code) { return !!this.keys[code]; }
  justDown(code) { const v = !!this._just[code]; if (v) this._just[code] = false; return v; }
  mouseJustDown() { const v = this.mouse._just; if (v) this.mouse._just = false; return v; }
  endFrame() { this.mouse.dx = 0; this.mouse.dy = 0; this.mouse._just = false; this._just = Object.create(null); }
}
