import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  query,
  limitToLast,
  onChildAdded,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#app");
const authForm = document.querySelector("#authForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const authError = document.querySelector("#authError");
const authSubmit = document.querySelector("#authSubmit");
const authSubtitle = document.querySelector("#authSubtitle");
const loginTab = document.querySelector("#loginTab");
const registerTab = document.querySelector("#registerTab");
const messages = document.querySelector("#messages");
const channelTitle = document.querySelector("#channelTitle");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const searchInput = document.querySelector("#search");
const myUsername = document.querySelector("#myUsername");
const myAvatar = document.querySelector("#myAvatar");
const memberList = document.querySelector("#memberList");
const onlineCount = document.querySelector("#onlineCount");
const logoutBtn = document.querySelector("#logoutBtn");

let authMode = "login";
let currentChannel = "general";
let currentProfile = null;
let stopMessages = null;
let stopPresence = null;
let auth = null;
let db = null;

const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_");

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(value);
}

function authEmail(username) {
  return `${username}@nexite.invalid`;
}

function avatarFor(username) {
  return (username?.[0] || "?").toUpperCase();
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  authSubmit.textContent = registering ? "create account" : "log in";
  authSubtitle.textContent = registering ? "make your nexite account." : "welcome back.";
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  authError.textContent = "";
}

function friendlyAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use": return "that username is already taken.";
    case "auth/invalid-credential": return "wrong username or password.";
    case "auth/weak-password": return "password needs at least 6 characters.";
    case "auth/too-many-requests": return "too many tries. wait a bit and try again.";
    case "auth/network-request-failed": return "network error. check your connection.";
    case "auth/operation-not-allowed": return "email/password auth still needs to be enabled in Firebase.";
    default: return error?.message || "something went wrong.";
  }
}

function messageHTML(message) {
  const username = message.username || "unknown";
  const text = message.text || "";
  const date = message.createdAt ? new Date(message.createdAt) : new Date();
  const time = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(date);
  const mine = auth?.currentUser?.uid === message.uid;

  return `
    <article class="message" data-text="${escapeHTML((username + " " + text).toLowerCase())}">
      <div class="avatar ${mine ? "me" : ""}">${escapeHTML(avatarFor(username))}</div>
      <div class="message-body">
        <div class="message-meta">
          <strong>${escapeHTML(username)}</strong>
          <time>${escapeHTML(time)}</time>
        </div>
        <p>${escapeHTML(text)}</p>
      </div>
    </article>
  `;
}

function renderChannelWelcome() {
  messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">#</div>
      <h1>Welcome to #${escapeHTML(currentChannel)}!</h1>
      <p>This is the start of the #${escapeHTML(currentChannel)} channel.</p>
    </div>
  `;
}

function watchMessages() {
  if (!db || !auth?.currentUser) return;
  if (stopMessages) stopMessages();
  renderChannelWelcome();

  const messageQuery = query(ref(db, `messages/${currentChannel}`), limitToLast(100));
  stopMessages = onChildAdded(messageQuery, snapshot => {
    const message = snapshot.val();
    if (!message || typeof message.text !== "string") return;
    messages.insertAdjacentHTML("beforeend", messageHTML(message));
    messages.scrollTop = messages.scrollHeight;
    applySearch();
  });
}

function switchChannel(name) {
  currentChannel = name;
  channelTitle.textContent = name;
  messageInput.placeholder = `Message #${name}`;

  document.querySelectorAll(".channel[data-channel]").forEach(button => {
    button.classList.toggle("active", button.dataset.channel === name);
  });

  searchInput.value = "";
  watchMessages();
  messageInput.focus();
}

function applySearch() {
  const term = searchInput.value.trim().toLowerCase();
  document.querySelectorAll(".message").forEach(message => {
    message.hidden = Boolean(term) && !message.dataset.text.includes(term);
  });
}

