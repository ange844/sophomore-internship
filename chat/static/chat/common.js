// Shared helpers used by every page. Exposes window.Chat.
(() => {
  const body = document.body;
  const me = body.dataset.userId
    ? { id: Number(body.dataset.userId), username: body.dataset.username }
    : null;

  function csrfToken() {
    const match = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function goToLogin() {
    location.href = "/login/?next=" + encodeURIComponent(location.pathname + location.search);
  }

  async function isNotAuthenticated(res) {
    try {
      const data = await res.clone().json();
      return data.detail === "Authentication credentials were not provided.";
    } catch {
      return false;
    }
  }

  // fetch() wrapper: JSON body, CSRF header, and a redirect to the login page when the
  // session has expired.
  async function api(url, { method = "GET", body, redirectOnAuthError = true } = {}) {
    const headers = {};
    const isForm = body instanceof FormData;  // file uploads: the browser sets the type
    if (body && !isForm) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["X-CSRFToken"] = csrfToken();
    const res = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    if (
      redirectOnAuthError &&
      (res.status === 401 || (res.status === 403 && (await isNotAuthenticated(res))))
    ) {
      goToLogin();
      return new Promise(() => {});  // the page is leaving, so never resolve
    }
    return res;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;  // textContent: no HTML injection
    return node;
  }

  function displayName(user) {
    const full = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    return full ? `${full} (${user.username})` : user.username;
  }

  async function errorText(res) {
    try {
      const data = await res.json();
      return data.detail || "Something went wrong.";
    } catch {
      return "Something went wrong.";
    }
  }

  async function logout() {
    await api("/api/auth/logout/", { method: "POST", redirectOnAuthError: false });
    location.href = "/login/";
  }

  // ---------- user picker: search box + department filter + clickable results ----------
  // onPick(user) runs when a person is clicked; isSelected / isDisabled are optional.
  let departmentsCache = null;
  async function getDepartments() {
    if (!departmentsCache) {
      const res = await api("/api/departments/");
      departmentsCache = res.ok ? await res.json() : [];
    }
    return departmentsCache;
  }

  function createPicker(mount, { onPick, isSelected, isDisabled }) {
    const root = el("div", "picker");
    const filters = el("div", "picker-filters");
    const search = el("input");
    search.placeholder = "Search by name...";
    const dept = el("select");
    dept.append(new Option("All departments", ""));
    const results = el("ul", "picker-results");
    filters.append(search, dept);
    root.append(filters, results);
    mount.replaceChildren(root);

    let users = [];
    let sequence = 0;
    let loadedOnce = false;
    let timer = null;

    getDepartments().then((list) => {
      list.forEach((d) => dept.append(new Option(d.name, String(d.id))));
    });

    function render() {
      results.replaceChildren();
      if (!users.length) {
        results.append(el("li", "empty", "No one found."));
        return;
      }
      for (const u of users) {
        const li = el("li", "picker-item");
        const nameEl = el("span", "name");
        nameEl.append(Chat.presence.dot(u.id, u.online, u.last_seen), displayName(u));
        li.append(nameEl);
        li.append(el("span", "dept", u.department || "No department"));
        if (isSelected && isSelected(u)) li.classList.add("selected");
        if (isDisabled && isDisabled(u)) {
          li.classList.add("disabled");
        } else {
          li.addEventListener("click", () => onPick(u));
        }
        results.append(li);
      }
    }

    async function load() {
      loadedOnce = true;
      const mine = ++sequence;  // ignore out-of-order responses
      const params = new URLSearchParams();
      if (search.value.trim()) params.set("q", search.value.trim());
      if (dept.value) params.set("department", dept.value);
      const res = await api("/api/users/?" + params.toString());
      if (!res.ok || mine !== sequence) return;
      users = await res.json();
      render();
    }

    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    dept.addEventListener("change", load);

    return { load, render, ensureLoaded: () => (loadedOnce ? render() : load()) };
  }

  window.Chat = { me, api, el, displayName, errorText, logout, createPicker };
})();
