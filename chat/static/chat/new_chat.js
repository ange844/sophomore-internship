(() => {
  const { api, createPicker, errorText } = Chat;
  const error = document.getElementById("error");

  async function startChat(user) {
    error.textContent = "";
    const res = await api("/api/conversations/direct/", {
      method: "POST",
      body: { user_id: user.id },
    });
    if (!res.ok) {
      error.textContent = await errorText(res);
      return;
    }
    const conversation = await res.json();
    location.href = `/chat/?c=${conversation.id}`;
  }

  createPicker(document.getElementById("picker"), { onPick: startChat }).load();
})();
