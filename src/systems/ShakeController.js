// Screen shake controller — one instance in Game
export class ShakeController {
  constructor() {
    this.intensity = 0;
    this.decay = 4;
    this.offset = { x: 0, y: 0 };
  }
  add(amount) { this.intensity = Math.min(this.intensity + amount, 2); }
  update(dt) {
    if (this.intensity > 0.001) {
      this.offset.x = (Math.random() - 0.5) * this.intensity * 0.15;
      this.offset.y = (Math.random() - 0.5) * this.intensity * 0.15;
      this.intensity *= (1 - this.decay * dt);
    } else {
      this.offset.x = this.offset.y = 0;
      this.intensity = 0;
    }
  }
}
