// Spasial hash grid — O(1) enemy lookup
export class SpatialHash {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.buckets = new Map();
  }
  _key(x, z) { return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`; }
  clear() { this.buckets.clear(); }
  insert(id, x, z, data) {
    const k = this._key(x, z);
    if (!this.buckets.has(k)) this.buckets.set(k, []);
    this.buckets.get(k).push({ id, data });
  }
  remove(id) {
    for (const [, bucket] of this.buckets) {
      const i = bucket.findIndex(e => e.id === id);
      if (i > -1) { bucket.splice(i, 1); return; }
    }
  }
  query(x, z, range) {
    const res = [];
    this.queryInto(x, z, range, res);
    return res;
  }
  // Zero-alloc: isi array existing (riset 2026 — hindari alokasi per frame)
  queryInto(x, z, range, out) {
    out.length = 0;
    const cs = this.cellSize;
    const minCx = Math.floor((x - range) / cs);
    const maxCx = Math.floor((x + range) / cs);
    const minCz = Math.floor((z - range) / cs);
    const maxCz = Math.floor((z + range) / cs);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.buckets.get(cx + "," + cz);
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
