(() => {
  const { api, el, displayName, errorText, presence: P } = Chat;
  const search = document.getElementById("people-search");
  const error = document.getElementById("error");
  let users = [];

  async function startChat(user) {
    error.textContent = "";
    const res = await api("/api/conversations/direct/", { method: "POST", body: { user_id: user.id } });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    location.href = `/chat/?c=${(await res.json()).id}`;
  }

  function row(user) {
    const li = el("li", "picker-item");
    const name = el("span", "name");
    name.append(P.dot(user.id, user.online, user.last_seen), displayName(user));
    li.append(name);
    const st = P.get(user.id);
    const info = [user.department || "No department"];
    if (!st.online) info.push(P.statusText(st));
    li.append(el("span", "dept", info.join(" · ")));
    li.addEventListener("click", () => startChat(user));
    return li;
  }

  function fill(listId, titleId, label, items) {
    const list = document.getElementById(listId);
    list.replaceChildren();
    document.getElementById(titleId).textContent = `${label} (${items.length})`;
    if (!items.length) list.append(el("li", "empty", "No one."));
    items.forEach((u) => list.append(row(u)));
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = users.filter((u) => !q || displayName(u).toLowerCase().includes(q));
    fill("online-list", "online-title", "Online", shown.filter((u) => P.get(u.id).online));
    fill("offline-list", "offline-title", "Offline", shown.filter((u) => !P.get(u.id).online));
  }

  search.addEventListener("input", render);
  P.onChange(render);  // someone connected or left: regroup the list

  (async function load() {
    const res = await api("/api/users/?limit=500");
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    users = await res.json();
    users.forEach((u) => P.seed(u.id, u.online, u.last_seen));
    render();
  })();
})();
