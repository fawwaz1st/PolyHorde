// 12-line event bus — replaces document CustomEvent
export const Events = {
  _listeners: {},
  on(event, fn) { (this._listeners[event] ??= []).push(fn); return () => this.off(event, fn); },
  off(event, fn) { const a = this._listeners[event]; if (a) { const i = a.indexOf(fn); if (i > -1) a.splice(i, 1); }},
  emit(event, data) { this._listeners[event]?.forEach(fn => fn(data)); }
};
