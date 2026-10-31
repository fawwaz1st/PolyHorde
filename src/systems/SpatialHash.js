// Spatial hash grid — integer key (tanpa alokasi string), zero-alloc queryInto
export class SpatialHash {
  constructor(cellSize = 4) {
    this.cellSize = cellSize;
    this.buckets = new Map();
  }
  // Kunci numerik (dulu template string per insert -> alokasi per frame)
  _key(cx, cz) { return cx * 4096 + cz; }
  clear() { this.buckets.clear(); }
  insert(id, x, z, data) {
    const cs = this.cellSize;
    const k = this._key(Math.floor(x / cs), Math.floor(z / cs));
    let b = this.buckets.get(k);
    if (!b) { b = []; this.buckets.set(k, b); }
    b.push(data); // simpan ref langsung, tanpa wrapper {id,data}
  }
  // Zero-alloc: isi array existing
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
