(() => {
  const { me, api, el, logout, presence: P } = Chat;

  const convList = document.getElementById("conversation-list");
  const chatTitle = document.getElementById("chat-title");
  const statusEl = document.getElementById("connection-status");
  const messagesEl = document.getElementById("messages");
  const placeholder = document.getElementById("placeholder");
  const olderBtn = document.getElementById("load-older");
  const listEl = document.getElementById("message-list");
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("message-input");
  const membersLink = document.getElementById("members-link");
  const fileInput = document.getElementById("file-input");
  const attachBtn = document.getElementById("attach-btn");
  const voiceBtn = document.getElementById("voice-btn");
  const cancelVoiceBtn = document.getElementById("cancel-voice");
  const recTimerEl = document.getElementById("rec-timer");
  const recTimeEl = document.getElementById("rec-time");
  const sendBtn = document.getElementById("send-btn");
  const chatErrorEl = document.getElementById("chat-error");
  const dropHint = document.getElementById("drop-hint");
  const chatPane = document.querySelector(".chat");
  Chat.setIcon(attachBtn, "paper-clip");
  Chat.setIcon(voiceBtn, "microphone");
  Chat.setIcon(cancelVoiceBtn, "x-mark");
  const MAX_UPLOAD_MB = 25;  // keep in sync with CHAT_MAX_UPLOAD_MB on the server

  let conversations = [];   // the user's conversations
  let current = null;       // conversation currently open
  let socket = null;        // WebSocket of the open conversation
  let retryCount = 0;
  let olderUrl = null;      // next page of older messages, if any

  document.getElementById("logout-btn").addEventListener("click", logout);

  let pinned = true;  // true while the user is reading the newest messages
  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  messagesEl.addEventListener("scroll", () => {
    pinned = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  });

  let errorTimer = null;
  function showError(text) {
    chatErrorEl.textContent = text;
    chatErrorEl.classList.remove("hidden");
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => chatErrorEl.classList.add("hidden"), 7000);
  }

  function setStatus(text, online = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("online", online);
  }

  // Once the chat socket is open, the header shows the other person's presence (direct
  // chats) or simply "connected".
  function showPeerStatus() {
    if (!current || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (current.type === "direct" && current.peer) {
      const st = P.get(current.peer.id);
      setStatus(P.statusText(st), st.online);
    } else {
      setStatus("connected");
    }
  }
  P.onChange(showPeerStatus);

  function resetChatPane() {
    listEl.replaceChildren();
    olderBtn.classList.add("hidden");
    membersLink.classList.add("hidden");
    placeholder.textContent = "Choose a conversation on the left to start chatting.";
    placeholder.classList.remove("hidden");
    messageForm.classList.add("hidden");
    chatTitle.textContent = "Select a conversation";
    setStatus("");
    history.replaceState(null, "", "/chat/");
  }

  // ---------- conversation list ----------
  // Refreshed every 15 seconds so new groups and recent activity show up (a per-user
  // live connection will replace this later).
  async function refreshConversations() {
    const res = await api("/api/conversations/");
    if (!res.ok) return;
    const fresh = await res.json();
    const byId = new Map(conversations.map((c) => [c.id, c]));
    conversations = fresh.map((s) => {  // keep the same objects so `current` stays valid
      const old = byId.get(s.id);
      if (old) {
        Object.assign(old, s);
        return old;
      }
      return s;
    });
    if (current && !conversations.includes(current)) {
      closeSocket();
      current = null;
      resetChatPane();
    }
    renderConversations();
  }

  function renderConversations() {
    convList.replaceChildren();
    if (!conversations.length) {
      convList.append(el("li", "empty", "No conversations yet."));
      return;
    }
    for (const c of conversations) {
      const li = el("li", "conversation" + (current && current.id === c.id ? " active" : ""));
      const title = el("div", "title");
      if (c.type === "direct" && c.peer) title.append(P.dot(c.peer.id, c.peer.online, c.peer.last_seen));
      title.append(c.title);
      if (c.type === "group") title.append(el("span", "badge", "Group"));
      if (c.type === "department") title.append(el("span", "badge", "Dept"));
      if (c.type === "general") title.append(el("span", "badge", "All"));
      li.append(title);
      const preview = el("div", "preview");
      if (c.last_message) preview.append(...previewParts(c.last_message));
      else preview.textContent = "No messages yet";
      li.append(preview);
      li.addEventListener("click", () => openConversation(c));
      convList.append(li);
    }
  }

  async function openConversation(c) {
    stopRecording(true);
    closeSocket();
    current = c;
    retryCount = 0;
    history.replaceState(null, "", `/chat/?c=${c.id}`);  // a refresh reopens this chat
    renderConversations();
    chatTitle.textContent = c.title;
    membersLink.href = `/chat/${c.id}/members/`;
    membersLink.classList.toggle("hidden", c.type === "direct");
    placeholder.classList.add("hidden");
    messageForm.classList.remove("hidden");
    listEl.replaceChildren();
    olderUrl = null;
    olderBtn.classList.add("hidden");

    const res = await api(`/api/conversations/${c.id}/messages/`);
    if (!current || current.id !== c.id) return;  // user switched while loading
    if (!res.ok) {
      placeholder.textContent = "Could not load messages.";
      placeholder.classList.remove("hidden");
      return;
    }
    const data = await res.json();
    olderUrl = data.next;
    olderBtn.classList.toggle("hidden", !olderUrl);
    data.results.reverse().forEach((m) => listEl.append(messageNode(m)));  // API: newest first
    pinned = true;
    scrollToBottom();
    messageInput.focus();
    connectSocket(c.id);
  }

  olderBtn.addEventListener("click", async () => {
    if (!olderUrl) return;
    const u = new URL(olderUrl);
    const res = await api(u.pathname + u.search);
    if (!res.ok) return;
    const data = await res.json();
    const previousHeight = messagesEl.scrollHeight;
    const fragment = document.createDocumentFragment();
    data.results.reverse().forEach((m) => fragment.append(messageNode(m)));
    listEl.prepend(fragment);
    messagesEl.scrollTop += messagesEl.scrollHeight - previousHeight;  // keep position
    olderUrl = data.next;
    olderBtn.classList.toggle("hidden", !olderUrl);
  });

  // ---------- messages ----------
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // One line for the conversation list: "sender: [icon] text"
  function previewParts(m) {
    const who = `${m.sender}: `;
    if (m.kind === "image") return [who, Chat.icon("photo", "icon-inline"), "Photo" + (m.content ? ": " + m.content : "")];
    if (m.kind === "audio") return [who, Chat.icon("microphone", "icon-inline"), "Voice note"];
    if (m.kind === "file") return [who, Chat.icon("document", "icon-inline"), m.attachment ? m.attachment.name : "File"];
    return [who + m.content];
  }

  // The body of a bubble depends on the kind of message.
  function appendBody(wrap, m) {
    const a = m.attachment;
    if (a && m.kind === "image") {
      const link = el("a", "media-link");
      link.href = a.url;
      link.target = "_blank";
      link.rel = "noopener";
      const img = el("img", "media-image");
      img.src = a.url;
      img.alt = a.name;
      img.loading = "lazy";
      img.addEventListener("load", () => { if (pinned) scrollToBottom(); });
      link.append(img);
      wrap.append(link);
    } else if (a && m.kind === "audio") {
      const audio = el("audio", "media-audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = a.url;
      wrap.append(audio);
    } else if (a) {
      const link = el("a", "file-link");
      link.href = a.url + "?download=1";
      link.download = a.name;
      const fileIcon = el("span", "file-icon");
      fileIcon.append(Chat.icon("document"));
      link.append(fileIcon);
      const info = el("span", "file-info");
      info.append(el("span", "file-name", a.name), el("small", "file-size", formatSize(a.size)));
      link.append(info);
      wrap.append(link);
    }
    if (m.content) wrap.append(el("div", "content", m.content));
  }

  function messageNode(m) {
    const mine = m.sender === me.username;
    const wrap = el("div", "message " + (mine ? "mine" : "theirs"));
    wrap.dataset.id = m.id;
    if (!mine) wrap.append(el("div", "sender", m.sender));
    appendBody(wrap, m);
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    wrap.append(el("div", "time", time));
    return wrap;
  }

  function onLiveMessage(conversationId, m) {
    if (!current || current.id !== conversationId) return;
    if (!listEl.querySelector(`[data-id="${m.id}"]`)) {
      const nearBottom = pinned;
      listEl.append(messageNode(m));
      if (nearBottom || m.sender === me.username) {
        pinned = true;
        scrollToBottom();
      }
    }
    current.last_message = m;
    renderConversations();
  }

  messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const content = messageInput.value.trim();
    if (!content || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ content }));
    messageInput.value = "";
  });

  // ---------- files, images, voice notes ----------
  let uploading = false;

  function setBusy(busy) {
    [attachBtn, voiceBtn, sendBtn].forEach((b) => { b.disabled = busy; });
  }

  async function uploadFile(file, { voice = false } = {}) {
    if (!current || uploading) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      showError(`"${file.name}" is too big. Files are limited to ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    const conversationId = current.id;
    const form = new FormData();
    form.append("file", file, file.name);
    const caption = messageInput.value.trim();
    if (caption && !voice) form.append("caption", caption);
    if (voice) form.append("voice", "1");

    uploading = true;
    setBusy(true);
    setStatus("uploading...");
    try {
      const res = await api(`/api/conversations/${conversationId}/attachments/`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let text = "The file could not be sent.";
        try { text = (await res.json()).detail || text; } catch {}
        showError(text);
        return;
      }
      if (!voice) messageInput.value = "";
      onLiveMessage(conversationId, await res.json());  // the live copy is ignored as a duplicate
    } catch {
      showError("The file could not be sent. Check your connection.");
    } finally {
      uploading = false;
      setBusy(false);
      showPeerStatus();
    }
  }

  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) uploadFile(file);
  });

  // Drag and drop onto the conversation
  let dragDepth = 0;
  chatPane.addEventListener("dragenter", (e) => {
    if (!current || !e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    dragDepth += 1;
    dropHint.classList.remove("hidden");
  });
  chatPane.addEventListener("dragover", (e) => { if (current) e.preventDefault(); });
  chatPane.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.classList.add("hidden");
  });
  chatPane.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropHint.classList.add("hidden");
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file && current) uploadFile(file);
  });

  // Paste a screenshot or copied image straight into the message box
  messageInput.addEventListener("paste", (e) => {
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const item = items.find((i) => i.kind === "file");
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    uploadFile(file);
  });

  // Voice notes (MediaRecorder needs HTTPS or localhost)
  let recorder = null;
  let recStream = null;
  let recChunks = [];
  let recCancelled = false;
  let recStarted = 0;
  let recInterval = null;
  const MAX_RECORDING_SECONDS = 300;

  function pickAudioType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  function setRecordingUi(on) {
    recTimerEl.classList.toggle("hidden", !on);
    cancelVoiceBtn.classList.toggle("hidden", !on);
    messageInput.classList.toggle("hidden", on);
    attachBtn.classList.toggle("hidden", on);
    sendBtn.classList.toggle("hidden", on);
    voiceBtn.classList.toggle("recording", on);
    voiceBtn.title = on ? "Stop and send" : "Record a voice note";
    Chat.setIcon(voiceBtn, on ? "stop" : "microphone");
  }

  async function startRecording() {
    if (!current || uploading) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showError("Voice notes need a secure connection (HTTPS or localhost) and a browser that can record audio.");
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showError("Microphone access was denied. Allow it in the browser to record voice notes.");
      return;
    }
    const mimeType = pickAudioType();
    recorder = new MediaRecorder(recStream, mimeType ? { mimeType } : undefined);
    recChunks = [];
    recCancelled = false;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.start();
    recStarted = Date.now();
    setRecordingUi(true);
    const tick = () => {
      const seconds = Math.floor((Date.now() - recStarted) / 1000);
      recTimeEl.textContent = `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording(false);
    };
    tick();
    recInterval = setInterval(tick, 500);
  }

  function stopRecording(cancel) {
    if (!recorder || recorder.state === "inactive") return;
    recCancelled = cancel;
    recorder.stop();
  }

  function finishRecording() {
    clearInterval(recInterval);
    if (recStream) recStream.getTracks().forEach((t) => t.stop());
    setRecordingUi(false);
    const type = (recorder && recorder.mimeType) || "audio/webm";
    const seconds = (Date.now() - recStarted) / 1000;
    recorder = null;
    recStream = null;
    if (recCancelled || !recChunks.length || seconds < 1) return;  // cancelled or accidental tap
    const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    uploadFile(new File(recChunks, `voice-note-${stamp}.${ext}`, { type }), { voice: true });
  }

  voiceBtn.addEventListener("click", () => (recorder ? stopRecording(false) : startRecording()));
  cancelVoiceBtn.addEventListener("click", () => stopRecording(true));

  // ---------- WebSocket ----------
  function connectSocket(conversationId) {
    closeSocket();
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/ws/chat/${conversationId}/`);
    socket = ws;
    setStatus("connecting...");

    ws.onopen = () => {
      retryCount = 0;
      showPeerStatus();
    };
    ws.onmessage = (event) => onLiveMessage(conversationId, JSON.parse(event.data));
    ws.onclose = () => {
      if (socket !== ws) return;  // closed on purpose or replaced by a newer socket
      if (retryCount >= 5) {
        setStatus("disconnected");
        return;
      }
      retryCount += 1;
      setStatus("disconnected, retrying...");
      setTimeout(() => {
        if (socket === ws && current && current.id === conversationId) {
          connectSocket(conversationId);
        }
      }, 2000);
    };
  }

  function closeSocket() {
    if (socket) {
      const ws = socket;
      socket = null;  // set first so onclose knows this close is intentional
      ws.close();
    }
    setStatus("");
  }

  // ---------- start ----------
  (async function start() {
    await refreshConversations();
    const wanted = Number(new URLSearchParams(location.search).get("c"));
    const target = conversations.find((c) => c.id === wanted);
    if (target) openConversation(target);
    setInterval(() => {
      if (!document.hidden) refreshConversations();
    }, 15000);
  })();
})();
