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
function statusLabel(s){ return ({responded:"Business responded", resolved:"Resolved", ignored:"No response", unresolved:"Unresolved"})[s] || "Unresolved"; }

/* ---------- router ---------- */
function routeURL(name,arg){ return name==="home" ? "/" : "/"+name+"/"+encodeURIComponent(arg||""); }
function go(name,arg){ saveComplaintDraft(); currentView={name,arg}; history.pushState({name,arg},"",routeURL(name,arg)); window.scrollTo({top:0}); render(); }
function readRoute(){ const parts=location.pathname.split("/").filter(Boolean); currentView={name:["business","profile","complaint"].includes(parts[0])?parts[0]:"home",arg:decodeURIComponent(parts[1]||"")}; }
window.addEventListener("popstate",()=>{readRoute();render();});

async function render(){
  renderChrome();
  const app=document.getElementById("app");
  if(currentView.name==="complaint"){
    app.innerHTML='<main class="wrap loading">Loading complaint…</main>';
    try { const {complaint}=await api("/api/complaints/"+encodeURIComponent(currentView.arg)); app.innerHTML=`<main><div class="wrap"><a class="backlink" href="/" onclick="event.preventDefault();go('home')">← The register</a>${caseCard(complaint,{detail:true,showRespond:true})}</div></main>`; }
    catch(e){app.innerHTML='<main class="wrap empty"><h1>Complaint unavailable</h1><p>'+esc(e.message)+'</p><a href="/">Return to the register</a></main>';}
  } else if(currentView.name==="business"){
    app.innerHTML=`<div class="loading">Loading business…</div>`;
    try{
      const data=await api("/api/businesses/"+encodeURIComponent(currentView.arg));
      app.innerHTML=viewBusiness(data);
    }catch(e){
      app.innerHTML=`<main><div class="wrap"><div class="empty"><div class="big">Business unavailable</div><div>${esc(e.message)}</div><button class="btn ghost sm" style="margin-top:16px" onclick="go('home')">← Back to the register</button></div></div></main>`;
    }
  } else if(currentView.name==="moderation"){
    app.innerHTML=`<div class="loading">Loading the moderation queue…</div>`;
    await renderModeration(currentView.arg||"open");
  } else if(currentView.name==="profile"){
    const id = currentView.arg==="me" ? (account&&account.id) : currentView.arg;
    if(!id){ openAuth(()=>go("profile","me")); app.innerHTML=await viewHome(); wireHome(); return; }
    app.innerHTML=`<div class="loading">Loading profile…</div>`;
    try{
      const data=await api("/api/users/"+encodeURIComponent(id));
      app.innerHTML=viewProfile(data);
    }catch(e){
      app.innerHTML=`<main><div class="wrap"><div class="empty"><div class="big">No such profile.</div><div>${esc(e.message)}</div><button class="btn ghost sm" style="margin-top:16px" onclick="go('home')">← Back to the register</button></div></div></main>`;
    }
  } else {
    app.innerHTML=await viewHome();
    wireHome();
  }
}

/* ---------- home ---------- */
async function viewHome(){
  let meta={total:0,unresolved:0,avgSeverity:0,businesses:0}, metaError=false;
  try{ meta=await api("/api/meta"); if(Array.isArray(meta.disputeReasons)) DISPUTE_REASONS=meta.disputeReasons; }catch(e){metaError=true;}
  return `
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <h1 class="title">Your experience. <em>On the record.</em></h1>
        <p class="lede">One voice is easy to ignore. A public register of them isn't. Tell us what they did to you, chances are they did it to someone else too.</p>
        <p class="hero-punch">Alone, we're a ticket they can close.<br><em>Together, we're a story they can't.</em></p>
        <div class="hero-actions"><button class="btn accent" onclick="startComplaint()">File a complaint</button><a class="btn ghost" href="#q">Search the register</a></div>
      </div>
      <div class="hero-stats">${metaError?'<button class="btn ghost" onclick="render()">Retry statistics</button>':""}
        <div class="hstat"><span class="n neg mono">${metaError?"Unavailable":meta.total?"−"+(meta.avgSeverity||0).toFixed(1):"—"}</span><span class="l">Register-wide average</span></div>
        <div class="hstat"><span class="n">${metaError?"—":meta.total}</span><span class="l">Logged complaints</span></div>
        <div class="hstat"><span class="n" style="color:var(--amber)">${metaError?"—":meta.unresolved}</span><span class="l">Still unresolved</span></div>
      </div>
    </div>
  </section>

  <section class="register">
    <div class="wrap reg-inner">
      <div class="searchbox">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input aria-label="Search complaints by business, trade or town" id="q" type="search" placeholder="Search a business, trade, or town…" value="${escAttr(filters.q)}" autocomplete="off">
      </div>
      <select aria-label="Category" class="filter" id="cat">
        <option value="all">All categories</option>
        ${CATEGORIES.map(c=>`<option value="${c}" ${filters.cat===c?"selected":""}>${c}</option>`).join("")}
      </select>
      <select aria-label="Complaint status" class="filter" id="status">
        <option value="all">Any status</option>
        <option value="unresolved" ${filters.status==="unresolved"?"selected":""}>Unresolved</option>
        <option value="ignored" ${filters.status==="ignored"?"selected":""}>Ignored / stonewalled</option>
        <option value="resolved" ${filters.status==="resolved"?"selected":""}>Resolved</option>
        <option value="responded" ${filters.status==="responded"?"selected":""}>Business responded</option>
      </select>
      <select aria-label="Sort complaints" class="filter" id="sort">
        <option value="recent" ${filters.sort==="recent"?"selected":""}>Most recent</option>
        <option value="backed" ${filters.sort==="backed"?"selected":""}>Most backed</option>
        <option value="severe" ${filters.sort==="severe"?"selected":""}>Most severe</option>
        <option value="shitlist" ${filters.sort==="shitlist"?"selected":""}>This week’s shit list</option>
        <option value="business" ${filters.sort==="business"?"selected":""}>By business</option>
      </select>
      <button class="btn accent sm" onclick="openShitList()">Sort by shit list</button>
      <button class="btn ghost sm" onclick="clearFilters()">Clear filters</button><span class="result-count" id="rcount" role="status" aria-live="polite"></span>
    </div>
  </section>

  <main><div class="wrap"><div class="feed" id="feed"><div class="loading">Loading complaints…</div></div></div></main>`;
}

