// Dünner WebSocket-Client für den Relay-Server.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.id = null;
  }

  on(type, fn) { this.handlers[type] = fn; }

  connect(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      if (location.protocol === 'file:') return reject(new Error('Kein Server (Datei lokal geöffnet)'));
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { ws.close(); reject(new Error('Server antwortet nicht')); }, timeoutMs);
      ws.onopen = () => { clearTimeout(timer); this.ws = ws; resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Keine Verbindung zum Server')); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.handlers.close && this.handlers.close(); } };
      ws.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        const h = this.handlers[m.t];
        if (h) h(m);
      };
    });
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  send(obj) { if (this.connected) this.ws.send(JSON.stringify(obj)); }

  // Host → Gast(e)
  toPeer(id, data) { this.send({ t: 'to', to: id, data }); }
  toAll(data) { this.send({ t: 'to', to: 'all', data }); }
  // Gast → Host
  toHost(data) { this.send({ t: 'host', data }); }

  close() { if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); } }
}
