const elements = {
  notice: document.querySelector("#notice"),
  authBadge: document.querySelector("#auth-badge"),
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  login: document.querySelector("#twitch-login"),
  profileImage: document.querySelector("#profile-image"),
  profileName: document.querySelector("#profile-name"),
  profileLogin: document.querySelector("#profile-login"),
  logout: document.querySelector("#logout"),
  channelForm: document.querySelector("#channel-form"),
  channel: document.querySelector("#channel"),
  language: document.querySelector("#language"),
  overlayUrl: document.querySelector("#overlay-url"),
  copyOverlay: document.querySelector("#copy-overlay"),
  openOverlay: document.querySelector("#open-overlay"),
  demoCard: document.querySelector("#demo-card"),
  demoForm: document.querySelector("#demo-form"),
  demoText: document.querySelector("#demo-text"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionText: document.querySelector("#connection-text"),
  feed: document.querySelector("#feed"),
  empty: document.querySelector("#empty-state"),
  feedChannel: document.querySelector("#feed-channel"),
  feedLanguage: document.querySelector("#feed-language"),
  feedToolbar: document.querySelector(".feed-toolbar"),
};

let liveSocket;
let currentStatus;

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.hidden = !message;
  elements.notice.dataset.type = type;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function selectedLanguage() {
  return elements.language.value || "en";
}

function updateOverlayUrl() {
  const url = new URL("/overlay", window.location.origin);
  url.searchParams.set("language", selectedLanguage());
  elements.overlayUrl.textContent = url.toString();
  elements.openOverlay.href = url.toString();
}

function renderConnection(status) {
  currentStatus = status;
  const isLive = status.phase === "live";
  elements.connectionPill.className = `connection-pill ${status.phase}`;
  elements.connectionText.textContent = status.detail;
  elements.feedToolbar.classList.toggle("live", isLive);
  elements.feedChannel.textContent = status.channel ? `#${status.channel.login}` : "Waiting for a channel";
}

function clearMessages() {
  elements.feed.querySelectorAll(".chat-message").forEach((node) => node.remove());
  elements.empty.hidden = false;
}

function addMessage(message) {
  elements.empty.hidden = true;
  const article = document.createElement("article");
  article.className = "chat-message";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("strong");
  name.textContent = message.chatterName;
  name.style.color = message.color || "#a879ff";
  const time = document.createElement("span");
  time.textContent = new Date(message.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const language = document.createElement("span");
  language.className = "language-tag";
  language.textContent = message.sourceLanguageCode;
  meta.append(name, time, language);

  const translated = document.createElement("p");
  translated.className = "translated-text";
  translated.textContent = message.translatedText;
  article.append(meta, translated);

  if (message.originalText !== message.translatedText) {
    const original = document.createElement("p");
    original.className = "original-text";
    original.textContent = message.originalText;
    article.append(original);
  }
  elements.feed.append(article);
  while (elements.feed.querySelectorAll(".chat-message").length > 50) {
    elements.feed.querySelector(".chat-message")?.remove();
  }
  article.scrollIntoView({ block: "end", behavior: "smooth" });
}

function connectLiveSocket() {
  liveSocket?.close();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  liveSocket = new WebSocket(`${protocol}//${window.location.host}/live?language=${encodeURIComponent(selectedLanguage())}`);
  liveSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "ready" || payload.type === "language_changed") {
      clearMessages();
      payload.recent?.forEach(addMessage);
      if (payload.status) renderConnection(payload.status);
    } else if (payload.type === "status") {
      renderConnection(payload.status);
    } else if (payload.type === "translation") {
      addMessage(payload.message);
    } else if (payload.type === "translation_error") {
      showNotice(payload.detail);
    }
  });
  liveSocket.addEventListener("close", () => {
    if (!document.hidden) setTimeout(connectLiveSocket, 1800);
  }, { once: true });
}

async function initialize() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("error")) showNotice(params.get("error"));

  try {
    const status = await request("/api/status");
    const savedLanguage = localStorage.getItem("nioret.language") || "en";
    for (const language of status.languages) {
      const option = new Option(language.name, language.code, false, language.code === savedLanguage);
      elements.language.add(option);
    }
    if (!elements.language.value) elements.language.value = "en";
    elements.feedLanguage.textContent = elements.language.selectedOptions[0].textContent;

    if (!status.twitchConfigured) {
      elements.authBadge.textContent = "Needs setup";
      elements.authBadge.className = "badge bad";
      elements.login.setAttribute("aria-disabled", "true");
      elements.login.textContent = "Configure Twitch credentials";
    } else if (status.authenticatedUser) {
      elements.authBadge.textContent = "Authorized";
      elements.authBadge.className = "badge good";
      elements.signedOut.hidden = true;
      elements.signedIn.hidden = false;
      elements.profileImage.src = status.authenticatedUser.profileImageUrl;
      elements.profileImage.alt = `${status.authenticatedUser.displayName} profile`;
      elements.profileName.textContent = status.authenticatedUser.displayName;
      elements.profileLogin.textContent = `@${status.authenticatedUser.login}`;
      elements.channel.value = status.authenticatedUser.login;
    } else {
      elements.authBadge.textContent = "Not connected";
      elements.authBadge.className = "badge neutral";
    }
    if (!status.openaiConfigured) showNotice("OPENAI_API_KEY is not configured; incoming messages cannot be translated yet.");
    elements.demoCard.hidden = !status.demoMode;
    renderConnection(status.connection);
    updateOverlayUrl();
    connectLiveSocket();
  } catch (error) {
    showNotice(error.message);
  }
}

elements.channelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showNotice("");
  try {
    const payload = await request("/api/twitch/connect", { method: "POST", body: JSON.stringify({ channel: elements.channel.value }) });
    renderConnection(payload.connection);
  } catch (error) { showNotice(error.message); }
});

elements.logout.addEventListener("click", async () => {
  try { await request("/auth/logout", { method: "POST" }); window.location.assign("/"); }
  catch (error) { showNotice(error.message); }
});

elements.language.addEventListener("change", () => {
  localStorage.setItem("nioret.language", selectedLanguage());
  elements.feedLanguage.textContent = elements.language.selectedOptions[0].textContent;
  updateOverlayUrl();
  clearMessages();
  if (liveSocket?.readyState === WebSocket.OPEN) {
    liveSocket.send(JSON.stringify({ type: "set_language", language: selectedLanguage() }));
  } else connectLiveSocket();
});

elements.copyOverlay.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.overlayUrl.textContent);
  const original = elements.copyOverlay.textContent;
  elements.copyOverlay.textContent = "Copied";
  setTimeout(() => { elements.copyOverlay.textContent = original; }, 1200);
});

elements.demoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showNotice("");
  try { await request("/api/demo/message", { method: "POST", body: JSON.stringify({ text: elements.demoText.value }) }); }
  catch (error) { showNotice(error.message); }
});

void initialize();