function caseCard(c,opts={}){
  const unheard = !["responded","resolved"].includes(c.status);
  return `
  <article class="case">
    <div class="case-top">
      <div class="case-main">
        <div class="case-meta">
          <a class="biz-link" href="${routeURL('business',c.biz)}" onclick="event.preventDefault();go('business','${c.biz}')">${esc(c.bizName)}</a>
        </div>
        <div class="biz-sub">${esc(c.cat)} · ${esc(c.loc)}</div>
        <h3 class="headline"><a href="${routeURL('complaint',c.id)}" onclick="event.preventDefault();go('complaint','${c.id}')">${esc(c.title)}</a></h3>
        <p class="body-excerpt">${esc(opts.detail?c.body:c.body.length>240?c.body.slice(0,240)+'…':c.body)}</p>
        ${!opts.detail?`<a class="link-btn" href="${routeURL('complaint',c.id)}" onclick="event.preventDefault();go('complaint','${c.id}')">Read full complaint</a>`:""}
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
      ${c.authorId?`<button class="author-link" onclick="go('profile',${c.authorId})">${esc(c.author||"Registered submitter")}</button>`:`<span>${esc(c.author||"Registered submitter")}</span>`}
      ${c.reply?'<span class="reply-flag">✓ Response posted · unverified</span>':'<span class="reply-flag" style="color:var(--amber)">Awaiting business response</span>'}
    </div>
    <div class="engage">
      <button data-vote="${c.id}" class="vote ${c.votedByMe?"on":""}" onclick="toggleVote('${c.id}',this)" aria-pressed="${c.votedByMe?"true":"false"}" title="Show support for this complaint; this is not a rating">
        <img class="thumb-ic" src="/thumb.webp" alt="" width="32" height="32"><span class="vote-n">${c.downvotes||0}</span><span class="vote-lbl">supporting this</span>
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
  return `<div class="reply"><div class="reply-head">↩ Unverified response from ${esc(r.by)} · ${fmtDate(r.date)}</div><p class="reply-body">${esc(r.text)}</p></div>`;
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
  if(!account){ openAuth(()=>toggleVote(publicId,document.querySelector(`[data-vote="${publicId}"]`))); return; }
  btn.disabled=true;
  try{
    const r=await api("/api/complaints/"+encodeURIComponent(publicId)+"/vote",{method:"POST"});
    btn.classList.toggle("on", r.voted);
    btn.setAttribute("aria-pressed", r.voted?"true":"false");
    const n=btn.querySelector(".vote-n"); if(n) n.textContent=r.downvotes;
    if(r.voted) toast("You're supporting this. "+r.downvotes+" and counting.");
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
         <textarea aria-label="Your comment" maxlength="2000" id="cbox-${publicId}" placeholder="Add your voice — have you been done the same?"></textarea>
         <div class="c-compose-row"><span class="signed-as">${esc(account.displayName||"Member")}</span><button class="btn accent sm" onclick="postComment('${publicId}')">Comment</button></div>
       </div>`
    : `<div class="c-signin">${commentSVG()} <button class="link-btn" onclick="openAuth(()=>loadComments('${publicId}'))">Sign in</button> to join the conversation.</div>`;
  const list = data.comments.length
    ? data.comments.map(c=>commentNode(c, publicId)).join("")
    : `<div class="c-empty">No comments yet. Be the first to back them up.</div>`;
  const cn=document.querySelector(`[data-cn="${publicId}"]`); if(cn) cn.textContent=data.count;
  panel.innerHTML = composer + `<div class="c-list">${list}</div>`;
}

function commentNode(c, publicId){
  const cAuthor=(x)=> x.authorId?`<button class="c-author author-link" onclick="go('profile',${x.authorId})">${esc(x.author)}</button>`:`<span class="c-author">${esc(x.author)}</span>`;
  const replies=(c.replies||[]).map(r=>`
    <div class="c-item c-reply">
      <div class="c-head">${cAuthor(r)}<span class="c-date">${fmtDate(r.date)}</span></div>
      <p class="c-body">${esc(r.body)}</p>
    </div>`).join("");
  return `
    <div class="c-item">
      <div class="c-head">${cAuthor(c)}<span class="c-date">${fmtDate(c.date)}</span></div>
      <p class="c-body">${esc(c.body)}</p>
      <div class="c-actions"><button class="c-replybtn" onclick="openReplyBox('${publicId}',${c.id},this)">Reply</button></div>
      <div class="c-replies">${replies}</div>
    </div>`;
}

