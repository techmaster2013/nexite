import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, push, update, remove, query, limitToLast,
  onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const authScreen=$("#authScreen"), appShell=$("#app"), authForm=$("#authForm");
const usernameInput=$("#usernameInput"), passwordInput=$("#passwordInput"), authError=$("#authError");
const authSubmit=$("#authSubmit"), authSubtitle=$("#authSubtitle"), loginTab=$("#loginTab"), registerTab=$("#registerTab");
const sidebarContent=$("#sidebarContent"), serverRail=$("#serverRail"), sideTitle=$("#sideTitle"), sideSubtitle=$("#sideSubtitle");
const sideAction=$("#sideAction"), messages=$("#messages"), emptyState=$("#emptyState"), messageForm=$("#messageForm");
const messageInput=$("#messageInput"), imageInput=$("#imageInput"), attachmentPreview=$("#attachmentPreview");
const searchInput=$("#search"), chatTitle=$("#chatTitle"), chatSubtitle=$("#chatSubtitle"), chatGlyph=$("#chatGlyph");
const typingBar=$("#typingBar"), detailsContent=$("#detailsContent"), myAvatar=$("#myAvatar"), myDisplay=$("#myDisplay"), myUsername=$("#myUsername");
const modalBackdrop=$("#modalBackdrop"), modal=$("#modal"), emojiPicker=$("#emojiPicker"), reactionPicker=$("#reactionPicker"), toastEl=$("#toast");

let authMode="login", auth=null, db=null, profile=null;
let friends={}, requests={}, memberships={}, dms={}, presence={};
let active={type:null,id:null,channelId:null,title:"",subtitle:""};
let pendingImage=null, conversationStops=[], globalStops=[], typingTimer=null, lastTypingWrite=0;
const EMOJIS=["😀","😭","💀","😂","🥹","😎","🤨","😔","😈","🔥","💜","❤️","👍","👎","🙏","✨","🎉","🧊","👀","🤝","💯","😵","😡","🤯"];
const REACTIONS=["❤️","😭","💀","😂","🔥","👍","👎","🧊","👀","✨","💜","🙏"];
const configured=Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);

