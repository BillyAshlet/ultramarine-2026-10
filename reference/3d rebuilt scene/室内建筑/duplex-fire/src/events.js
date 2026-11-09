// Events: something happened that a person should be able to point at — an
// object caught fire, a room flashed over, a gas meter failed.
//
// Mechanisms only report; what is shown (the red ! and the cards) is task G's.
// Until G exists every event is printed to the console, so nothing is lost.

export class Events {
  constructor(clock) {
    this.clock = clock;          // () => simulated seconds
    this.log = [];
    this.listeners = [];
  }

  /**
   * @param {{type: string, objectId?: string, pos?: number[], data?: object, time?: number}} e
   *   type names a card in cards.json (e.g. '点燃', '轰燃'); pos is [x, y, z] in metres.
   */
  emit(e) {
    const event = { ...e, time: e.time ?? this.clock() };
    this.log.push(event);
    if (this.listeners.length === 0) console.info('[event]', event.type, event);
    for (const fn of this.listeners) {
      try { fn(event); } catch (err) { console.error('[events] listener failed', err); }
    }
    return event;
  }

  /** Call fn with every event from now on. Returns a function that stops it. */
  on(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  reset() { this.log = []; }
}
