(() => {
  const { api } = Chat;
  const form = document.getElementById("login-form");
  const error = document.getElementById("login-error");

  // Only follow ?next= when it is a path on this site.
  function destination() {
    const next = new URLSearchParams(location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/chat/";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    const res = await api("/api/auth/login/", {
      method: "POST",
      redirectOnAuthError: false,
      body: {
        username: document.getElementById("login-username").value,
        password: document.getElementById("login-password").value,
      },
    });
    if (!res.ok) {
      error.textContent = "Invalid username or password.";
      return;
    }
    location.href = destination();
  });
})();