function esc(v=""){return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function norm(v){return v.trim().toLowerCase()}
function validUsername(v){return /^[a-z0-9_]{3,20}$/.test(v)}
function authEmail(username){return `${username}@nexite.invalid`}
function safeImage(v){return typeof v==="string" && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(v) ? v : ""}
function avatarHTML(user={},cls=""){
  const p=safeImage(user.pfp);
  const name=user.displayName||user.username||"?";
  return `<div class="avatar ${cls}">${p?`<img src="${p}" alt="">`:esc(name[0]?.toUpperCase()||"?")}</div>`;
}
function showToast(text){
  toastEl.textContent=text;toastEl.classList.remove("hidden");
  clearTimeout(showToast.t);showToast.t=setTimeout(()=>toastEl.classList.add("hidden"),2400);
}
function friendlyError(e){
  const map={
    "auth/email-already-in-use":"that username is already taken.",
    "auth/invalid-credential":"wrong username or password.",
    "auth/weak-password":"password needs at least 6 characters.",
    "auth/too-many-requests":"too many tries. wait a bit.",
    "auth/network-request-failed":"network error.",
    "auth/operation-not-allowed":"enable Email/Password auth in Firebase."
  };
  return map[e?.code]||e?.message||"something went wrong.";
}
function setAuthMode(mode){
  authMode=mode;const reg=mode==="register";
  loginTab.classList.toggle("active",!reg);registerTab.classList.toggle("active",reg);
  authSubmit.textContent=reg?"create account":"log in";
  authSubtitle.textContent=reg?"make your nexite account.":"welcome back.";
  passwordInput.autocomplete=reg?"new-password":"current-password";authError.textContent="";
}
function applyPrefs(){
  document.body.dataset.accent=localStorage.nexiteAccent||"violet";
  document.body.classList.toggle("compact",localStorage.nexiteCompact==="1");
  document.body.classList.toggle("reduce-motion",localStorage.nexiteReduce==="1");
}
applyPrefs();

function inlineMD(raw){
  let s=esc(raw);
  s=s.replace(/`([^`\n]+)`/g,"<code>$1</code>");
  s=s.replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>");
  s=s.replace(/__([^_\n]+)__/g,"<strong>$1</strong>");
  s=s.replace(/(^|[^\*])\*([^*\n]+)\*/g,"$1<em>$2</em>");
  s=s.replace(/~~([^~\n]+)~~/g,"<s>$1</s>");
  s=s.replace(/\|\|(.+?)\|\|/g,'<span class="spoiler" tabindex="0">$1</span>');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function markdown(raw=""){
  const chunks=String(raw).split("```");
  return chunks.map((chunk,i)=>{
    if(i%2) return `<pre><code>${esc(chunk.replace(/^\w+\n/,""))}</code></pre>`;
    return chunk.split("\n").map(line=>{
      if(/^>\s?/.test(line)) return `<blockquote>${inlineMD(line.replace(/^>\s?/,""))}</blockquote>`;
      return `<p>${inlineMD(line)||"<br>"}</p>`;
    }).join("");
  }).join("");
}
function reactionEntries(reactions={}){
  return Object.entries(reactions).map(([key,users])=>({
    key,emoji:decodeURIComponent(key),count:Object.keys(users||{}).length,mine:Boolean(users?.[auth?.currentUser?.uid])
  })).filter(x=>x.count);
}
function messageHTML(id,m){
  const mine=m.uid===auth?.currentUser?.uid;
  const rs=reactionEntries(m.reactions);
  return `<article class="message" data-message-id="${esc(id)}" data-search="${esc(((m.displayName||m.username||"")+" "+(m.text||"")).toLowerCase())}">
    ${avatarHTML(m,mine?"mine":"")}
    <div class="message-body">
      <div class="message-meta"><strong>${esc(m.displayName||m.username||"unknown")}</strong><time>${formatTime(m.createdAt)}</time></div>
      ${m.text?`<div class="message-content">${markdown(m.text)}</div>`:""}
      ${safeImage(m.image)?`<img class="message-image" src="${safeImage(m.image)}" alt="image from ${esc(m.username||"user")}">`:""}
      ${rs.length?`<div class="reactions">${rs.map(r=>`<button class="reaction ${r.mine?"mine":""}" data-react="${esc(r.key)}">${esc(r.emoji)} <span>${r.count}</span></button>`).join("")}</div>`:""}
    </div>
    <div class="message-tools"><button data-add-reaction title="react">☺</button></div>
  </article>`;
}
function formatTime(ts){
  if(!ts)return "now";
  try{return new Intl.DateTimeFormat([],{hour:"numeric",minute:"2-digit"}).format(new Date(ts))}catch{return "now"}
}
function stopConversation(){
  conversationStops.forEach(fn=>{try{fn()}catch{}});conversationStops=[];
  typingBar.textContent="";searchInput.value="";pendingImage=null;renderAttachment();
}
function listen(r,cb){const off=onValue(r,cb);return off}
function activePath(){
  if(active.type==="server") return `serverMessages/${active.id}/${active.channelId}`;
  if(active.type==="dm") return `dmMessages/${active.id}`;
  return null;
}
function typingPath(){
  if(active.type==="server") return `typing/server_${active.id}_${active.channelId}`;
  if(active.type==="dm") return `typing/dm_${active.id}`;
  return null;
}
function showConversationUI(show){
  emptyState.classList.toggle("hidden",show);
  messages.classList.toggle("hidden",!show);
  messageForm.classList.toggle("hidden",!show);
  if(!show){typingBar.textContent="";attachmentPreview.classList.add("hidden")}
}
function renderConversationStart(){
  const isDm=active.type==="dm";
  const dm=isDm?dms[active.id]:null;
  const other=dm?.other||{};
  const icon=isDm?avatarHTML(other,"big-avatar"):`<div class="avatar big-avatar">${esc(active.title?.[0]?.toUpperCase()||"✦")}</div>`;
  return `<div class="conversation-start">${icon}<h1>${esc(active.title)}</h1><p>${esc(active.subtitle||"this is the beginning.")}</p></div>`;
}
function watchConversation(){
  stopConversation();const path=activePath();if(!path)return;
  showConversationUI(true);messages.innerHTML=renderConversationStart();
  const q=query(ref(db,path),limitToLast(150));
  conversationStops.push(listen(q,snap=>{
    const data=snap.val()||{};
    const rows=Object.entries(data).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    messages.innerHTML=renderConversationStart()+rows.map(([id,m])=>messageHTML(id,m)).join("");
    applySearch();
    requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight);
  }));
  const tp=typingPath();
  conversationStops.push(listen(ref(db,tp),snap=>{
    const people=Object.entries(snap.val()||{}).filter(([uid,v])=>uid!==auth.currentUser.uid&&v?.username).map(([,v])=>v.displayName||v.username);
    typingBar.textContent=people.length?`${people.slice(0,2).join(", ")} ${people.length===1?"is":"are"} typing…`:"";
  }));
  onDisconnect(ref(db,`${tp}/${auth.currentUser.uid}`)).remove().catch(()=>{});
}
function applySearch(){
  const term=searchInput.value.trim().toLowerCase();
  $$(".message").forEach(el=>el.hidden=Boolean(term)&&!el.dataset.search.includes(term));
}