function openReplyBox(publicId, parentId, btn){
  if(!account){ openAuth(()=>openReplyBox(publicId,parentId,btn)); return; }
  const item=btn.closest(".c-item");
  if(item.querySelector(".c-replybox")) { item.querySelector(".c-replybox textarea").focus(); return; }
  const box=document.createElement("div");
  box.className="c-replybox";
  box.innerHTML=`<textarea aria-label="Your reply" maxlength="2000" placeholder="Write a reply…"></textarea>
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

let feedRequest=0, feedLimit=20;
function clearFilters(){ Object.assign(filters,{q:"",cat:"all",status:"all",sort:"recent"});feedLimit=20;render(); }
async function refreshFeed(more=false){
  const request=++feedRequest, feed=document.getElementById("feed"), rc=document.getElementById("rcount");
  if(!feed) return;
  if(!more) feedLimit=20;
  const qs=new URLSearchParams({...filters,limit:feedLimit});
  feed.setAttribute("aria-busy","true");
  try {
    const {complaints,total}=await api("/api/complaints?"+qs);
    if(request!==feedRequest||!feed.isConnected)return;
    rc.textContent=`${total??complaints.length} complaint${(total??complaints.length)===1?"":"s"}`;
    const filtered=filters.q||filters.cat!=="all"||filters.status!=="all"||filters.sort==="shitlist";
    feed.innerHTML=complaints.length?complaints.map(c=>caseCard(c)).join("")+(total>complaints.length?'<button class="btn ghost" onclick="feedLimit+=20;refreshFeed(true)">Load more complaints</button>':""):
      `<div class="empty"><h2>${filtered?"No matching complaints":"No complaints yet"}</h2><p>${filtered?"Try another search or clear your filters.":"Be the first to share a first-hand experience on the register."}</p><button class="btn accent" onclick="${filtered?"clearFilters()":"startComplaint()"}">${filtered?"Clear filters":"File the first complaint"}</button></div>`;
  } catch(e){if(request===feedRequest)feed.innerHTML='<div class="empty"><h2>Could not load complaints</h2><p>'+esc(e.message)+'</p><button class="btn ghost" onclick="refreshFeed()">Retry</button></div>';}
  finally{feed.removeAttribute("aria-busy");}
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
let dossierData=null, dossierSort="backed";
function viewBusiness(data){
  dossierData=data; dossierSort="backed";
  const b=data.business, s=data.stats;
  const totalBacking=(data.complaints||[]).reduce((a,c)=>a+(c.downvotes||0),0);
  return `<main><div class="wrap">
    <button class="backlink" onclick="go('home')">← The register</button>
    <div class="dossier">
      <div class="dossier-top">
        <div style="flex:1;min-width:240px">
          <h2>${esc(b.name)}</h2>
          <div class="biz-meta"><span>${esc(b.kind||"Business")}</span><span>·</span><span>${esc(b.cat)}</span><span>·</span><span>${esc(b.loc)}</span></div>
          <p style="color:var(--ink-soft);margin:16px 0 0;max-width:56ch">Public complaints register for ${esc(b.name)}. This page lists published complaints and their current outcomes. There is no positive-review side — a low or empty count means fewer people have reported being let down here.</p>
        </div>
        <div class="dossier-score">
          <div class="big">&minus;${s.total?(s.avgSeverity||0).toFixed(1):"—"}</div>
          <div class="stars">${starRow(Math.round(s.avgSeverity||0),15)}</div>
          <div class="lbl">Average severity</div>
        </div>
      </div>
      <div class="dossier-stats">
        <div class="dstat"><div class="n">${s.total}</div><div class="l">Complaints</div></div>
        <div class="dstat"><div class="n bad">${s.unresolved}</div><div class="l">Unresolved</div></div>
        <div class="dstat"><div class="n warn">${s.ignored}</div><div class="l">Ignored</div></div>
        <div class="dstat"><div class="n good">${s.responded}</div><div class="l">Responses</div></div>
        <div class="dstat"><div class="n" style="color:var(--accent)">${totalBacking}</div><div class="l">Total backing</div></div>
      </div>
    </div>
    <div class="section-rule">
      <h3>Complaints on record</h3>
      <div class="dossier-sort">
        <button class="ds-tab active" data-ds="backed" onclick="sortDossier('backed')">Most backed</button>
        <button class="ds-tab" data-ds="recent" onclick="sortDossier('recent')">Most recent</button>
      </div>
      <span class="line"></span>
    </div>
    <div class="feed" id="dossierFeed">${dossierList()}</div>
    <div style="margin-top:26px;text-align:center">
      <button class="btn accent" onclick="startComplaint('${b.slug}','${escAttr(b.name)}','${escAttr(b.cat)}')">Been let down by ${esc(b.name)} too? Add yours</button>
    </div>
  </div></main>`;
}
function dossierSorted(){
  const arr=[...((dossierData&&dossierData.complaints)||[])];
  if(dossierSort==="backed") arr.sort((a,b)=>(b.downvotes||0)-(a.downvotes||0) || b.date.localeCompare(a.date));
  else arr.sort((a,b)=>b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return arr;
}
function dossierList(){ return dossierSorted().map(c=>caseCard(c,{showRespond:true})).join(""); }
function sortDossier(mode){
  dossierSort=mode;
  document.querySelectorAll(".dossier-sort .ds-tab").forEach(t=>t.classList.toggle("active", t.dataset.ds===mode));
  const feed=document.getElementById("dossierFeed"); if(feed) feed.innerHTML=dossierList();
}

/* ---------- user profile ---------- */
function viewProfile(data){
  const u=data.user, s=data.stats;
  const initial=(u.handle||"?").trim()[0].toUpperCase();
  const emptyMsg=(m)=>`<div class="empty"><div class="big">${esc(m)}</div></div>`;
  return `<main><div class="wrap">
    <button class="backlink" onclick="go('home')">← The register</button>
    <div class="profile-head">
      <div class="profile-av">${esc(initial)}</div>
      <div style="flex:1;min-width:0">
        <h2>@${esc(u.handle)}${u.isModerator?' <span class="profile-mod">⚖ Moderator</span>':''}</h2>
        <div class="profile-meta">Joined ${fmtDate(u.joined)}${u.isMe?" · this is you":""}${u.isMe&&u.email?` · ${esc(u.email)}`:""}</div>
      </div>
    </div>
    ${u.isMe?`<button class="btn ghost" onclick="openAccountSettings()">Edit public name & recovery code</button>`:""}
    <div class="profile-stats">
      <div class="dstat"><div class="n">${s.filed}</div><div class="l">Complaints filed</div></div>
      <div class="dstat"><div class="n" style="color:var(--accent)">${s.backed}</div><div class="l">Complaints backed</div></div>
      <div class="dstat"><div class="n">${s.comments}</div><div class="l">Comments</div></div>
    </div>
    <div class="section-rule"><h3>Filed by @${esc(u.handle)}</h3><span class="line"></span></div>
    <div class="feed">${data.filed.length ? data.filed.map(c=>caseCard(c)).join("") : emptyMsg(u.isMe?"You haven't filed a complaint yet.":"No complaints filed yet.")}</div>
    <div class="section-rule"><h3>Backing</h3><span class="line"></span></div>
    <div class="feed">${data.backed.length ? data.backed.map(c=>caseCard(c)).join("") : emptyMsg(u.isMe?"You're not backing anything yet.":"Not backing anything yet.")}</div>
  </div></main>`;
}

/* ---------- chrome: account + theme ---------- */
function renderChrome(){
  requestAnimationFrame(()=>{document.documentElement.style.setProperty("--header-height",document.querySelector("header").getBoundingClientRect().height+"px");});
  const ms=document.getElementById("markStars"); if(ms) ms.innerHTML=starSVG(true,15)+starSVG(true,15);
  const slot=document.getElementById("acctSlot");
  if(account){
    const initial=(account.email||"?").trim()[0].toUpperCase();
    const modBtn = account.isModerator
      ? `<button class="btn ghost sm" onclick="go('moderation')" title="Moderation queue">⚖ Moderation<span id="modBadge" class="mod-badge" hidden></span></button>`
      : "";
    slot.innerHTML = modBtn + `<div class="acct"><button class="acct-link" title="Your profile" onclick="go('profile','me')"><span class="av">${initial}</span><span>${esc(account.displayName||"Your account")}</span></button><button class="close-x" title="Sign out" style="font-size:16px" aria-label="Sign out" onclick="signOut()">Sign out</button></div>`;
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
let modalTrigger=null, authAfter=null;
function openModal(html){
  saveComplaintDraft();modalTrigger=document.activeElement;
  document.getElementById("modalMount").innerHTML=html;
  const modal=document.querySelector(".modal"); modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");modal.tabIndex=-1;
  const heading=modal.querySelector("h3");if(heading){heading.id=heading.id||"dialogTitle";modal.setAttribute("aria-labelledby",heading.id);}
  document.getElementById("overlay").classList.add("open");
  for(const el of document.querySelectorAll("header,footer,#app"))el.inert=true;
  modal.focus();
  modal.addEventListener("keydown",e=>{if(e.key==="Tab"){const els=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')].filter(el=>el.offsetParent!==null);const first=els[0],last=els.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===modal)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}if(e.key==="Enter"&&e.target.matches("input")){e.preventDefault();modal.querySelector(".modal-foot .btn.accent")?.click();}});
}
function closeModal(){if(document.querySelector(".recovery-code")&&!confirm("Have you saved your recovery code? You will need it to reset your password."))return;saveComplaintDraft();document.getElementById("overlay").classList.remove("open");document.getElementById("modalMount").innerHTML="";for(const el of document.querySelectorAll("header,footer,#app"))el.inert=false;if(modalTrigger?.isConnected)modalTrigger.focus();}
document.getElementById("overlay").addEventListener("click",e=>{ if(e.target.id==="overlay") closeModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeModal(); });
function showErr(id,msg){ const el=document.getElementById(id); if(el){ el.textContent=msg; el.setAttribute("role","alert");el.classList.add("show"); } }
function hideErr(id){ const el=document.getElementById(id); if(el) el.classList.remove("show"); }

/* ---------- auth (real: email + password, login/register) ---------- */
let authMode="register";
function openAuth(after,mode="login"){
  authAfter=typeof after==="function"?after:null;
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
          <label for="authPass">Password <span class="hint" id="passHint"></span></label>
          <input id="authPass" type="password" placeholder="••••••••" autocomplete="current-password">
        </div>
        <button class="link-btn" type="button" onclick="togglePassword('authPass',this)">Show password</button>
        <div class="field" id="displayNameField"><label for="authName">Public display name</label><input id="authName" maxlength="40" autocomplete="nickname" placeholder="Choose a name, not your email"><span class="hint">Shown with your complaints and comments. Your email stays private.</span></div>
        <button class="link-btn" onclick="openRecovery()">Forgot password?</button>
        <p class="form-note">Your posts are public. You will receive a private recovery code when creating an account. Keep it somewhere safe.</p>
      </div>
      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="authSubmit" onclick="doAuth()">Create account</button>
      </div>
    </div>`);
  authMode=mode; setAuthMode(mode);
  setTimeout(()=>{const el=document.getElementById("authEmail"); if(el) el.focus();},60);
}
function setAuthMode(mode){
  authMode=mode; hideErr("authErr");
  document.getElementById("displayNameField").hidden=mode!=="register";document.getElementById("passHint").textContent=mode==="register"?"— at least 6 characters":"";
  document.querySelectorAll(".auth-tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.mode===mode?"true":"false"));
  document.getElementById("authTitle").textContent = mode==="register"?"Create your free account":"Welcome back";
  document.getElementById("authSubmit").textContent = mode==="register"?"Create account":"Sign in";
  const pass=document.getElementById("authPass"); if(pass) pass.setAttribute("autocomplete", mode==="register"?"new-password":"current-password");
}
async function doAuth(){
  hideErr("authErr");
  const email=(document.getElementById("authEmail").value||"").trim();
  const password=document.getElementById("authPass").value||"";
  const btn=document.getElementById("authSubmit"); btn.disabled=true;
  try{
    const data=await api("/api/auth/"+authMode,{method:"POST",body:{email,password,displayName:document.getElementById("authName").value}});
    account=data.user; renderChrome();
    toast(authMode==="register"?"You're in.":"Signed in.");
    closeModal();
    const resume=authAfter;authAfter=null;
    if(data.recoveryCode)showRecoveryCode(data.recoveryCode,resume);else if(resume)resume();else render();
  }catch(e){ showErr("authErr",e.message); btn.disabled=false; }
}
async function signOut(){
  try{ await api("/api/auth/logout",{method:"POST"}); }catch(e){}
  account=null; renderChrome(); toast("Signed out."); if(currentView.name!=="home") go("home");
}

/* ---------- file a complaint ---------- */
function startComplaint(slug,name,cat){
  if(!account){ openAuth(()=>openComplaintForm(slug||"",name||"",cat||""),"register"); return; }
  openComplaintForm(slug||"", name||"", cat||"");
}
function openComplaintForm(slug,presetName,presetCat){
  reviewedComplaint=null;
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
          <label for="fBiz">Business / tradesperson <span class="hint">Required</span></label>
          <input id="fBiz" list="businessOptions" autocomplete="organization" maxlength="120" type="text" placeholder="e.g. Brightpath Builders" value="${escAttr(preset)}"><datalist id="businessOptions"></datalist><span class="hint">Choose an existing business when available. Check the name and location.</span>
        </div>
        <div class="field row2">
          <div class="field" style="gap:6px">
            <label for="fCat">Category</label>
            <select id="fCat"><option value="">Choose a category</option>${CATEGORIES.map(c=>`<option ${c===pcat?"selected":""}>${c}</option>`).join("")}</select>
          </div>
          <div class="field" style="gap:6px">
            <label for="fLoc">Location</label>
            <input id="fLoc" type="text" placeholder="e.g. Brisbane, QLD" maxlength="100">
          </div>
        </div>
        <div class="field">
          <label for="fService">Product or service <span class="hint">Required</span></label>
          <input id="fService" maxlength="160" placeholder="e.g. Washing machine, kitchen renovation, internet plan">
        </div>
        <div class="field row2">
          <div class="field"><label for="fIncidentDate">When did it happen? <span class="hint">Optional</span></label><input id="fIncidentDate" type="date"><span class="hint">Leave blank if you do not know the exact date.</span></div>
          <div class="field"><label for="fAmount">Amount involved (AUD) <span class="hint">Optional</span></label><input id="fAmount" type="number" min="0" step="0.01" placeholder="e.g. 250.00"><span class="hint">Include the amount paid or disputed, if relevant.</span></div>
        </div>
        <div class="field">
          <label for="fContact">Have you contacted the business? <span class="hint">Required</span></label>
          <select id="fContact"><option value="">Choose an answer</option><option>No, not yet</option><option>Yes, but no response</option><option>Yes, they responded but it is unresolved</option></select>
        </div>
        <div class="field"><label for="fContactNotes">Contact attempts and response <span class="hint">Optional</span></label><textarea id="fContactNotes" maxlength="1500" placeholder="When and how did you contact them? What did they say or offer? Do not include private phone numbers or email addresses."></textarea></div>
        <div class="field">
          <label>How serious was the issue? <span class="hint">Required · choose one</span></label>
          <div class="sev-pick" id="sevPick" role="group" aria-label="Severity">
            ${[1,2,3,4,5].map(n=>`<button type="button" data-sev="${n}" aria-pressed="${false?"true":"false"}"><span class="sn">&minus;${n}</span><span class="sl">${["Minor","Moderate","Serious","Severe","Very severe"][n-1]}</span></button>`).join("")}
          </div><span class="hint">Minor: inconvenience. Moderate: repeated delays. Serious: significant cost or disruption. Severe: major loss. Very severe: lasting harm.</span>
        </div>
        <div class="field">
          <label for="fTitle">Headline <span class="hint">Required</span></label>
          <input id="fTitle" maxlength="180" type="text" placeholder="One line: what went wrong and how it was handled">
        </div>
        <div class="field">
          <label for="fBody">What happened <span class="hint">Required · at least 20 characters</span></label>
          <textarea id="fBody" minlength="20" maxlength="10000" placeholder="Facts, dates, amounts. What you asked for and how the business responded (or didn't)."></textarea>
        </div>
        <div class="field"><label for="fOutcome">What resolution would you like? <span class="hint">Required</span></label><textarea id="fOutcome" maxlength="1500" placeholder="e.g. A refund, a repair, delivery of the item, or a clear explanation."></textarea></div>
        <div class="form-note">All these details will be included in your public complaint. Keep private information out. By filing you confirm this is a truthful, first-hand account. The business can respond publicly or ask moderators to review a disputed entry.</div>
      </div>
      <div class="modal-foot">
        <span class="signed-as">Public name: ${account?esc(account.displayName||"Member"):"—"}</span>
        <div class="spacer"></div>
        <button class="btn ghost" onclick="closeModal()">Cancel</button>
        <button class="btn accent" id="cSubmit" onclick="reviewComplaint()">Review complaint</button>
      </div>
    </div>`);
  let sev=0;
  const pick=document.getElementById("sevPick");
  pick.addEventListener("click",e=>{
    const btn=e.target.closest("button[data-sev]"); if(!btn) return;
    sev=+btn.dataset.sev;
    pick.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", b===btn?"true":"false"));
  });
  window.__getSev=()=>sev;
  restoreComplaintDraft(preset,pcat);
  const draft=document.getElementById("fBiz");draft.addEventListener("input",lookupBusinesses);
  draft.addEventListener("change",()=>{const option=[...document.querySelectorAll("#businessOptions option")].find(x=>x.value===draft.value);if(option){document.getElementById("fCat").value=option.dataset.cat;document.getElementById("fLoc").value=option.dataset.loc;}});
  document.querySelector(".modal").addEventListener("input",saveComplaintDraft);
  document.querySelector(".modal").addEventListener("click",()=>setTimeout(saveComplaintDraft,0));
  document.querySelector(".modal-foot").insertAdjacentHTML("afterbegin",'<button class="link-btn" onclick="discardComplaintDraft()">Discard draft</button>');
  const saved=readDraft();if(saved?.severity){sev=saved.severity;pick.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.sev===sev));}
  lookupBusinesses();
  setTimeout(()=>{const el=document.getElementById("fBiz"); if(el&&!el.value) el.focus(); else {const t=document.getElementById("fTitle"); if(t) t.focus();}},60);
}
let reviewedComplaint=null;
async function submitComplaint(){
  hideErr("cErr");
  const payload=reviewedComplaint||{
    business:(document.getElementById("fBiz").value||"").trim(),
    cat:document.getElementById("fCat").value,
    loc:(document.getElementById("fLoc").value||"").trim(),
    severity:window.__getSev?window.__getSev():0,
    title:(document.getElementById("fTitle").value||"").trim(),
    body:(document.getElementById("fBody").value||"").trim()
  };
  const btn=document.getElementById("cSubmit"); btn.disabled=true;
  try{
    const data=await api("/api/complaints",{method:"POST",body:payload});
    try{localStorage.removeItem("zs_complaint_draft");}catch{}reviewedComplaint=null;
    closeModal();
    openModal(`<div class="modal"><div class="modal-head"><h3>Complaint published</h3></div><div class="modal-body"><p>Your complaint is public. Save this reference: <strong>${esc(data.publicId)}</strong>.</p><a class="btn accent" href="${routeURL('complaint',data.publicId)}" onclick="event.preventDefault();closeModal();go('complaint','${data.publicId}')">View your complaint</a></div></div>`);
    filters.q=""; filters.cat="all"; filters.status="all"; filters.sort="recent";
    go("complaint",data.publicId);
  }catch(e){ showErr("cErr",e.message); btn.disabled=false; }
}

/* ---------- right of reply ---------- */
function openReply(publicId){
  if(!account){ openAuth(()=>openReply(publicId)); return; }
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
        <div class="form-note">This response will be public and labelled unverified. Signing in does not verify that you represent this business.</div>
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
    closeModal(); toast("Response posted. The complaint is not marked resolved.");
    render();
  }catch(e){ showErr("rErr",e.message); btn.disabled=false; }
}

/* ---------- dispute a complaint ---------- */
function openDispute(publicId){
  if(!account){ openAuth(()=>openDispute(publicId)); return; }
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
        <div class="case-meta"><button class="biz-link" onclick="go('business','${d.biz}')">${esc(d.bizName)}</button></div>
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
function toggleTheme(){ const theme=isDark()?"light":"dark";document.documentElement.setAttribute("data-theme",theme);try{localStorage.setItem("zs_theme",theme);}catch{}renderChrome(); }
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
  readRoute();render();
})();

/* Usability: local drafts contain only complaint text, never credentials. */
function readDraft(){try{return JSON.parse(localStorage.getItem("zs_complaint_draft")||"null");}catch{return null;}}
function saveComplaintDraft(){if(!document.getElementById("fBiz"))return;const d={};for(const [key,id] of Object.entries({business:"fBiz",cat:"fCat",loc:"fLoc",title:"fTitle",body:"fBody",service:"fService",incidentDate:"fIncidentDate",amount:"fAmount",contact:"fContact",contactNotes:"fContactNotes",outcome:"fOutcome"}))d[key]=document.getElementById(id).value;d.severity=window.__getSev?.()||0;try{localStorage.setItem("zs_complaint_draft",JSON.stringify(d));}catch{}}
function restoreComplaintDraft(name,cat){const d=readDraft();if(!d)return;for(const [key,id] of Object.entries({business:"fBiz",cat:"fCat",loc:"fLoc",title:"fTitle",body:"fBody",service:"fService",incidentDate:"fIncidentDate",amount:"fAmount",contact:"fContact",contactNotes:"fContactNotes",outcome:"fOutcome"}))document.getElementById(id).value=d[key]||"";if(name)document.getElementById("fBiz").value=name;if(cat)document.getElementById("fCat").value=cat;}
function discardComplaintDraft(){if(!confirm("Discard your saved complaint draft? This cannot be undone."))return;for(const id of ["fBiz","fCat","fLoc","fTitle","fBody","fService","fIncidentDate","fAmount","fContact","fContactNotes","fOutcome"])document.getElementById(id).value="";try{localStorage.removeItem("zs_complaint_draft");}catch{}reviewedComplaint=null;closeModal();try{localStorage.removeItem("zs_complaint_draft");}catch{}}
let lookupRequest=0;
async function lookupBusinesses(){const request=++lookupRequest;const input=document.getElementById("fBiz");if(!input)return;try{const {businesses}=await api("/api/businesses?q="+encodeURIComponent(input.value));if(request!==lookupRequest||!document.getElementById("businessOptions"))return;document.getElementById("businessOptions").innerHTML=businesses.map(b=>`<option value="${escAttr(b.name)}" data-cat="${escAttr(b.cat)}" data-loc="${escAttr(b.loc)}">${esc(b.loc)}</option>`).join("");}catch{}}
function fieldError(id,msg){const input=document.getElementById(id);input.setAttribute("aria-invalid","true");const error=document.createElement("span");error.className="field-error";error.id=id+"Error";error.textContent=msg;input.after(error);input.setAttribute("aria-describedby",error.id);input.focus();}
function reviewComplaint(){
 document.querySelectorAll(".field-error").forEach(e=>e.remove());document.querySelectorAll('[aria-invalid]').forEach(e=>e.removeAttribute('aria-invalid'));
 const d={business:document.getElementById("fBiz").value.trim(),cat:document.getElementById("fCat").value,loc:document.getElementById("fLoc").value.trim(),severity:window.__getSev(),title:document.getElementById("fTitle").value.trim(),body:document.getElementById("fBody").value.trim()};
 if(!d.business)return fieldError("fBiz","Enter a business or tradesperson name.");if(!d.cat)return fieldError("fCat","Choose a category.");if(!d.severity){showErr("cErr","Choose how serious the issue was.");document.querySelector("#sevPick button").focus();return;}if(!d.title)return fieldError("fTitle","Add a short headline.");if(d.body.length<20)return fieldError("fBody","Describe what happened in at least 20 characters.");
 const value=id=>document.getElementById(id).value.trim();
 if(!value("fService"))return fieldError("fService","Name the product or service involved.");
 if(!value("fContact"))return fieldError("fContact","Tell us whether you contacted the business.");
 if(!value("fOutcome"))return fieldError("fOutcome","Tell us what would resolve the issue.");
 if(value("fAmount")&&(!Number.isFinite(Number(value("fAmount")))||Number(value("fAmount"))<0))return fieldError("fAmount","Enter an amount of zero or more.");
 const details=["Product or service: "+value("fService"),"Date of issue: "+(value("fIncidentDate")||"Not specified"),...(value("fAmount")?["Amount involved: AUD "+Number(value("fAmount")).toFixed(2)]:[]),"Contacted the business: "+value("fContact"),...(value("fContactNotes")?["Contact attempts and response: "+value("fContactNotes")]:[])];
 saveComplaintDraft();
 d.body=details.join("\n")+"\n\nWhat happened\n"+d.body+"\n\nResolution wanted\n"+value("fOutcome");
 if(d.body.length>10000)return fieldError("fBody","Please shorten the complaint; all details together must fit within 10,000 characters.");
 reviewedComplaint=d;
 openModal(`<div class="modal"><div class="modal-head"><h3>Review before publishing</h3><button class="close-x" aria-label="Close review" onclick="closeModal()">×</button></div><div class="modal-body"><div class="form-err" id="cErr"></div><p>Your complaint, location and public name will be visible to everyone. Your email remains private.</p><dl><dt>Business</dt><dd>${esc(d.business)} · ${esc(d.loc||"Location not provided")}</dd><dt>Category and severity</dt><dd>${esc(d.cat)} · −${d.severity}</dd><dt>Public name</dt><dd>${esc(account.displayName||"Member")}</dd></dl><h4>${esc(d.title)}</h4><p class="complaint-text">${esc(d.body)}</p><p>Publish only truthful, first-hand experiences. Remove private contact, payment and sensitive personal details.</p><label class="confirmation"><input type="checkbox" id="publishConfirm"> I confirm this is my first-hand account and I have checked it for private information.</label></div><div class="modal-foot"><button class="btn ghost" onclick="openComplaintForm()">Back to edit</button><button class="btn accent" id="cSubmit" onclick="if(!document.getElementById('publishConfirm').checked){showErr('cErr','Confirm your account before publishing.');return;}submitComplaint()">Publish complaint</button></div></div>`);
}
function togglePassword(id,button){const input=document.getElementById(id);input.type=input.type==="password"?"text":"password";button.textContent=input.type==="password"?"Show password":"Hide password";}
function showRecoveryCode(code,resume){openModal(`<div class="modal"><div class="modal-head"><h3>Save your private recovery code</h3></div><div class="modal-body"><p>This code can reset your password. Keep it in a password manager. Never share it or post it in a complaint.</p><code class="recovery-code">${esc(code)}</code><button class="btn ghost" id="saveRecovery">Download recovery code</button></div><div class="modal-foot"><button class="btn accent" id="continueRecovery">I saved it — continue</button></div></div>`);document.getElementById("saveRecovery").onclick=()=>{const url=URL.createObjectURL(new Blob(["Zero Stars recovery code\n"+code],{type:"text/plain"}));const a=document.createElement("a");a.href=url;a.download="zero-stars-recovery.txt";a.click();URL.revokeObjectURL(url);};document.getElementById("continueRecovery").onclick=()=>{document.querySelector(".recovery-code").classList.remove("recovery-code");closeModal();if(resume)resume();else render();};}
function openRecovery(){openModal(`<div class="modal"><div class="modal-head"><h3>Reset your password</h3><button class="close-x" aria-label="Close" onclick="closeModal()">×</button></div><div class="modal-body"><p>Use the private recovery code you saved when creating your account. A successful reset signs out all existing sessions and gives you a new code.</p><div id="recoverErr" class="form-err"></div><div class="field"><label for="recoverEmail">Email</label><input id="recoverEmail" type="email" autocomplete="email"></div><div class="field"><label for="recoverCode">Recovery code</label><input id="recoverCode" autocomplete="off"></div><div class="field"><label for="recoverPass">New password · at least 6 characters</label><input id="recoverPass" type="password" autocomplete="new-password"></div><button class="link-btn" onclick="togglePassword('recoverPass',this)">Show password</button></div><div class="modal-foot"><button class="btn ghost" onclick="openAuth()">Back to sign in</button><button class="btn accent" id="recoverSubmit" onclick="resetPassword()">Reset password</button></div></div>`);}
async function resetPassword(){const button=document.getElementById("recoverSubmit");button.disabled=true;try{const result=await api("/api/auth/recover",{method:"POST",body:{email:document.getElementById("recoverEmail").value,recoveryCode:document.getElementById("recoverCode").value,password:document.getElementById("recoverPass").value}});account=null;renderChrome();showRecoveryCode(result.recoveryCode,()=>openAuth());}catch(e){showErr("recoverErr",e.message);button.disabled=false;}}
try{const theme=localStorage.getItem("zs_theme");if(["light","dark"].includes(theme))document.documentElement.setAttribute("data-theme",theme);}catch{}
const motion=matchMedia("(prefers-reduced-motion: reduce)");function setLogoMotion(){const video=document.querySelector(".logo-vid");if(!video)return;if(motion.matches){video.pause();video.removeAttribute("autoplay");video.style.display="none";let img=document.querySelector(".static-logo");if(!img){img=document.createElement("img");img.className="static-logo";img.src="/logo.webp";img.alt="Zero Stars";video.before(img);}img.hidden=false;}else{video.style.display="";document.querySelector(".static-logo")?.setAttribute("hidden","");video.play().catch(()=>{});}}motion.addEventListener("change",setLogoMotion);setLogoMotion();

function openAccountSettings(){openModal(`<div class="modal"><div class="modal-head"><h3>Account settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">×</button></div><div class="modal-body"><p>Choose a public name for future posts. Saving generates a new recovery code and invalidates your old one. Existing posts keep their published names.</p><div id="settingsErr" class="form-err"></div><div class="field"><label for="settingsName">Public display name</label><input id="settingsName" maxlength="40" value="${escAttr(account.displayName||"Member")}" autocomplete="nickname"></div><div class="field"><label for="settingsPass">Current password</label><input id="settingsPass" type="password" autocomplete="current-password"></div></div><div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn accent" id="settingsSave" onclick="saveAccountSettings()">Save settings</button></div></div>`);}
async function saveAccountSettings(){const button=document.getElementById("settingsSave");button.disabled=true;try{const data=await api("/api/auth/settings",{method:"POST",body:{displayName:document.getElementById("settingsName").value,password:document.getElementById("settingsPass").value}});account=data.user;renderChrome();showRecoveryCode(data.recoveryCode,()=>render());}catch(e){showErr("settingsErr",e.message);button.disabled=false;}}

async function openShitList(){
 filters.sort="shitlist";const sort=document.getElementById("sort");if(sort)sort.value="shitlist";refreshFeed();
 openModal(`<div class="modal shit-list"><div class="modal-head"><h3>This week’s shit list</h3><button class="close-x" aria-label="Close" onclick="closeModal()">×</button></div><div class="modal-body" id="shitListContent" aria-live="polite">Loading this week’s rankings…</div></div>`);
 const mount=document.getElementById("shitListContent");
 try{const data=await api("/api/shit-list");if(!mount.isConnected)return;
 mount.innerHTML=`<p>Week beginning ${esc(data.week)} · Brisbane time.</p><p class="ranking-basis">Ranked by average severity of published complaints filed this week, then complaint count. These are user reports, not independently verified findings. Entries labelled fictional are demo submissions.</p>${data.businesses.length?`<ol class="weekly-ranking">${data.businesses.map(b=>`<li><span class="rank-number">#${b.rank}</span><div><a class="biz-link" href="${routeURL('business',b.slug)}" onclick="event.preventDefault();closeModal();go('business','${b.slug}')">${esc(b.name)}</a><p>${esc(b.loc)} · ${b.count} complaint${b.count===1?'':'s'}</p></div><strong class="rank-score" aria-label="Average severity minus ${b.average.toFixed(1)}">−${b.average.toFixed(1)}</strong></li>`).join('')}</ol>`:'<p>No complaints have been filed this week. Businesses will appear here as reports arrive.</p>'}`;
 }catch(e){if(mount.isConnected)mount.innerHTML='<p>'+esc(e.message)+'</p><button class="btn ghost" onclick="openShitList()">Retry</button>';}
}