function renderPresence(data = {}) {
  const online = Object.entries(data)
    .filter(([, person]) => person?.state === "online" && person?.username)
    .sort((a, b) => a[1].username.localeCompare(b[1].username));

  onlineCount.textContent = `ONLINE — ${online.length}`;
  memberList.innerHTML = online.map(([uid, person]) => `
    <div class="member">
      <div class="avatar ${uid === auth?.currentUser?.uid ? "me" : ""}">${escapeHTML(avatarFor(person.username))}</div>
      <div><strong>${escapeHTML(person.username)}</strong><span>online</span></div>
    </div>
  `).join("");
}

async function startPresence(user, profile) {
  const connectedRef = ref(db, ".info/connected");
  const myPresenceRef = ref(db, `presence/${user.uid}`);

  stopPresence = onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true) return;

    await onDisconnect(myPresenceRef).set({
      username: profile.username,
      state: "offline",
      lastChanged: serverTimestamp()
    });

    await set(myPresenceRef, {
      username: profile.username,
      state: "online",
      lastChanged: serverTimestamp()
    });
  });
}

function watchMembers() {
  onValue(ref(db, "presence"), snapshot => renderPresence(snapshot.val() || {}));
}

async function loadProfile(user) {
  const snapshot = await get(ref(db, `users/${user.uid}`));
  if (!snapshot.exists()) throw new Error("account profile is missing.");
  return snapshot.val();
}

async function enterApp(user) {
  try {
    currentProfile = await loadProfile(user);
    myUsername.textContent = currentProfile.username;
    myAvatar.textContent = avatarFor(currentProfile.username);
    authScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    await startPresence(user, currentProfile);
    watchMembers();
    watchMessages();
  } catch (error) {
    authError.textContent = friendlyAuthError(error);
    await signOut(auth);
  }
}

async function leaveApp() {
  if (stopMessages) stopMessages();
  if (stopPresence) stopPresence();
  stopMessages = null;
  stopPresence = null;
  currentProfile = null;
  messages.innerHTML = "";
  memberList.innerHTML = "";
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

if (!configured) {
  authError.textContent = "Firebase isn't configured yet — add the project config in firebase-config.js.";
  authSubmit.disabled = true;
} else {
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  db = getDatabase(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);

  onAuthStateChanged(auth, async user => {
    if (user) await enterApp(user);
    else await leaveApp();
  });
}

authForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!configured || !auth || !db) return;

  const username = normalizeUsername(usernameInput.value);
  const password = passwordInput.value;

  if (!validUsername(username)) {
    authError.textContent = "username must be 3–20 characters: lowercase letters, numbers, or _.";
    return;
  }

  if (password.length < 6) {
    authError.textContent = "password needs at least 6 characters.";
    return;
  }

  authError.textContent = "";
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === "register" ? "creating..." : "logging in...";

  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, authEmail(username), password);
      await set(ref(db, `users/${credential.user.uid}`), {
        username,
        createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, authEmail(username), password);
    }
    passwordInput.value = "";
  } catch (error) {
    authError.textContent = friendlyAuthError(error);
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === "register" ? "create account" : "log in";
  }
});

document.querySelectorAll(".channel[data-channel]").forEach(button => {
  button.addEventListener("click", () => switchChannel(button.dataset.channel));
});

messageForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!db || !auth?.currentUser || !currentProfile) return;

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  try {
    await push(ref(db, `messages/${currentChannel}`), {
      uid: auth.currentUser.uid,
      username: currentProfile.username,
      text,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    messageInput.value = text;
  }
});

searchInput.addEventListener("input", applySearch);

logoutBtn.addEventListener("click", async () => {
  if (!auth) return;
  if (auth.currentUser && db && currentProfile) {
    await set(ref(db, `presence/${auth.currentUser.uid}`), {
      username: currentProfile.username,
      state: "offline",
      lastChanged: serverTimestamp()
    }).catch(() => {});
  }
  await signOut(auth);
});

document.querySelectorAll(".server").forEach(button => {
  button.addEventListener("click", () => {
    if (button.classList.contains("add")) return;
    document.querySelectorAll(".server").forEach(server => server.classList.remove("active"));
    button.classList.add("active");
  });
});
