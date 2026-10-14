// Presence client, loaded on every page after common.js. Keeps one WebSocket open to
// /ws/presence/ and exposes Chat.presence. Pages draw a dot with presence.dot(id, ...);
// dots update themselves live.
(() => {
  const state = new Map();   // user id -> { online, last_seen }
  const listeners = [];

  const pad = (n) => String(n).padStart(2, "0");

  function statusText(s) {
    if (s.online) return "online";
    if (!s.last_seen) return "offline";
    const d = new Date(s.last_seen);
    const now = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
      new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days === 0) return `last seen today at ${time}`;
    if (days === 1) return `last seen yesterday at ${time}`;
    return `last seen ${d.toLocaleDateString()} at ${time}`;
  }

  function get(id) {
    return state.get(id) || { online: false, last_seen: null };
  }

  // Remember what the API told us, unless a live update already told us something fresher.
  function seed(id, online, lastSeen) {
    if (!state.has(id)) state.set(id, { online: !!online, last_seen: lastSeen || null });
  }

  function refreshDots(id) {
    const s = get(id);
    document.querySelectorAll(`.dot[data-uid="${id}"]`).forEach((dot) => {
      dot.classList.toggle("online", s.online);
      dot.title = statusText(s);
    });
  }

  function notify(id) {
    refreshDots(id);
    listeners.forEach((fn) => fn(id));
  }

  function set(id, online, lastSeen) {
    const old = get(id);
    state.set(id, { online, last_seen: lastSeen || old.last_seen });
    notify(id);
  }

  function dot(id, online, lastSeen) {
    seed(id, online, lastSeen);
    const span = document.createElement("span");
    span.className = "dot";
    span.dataset.uid = String(id);
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", statusText(get(id)));
    refreshDots(id);  // no-op until attached; set the initial look directly:
    span.classList.toggle("online", get(id).online);
    span.title = statusText(get(id));
    return span;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function handle(data) {
    if (data.event === "snapshot") {
      const online = new Set(data.online);
      for (const [id, s] of state) {
        if (s.online && !online.has(id)) set(id, false, null);
      }
      online.forEach((id) => set(id, true, null));
    } else if (data.event === "update") {
      set(data.user_id, data.online, data.last_seen);
    }
  }

  let socket = null;
  function connect() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws/presence/`);
    socket = ws;
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (socket === ws) setTimeout(connect, 3000);  // server restart or network blip
    };
  }

  window.Chat.presence = { get, seed, set, dot, onChange, statusText, handle };
  if (window.Chat.me) connect();
})();