function setActiveOrbit(which){
  $$(".orbit-btn").forEach(b=>b.classList.remove("active"));
  if(which==="home")$("#homeBtn").classList.add("active");
  else if(which==="friends")$("#friendsBtn").classList.add("active");
  else document.querySelector(`.server-dot[data-server="${CSS.escape(which)}"]`)?.classList.add("active");
}
function renderHome(){
  stopConversation();active={type:null,id:null,channelId:null,title:"",subtitle:""};showConversationUI(false);setActiveOrbit("home");
  sideTitle.textContent="home";sideSubtitle.textContent="your nexite";sideAction.textContent="+";
  sideAction.onclick=openAddFriend;
  const dmRows=Object.entries(dms).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));
  sidebarContent.innerHTML=`
    <div class="side-section">
      <button class="side-item" id="homeFriends"><span class="side-icon">♡</span><span class="side-copy"><strong>friends</strong><small>${Object.keys(friends).length} connected</small></span>${Object.keys(requests).length?`<span class="badge">${Object.keys(requests).length}</span>`:""}</button>
    </div>
    <div class="side-section"><div class="side-label"><span>direct messages</span><button class="ghost-btn" id="newDmBtn">+</button></div>
      ${dmRows.length?dmRows.map(([id,d])=>`<button class="side-item" data-dm="${esc(id)}">${avatarHTML(d.other||{})}<span class="side-copy"><strong>${esc(d.other?.displayName||d.other?.username||"dm")}</strong><small>@${esc(d.other?.username||"")}</small></span></button>`).join(""):`<div class="detail-card"><p>no dms yet. add a friend and start yapping 😭</p></div>`}
    </div>`;
  $("#homeFriends")?.addEventListener("click",renderFriends);
  $("#newDmBtn")?.addEventListener("click",openNewDm);
  $$('[data-dm]').forEach(b=>b.onclick=()=>openDM(b.dataset.dm));
  chatTitle.textContent="nexite";chatSubtitle.textContent="pick a conversation";chatGlyph.textContent="✦";
  renderHomeDetails();
}
function renderFriends(){
  stopConversation();active={type:null,id:null,channelId:null,title:"",subtitle:""};showConversationUI(false);setActiveOrbit("friends");
  sideTitle.textContent="friends";sideSubtitle.textContent="people you chose";sideAction.textContent="+";
  sideAction.onclick=openAddFriend;
  const fr=Object.entries(friends);
  sidebarContent.innerHTML=`
    <div class="side-section"><div class="side-label"><span>friends</span><span>${fr.length}</span></div>
      ${fr.length?fr.map(([uid,f])=>`<button class="side-item" data-friend="${esc(uid)}">${avatarHTML(f)}<span class="side-copy"><strong>${esc(f.displayName||f.username)}</strong><small>${presence[uid]?.state==="online"?"online":"offline"} · @${esc(f.username)}</small></span></button>`).join(""):`<div class="detail-card"><p>no friends yet. tragic. fix that with the + button.</p></div>`}
    </div>
    ${Object.keys(requests).length?`<div class="side-section"><div class="side-label"><span>requests</span><span>${Object.keys(requests).length}</span></div>${Object.entries(requests).map(([uid,r])=>`<button class="side-item" data-request="${esc(uid)}">${avatarHTML(r)}<span class="side-copy"><strong>${esc(r.displayName||r.username)}</strong><small>wants to be friends</small></span><span class="badge">!</span></button>`).join("")}</div>`:""}`;
  $$('[data-friend]').forEach(b=>b.onclick=()=>openFriendCard(b.dataset.friend));
  $$('[data-request]').forEach(b=>b.onclick=()=>openRequest(b.dataset.request));
  chatTitle.textContent="friends";chatSubtitle.textContent="dms start here";chatGlyph.textContent="♡";
  detailsContent.innerHTML=`<div class="details-title">friends</div><div class="detail-card"><h3>keep it simple</h3><p>friend someone by username, then open a private dm.</p></div>`;
}
function renderServerRail(){
  serverRail.innerHTML=Object.entries(memberships).map(([id,s])=>`<button class="orbit-btn server-dot" data-server="${esc(id)}" title="${esc(s.name||"space")}">${safeImage(s.icon)?`<img src="${safeImage(s.icon)}" alt="">`:`<span class="server-fallback">${esc(s.iconEmoji||s.name?.[0]?.toUpperCase()||"S")}</span>`}</button>`).join("");
  $$(".server-dot").forEach(b=>b.onclick=()=>openServer(b.dataset.server));
}
async function openServer(serverId,channelId=null){
  const snap=await get(ref(db,`servers/${serverId}`));if(!snap.exists()){showToast("that space is gone.");return}
  const server=snap.val();const channels=server.channels||{};
  const first=channelId||Object.keys(channels)[0];
  setActiveOrbit(serverId);sideTitle.textContent=server.name||"space";sideSubtitle.textContent=server.owner===auth.currentUser.uid?"you own this space":"space";
  sideAction.textContent="⋯";sideAction.onclick=()=>openServerSettings(serverId,server);
  sidebarContent.innerHTML=`<div class="side-section"><div class="side-label"><span>channels</span>${server.owner===auth.currentUser.uid?`<button class="ghost-btn" id="addChannelBtn">+</button>`:""}</div>
    ${Object.entries(channels).map(([id,c])=>`<button class="side-item ${id===first?"active":""}" data-channel="${esc(id)}"><span class="side-icon">#</span><span class="side-copy"><strong>${esc(c.name)}</strong><small>text channel</small></span></button>`).join("")}
  </div>`;
  $("#addChannelBtn")?.addEventListener("click",()=>openAddChannel(serverId));
  $$('[data-channel]').forEach(b=>b.onclick=()=>openServer(serverId,b.dataset.channel));
  if(!first){stopConversation();showConversationUI(false);chatTitle.textContent=server.name;chatSubtitle.textContent="no channels yet";renderServerDetails(serverId,server);return}
  const channel=channels[first];
  active={type:"server",id:serverId,channelId:first,title:`#${channel.name}`,subtitle:`${server.name} · #${channel.name}`};
  chatTitle.textContent=channel.name;chatSubtitle.textContent=server.name;chatGlyph.textContent="#";
  messageInput.placeholder=`message #${channel.name}`;watchConversation();renderServerDetails(serverId,server);
}
function renderServerDetails(serverId,server){
  const members=server.members||{};
  detailsContent.innerHTML=`<div class="details-title">${esc(server.name||"space")}</div>
    <div class="detail-card"><h3>${Object.keys(members).length} member${Object.keys(members).length===1?"":"s"}</h3><p>${server.owner===auth.currentUser.uid?"you own this space. use ⋯ to add people or channels.":"a nexite space."}</p></div>
    <div class="details-title">members</div>
    ${Object.entries(members).map(([uid,m])=>`<div class="detail-person">${avatarHTML(m)}<div><strong>${esc(m.displayName||m.username)}</strong><span>${m.role==="owner"?"owner":presence[uid]?.state==="online"?"online":"offline"}</span></div>${presence[uid]?.state==="online"?'<i class="status-dot"></i>':""}</div>`).join("")}`;
}
function renderHomeDetails(){
  const online=Object.values(presence).filter(x=>x?.state==="online").length;
  detailsContent.innerHTML=`<div class="details-title">nexite</div><div class="detail-card"><h3>${online} online</h3><p>purple, realtime, and significantly less gray than discord 💀</p></div><div class="detail-card"><h3>formatting</h3><p>**bold** · *italic* · ~~strike~~ · \`code\` · ||spoiler|| · markdown links</p></div>`;
}
async function openDM(dmId){
  const d=dms[dmId];if(!d)return;
  setActiveOrbit("home");sideTitle.textContent="direct messages";sideSubtitle.textContent="private";
  renderHome();
  document.querySelector(`[data-dm="${CSS.escape(dmId)}"]`)?.classList.add("active");
  active={type:"dm",id:dmId,channelId:null,title:d.other?.displayName||d.other?.username||"dm",subtitle:`@${d.other?.username||""}`};
  chatTitle.textContent=active.title;chatSubtitle.textContent=active.subtitle;chatGlyph.textContent="↗";messageInput.placeholder=`message @${d.other?.username||""}`;
  watchConversation();
  detailsContent.innerHTML=`<div class="details-title">direct message</div><div class="detail-card">${avatarHTML(d.other)}<h3>${esc(d.other?.displayName||d.other?.username||"user")}</h3><p>@${esc(d.other?.username||"")}</p></div>`;
}

