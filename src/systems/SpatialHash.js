// Spatial hash grid — integer key, bucket pool (zero-alloc per frame)
export class SpatialHash {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.buckets = new Map();
    this._pool = []; // pool array bucket untuk dipakai ulang
  }
  _key(cx, cz) { return cx * 4096 + cz; }
  clear() {
    // Kembalikan semua bucket ke pool (bukan buang array)
    for (const [k, arr] of this.buckets) {
      arr.length = 0;
      this._pool.push(arr);
    }
    this.buckets.clear();
  }
  insert(id, x, z, data) {
    const cs = this.cellSize;
    const k = this._key(Math.floor(x / cs), Math.floor(z / cs));
    let b = this.buckets.get(k);
    if (!b) {
      b = this._pool.pop() || [];
      this.buckets.set(k, b);
    }
    b.push(data);
  }
  queryInto(x, z, range, out) {
    out.length = 0;
    const cs = this.cellSize;
    const minCx = Math.floor((x - range) / cs);
    const maxCx = Math.floor((x + range) / cs);
    const minCz = Math.floor((z - range) / cs);
    const maxCz = Math.floor((z + range) / cs);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.buckets.get(this._key(cx, cz));
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
