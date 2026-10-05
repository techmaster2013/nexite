const channels = {
  general: [
    { user: "nexbot", avatar: "N", kind: "bot", text: "welcome to nexite 👋", time: "just now" },
    { user: "cubey", avatar: "🧊", kind: "cube", text: "cube", time: "just now" }
  ],
  random: [
    { user: "nexbot", avatar: "N", kind: "bot", text: "this is #random. do whatever 😭", time: "just now" }
  ],
  memes: [
    { user: "cubey", avatar: "🧊", kind: "cube", text: "there are currently zero memes. devastating.", time: "just now" }
  ]
};

let currentChannel = "general";

const messages = document.querySelector("#messages");
const channelTitle = document.querySelector("#channelTitle");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const searchInput = document.querySelector("#search");

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function messageHTML(message) {
  return `
    <article class="message" data-text="${escapeHTML((message.user + " " + message.text).toLowerCase())}">
      <div class="avatar ${message.kind || ""}">${escapeHTML(message.avatar)}</div>
      <div class="message-body">
        <div class="message-meta">
          <strong>${escapeHTML(message.user)}</strong>
          <time>${escapeHTML(message.time)}</time>
        </div>
        <p>${escapeHTML(message.text)}</p>
      </div>
    </article>
  `;
}

function renderMessages() {
  const list = channels[currentChannel] || [];

  messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">#</div>
      <h1>Welcome to #${escapeHTML(currentChannel)}!</h1>
      <p>This is the start of the #${escapeHTML(currentChannel)} channel.</p>
    </div>
    ${list.map(messageHTML).join("")}
  `;

  messages.scrollTop = messages.scrollHeight;
}

function switchChannel(name) {
  if (!channels[name]) channels[name] = [];
  currentChannel = name;
  channelTitle.textContent = name;
  messageInput.placeholder = `Message #${name}`;

  document.querySelectorAll(".channel[data-channel]").forEach(button => {
    button.classList.toggle("active", button.dataset.channel === name);
  });

  searchInput.value = "";
  renderMessages();
  messageInput.focus();
}

document.querySelectorAll(".channel[data-channel]").forEach(button => {
  button.addEventListener("click", () => switchChannel(button.dataset.channel));
});

messageForm.addEventListener("submit", event => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  channels[currentChannel].push({
    user: "you",
    avatar: "Z",
    kind: "me",
    text,
    time: new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date())
  });

  messageInput.value = "";
  renderMessages();
});

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim().toLowerCase();
  document.querySelectorAll(".message").forEach(message => {
    message.hidden = query && !message.dataset.text.includes(query);
  });
});

document.querySelectorAll(".server").forEach(button => {
  button.addEventListener("click", () => {
    if (button.classList.contains("add")) return;
    document.querySelectorAll(".server").forEach(server => server.classList.remove("active"));
    button.classList.add("active");
  });
});

renderMessages();
