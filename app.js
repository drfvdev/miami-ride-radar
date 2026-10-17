(() => {
"use strict";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let events = [], updatedAt = "", currentView = "today", range = "7", selectedDate, monthYear, monthIndex;
let searchTerm = "", area = "all", category = "all";
const getMiamiToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(new Date());
  const z = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return z.year + "-" + z.month + "-" + z.day;
};
const today = getMiamiToday();
selectedDate = today;
monthYear = Number(today.slice(0,4));
monthIndex = Number(today.slice(5,7))-1;
const nextDate = (iso,days) => {const t = new Date(iso+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+days);return t.toISOString().slice(0,10)};
const dateFmt = (d,opt={}) => new Intl.DateTimeFormat("en-US",{timeZone:"UTC",...opt}).format(new Date(d+"T12:00:00Z"));
const fullDate = d => dateFmt(d,{weekday:"long",month:"long",day:"numeric"});
const compactDate = d => dateFmt(d,{weekday:"short",month:"short",day:"numeric"});
const shortDate = d => dateFmt(d,{month:"short",day:"numeric"});
const weekday = d => dateFmt(d,{weekday:"short"});
const escapeText = x => String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clock = s => {if(!/^\d{2}:\d{2}$/.test(s||""))return "Not published";const [h,m] = s.split(":").map(Number);return (h%12||12)+":"+(m<10?"0":"")+m+" "+(h>=12?"PM":"AM")};
const active = (e,d) => e.date <= d && (e.date_end||e.date) >= d;
const endText = e => e.end_verified && e.end ? clock(e.end) + (e.end_date && e.end_date !== e.date ? " · "+weekday(e.end_date) : "") : "Not published";
const mapURL = e => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(e.address||e.venue||"Miami");
const officialURL = e => /^https:\/\//i.test(e.source||"") ? e.source : "https://www.google.com/search?q="+encodeURIComponent(e.title+" "+e.venue);
const visible = e => e.date && e.title && (e.date_end||e.date)>=today;
const sorted = arr => [...arr].sort((a,b)=>a.date.localeCompare(b.date)||(a.start||"99:99").localeCompare(b.start||"99:99")||Number(b.priority==="High")-Number(a.priority==="High"));
const filtered = arr => sorted(arr.filter(e => (area==="all"||e.area===area)&&(category==="all"||e.category===category)&&(!searchTerm||[e.title,e.venue,e.area,e.category].join(" ").toLowerCase().includes(searchTerm))));
const updateDate = () => {
  if(!updatedAt){$("#updatedLabel").textContent = "Data date unavailable";return}
  const d=new Date(updatedAt);
  $("#updatedLabel").textContent = Number.isNaN(d.getTime()) ? "Date unknown" : "Checked "+new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"}).format(d);
};
function eventCard(e){
 const potential=e.priority==="High" ? '<span class="high-potential">High potential</span><span class="separator"></span>' : "";
 const note=e.window_type||"Planning estimate";
 return '<article class="event-card"><div class="event-content"><div><div class="event-meta">'+potential+'<span>'+escapeText(e.category||"Event")+'</span><span class="separator"></span><span>'+escapeText(e.area||"Miami")+'</span></div><h3>'+escapeText(e.title)+'</h3><div class="venue">'+escapeText(e.venue)+(e.start?' · Starts '+escapeText(clock(e.start)):'')+(e.date_end && e.date_end!==e.date?' · Through '+escapeText(shortDate(e.date_end)):'')+'</div></div><div class="pickup-block"><div class="field-label">Suggested pickup window</div><div class="pickup-time">'+escapeText(e.window||"Not available")+'</div><div class="pickup-note">'+escapeText(note)+'</div></div></div><div class="card-foot"><div class="end-line">Official end: <strong>'+escapeText(endText(e))+'</strong></div><div class="card-actions"><a href="'+escapeText(mapURL(e))+'" target="_blank" rel="noopener noreferrer" aria-label="Directions to '+escapeText(e.venue)+'">Directions ↗</a><button type="button" data-event="'+escapeText(e.id)+'">Details →</button></div></div></article>';
}
function emptyState(title,description){
 return '<div class="empty-state"><h3>'+escapeText(title)+'</h3><p>'+escapeText(description)+'</p></div>';
}
function compactCard(e){
 return '<button type="button" class="compact-item" data-event="'+escapeText(e.id)+'"><span class="compact-date">'+escapeText(weekday(e.date))+'<br>'+escapeText(shortDate(e.date))+'</span><span class="compact-text"><span class="compact-title">'+escapeText(e.title)+'</span><span class="compact-sub">'+escapeText(e.venue)+' · '+escapeText(e.window||"Pickup time unknown")+'</span></span><span class="compact-arrow" aria-hidden="true">›</span></button>';
}
function renderToday(){
 const same = sorted(events.filter(e=>active(e,today)));
 const tomorrow = nextDate(today,1);
 const next = sorted(events.filter(e=>e.date>today && e.date<=nextDate(today,7)));
 $("#todayDate").textContent=fullDate(today)+" · Miami";
 $("#todayCount").textContent=same.length===1?"1 tracked event today":same.length+" tracked events today";
 $("#todayEvents").innerHTML=same.length ? same.map(eventCard).join("") : emptyState("Nothing tracked for today","No major events are listed in the current feed for today. This isn't a complete city calendar.");
 $("#nextPreview").innerHTML=next.length ? next.slice(0,5).map(compactCard).join("") : emptyState("Nothing upcoming in this feed","Check the full calendar or refresh the listings.");
 $("#previewTitle").textContent=next.some(e=>active(e,tomorrow)) ? "Tomorrow & beyond" : "Coming up next";
}
function buildFilters(){
 for(const [selector,key,allLabel] of [["#areaFilter","area","All areas"],["#categoryFilter","category","All types"]]){
  const sel=$(selector), prior=sel.value, values=[...new Set(events.map(e=>e[key]).filter(Boolean))].sort();
  sel.innerHTML='<option value="all">'+allLabel+'</option>'+values.map(x=>'<option value="'+escapeText(x)+'">'+escapeText(x)+'</option>').join("");
  sel.value=values.includes(prior)?prior:"all";
 }
 area=$("#areaFilter").value; category=$("#categoryFilter").value;
}
function renderUpcoming(){
 const max=range==="7"?nextDate(today,6):range==="30"?nextDate(today,29):"9999-12-31";
 const matching=filtered(events.filter(e=>e.date<=max));
 $("#resultsLabel").textContent=matching.length+(matching.length===1?" event":" events")+" found";
 if(!matching.length){
  $("#upcomingEvents").innerHTML=emptyState("No matching events","Try a different date range, neighborhood, or search.");
  return;
 }
 const group=new Map();
 matching.forEach(e=>{const key=e.date; if(!group.has(key))group.set(key,[]);group.get(key).push(e)});
 $("#upcomingEvents").innerHTML=[...group].map(([day,items])=>'<div class="date-group"><div class="date-group-header"><h2>'+escapeText(fullDate(day))+'</h2><span class="group-line"></span></div><div class="event-stack">'+items.map(eventCard).join("")+'</div></div>').join("");
}
function monthMove(by){
 monthIndex+=by;
 if(monthIndex<0){monthIndex=11;monthYear--}
 if(monthIndex>11){monthIndex=0;monthYear++}
 renderCalendar();
}
function renderCalendar(){
 $("#monthTitle").textContent=new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(new Date(monthYear,monthIndex,1));
 const startWeekday=new Date(Date.UTC(monthYear,monthIndex,1)).getUTCDay();
 const monthDays=new Date(Date.UTC(monthYear,monthIndex+1,0)).getUTCDate();
 const total=Math.ceil((startWeekday+monthDays)/7)*7;
 let buttons="";
 for(let i=0;i<total;i++){
  const iso=new Date(Date.UTC(monthYear,monthIndex,i-startWeekday+1)).toISOString().slice(0,10);
  const num=Number(iso.slice(8));
  const count=events.filter(e=>active(e,iso)).length;
  const selected=iso===selectedDate, current=iso===today;
  buttons+='<button type="button" class="'+(iso.slice(0,7)!==monthYear+"-"+String(monthIndex+1).padStart(2,"0")?"other-month ":"")+(selected?"selected ":"")+(current?"today ":"")+'" data-day="'+iso+'" aria-label="'+escapeText(fullDate(iso)+", "+count+" tracked events")+'" aria-pressed="'+selected+'"><span class="day-number">'+num+'</span><span class="day-dots" aria-hidden="true">'+(count?'<i class="day-dot"></i>'+(count>1?'<i class="day-dot dim"></i>':"")+(count>2?'<span class="day-more">+'+(count-2)+'</span>':""):"")+'</span></button>';
 }
 $("#monthGrid").innerHTML=buttons;
 renderCalendarDay();
}
function renderCalendarDay(){
 const matching=sorted(events.filter(e=>active(e,selectedDate)));
 $("#selectedDayTitle").textContent=fullDate(selectedDate);
 $("#selectedDayEvents").innerHTML=matching.length ? matching.map(eventCard).join("") : emptyState("No tracked events","There are no events in the current feed for this date.");
}
function render(){renderToday();renderUpcoming();renderCalendar();updateDate();}
function navigate(view){
 currentView=view;
 $$(".view").forEach(v=>v.hidden=v.id!==view+"View");
 $$("[data-view]").forEach(b=>{const on=b.dataset.view===view;b.classList.toggle("active",on);b.setAttribute("aria-current",on?"page":"false")});
 window.scrollTo({top:0,behavior:"instant"});
}
function showDetail(id){
 const e=events.find(item=>item.id===id);if(!e)return;
 $("#detailTag").textContent=(e.category||"Event")+" · "+(e.area||"Miami");
 $("#detailTitle").textContent=e.title;
 $("#detailMeta").textContent=fullDate(e.date)+(e.date_end && e.date_end!==e.date?" to "+shortDate(e.date_end):"")+" · "+e.venue;
 $("#detailWindow").textContent=e.window||"Not available";
 $("#detailWindowNote").textContent=e.window_type||"Planning estimate";
 $("#detailStart").textContent=clock(e.start);
 $("#detailEnd").textContent=endText(e);
 $("#detailAddress").textContent=e.address||e.venue;
 $("#detailNotes").textContent=e.note||"Check the official event page for details before traveling.";
 $("#detailDirections").href=mapURL(e);
 $("#detailSource").href=officialURL(e);
 const dialog=$("#detailDialog");if(!dialog.open)dialog.showModal();
}
function setTheme(value){
 document.documentElement.dataset.theme=value;
 $("#themeToggle").textContent=value==="dark"?"☀":"◐";
 $("#themeToggle").setAttribute("aria-label",value==="dark"?"Switch to light mode":"Switch to dark mode");
 $("#themeToggle").title=value==="dark"?"Light mode":"Dark mode";
 try{localStorage.setItem("ride-radar-theme",value)}catch{}
}
try{
 const stored=localStorage.getItem("ride-radar-theme");
 setTheme(stored==="light"||stored==="dark"?stored:(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));
}catch{setTheme("light")}
$("#themeToggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
$("#refreshButton").addEventListener("click",load);
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
$$("[data-range]").forEach(b=>b.addEventListener("click",()=>{range=b.dataset.range;$$("[data-range]").forEach(x=>x.classList.toggle("active",x.dataset.range===range));renderUpcoming()}));
$("#searchEvents").addEventListener("input",e=>{searchTerm=e.target.value.trim().toLowerCase();renderUpcoming()});
$("#areaFilter").addEventListener("change",e=>{area=e.target.value;renderUpcoming()});
$("#categoryFilter").addEventListener("change",e=>{category=e.target.value;renderUpcoming()});
$("#prevMonth").addEventListener("click",()=>monthMove(-1));
$("#nextMonth").addEventListener("click",()=>monthMove(1));
$("#jumpToday").addEventListener("click",()=>{monthYear=Number(today.slice(0,4));monthIndex=Number(today.slice(5,7))-1;selectedDate=today;renderCalendar()});
$("#monthGrid").addEventListener("click",e=>{const button=e.target.closest("[data-day]");if(!button)return;selectedDate=button.dataset.day;const m=selectedDate.slice(0,7).split("-");monthYear=Number(m[0]);monthIndex=Number(m[1])-1;renderCalendar()});
document.addEventListener("click",e=>{const target=e.target.closest("[data-event]");if(target)showDetail(target.dataset.event)});
$("#detailClose").addEventListener("click",()=>$("#detailDialog").close());
$("#detailDialog").addEventListener("click",e=>{if(e.target===$("#detailDialog"))$("#detailDialog").close()});
$("#openCalendar").addEventListener("click",()=>navigate("calendar"));
$("#openUpcoming").addEventListener("click",()=>navigate("upcoming"));
async function load(){
 $("#refreshButton").disabled=true;
 $("#refreshButton").setAttribute("aria-label","Refreshing events");
 try{
  const response=await fetch("./events.json?t="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw new Error("Could not load events");
  const payload=await response.json();
  if(!Array.isArray(payload.events))throw new Error("Invalid events feed");
  events=sorted(payload.events.filter(visible));
  updatedAt=payload.updated_at||"";
  buildFilters();render();
  $("#feedNotice").hidden=true;
 }catch(e){
  if(!events.length){$("#todayEvents").innerHTML=emptyState("Events temporarily unavailable","Could not load the calendar. Tap refresh to try again.");$("#nextPreview").innerHTML="";$("#upcomingEvents").innerHTML="";$("#selectedDayEvents").innerHTML=""}
  $("#feedNotice").textContent="Event feed could not be refreshed. Try again shortly.";
  $("#feedNotice").hidden=false;
 }finally{$("#refreshButton").disabled=false;$("#refreshButton").setAttribute("aria-label","Refresh events")}
}
$("#todayDate").textContent=fullDate(today)+" · Miami";
navigate("today");
load();
})();
