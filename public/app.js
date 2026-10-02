/* Zero Stars — front end (talks to the Express + SQLite API) */

const CATEGORIES = ["Trades & Construction","Retail","Warranty & Insurance","Customer Service","Professional Services","Other"];
let DISPUTE_REASONS = ["Factually inaccurate","Already resolved","Not a genuine customer","Abusive or defamatory","Duplicate or spam","Other"];
let account = null;
const filters = { q:"", cat:"all", status:"all", sort:"recent" };
let currentView = { name:"home" };

/* ---------- API helper ---------- */
async function api(path, opts={}) {
  const res = await fetch(path, {
    headers: { "Content-Type":"application/json" },
    credentials: "same-origin",
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch(e){}
  if (!res.ok) throw new Error((data && data.error) || "Something went wrong.");
  return data;
}

/* ---------- stars / severity ---------- */
function starSVG(filled,size){
  const s=size||14, col=filled?"var(--accent)":"none", stroke=filled?"var(--accent)":"var(--line-strong)";
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${col}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8-5.1-4.7 6.9-.8z"/></svg>`;
}
function starRow(sev,size){ let h=""; for(let i=1;i<=5;i++) h+=starSVG(i<=sev,size); return h; }

/* ---------- helpers ---------- */
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function escAttr(s){ return esc(s); }
function fmtDate(iso){ try{const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});}catch(e){return iso;} }
function statusLabel(s){ return s==="responded"?"Business responded":s==="ignored"?"Ignored / stonewalled":"Unresolved"; }

/* ---------- router ---------- */
function go(name,arg){ currentView={name,arg}; window.scrollTo({top:0}); render(); }

async function render(){
  renderChrome();
  const app=document.getElementById("app");
  if(currentView.name==="business"){
    app.innerHTML=`<div class="loading">Opening the dossier…</div>`;
    try{
      const data=await api("/api/businesses/"+encodeURIComponent(currentView.arg));
      app.innerHTML=viewBusiness(data);
    }catch(e){
      app.innerHTML=`<main><div class="wrap"><div class="empty"><div class="big">Can't find that one — lucky them.</div><div>${esc(e.message)}</div><button class="btn ghost sm" style="margin-top:16px" onclick="go('home')">← Back to the register</button></div></div></main>`;
    }
  } else if(currentView.name==="moderation"){
    app.innerHTML=`<div class="loading">Loading the moderation queue…</div>`;
    await renderModeration(currentView.arg||"open");
  } else {
    app.innerHTML=await viewHome();
    wireHome();
  }
}

/* ---------- home ---------- */
async function viewHome(){
  let meta={total:0,unresolved:0,avgSeverity:0,businesses:0};
  try{ meta=await api("/api/meta"); if(Array.isArray(meta.disputeReasons)) DISPUTE_REASONS=meta.disputeReasons; }catch(e){}
  return `
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <p class="eyebrow">For the unheard, the unheeded and the unbelievably pissed off</p>
        <h1 class="title">When one star is <em>one too many.</em></h1>
        <p class="lede">A free, public register for people who weren't heard. Search what a business is accused of before you hand over a deposit — and put your own unresolved complaint on the record.</p>
      </div>
      <div class="hero-stats">
        <div class="hstat"><span class="n neg mono">&minus;${(meta.avgSeverity||0).toFixed(1)}</span><span class="l">Register-wide average</span></div>
        <div class="hstat"><span class="n">${meta.total}</span><span class="l">Logged complaints</span></div>
        <div class="hstat"><span class="n" style="color:var(--amber)">${meta.unresolved}</span><span class="l">Still unresolved</span></div>
      </div>
    </div>
  </section>

  <section class="manifesto">
    <div class="wrap">
      <p class="manifesto-kicker">Why we're here</p>
      <h2 class="manifesto-line">We heard you. <em>Now Australia will too.</em></h2>
      <p class="manifesto-body">Getting stonewalled by a company is its own kind of insult — the unanswered email, the hold music, the complaint that quietly disappears. One voice is easy to ignore. A public register of them isn't.</p>
      <p class="manifesto-punch">Alone, you're a ticket they can close. <em>Together, you're a story they can't.</em></p>
    </div>
  </section>

  <section class="register">
    <div class="wrap reg-inner">
      <div class="searchbox">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="q" type="search" placeholder="Search a business, trade, or town…" value="${escAttr(filters.q)}" autocomplete="off">
      </div>
      <select class="filter" id="cat">
        <option value="all">All categories</option>
        ${CATEGORIES.map(c=>`<option value="${c}" ${filters.cat===c?"selected":""}>${c}</option>`).join("")}
      </select>
      <select class="filter" id="status">
        <option value="all">Any status</option>
        <option value="unresolved" ${filters.status==="unresolved"?"selected":""}>Unresolved</option>
        <option value="ignored" ${filters.status==="ignored"?"selected":""}>Ignored / stonewalled</option>
        <option value="responded" ${filters.status==="responded"?"selected":""}>Business responded</option>
      </select>
      <select class="filter" id="sort">
        <option value="recent" ${filters.sort==="recent"?"selected":""}>Most recent</option>
        <option value="backed" ${filters.sort==="backed"?"selected":""}>Most backed</option>
        <option value="severe" ${filters.sort==="severe"?"selected":""}>Most severe</option>
        <option value="business" ${filters.sort==="business"?"selected":""}>By business</option>
      </select>
      <span class="result-count" id="rcount"></span>
    </div>
  </section>

  <main><div class="wrap"><div class="feed" id="feed"><div class="loading">Loading complaints…</div></div></div></main>`;
}

