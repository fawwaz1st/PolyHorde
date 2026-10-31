export class Input {
  constructor(canvas) {
    this.keys = {};
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, left: false };
    this.isLocked = false;
    this.onPointerLock = null;
    this.onPointerLockLost = null;

    this._justPressed = {};
    this._keydown = e => {
      if (!this.keys[e.code]) this._justPressed[e.code] = true;
      this.keys[e.code] = true;
    };
    this._keyup = e => { this.keys[e.code] = false; };
    this._mousemove = e => {
      if (this.isLocked) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    };
    this._mousedown = e => {
      if (e.button === 0) { this.mouse.left = true; this.mouse._justClicked = true; }
    };
    this._mouseup = e => {
      if (e.button === 0) { this.mouse.left = false; this.mouse._justClicked = false; }
    };
    this._pointerlockchange = () => {
      const locked = document.pointerLockElement;
      this.isLocked = locked === canvas || locked === document.body;
      if (this.isLocked) {
        this.onPointerLock?.();
      } else {
        this.mouse.left = false;
        this.onPointerLockLost?.();
      }
    };
    this._pointerlockerror = () => {
      // ignore — lock may be retried
    };

    document.addEventListener('keydown', this._keydown);
    document.addEventListener('keyup', this._keyup);
    document.addEventListener('mousemove', this._mousemove);
    document.addEventListener('mousedown', this._mousedown);
    document.addEventListener('mouseup', this._mouseup);
    document.addEventListener('pointerlockchange', this._pointerlockchange);
    document.addEventListener('pointerlockerror', this._pointerlockerror);
  }

  update() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse._justClicked = false;
    this._justPressed = {}; // clear each frame
  }

  isDown(key) {
    return !!this.keys[key];
  }

  justDown(key) {
    const val = !!this._justPressed[key];
    if (val) this._justPressed[key] = false; // consume
    return val;
  }

  mouseJustDown() {
    const val = !!this.mouse._justClicked;
    if (val) this.mouse._justClicked = false; // consume
    return val;
  }

  dispose() {
    document.removeEventListener('keydown', this._keydown);
    document.removeEventListener('keyup', this._keyup);
    document.removeEventListener('mousemove', this._mousemove);
    document.removeEventListener('mousedown', this._mousedown);
    document.removeEventListener('mouseup', this._mouseup);
    document.removeEventListener('pointerlockchange', this._pointerlockchange);
    document.removeEventListener('pointerlockerror', this._pointerlockerror);
  }
}
