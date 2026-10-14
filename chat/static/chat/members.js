(() => {
  const { me, api, el, createPicker, errorText, presence: P } = Chat;
  const conversationId = Number(document.querySelector("[data-conversation-id]").dataset.conversationId);
  const list = document.getElementById("members-list");
  const error = document.getElementById("error");
  const addSection = document.getElementById("add-members");
  const leaveBtn = document.getElementById("leave-btn");
  let detail = null;

  const picker = createPicker(document.getElementById("picker"), {
    onPick: addMember,
    isDisabled: (user) => detail && detail.members.some((m) => m.id === user.id),
  });

  async function load() {
    const res = await api(`/api/conversations/${conversationId}/`);
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    render(await res.json());
  }

  function render(data) {
    detail = data;
    const isGroup = data.type === "group";
    const iAmAdmin = data.my_role === "admin";
    document.getElementById("title").textContent = data.title;
    const notes = {
      department: "Members of this channel are managed through each person's department.",
      general: "Everyone in the company belongs to this chat.",
    };
    document.getElementById("note").textContent = notes[data.type] || "";

    list.replaceChildren();
    for (const m of data.members) {
      const li = el("li", "member");
      li.append(P.dot(m.id, m.online, m.last_seen));
      const name = el("span", "name", m.username + (m.id === me.id ? " (you)" : ""));
      name.append(el("small", "last-seen", P.statusText(P.get(m.id))));
      li.append(name);
      if (isGroup && m.role === "admin") li.append(el("span", "badge", "Admin"));
      if (isGroup && iAmAdmin && m.id !== me.id) {
        const remove = el("button", "", "Remove");
        remove.type = "button";
        remove.addEventListener("click", () => removeMember(m.id));
        li.append(remove);
      }
      list.append(li);
    }

    const canAdd = isGroup && iAmAdmin;
    addSection.classList.toggle("hidden", !canAdd);
    leaveBtn.classList.toggle("hidden", !isGroup);
    if (canAdd) picker.ensureLoaded();
  }

  async function addMember(user) {
    error.textContent = "";
    const res = await api(`/api/conversations/${conversationId}/members/`, {
      method: "POST",
      body: { user_ids: [user.id] },
    });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    render(await res.json());
  }

  async function removeMember(userId) {
    error.textContent = "";
    const res = await api(`/api/conversations/${conversationId}/members/${userId}/`, {
      method: "DELETE",
    });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    load();
  }

  leaveBtn.addEventListener("click", async () => {
    if (!confirm("Leave this group?")) return;
    const res = await api(`/api/conversations/${conversationId}/members/${me.id}/`, {
      method: "DELETE",
    });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    location.href = "/chat/";
  });

  P.onChange(() => { if (detail) render(detail); });
  load();
})();