function caseCard(c,opts={}){
  const unheard = c.status!=="responded";
  return `
  <article class="case">
    <div class="case-top">
      <div class="case-main">
        <div class="case-meta">
          <span class="caseid">${c.id}</span>
          <button class="biz-link" onclick="go('business','${c.biz}')">${esc(c.bizName)}</button>
        </div>
        <div class="biz-sub">${esc(c.cat)} · ${esc(c.loc)}</div>
        <h3 class="headline">${esc(c.title)}</h3>
        <p class="body-excerpt">${esc(c.body)}</p>
      </div>
      <div class="case-side">
        <div class="sev">
          <span class="sev-stars">${starRow(c.sev,15)}</span>
          <span class="sev-num">&minus;${c.sev}</span>
          <span class="sev-label">severity</span>
        </div>
        ${unheard?'<span class="stamp">Unheard</span>':""}
      </div>
    </div>
    <div class="chips">
      <span class="chip cat">${esc(c.cat)}</span>
      <span class="status ${c.status}">${statusLabel(c.status)}</span>
      ${c.modState==="disputed" ? `<span class="status disputed" title="${escAttr(c.disputeReason||"Disputed")}">⚖ Disputed — under review</span>` : ""}
    </div>
    ${c.reply?replyBlock(c.reply):""}
    ${cardActions(c,opts)}
    <div class="case-foot">
      <span>Filed ${fmtDate(c.date)}</span><span class="dot"></span>
      <span>${esc(c.author||"Registered submitter")}</span>
      ${c.reply?'<span class="reply-flag">✓ Right of reply used</span>':'<span class="reply-flag" style="color:var(--amber)">Awaiting business response</span>'}
    </div>
    <div class="engage">
      <button class="vote ${c.votedByMe?"on":""}" onclick="toggleVote('${c.id}',this)" aria-pressed="${c.votedByMe?"true":"false"}" title="Back this complaint — you've been done the same">
        ${thumbDownSVG()}<span class="vote-n">${c.downvotes||0}</span><span class="vote-lbl">backing this</span>
      </button>
      <button class="cbtn" onclick="toggleComments('${c.id}',this)">
        ${commentSVG()}<span class="c-n" data-cn="${c.id}">${c.commentCount||0}</span> <span class="cbtn-lbl">${(c.commentCount||0)===1?"comment":"comments"}</span>
      </button>
    </div>
    <div class="comments" id="comments-${c.id}" hidden></div>
  </article>`;
}
function thumbDownSVG(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M17 2h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"/><path d="M17 13V2H7.3a2 2 0 0 0-2 1.7l-1.1 7A2 2 0 0 0 6.2 13H11l-1 4.5A2.3 2.3 0 0 0 12.2 20L17 13z"/></svg>`;}
function commentSVG(){return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20l1.3-3.9A8.4 8.4 0 0 1 3.5 11 8.5 8.5 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>`;}
function replyBlock(r){
  return `<div class="reply"><div class="reply-head">↩ Response from ${esc(r.by)} · ${fmtDate(r.date)}</div><p class="reply-body">${esc(r.text)}</p></div>`;
}
function cardActions(c,opts={}){
  const buttons=[];
  if(opts.showRespond && !c.reply && c.modState!=="removed")
    buttons.push(`<button class="act respond" onclick="openReply('${c.id}')">↩ Respond as the business</button>`);
  if(account && c.modState==="published")
    buttons.push(`<button class="act dispute" onclick="openDispute('${c.id}')">⚖ Dispute this complaint</button>`);
  if(c.modState==="disputed")
    buttons.push(`<span class="act muted">⚖ Under review — a moderator will decide</span>`);
  if(!buttons.length) return "";
  return `<div class="card-actions">${buttons.join("")}</div>`;
}

/* ---------- social: downvotes + comments ---------- */
async function toggleVote(publicId, btn){
  if(!account){ openAuth(); return; }
  btn.disabled=true;
  try{
    const r=await api("/api/complaints/"+encodeURIComponent(publicId)+"/vote",{method:"POST"});
    btn.classList.toggle("on", r.voted);
    btn.setAttribute("aria-pressed", r.voted?"true":"false");
    const n=btn.querySelector(".vote-n"); if(n) n.textContent=r.downvotes;
    if(r.voted) toast("You're backing this. "+r.downvotes+" and counting.");
  }catch(e){ toast(e.message); }
  finally{ btn.disabled=false; }
}

async function toggleComments(publicId, btn){
  const panel=document.getElementById("comments-"+publicId);
  if(!panel) return;
  if(!panel.hidden){ panel.hidden=true; btn.classList.remove("active"); return; }
  panel.hidden=false; btn.classList.add("active");
  panel.innerHTML=`<div class="c-loading">Loading comments…</div>`;
  await loadComments(publicId);
}

async function loadComments(publicId){
  const panel=document.getElementById("comments-"+publicId);
  if(!panel) return;
  let data;
  try{ data=await api("/api/complaints/"+encodeURIComponent(publicId)+"/comments"); }
  catch(e){ panel.innerHTML=`<div class="c-loading">Couldn't load comments: ${esc(e.message)}</div>`; return; }
  const composer = account
    ? `<div class="c-compose">
         <textarea id="cbox-${publicId}" placeholder="Add your voice — have you been done the same?"></textarea>
         <div class="c-compose-row"><span class="signed-as">${esc(account.email)}</span><button class="btn accent sm" onclick="postComment('${publicId}')">Comment</button></div>
       </div>`
    : `<div class="c-signin">${commentSVG()} <button class="link-btn" onclick="openAuth()">Sign in</button> to join the conversation.</div>`;
  const list = data.comments.length
    ? data.comments.map(c=>commentNode(c, publicId)).join("")
    : `<div class="c-empty">No comments yet. Be the first to back them up.</div>`;
  const cn=document.querySelector(`[data-cn="${publicId}"]`); if(cn) cn.textContent=data.count;
  panel.innerHTML = composer + `<div class="c-list">${list}</div>`;
}

function commentNode(c, publicId){
  const replies=(c.replies||[]).map(r=>`
    <div class="c-item c-reply">
      <div class="c-head"><span class="c-author">${esc(r.author)}</span><span class="c-date">${fmtDate(r.date)}</span></div>
      <p class="c-body">${esc(r.body)}</p>
    </div>`).join("");
  return `
    <div class="c-item">
      <div class="c-head"><span class="c-author">${esc(c.author)}</span><span class="c-date">${fmtDate(c.date)}</span></div>
      <p class="c-body">${esc(c.body)}</p>
      <div class="c-actions"><button class="c-replybtn" onclick="openReplyBox('${publicId}',${c.id},this)">Reply</button></div>
      <div class="c-replies">${replies}</div>
    </div>`;
}

function openReplyBox(publicId, parentId, btn){
  if(!account){ openAuth(); return; }
  const item=btn.closest(".c-item");
  if(item.querySelector(".c-replybox")) { item.querySelector(".c-replybox textarea").focus(); return; }
  const box=document.createElement("div");
  box.className="c-replybox";
  box.innerHTML=`<textarea placeholder="Write a reply…"></textarea>
    <div class="c-compose-row"><button class="btn ghost sm" onclick="this.closest('.c-replybox').remove()">Cancel</button>
    <button class="btn accent sm" onclick="postComment('${publicId}',${parentId},this)">Reply</button></div>`;
  btn.closest(".c-actions").after(box);
  box.querySelector("textarea").focus();
}

async function postComment(publicId, parentId, btn){
  let textarea;
  if(parentId && btn){ textarea=btn.closest(".c-replybox").querySelector("textarea"); }
  else { textarea=document.getElementById("cbox-"+publicId); }
  const body=(textarea?.value||"").trim();
  if(body.length<2){ toast("Say something first."); return; }
  try{
    await api("/api/complaints/"+encodeURIComponent(publicId)+"/comments",{method:"POST",body:{body,parentId:parentId||null}});
    await loadComments(publicId);
    toast("Posted.");
  }catch(e){ toast(e.message); }
}

async function refreshFeed(){
  const feed=document.getElementById("feed"); const rc=document.getElementById("rcount");
  if(!feed) return;
  const qs=new URLSearchParams({q:filters.q,cat:filters.cat,status:filters.status,sort:filters.sort});
  try{
    const {complaints}=await api("/api/complaints?"+qs.toString());
    if(rc) rc.textContent=`${complaints.length} complaint${complaints.length===1?"":"s"}`;
    if(!complaints.length){ feed.innerHTML=`<div class="empty"><div class="big">Nothing here. Suspiciously quiet.</div><div>Either nobody's filed that yet, or your filters are too tight. Loosen them and look again.</div></div>`; return; }
    feed.innerHTML=complaints.map(c=>caseCard(c)).join("");
  }catch(e){ feed.innerHTML=`<div class="empty"><div class="big">Couldn't reach the register.</div><div>${esc(e.message)}</div></div>`; }
}

let searchT;
function wireHome(){
  const q=document.getElementById("q");
  if(q) q.oninput=e=>{ filters.q=e.target.value; clearTimeout(searchT); searchT=setTimeout(refreshFeed,180); };
  const cat=document.getElementById("cat"); if(cat) cat.onchange=e=>{filters.cat=e.target.value; refreshFeed();};
  const st=document.getElementById("status"); if(st) st.onchange=e=>{filters.status=e.target.value; refreshFeed();};
  const so=document.getElementById("sort"); if(so) so.onchange=e=>{filters.sort=e.target.value; refreshFeed();};
  refreshFeed();
}

/* ---------- business dossier ---------- */
function viewBusiness(data){
  const b=data.business, list=data.complaints, s=data.stats;
  return `<main><div class="wrap">
    <button class="backlink" onclick="go('home')">← The register</button>
    <div class="dossier">
      <div class="dossier-top">
        <div style="flex:1;min-width:240px">
          <h2>${esc(b.name)}</h2>
          <div class="biz-meta"><span>${esc(b.kind||"Business")}</span><span>·</span><span>${esc(b.cat)}</span><span>·</span><span>${esc(b.loc)}</span></div>
          <p style="color:var(--ink-soft);margin:16px 0 0;max-width:56ch">Public complaints register for ${esc(b.name)}. This page aggregates every unresolved complaint filed against this business. There is no positive-review side — a low or empty count means fewer people have reported being let down here.</p>
        </div>
        <div class="dossier-score">
          <div class="big">&minus;${(s.avgSeverity||0).toFixed(1)}</div>
          <div class="stars">${starRow(Math.round(s.avgSeverity||0),15)}</div>
          <div class="lbl">Average severity</div>
        </div>
      </div>
      <div class="dossier-stats">
        <div class="dstat"><div class="n">${s.total}</div><div class="l">Complaints</div></div>
        <div class="dstat"><div class="n bad">${s.unresolved}</div><div class="l">Unresolved</div></div>
        <div class="dstat"><div class="n warn">${s.ignored}</div><div class="l">Ignored</div></div>
        <div class="dstat"><div class="n good">${s.responded}</div><div class="l">Responses given</div></div>
      </div>
    </div>
    <div class="section-rule"><h3>Complaints on record</h3><span class="line"></span></div>
    <div class="feed">${list.map(c=>caseCard(c,{showRespond:true})).join("")}</div>
    <div style="margin-top:26px;text-align:center">
      <button class="btn accent" onclick="startComplaint('${b.slug}','${escAttr(b.name)}','${escAttr(b.cat)}')">Been let down by ${esc(b.name)} too? Add yours</button>
    </div>
  </div></main>`;
}

/* ---------- chrome: account + theme ---------- */
function renderChrome(){
  document.getElementById("markStars").innerHTML=starSVG(true,15)+starSVG(true,15);
  const slot=document.getElementById("acctSlot");
  if(account){
    const initial=(account.email||"?").trim()[0].toUpperCase();
    const modBtn = account.isModerator
      ? `<button class="btn ghost sm" onclick="go('moderation')" title="Moderation queue">⚖ Moderation<span id="modBadge" class="mod-badge" hidden></span></button>`
      : "";
    slot.innerHTML = modBtn + `<div class="acct"><span class="av">${initial}</span><span>${esc(account.email)}</span><button class="close-x" title="Sign out" style="font-size:16px" onclick="signOut()">⏻</button></div>`;
    if(account.isModerator) refreshModBadge();
  } else {
    slot.innerHTML=`<button class="btn ghost sm" onclick="openAuth()">Sign in</button>`;
  }
  document.getElementById("themeBtn").innerHTML = isDark()?sunIcon():moonIcon();
}
async function refreshModBadge(){
  try{
    const {counts}=await api("/api/moderation/queue");
    const el=document.getElementById("modBadge");
    if(el){ if(counts.open>0){ el.textContent=counts.open; el.hidden=false; } else { el.hidden=true; } }
  }catch(e){}
}

/* ---------- modal plumbing ---------- */
function openModal(html){ document.getElementById("modalMount").innerHTML=html; document.getElementById("overlay").classList.add("open"); }
function closeModal(){ document.getElementById("overlay").classList.remove("open"); document.getElementById("modalMount").innerHTML=""; }
document.getElementById("overlay").addEventListener("click",e=>{ if(e.target.id==="overlay") closeModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });
function showErr(id,msg){ const el=document.getElementById(id); if(el){ el.textContent=msg; el.classList.add("show"); } }
function hideErr(id){ const el=document.getElementById(id); if(el) el.classList.remove("show"); }

/* ---------- auth (real: email + password, login/register) ---------- */
let authMode="register";
function openAuth(after){
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3 id="authTitle">Create your free account</h3><p>Reading the register is always free and needs no account. A quick sign-in is required only to <em>file</em> a complaint — so you can track the business's response.</p></div>
        <button class="close-x" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="auth-tabs" role="tablist">
          <button role="tab" aria-selected="true" data-mode="register" onclick="setAuthMode('register')">Register</button>
          <button role="tab" aria-selected="false" data-mode="login" onclick="setAuthMode('login')">Sign in</button>
        </div>
        <div class="form-err" id="authErr"></div>
        <div class="field">
          <label for="authEmail">Email address</label>
          <input id="authEmail" type="email" placeholder="you@example.com" value="${account?escAttr(account.email):""}" autocomplete="email">
        </div>
        <div class="field">
          <label for="authPass">Password <span class="hint">— at least 6 characters, stored hashed (scrypt)</span></label>
          <input id="authPass" type="password" placeholder="••••••••" autocomplete="current-password">
        </div>
        <div class="form-note">Requiring a free account (rather than anonymous posting) is a deliberate choice: it cuts spam, lets submitters track replies, and keeps a light record trail that lowers false-complaint risk. This is a local prototype — the database lives on this machine only.</div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="authSubmit" onclick="doAuth('${after||""}')">Create account</button>
      </div>
    </div>`);
  authMode="register"; setAuthMode("register");
  setTimeout(()=>{const el=document.getElementById("authEmail"); if(el) el.focus();},60);
}
function setAuthMode(mode){
  authMode=mode; hideErr("authErr");
  document.querySelectorAll(".auth-tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.mode===mode?"true":"false"));
  document.getElementById("authTitle").textContent = mode==="register"?"Create your free account":"Welcome back";
  document.getElementById("authSubmit").textContent = mode==="register"?"Create account":"Sign in";
  const pass=document.getElementById("authPass"); if(pass) pass.setAttribute("autocomplete", mode==="register"?"new-password":"current-password");
}
async function doAuth(after){
  hideErr("authErr");
  const email=(document.getElementById("authEmail").value||"").trim();
  const password=document.getElementById("authPass").value||"";
  const btn=document.getElementById("authSubmit"); btn.disabled=true;
  try{
    const data=await api("/api/auth/"+authMode,{method:"POST",body:{email,password}});
    account=data.user; renderChrome();
    toast(authMode==="register"?"You're in.":"Signed in.");
    closeModal();
    openComplaintForm(after||"");
  }catch(e){ showErr("authErr",e.message); btn.disabled=false; }
}
async function signOut(){
  try{ await api("/api/auth/logout",{method:"POST"}); }catch(e){}
  account=null; renderChrome(); toast("Signed out."); if(currentView.name!=="home") go("home");
}

/* ---------- file a complaint ---------- */
function startComplaint(slug,name,cat){
  if(!account){ openAuth(slug||""); return; }
  openComplaintForm(slug||"", name||"", cat||"");
}
function openComplaintForm(slug,presetName,presetCat){
  const preset=presetName||"";
  const pcat=presetCat||"";
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3>File a complaint</h3><p>Put an unresolved issue on the public record. Be factual and first-hand — the business gets a right of reply.</p></div>
        <button class="close-x" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-err" id="cErr"></div>
        <div class="field">
          <label for="fBiz">Business / tradesperson</label>
          <input id="fBiz" type="text" placeholder="e.g. Brightpath Builders" value="${escAttr(preset)}">
        </div>
        <div class="field row2">
          <div class="field" style="gap:6px">
            <label for="fCat">Category</label>
            <select id="fCat">${CATEGORIES.map(c=>`<option ${c===pcat?"selected":""}>${c}</option>`).join("")}</select>
          </div>
          <div class="field" style="gap:6px">
            <label for="fLoc">Location</label>
            <input id="fLoc" type="text" placeholder="Town / region">
          </div>
        </div>
        <div class="field">
          <label>Severity <span class="hint">— how bad, on the zero-to-&minus;5 scale</span></label>
          <div class="sev-pick" id="sevPick">
            ${[1,2,3,4,5].map(n=>`<button type="button" data-sev="${n}" aria-pressed="${n===3?"true":"false"}"><span class="sn">&minus;${n}</span><span class="sl">${["minor","poor","serious","severe","egregious"][n-1]}</span></button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="fTitle">Headline</label>
          <input id="fTitle" type="text" placeholder="One line: what went wrong and how it was handled">
        </div>
        <div class="field">
          <label for="fBody">What happened</label>
          <textarea id="fBody" placeholder="Facts, dates, amounts. What you asked for and how the business responded (or didn't)."></textarea>
        </div>
        <div class="form-note">By filing you confirm this is a truthful, first-hand account. The business can respond publicly or ask moderators to review a disputed entry.</div>
      </div>
      <div class="modal-foot">
        <span class="signed-as">Filing as ${account?esc(account.email):"—"}</span>
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="cSubmit" onclick="submitComplaint()">Put it on the record</button>
      </div>
    </div>`);
  let sev=3;
  const pick=document.getElementById("sevPick");
  pick.addEventListener("click",e=>{
    const btn=e.target.closest("button[data-sev]"); if(!btn) return;
    sev=+btn.dataset.sev;
    pick.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", b===btn?"true":"false"));
  });
  window.__getSev=()=>sev;
  setTimeout(()=>{const el=document.getElementById("fBiz"); if(el&&!el.value) el.focus(); else {const t=document.getElementById("fTitle"); if(t) t.focus();}},60);
}
async function submitComplaint(){
  hideErr("cErr");
  const payload={
    business:(document.getElementById("fBiz").value||"").trim(),
    cat:document.getElementById("fCat").value,
    loc:(document.getElementById("fLoc").value||"").trim(),
    severity:window.__getSev?window.__getSev():3,
    title:(document.getElementById("fTitle").value||"").trim(),
    body:(document.getElementById("fBody").value||"").trim()
  };
  const btn=document.getElementById("cSubmit"); btn.disabled=true;
  try{
    const data=await api("/api/complaints",{method:"POST",body:payload});
    closeModal();
    toast("On the record. They can't say they weren't told.",true);
    filters.q=""; filters.cat="all"; filters.status="all"; filters.sort="recent";
    go("business",data.slug);
  }catch(e){ showErr("cErr",e.message); btn.disabled=false; }
}

/* ---------- right of reply ---------- */
function openReply(publicId){
  if(!account){ openAuth(); return; }
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3>Right of reply</h3><p>Respond publicly to complaint <strong>${esc(publicId)}</strong>. Your response is shown directly beneath it and marks the case as answered.</p></div>
        <button class="close-x" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-err" id="rErr"></div>
        <div class="field">
          <label for="rBy">Responding as</label>
          <input id="rBy" type="text" placeholder="Business name">
        </div>
        <div class="field">
          <label for="rText">Your response</label>
          <textarea id="rText" placeholder="Acknowledge the issue and set out what you'll do about it."></textarea>
        </div>
        <div class="form-note">In production, posting as a business would require verifying ownership of that listing. This prototype lets any signed-in user demonstrate the flow.</div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="rSubmit" onclick="submitReply('${esc(publicId)}')">Post response</button>
      </div>
    </div>`);
  setTimeout(()=>{const el=document.getElementById("rBy"); if(el) el.focus();},60);
}
async function submitReply(publicId){
  hideErr("rErr");
  const by=(document.getElementById("rBy").value||"").trim();
  const text=(document.getElementById("rText").value||"").trim();
  const btn=document.getElementById("rSubmit"); btn.disabled=true;
  try{
    await api("/api/complaints/"+encodeURIComponent(publicId)+"/reply",{method:"POST",body:{by,text}});
    closeModal(); toast("Response posted — case marked answered.");
    render();
  }catch(e){ showErr("rErr",e.message); btn.disabled=false; }
}