function openModal(title,sub,body){
  modal.innerHTML=`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(sub||"")}</p></div><button class="modal-close">×</button></div>${body}`;
  modalBackdrop.classList.remove("hidden");modal.querySelector(".modal-close").onclick=closeModal;
}
function closeModal(){modalBackdrop.classList.add("hidden");modal.innerHTML=""}
modalBackdrop.addEventListener("pointerdown",e=>{if(e.target===modalBackdrop)closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();emojiPicker.classList.add("hidden");reactionPicker.classList.add("hidden")}});

function openAddFriend(){
  openModal("add friend","username only. no phone-number nonsense.",`<form id="addFriendForm" class="form-grid"><label>username<input id="friendName" maxlength="20" placeholder="their username" required></label><div id="friendError" class="auth-error"></div><div class="form-actions"><button class="primary-btn">send request</button></div></form>`);
  $("#addFriendForm").onsubmit=async e=>{
    e.preventDefault();const name=norm($("#friendName").value),err=$("#friendError");
    if(name===profile.username){err.textContent="bro that's you 😭";return}
    try{
      const u=await get(ref(db,`usernames/${name}`));if(!u.exists())throw new Error("no nexite user with that username.");
      const uid=u.val();if(friends[uid])throw new Error("you're already friends.");
      await set(ref(db,`friendRequests/${uid}/${auth.currentUser.uid}`),{username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",createdAt:serverTimestamp()});
      closeModal();showToast("friend request sent.");
    }catch(x){err.textContent=x.message}
  };
}
function openRequest(uid){
  const r=requests[uid];if(!r)return;
  openModal("friend request",`@${r.username}`,`<div class="profile-preview">${avatarHTML(r)}<div><strong>${esc(r.displayName||r.username)}</strong><div class="muted">@${esc(r.username)}</div></div></div><div class="form-actions"><button id="declineFriend" class="soft-btn">decline</button><button id="acceptFriend" class="primary-btn">accept</button></div>`);
  $("#declineFriend").onclick=async()=>{await remove(ref(db,`friendRequests/${auth.currentUser.uid}/${uid}`));closeModal()};
  $("#acceptFriend").onclick=async()=>{
    const their=await get(ref(db,`users/${uid}`));if(!their.exists())return;
    const t=their.val(),now=Date.now();
    await set(ref(db,`friends/${auth.currentUser.uid}/${uid}`),{username:t.username,displayName:t.displayName||t.username,pfp:t.pfp||"",since:now});
    await set(ref(db,`friends/${uid}/${auth.currentUser.uid}`),{username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",since:now});
    await remove(ref(db,`friendRequests/${auth.currentUser.uid}/${uid}`));
    closeModal();showToast("friend added 💜");
  };
}
function openFriendCard(uid){
  const f=friends[uid];if(!f)return;
  openModal(f.displayName||f.username,`@${f.username}`,`<div class="profile-preview">${avatarHTML(f)}<div><strong>${esc(f.displayName||f.username)}</strong><div class="muted">${presence[uid]?.state==="online"?"online":"offline"}</div></div></div><div class="form-actions"><button id="removeFriend" class="danger-btn">remove</button><button id="dmFriend" class="primary-btn">message</button></div>`);
  $("#dmFriend").onclick=async()=>{closeModal();const id=await ensureDM(uid,f);openDM(id)};
  $("#removeFriend").onclick=async()=>{if(!confirm(`remove @${f.username}?`))return;await remove(ref(db,`friends/${uid}/${auth.currentUser.uid}`));await remove(ref(db,`friends/${auth.currentUser.uid}/${uid}`));closeModal()};
}
function openNewDm(){
  const rows=Object.entries(friends);
  openModal("new message","pick a friend.",rows.length?rows.map(([uid,f])=>`<button class="side-item modal-friend" data-newdm="${esc(uid)}">${avatarHTML(f)}<span class="side-copy"><strong>${esc(f.displayName||f.username)}</strong><small>@${esc(f.username)}</small></span></button>`).join(""):`<div class="detail-card"><p>add a friend first.</p></div>`);
  $$('[data-newdm]').forEach(b=>b.onclick=async()=>{const uid=b.dataset.newdm,id=await ensureDM(uid,friends[uid]);closeModal();openDM(id)});
}
async function ensureDM(otherUid,other){
  const pair=[auth.currentUser.uid,otherUid].sort().join("_");
  const dmId=pair;const existing=await get(ref(db,`dms/${dmId}`));
  if(!existing.exists()){
    await set(ref(db,`dms/${dmId}`),{createdAt:serverTimestamp(),members:{[auth.currentUser.uid]:true,[otherUid]:true}});
  }
  const now=Date.now(),up={};
  up[`userDms/${auth.currentUser.uid}/${dmId}`]={otherUid,username:other.username,displayName:other.displayName||other.username,pfp:other.pfp||"",updatedAt:now};
  up[`userDms/${otherUid}/${dmId}`]={otherUid:auth.currentUser.uid,username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",updatedAt:now};
  await update(ref(db),up);return dmId;
}

function openCreateServer(){
  openModal("create a space","servers, but nexite calls them spaces.",`<form id="serverForm" class="form-grid"><label>space name<input id="serverNameInput" maxlength="32" placeholder="the cool people" required></label><label>icon emoji<input id="serverEmojiInput" maxlength="4" placeholder="✨"></label><div class="form-actions"><button class="primary-btn">create space</button></div></form>`);
  $("#serverForm").onsubmit=async e=>{
    e.preventDefault();const name=$("#serverNameInput").value.trim(),iconEmoji=$("#serverEmojiInput").value.trim()||"✦";
    if(!name)return;const sid=push(ref(db,"servers")).key,cid=push(ref(db,`servers/${sid}/channels`)).key,now=Date.now();
    const member={username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",role:"owner",joinedAt:now};
    await set(ref(db,`servers/${sid}`),{name,iconEmoji,owner:auth.currentUser.uid,createdAt:serverTimestamp(),channels:{[cid]:{name:"general",createdAt:now}},members:{[auth.currentUser.uid]:member}});
    await set(ref(db,`serverMemberships/${auth.currentUser.uid}/${sid}`),{name,iconEmoji,role:"owner",joinedAt:now});
    closeModal();openServer(sid,cid);
  };
}
function openAddChannel(serverId){
  openModal("new channel","give the space somewhere else to yap.",`<form id="channelForm" class="form-grid"><label>channel name<input id="channelName" maxlength="24" placeholder="random" required></label><div class="form-actions"><button class="primary-btn">create</button></div></form>`);
  $("#channelForm").onsubmit=async e=>{e.preventDefault();const name=$("#channelName").value.trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9_-]/g,"");if(!name)return;const c=push(ref(db,`servers/${serverId}/channels`));await set(c,{name,createdAt:serverTimestamp()});closeModal();openServer(serverId,c.key)};
}
function openServerSettings(serverId,server){
  const owner=server.owner===auth.currentUser.uid;
  openModal(server.name||"space",owner?"space controls":"space info",`${owner?`<form id="inviteForm" class="form-grid"><label>add member by username<input id="inviteName" maxlength="20" placeholder="username"></label><div id="inviteError" class="auth-error"></div><button class="primary-btn">add to space</button></form><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">`:""}<div class="detail-card"><h3>${Object.keys(server.members||{}).length} members</h3><p>${Object.keys(server.channels||{}).length} channels</p></div>${owner?`<div class="form-actions"><button id="deleteServer" class="danger-btn">delete space</button></div>`:`<div class="form-actions"><button id="leaveServer" class="danger-btn">leave space</button></div>`}`);
  $("#inviteForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const name=norm($("#inviteName").value),err=$("#inviteError");
    try{const u=await get(ref(db,`usernames/${name}`));if(!u.exists())throw new Error("user not found.");const uid=u.val(),p=await get(ref(db,`users/${uid}`));if(!p.exists())throw new Error("profile missing.");const v=p.val(),now=Date.now(),up={};
      up[`servers/${serverId}/members/${uid}`]={username:v.username,displayName:v.displayName||v.username,pfp:v.pfp||"",role:"member",joinedAt:now};
      up[`serverMemberships/${uid}/${serverId}`]={name:server.name,iconEmoji:server.iconEmoji||"✦",role:"member",joinedAt:now};
      await update(ref(db),up);closeModal();showToast(`@${name} added.`);
    }catch(x){err.textContent=x.message}
  });
  $("#deleteServer")?.addEventListener("click",async()=>{if(!confirm(`delete ${server.name}? this deletes its messages too.`))return;const up={};Object.keys(server.members||{}).forEach(uid=>up[`serverMemberships/${uid}/${serverId}`]=null);up[`serverMessages/${serverId}`]=null;up[`servers/${serverId}`]=null;await update(ref(db),up);closeModal();renderHome()});
  $("#leaveServer")?.addEventListener("click",async()=>{if(!confirm(`leave ${server.name}?`))return;const up={};up[`servers/${serverId}/members/${auth.currentUser.uid}`]=null;up[`serverMemberships/${auth.currentUser.uid}/${serverId}`]=null;await update(ref(db),up);closeModal();renderHome()});
}
function openSettings(){
  openModal("settings","make nexite yours.",`<div class="profile-preview">${avatarHTML(profile)}<div><strong>${esc(profile.displayName||profile.username)}</strong><div class="muted">@${esc(profile.username)}</div></div></div>
  <form id="settingsForm" class="form-grid">
    <label>display name<input id="displayNameSetting" maxlength="32" value="${esc(profile.displayName||profile.username)}"></label>
    <label>bio<textarea id="bioSetting" maxlength="160" rows="3">${esc(profile.bio||"")}</textarea></label>
    <label>profile picture<input id="pfpSetting" type="file" accept="image/*"></label>
    <label>accent<select id="accentSetting"><option value="violet">violet</option><option value="pink">pink</option><option value="blue">blue</option></select></label>
    <label style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:8px;text-transform:none"><input id="compactSetting" type="checkbox" style="width:auto"> compact messages</label>
    <label style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:8px;text-transform:none"><input id="motionSetting" type="checkbox" style="width:auto"> reduce motion</label>
    <div class="form-actions"><button class="primary-btn">save</button></div>
  </form>`);
  $("#accentSetting").value=localStorage.nexiteAccent||"violet";$("#compactSetting").checked=localStorage.nexiteCompact==="1";$("#motionSetting").checked=localStorage.nexiteReduce==="1";
  $("#settingsForm").onsubmit=async e=>{
    e.preventDefault();const displayName=$("#displayNameSetting").value.trim()||profile.username,bio=$("#bioSetting").value.trim();let pfp=profile.pfp||"",file=$("#pfpSetting").files?.[0];
    try{if(file)pfp=await compressImage(file,256,160000);await update(ref(db,`users/${auth.currentUser.uid}`),{displayName,bio,pfp});
      profile={...profile,displayName,bio,pfp};localStorage.nexiteAccent=$("#accentSetting").value;localStorage.nexiteCompact=$("#compactSetting").checked?"1":"0";localStorage.nexiteReduce=$("#motionSetting").checked?"1":"0";applyPrefs();renderMe();closeModal();showToast("settings saved.");
    }catch(x){showToast(x.message)}
  };
}

function renderAttachment(){
  if(!pendingImage){attachmentPreview.classList.add("hidden");attachmentPreview.innerHTML="";return}
  attachmentPreview.innerHTML=`<img src="${pendingImage.data}" alt=""><span>${esc(pendingImage.name)}</span><button id="removeAttachment" class="ghost-btn">×</button>`;
  attachmentPreview.classList.remove("hidden");$("#removeAttachment").onclick=()=>{pendingImage=null;imageInput.value="";renderAttachment()};
}
async function compressImage(file,maxDim=1280,maxChars=620000){
  if(!file.type.startsWith("image/"))throw new Error("pick an image file.");
  if(file.size>12*1024*1024)throw new Error("image is too huge. keep it under 12 MB.");
  const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
  const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=data});
  let scale=Math.min(1,maxDim/Math.max(img.width,img.height)),quality=.82,out="";
  for(let n=0;n<5;n++){
    const c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);out=c.toDataURL("image/webp",quality);
    if(out.length<=maxChars)return out;scale*=.78;quality-=.1;
  }
  throw new Error("couldn't shrink that image enough.");
}
function placePicker(el,anchor){
  const r=anchor.getBoundingClientRect(),w=250,h=190;
  el.style.left=`${Math.max(8,Math.min(innerWidth-w-8,r.left))}px`;
  el.style.top=`${Math.max(8,Math.min(innerHeight-h-8,r.top-h-6))}px`;
}
function openEmojiPicker(){
  emojiPicker.innerHTML=EMOJIS.map(e=>`<button>${e}</button>`).join("");placePicker(emojiPicker,$("#emojiBtn"));emojiPicker.classList.toggle("hidden");
  $$("#emojiPicker button").forEach(b=>b.onclick=()=>{const start=messageInput.selectionStart,end=messageInput.selectionEnd;messageInput.setRangeText(b.textContent,start,end,"end");messageInput.focus();emojiPicker.classList.add("hidden")});
}
function openReactionPicker(messageId,anchor){
  reactionPicker.dataset.messageId=messageId;reactionPicker.innerHTML=REACTIONS.map(e=>`<button>${e}</button>`).join("");placePicker(reactionPicker,anchor);reactionPicker.classList.remove("hidden");
  $$("#reactionPicker button").forEach(b=>b.onclick=()=>{toggleReaction(messageId,b.textContent);reactionPicker.classList.add("hidden")});
}
async function toggleReaction(messageId,emoji){
  const path=activePath();if(!path)return;const key=encodeURIComponent(emoji),r=ref(db,`${path}/${messageId}/reactions/${key}/${auth.currentUser.uid}`),s=await get(r);if(s.exists())await remove(r);else await set(r,true);
}

async function writeTyping(){
  const p=typingPath();if(!p||!profile)return;const now=Date.now();
  if(now-lastTypingWrite>900){lastTypingWrite=now;await set(ref(db,`${p}/${auth.currentUser.uid}`),{username:profile.username,displayName:profile.displayName||profile.username,at:serverTimestamp()}).catch(()=>{})}
  clearTimeout(typingTimer);typingTimer=setTimeout(()=>remove(ref(db,`${p}/${auth.currentUser.uid}`)).catch(()=>{}),1800);
}
function renderMe(){
  myDisplay.textContent=profile.displayName||profile.username;myUsername.textContent=`@${profile.username}`;
  myAvatar.innerHTML=safeImage(profile.pfp)?`<img src="${safeImage(profile.pfp)}" alt="">`:esc((profile.displayName||profile.username)[0].toUpperCase());
}
async function loadProfile(user){
  const s=await get(ref(db,`users/${user.uid}`));if(!s.exists())throw new Error("account profile is missing.");return s.val();
}
function startGlobalWatchers(){
  globalStops.forEach(fn=>{try{fn()}catch{}});globalStops=[];
  const uid=auth.currentUser.uid;
  globalStops.push(listen(ref(db,`friends/${uid}`),s=>{friends=s.val()||{};if($("#friendsBtn")?.classList.contains("active"))renderFriends();else if($("#homeBtn")?.classList.contains("active")&&!active.type)renderHome()}));
  globalStops.push(listen(ref(db,`friendRequests/${uid}`),s=>{requests=s.val()||{};if($("#friendsBtn")?.classList.contains("active"))renderFriends();else if($("#homeBtn")?.classList.contains("active")&&!active.type)renderHome()}));
  globalStops.push(listen(ref(db,`serverMemberships/${uid}`),s=>{memberships=s.val()||{};renderServerRail()}));
  globalStops.push(listen(ref(db,`userDms/${uid}`),s=>{
    const raw=s.val()||{};dms={};Object.entries(raw).forEach(([id,v])=>dms[id]={...v,other:{uid:v.otherUid,username:v.username,displayName:v.displayName,pfp:v.pfp}});
    if($("#homeBtn")?.classList.contains("active")&&!active.type)renderHome();
  }));
  globalStops.push(listen(ref(db,"presence"),s=>{presence=s.val()||{};if($("#friendsBtn")?.classList.contains("active"))renderFriends();if(active.type==="server")get(ref(db,`servers/${active.id}`)).then(x=>x.exists()&&renderServerDetails(active.id,x.val()))}));
}
async function startPresence(user){
  const p=ref(db,`presence/${user.uid}`),connected=ref(db,".info/connected");
  globalStops.push(listen(connected,async s=>{
    if(s.val()!==true)return;
    await onDisconnect(p).set({username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",state:"offline",lastChanged:serverTimestamp()});
    await set(p,{username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",state:"online",lastChanged:serverTimestamp()});
  }));
}
async function enterApp(user){
  try{
    profile=await loadProfile(user);
    await set(ref(db,`usernames/${profile.username}`),user.uid);
    if(!profile.displayName){await update(ref(db,`users/${user.uid}`),{displayName:profile.username,bio:"",pfp:""});profile.displayName=profile.username;profile.bio="";profile.pfp=""}
    renderMe();authScreen.classList.add("hidden");appShell.classList.remove("hidden");
    await startPresence(user);startGlobalWatchers();renderHome();
  }catch(e){authError.textContent=friendlyError(e);await signOut(auth)}
}
async function leaveApp(){
  stopConversation();globalStops.forEach(fn=>{try{fn()}catch{}});globalStops=[];profile=null;friends={};requests={};memberships={};dms={};presence={};
  appShell.classList.add("hidden");authScreen.classList.remove("hidden");
}

loginTab.onclick=()=>setAuthMode("login");registerTab.onclick=()=>setAuthMode("register");
if(!configured){authError.textContent="Firebase isn't configured.";authSubmit.disabled=true}else{
  const firebaseApp=initializeApp(firebaseConfig);auth=getAuth(firebaseApp);db=getDatabase(firebaseApp);await setPersistence(auth,browserLocalPersistence);
  onAuthStateChanged(auth,user=>user?enterApp(user):leaveApp());
}
authForm.onsubmit=async e=>{
  e.preventDefault();if(!auth||!db)return;const username=norm(usernameInput.value),password=passwordInput.value;
  if(!validUsername(username)){authError.textContent="3–20 chars: lowercase letters, numbers, or _.";return}
  if(password.length<6){authError.textContent="password needs at least 6 characters.";return}
  authError.textContent="";authSubmit.disabled=true;authSubmit.textContent=authMode==="register"?"creating...":"logging in...";
  try{
    if(authMode==="register"){
      const c=await createUserWithEmailAndPassword(auth,authEmail(username),password);
      await set(ref(db,`users/${c.user.uid}`),{username,displayName:username,bio:"",pfp:"",createdAt:serverTimestamp()});
      await set(ref(db,`usernames/${username}`),c.user.uid);
    }else await signInWithEmailAndPassword(auth,authEmail(username),password);
    passwordInput.value="";
  }catch(x){authError.textContent=friendlyError(x)}
  finally{authSubmit.disabled=false;authSubmit.textContent=authMode==="register"?"create account":"log in"}
};

messageForm.onsubmit=async e=>{
  e.preventDefault();const path=activePath();if(!path||!profile)return;const text=messageInput.value.trim();if(!text&&!pendingImage)return;
  const payload={uid:auth.currentUser.uid,username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",text,createdAt:serverTimestamp()};
  if(pendingImage)payload.image=pendingImage.data;
  messageInput.value="";messageInput.style.height="auto";pendingImage=null;imageInput.value="";renderAttachment();
  try{await push(ref(db,path),payload);const tp=typingPath();if(tp)remove(ref(db,`${tp}/${auth.currentUser.uid}`)).catch(()=>{})}
  catch(x){showToast("message failed: "+x.message)}
};
messageInput.addEventListener("input",()=>{messageInput.style.height="auto";messageInput.style.height=Math.min(messageInput.scrollHeight,140)+"px";writeTyping()});
messageInput.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();messageForm.requestSubmit()}});
searchInput.oninput=applySearch;
$("#attachBtn").onclick=()=>imageInput.click();
imageInput.onchange=async()=>{const f=imageInput.files?.[0];if(!f)return;attachmentPreview.classList.remove("hidden");attachmentPreview.textContent="compressing image…";try{pendingImage={name:f.name,data:await compressImage(f)};renderAttachment()}catch(x){pendingImage=null;renderAttachment();showToast(x.message)}};
$("#emojiBtn").onclick=openEmojiPicker;
messages.addEventListener("click",e=>{
  const spoiler=e.target.closest(".spoiler");if(spoiler){spoiler.classList.toggle("revealed");return}
  const img=e.target.closest(".message-image");if(img){openModal("image","",`<img src="${img.src}" alt="" style="width:100%;max-height:70vh;object-fit:contain;border-radius:14px">`);return}
  const msg=e.target.closest(".message");if(!msg)return;
  const add=e.target.closest("[data-add-reaction]");if(add){openReactionPicker(msg.dataset.messageId,add);return}
  const reaction=e.target.closest("[data-react]");if(reaction)toggleReaction(msg.dataset.messageId,decodeURIComponent(reaction.dataset.react));
});
$("#homeBtn").onclick=renderHome;$("#friendsBtn").onclick=renderFriends;$("#createServerBtn").onclick=openCreateServer;$("#emptyServerBtn").onclick=openCreateServer;
$("#emptyFriendBtn").onclick=openAddFriend;$("#settingsBtn").onclick=openSettings;myAvatar.onclick=openSettings;
$("#chatInfoBtn").onclick=()=>$("#details").classList.toggle("hidden");
$("#logoutBtn").onclick=async()=>{
  if(auth?.currentUser&&profile){await set(ref(db,`presence/${auth.currentUser.uid}`),{username:profile.username,displayName:profile.displayName||profile.username,pfp:profile.pfp||"",state:"offline",lastChanged:serverTimestamp()}).catch(()=>{})}
  await signOut(auth);
};
document.addEventListener("pointerdown",e=>{
  if(!emojiPicker.contains(e.target)&&e.target!==$("#emojiBtn"))emojiPicker.classList.add("hidden");
  if(!reactionPicker.contains(e.target)&&!e.target.closest("[data-add-reaction]"))reactionPicker.classList.add("hidden");
});
