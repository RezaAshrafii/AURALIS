export class Store {
  constructor(initial={}) { this.state=structuredClone(initial); this.listeners=new Set(); }
  get(){ return this.state; }
  set(patch){ this.state={...this.state,...patch}; this.emit(); }
  update(fn){ this.state=fn(this.state); this.emit(); }
  subscribe(fn){ this.listeners.add(fn); fn(this.state); return()=>this.listeners.delete(fn); }
  emit(){ for(const fn of this.listeners) fn(this.state); }
}