/* ---------- dispute a complaint ---------- */
function openDispute(publicId){
  if(!account){ openAuth(); return; }
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div><h3>Dispute this complaint</h3><p>Challenge complaint <strong>${esc(publicId)}</strong>. It gets flagged <em>under review</em> and goes to a moderator, who decides whether it stays, is removed, or is marked resolved.</p></div>
        <button class="close-x" onclick="closeModal()" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-err" id="dErr"></div>
        <div class="field">
          <label for="dReason">Grounds for dispute</label>
          <select id="dReason">${DISPUTE_REASONS.map(r=>`<option>${esc(r)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="dDetail">Explain</label>
          <textarea id="dDetail" placeholder="Set out why this complaint is inaccurate, resolved, or otherwise shouldn't stand. Evidence helps a moderator decide."></textarea>
        </div>
        <div class="form-note">Raising a dispute doesn't delete the complaint — a moderator reviews both sides. Abusing the dispute process can itself be actioned.</div>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="dSubmit" onclick="submitDispute('${esc(publicId)}')">Submit for review</button>
      </div>
    </div>`);
  setTimeout(()=>{const el=document.getElementById("dDetail"); if(el) el.focus();},60);
}
async function submitDispute(publicId){
  hideErr("dErr");
  const reason=document.getElementById("dReason").value;
  const detail=(document.getElementById("dDetail").value||"").trim();
  const btn=document.getElementById("dSubmit"); btn.disabled=true;
  try{
    await api("/api/complaints/"+encodeURIComponent(publicId)+"/dispute",{method:"POST",body:{reason,detail}});
    closeModal(); toast("Flagged for review. A moderator will decide.");
    render();
  }catch(e){ showErr("dErr",e.message); btn.disabled=false; }
}

/* ---------- moderation queue (moderators only) ---------- */
async function renderModeration(state){
  const app=document.getElementById("app");
  let data;
  try{ data=await api("/api/moderation/queue?state="+encodeURIComponent(state)); }
  catch(e){ app.innerHTML=`<main><div class="wrap"><div class="empty"><div class="big">Moderation unavailable.</div><div>${esc(e.message)}</div><button class="btn ghost sm" style="margin-top:16px" onclick="go('home')">← Back to the register</button></div></div></main>`; return; }
  const {disputes, counts}=data;
  const tab=(s,label)=>`<button class="mod-tab ${state===s?"active":""}" onclick="go('moderation','${s}')">${label} <span class="mod-tab-n">${counts[s]}</span></button>`;
  app.innerHTML=`<main><div class="wrap">
    <button class="backlink" onclick="go('home')">← The register</button>
    <div class="mod-head">
      <h2>Moderation queue</h2>
      <p><strong>Keep</strong> rejects the dispute and the complaint stays public · <strong>Remove</strong> hides it from the register · <strong>Resolve</strong> keeps it but marks it answered. Every decision is logged.</p>
    </div>
    <div class="mod-tabs">${tab("open","Open")}${tab("upheld","Upheld")}${tab("rejected","Rejected")}</div>
    <div class="feed">${disputes.length ? disputes.map(moderationCard).join("") : `<div class="empty"><div class="big">Nothing in this lane.</div><div>No ${esc(state)} disputes right now.</div></div>`}</div>
  </div></main>`;
}
function moderationCard(d){
  const open = d.state==="open";
  return `<article class="case mod-case">
    <div class="case-top">
      <div class="case-main">
        <div class="case-meta"><span class="caseid">${esc(d.complaintId)}</span><button class="biz-link" onclick="go('business','${d.biz}')">${esc(d.bizName)}</button></div>
        <div class="biz-sub">${esc(d.cat)} · ${esc(d.loc)}</div>
        <h3 class="headline">${esc(d.title)}</h3>
        <p class="body-excerpt">${esc(d.body)}</p>
      </div>
      <div class="case-side">
        <div class="sev"><span class="sev-stars">${starRow(d.sev,15)}</span><span class="sev-num">&minus;${d.sev}</span><span class="sev-label">severity</span></div>
      </div>
    </div>
    <div class="dispute-block">
      <div class="dispute-head">⚖ Dispute — ${esc(d.reason)} <span class="dispute-by">raised ${fmtDate(d.raisedAt)}${d.raisedByEmail?` · ${esc(d.raisedByEmail)}`:" · business"}</span></div>
      <p class="dispute-detail">${esc(d.detail)}</p>
    </div>
    ${open ? `
    <div class="mod-actions">
      <input id="note-${d.disputeId}" class="mod-note" type="text" placeholder="Moderator note (optional, logged)">
      <div class="mod-btns">
        <button class="btn ghost sm" onclick="resolveDispute(${d.disputeId},'keep')">Keep complaint</button>
        <button class="btn ghost sm" onclick="resolveDispute(${d.disputeId},'resolve')">Mark resolved</button>
        <button class="btn accent sm" onclick="resolveDispute(${d.disputeId},'remove')">Remove complaint</button>
      </div>
    </div>` : `
    <div class="case-foot"><span>Decision: <strong>${esc(d.resolution||d.state)}</strong></span>${d.moderatorEmail?`<span class="dot"></span><span>${esc(d.moderatorEmail)}</span>`:""}${d.resolvedAt?`<span class="dot"></span><span>${fmtDate(d.resolvedAt)}</span>`:""}${d.moderatorNote?`<span class="dot"></span><span>“${esc(d.moderatorNote)}”</span>`:""}</div>`}
  </article>`;
}
async function resolveDispute(id,action){
  const note=(document.getElementById("note-"+id)?.value||"").trim();
  try{
    await api("/api/moderation/disputes/"+id+"/resolve",{method:"POST",body:{action,note}});
    toast(action==="remove"?"Complaint removed from the register." : action==="resolve"?"Kept and marked resolved." : "Dispute rejected — complaint stands.");
    renderModeration(currentView.arg||"open");
    refreshModBadge();
  }catch(e){ toast(e.message); }
}

/* ---------- theme ---------- */
function isDark(){
  const attr=document.documentElement.getAttribute("data-theme");
  if(attr) return attr==="dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function toggleTheme(){ document.documentElement.setAttribute("data-theme", isDark()?"light":"dark"); renderChrome(); }
document.getElementById("themeBtn").addEventListener("click",toggleTheme);
function moonIcon(){return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;}
function sunIcon(){return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>`;}

/* ---------- toast ---------- */
let toastT;
function toast(msg,star){
  const t=document.getElementById("toast");
  t.innerHTML=(star?'<span class="t-star">'+starSVG(true,15)+'</span>':"")+esc(msg);
  t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),2600);
}

/* ---------- boot ---------- */
(async function(){
  try{ const me=await api("/api/auth/me"); account=me.user; }catch(e){}
  try{ const meta=await api("/api/meta"); if(Array.isArray(meta.disputeReasons)) DISPUTE_REASONS=meta.disputeReasons; }catch(e){}
  render();
})();
