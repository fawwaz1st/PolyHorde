// Event bus — deklaratif, off() otomatis
export const Events = {
  _l: {},
  on(e, fn) { (this._l[e] ??= []).push(fn); return () => this.off(e, fn); },
  off(e, fn) { const a = this._l[e]; if (a) { const i = a.indexOf(fn); if (i > -1) a.splice(i, 1); } },
  emit(e, d) { const a = this._l[e]; if (a) for (let i = 0; i < a.length; i++) a[i](d); }
};
