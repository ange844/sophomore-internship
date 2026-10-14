(() => {
  const { api, el, createPicker, errorText } = Chat;
  const nameInput = document.getElementById("group-name");
  const chips = document.getElementById("group-chips");
  const error = document.getElementById("error");
  const selected = new Map();  // id -> user

  function renderChips() {
    chips.replaceChildren();
    for (const user of selected.values()) {
      const chip = el("span", "chip", user.username);
      const remove = el("button", "", "\u00d7");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${user.username}`);
      remove.addEventListener("click", () => {
        selected.delete(user.id);
        renderChips();
        picker.render();
      });
      chip.append(remove);
      chips.append(chip);
    }
  }

  const picker = createPicker(document.getElementById("picker"), {
    onPick: (user) => {
      if (selected.has(user.id)) selected.delete(user.id);
      else selected.set(user.id, user);
      renderChips();
      picker.render();
    },
    isSelected: (user) => selected.has(user.id),
  });
  picker.load();

  document.getElementById("create-group-btn").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    error.textContent = "";
    if (!name) {
      error.textContent = "Please enter a group name.";
      return;
    }
    if (!selected.size) {
      error.textContent = "Pick at least one person.";
      return;
    }
    const res = await api("/api/conversations/group/", {
      method: "POST",
      body: { name, member_ids: [...selected.keys()] },
    });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    const conversation = await res.json();
    location.href = `/chat/?c=${conversation.id}`;
  });
})();
