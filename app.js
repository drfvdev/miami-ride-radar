(() => {
"use strict";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const TZ = "America/New_York";
let events = [], updatedAt = "", currentView = "today", range = "7", selectedDate, monthYear, monthIndex;
let searchTerm = "", area = "all", category = "all", highOnly = false, pendingEventId = "";
let now = Date.now();

// ---------- Dates and Miami time ----------
const getMiamiToday = () => {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(new Date());
  const z = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return z.year + "-" + z.month + "-" + z.day;
};
let today = getMiamiToday();
selectedDate = today;
monthYear = Number(today.slice(0,4));
monthIndex = Number(today.slice(5,7))-1;
const nextDate = (iso,days) => {const t = new Date(iso+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+days);return t.toISOString().slice(0,10)};
const dateFmt = (d,opt={}) => new Intl.DateTimeFormat("en-US",{timeZone:"UTC",...opt}).format(new Date(d+"T12:00:00Z"));
const fullDate = d => dateFmt(d,{weekday:"long",month:"long",day:"numeric"});
const shortDate = d => dateFmt(d,{month:"short",day:"numeric"});
const weekday = d => dateFmt(d,{weekday:"short"});
const timeOf = ms => new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"}).format(new Date(ms));
const hourOf = ms => new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric"}).format(new Date(ms)).replace(" ","").toLowerCase();
// Miami's UTC offset (minutes) on a given calendar day, so times stay right across daylight saving changes
const offsetCache = {};
const miamiOffset = iso => {
  if(iso in offsetCache) return offsetCache[iso];
  let offset = -300;
  try{
    const name = new Intl.DateTimeFormat("en-US",{timeZone:TZ,timeZoneName:"shortOffset"}).formatToParts(new Date(iso+"T16:00:00Z")).find(p=>p.type==="timeZoneName").value;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if(m) offset = (m[1]==="-"?-1:1)*(Number(m[2])*60+Number(m[3]||0));
  }catch{}
  return offsetCache[iso] = offset;
};
const miamiTime = (iso,minutes) => {const [y,mo,d] = iso.split("-").map(Number);return Date.UTC(y,mo-1,d,0,minutes) - miamiOffset(iso)*60000};
const duration = ms => {
  const mins = Math.max(1,Math.round(ms/60000));
  if(mins < 60) return mins+" min";
  const h = Math.floor(mins/60), m = mins%60;
  return h+"h"+(m?" "+m+"m":"");
};

// ---------- Pickup windows ----------
// Turns text like "10:15–11:45 PM" or "10:30 PM–12:15 AM" into real timestamps. Returns null for free text.
const toMinutes = (h,m,ap) => (Number(h)%12 + (ap==="PM"?12:0))*60 + Number(m);
function parseWindow(e){
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(e.window||"");
  if(!m) return null;
  const ap2 = m[6].toUpperCase(), ap1 = (m[3]||ap2).toUpperCase();
  let start = toMinutes(m[1],m[2],ap1), end = toMinutes(m[4],m[5],ap2);
  // An early-morning window for an evening event belongs to the following night
  if(/^\d{2}:\d{2}$/.test(e.start||"")){
    const eventStart = Number(e.start.slice(0,2))*60 + Number(e.start.slice(3));
    if(start < eventStart-60) {start += 1440; end += 1440}
  }
  if(end <= start) end += 1440;
  return {start:miamiTime(e.date,start), end:miamiTime(e.date,end)};
}
function status(e){
  const w = e._win;
  if(!w) return null;
  if(now >= w.end) return {key:"done", label:"Pickup window passed"};
  if(now >= w.start) return {key:"open", label:"Window open · "+duration(w.end-now)+" left"};
  if(w.start-now < 18*3600000) return {key:"soon", label:"Pickups in "+duration(w.start-now)};
  return null;
}
const statusChip = e => {const s = status(e);return s ? '<span class="chip chip-'+s.key+'">'+(s.key==="open"?'<i class="pulse" aria-hidden="true"></i>':"")+escapeText(s.label)+'</span>' : ""};

// ---------- Event helpers ----------
const escapeText = x => String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clock = s => {if(!/^\d{2}:\d{2}$/.test(s||""))return "Not published";const [h,m] = s.split(":").map(Number);return (h%12||12)+":"+(m<10?"0":"")+m+" "+(h>=12?"PM":"AM")};
const active = (e,d) => e.date <= d && (e.date_end||e.date) >= d;
// Still relevant right now: on today's calendar or later, or last night's event whose pickup window hasn't closed
const current = e => (e.date_end||e.date) >= today || (e._win && e._win.end > now);
const onToday = e => active(e,today) || (e.date < today && e._win && e._win.end > now);
const endText = e => e.end_verified && e.end ? clock(e.end) + (e.end_date && e.end_date !== e.date ? " · "+weekday(e.end_date) : "") : "Not published";
const place = e => e.address||e.venue||"Miami, FL";
const mapURL = e => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(place(e));
const wazeURL = e => "https://waze.com/ul?navigate=yes&q="+encodeURIComponent(place(e));
const officialURL = e => /^https:\/\//i.test(e.source||"") ? e.source : "https://www.google.com/search?q="+encodeURIComponent(e.title+" "+e.venue);
const isHigh = e => e.priority === "High";
const sorted = arr => [...arr].sort((a,b)=>a.date.localeCompare(b.date)||(a.start||"99:99").localeCompare(b.start||"99:99")||Number(isHigh(b))-Number(isHigh(a)));
const byWindow = arr => [...arr].sort((a,b)=>{
  const da = status(a)?.key==="done", db = status(b)?.key==="done";
  if(da !== db) return da ? 1 : -1;
  return (a._win?.start ?? Infinity)-(b._win?.start ?? Infinity) || Number(isHigh(b))-Number(isHigh(a));
});
const filtered = arr => sorted(arr.filter(e => (area==="all"||e.area===area)&&(category==="all"||e.category===category)&&(!highOnly||isHigh(e))&&(!searchTerm||[e.title,e.venue,e.area,e.category,e.address].join(" ").toLowerCase().includes(searchTerm))));
const updateDate = () => {
  if(!updatedAt){$("#updatedLabel").textContent = "Data date unavailable";return}
  const d = new Date(updatedAt);
  $("#updatedLabel").textContent = Number.isNaN(d.getTime()) ? "Date unknown" : "Listings checked "+new Intl.DateTimeFormat("en-US",{timeZone:TZ,month:"short",day:"numeric"}).format(d);
};

// ---------- Rendering ----------
function eventCard(e){
 const s = status(e);
 const potential = isHigh(e) ? '<span class="high-potential">High potential</span><span class="separator"></span>' : "";
 const note = e.window_type||"Planning estimate";
 return '<article class="event-card'+(s?.key==="done"?" is-done":"")+(s?.key==="open"?" is-open":"")+'">'
  +'<div class="event-content"><div>'
  +(s?'<div class="chip-row">'+statusChip(e)+'</div>':"")
  +'<div class="event-meta">'+potential+'<span>'+escapeText(e.category||"Event")+'</span><span class="separator"></span><span>'+escapeText(e.area||"Miami")+'</span></div>'
  +'<h3><button type="button" class="title-link" data-event="'+escapeText(e.id)+'">'+escapeText(e.title)+'</button></h3>'
  +'<div class="venue">'+escapeText(e.venue)+(e.start?' · Starts '+escapeText(clock(e.start)):'')+(e.date_end && e.date_end!==e.date?' · Through '+escapeText(shortDate(e.date_end)):'')+'</div></div>'
  +'<div class="pickup-block"><div class="field-label">Suggested pickup window</div><div class="pickup-time">'+escapeText(e.window||"Not available")+'</div><div class="pickup-note">'+escapeText(note)+'</div></div></div>'
  +'<div class="card-foot"><div class="end-line">Official end: <strong>'+escapeText(endText(e))+'</strong></div>'
  +'<div class="card-actions"><a href="'+escapeText(wazeURL(e))+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+escapeText(e.venue)+' in Waze">Waze ↗</a>'
  +'<a href="'+escapeText(mapURL(e))+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+escapeText(e.venue)+' in Google Maps">Maps ↗</a>'
  +'<button type="button" data-event="'+escapeText(e.id)+'">Details →</button></div></div></article>';
}
function emptyState(title,description,action=""){
 return '<div class="empty-state"><h3>'+escapeText(title)+'</h3><p>'+escapeText(description)+'</p>'+action+'</div>';
}
function compactCard(e){
 return '<button type="button" class="compact-item'+(isHigh(e)?" is-high":"")+'" data-event="'+escapeText(e.id)+'"><span class="compact-date"><b>'+escapeText(weekday(e.date))+'</b>'+escapeText(shortDate(e.date))+'</span><span class="compact-text"><span class="compact-title">'+escapeText(e.title)+'</span><span class="compact-sub">'+escapeText(e.venue)+' · '+escapeText(e.window||"Pickup time unknown")+'</span></span><span class="compact-arrow" aria-hidden="true">›</span></button>';
}
function renderNextUp(){
 const box = $("#nextUp");
 const next = events.filter(e=>e._win && e._win.end>now).sort((a,b)=>a._win.start-b._win.start||Number(isHigh(b))-Number(isHigh(a)));
 const open = next.filter(e=>e._win.start<=now);
 const e = open[0]||next[0];
 if(!e){box.hidden = true;return}
 const isOpen = e._win.start <= now;
 const sameDay = Math.abs(e._win.start-now) < 20*3600000;
 const headline = isOpen ? "Pickup window open now" : sameDay ? "Next pickup in "+duration(e._win.start-now) : "Next pickup "+fullDate(e.date);
 const more = isOpen && open.length>1 ? '<span class="next-more">+'+(open.length-1)+' more open now</span>' : "";
 box.innerHTML = '<div class="next-label">'+(isOpen?'<i class="pulse" aria-hidden="true"></i>':"")+escapeText(headline)+more+'</div>'
  +'<div class="next-body"><div class="next-main"><h2>'+escapeText(e.title)+'</h2><p>'+escapeText(e.venue)+' · '+escapeText(e.area||"Miami")+'</p></div>'
  +'<div class="next-window"><span>'+escapeText(timeOf(e._win.start))+' – '+escapeText(timeOf(e._win.end))+'</span><small>'+escapeText(isOpen?"Closes in "+duration(e._win.end-now):e.window_type||"Planning estimate")+'</small></div></div>'
  +'<div class="next-actions"><a class="btn btn-solid" href="'+escapeText(wazeURL(e))+'" target="_blank" rel="noopener noreferrer">Navigate with Waze</a><a class="btn" href="'+escapeText(mapURL(e))+'" target="_blank" rel="noopener noreferrer">Google Maps</a><button class="btn" type="button" data-event="'+escapeText(e.id)+'">Details</button></div>';
 box.classList.toggle("is-open",isOpen);
 box.hidden = false;
}
// Horizontal plan of tonight's pickup windows so overlapping or back-to-back pickups are easy to spot
function renderTimeline(list){
 const box = $("#timeline");
 const items = list.filter(e=>e._win && e._win.end>now-2*3600000 && e._win.start<now+24*3600000);
 if(items.length < 2){box.hidden = true;return}
 const hour = 3600000;
 const earliest = Math.min(...items.map(e=>e._win.start));
 const from = Math.floor(Math.min(earliest-hour, now<earliest && earliest-now<3*hour ? now : Infinity)/hour)*hour;
 const to = Math.ceil(Math.max(...items.map(e=>e._win.end))/hour)*hour + hour;
 const span = to-from, pct = t => ((t-from)/span*100).toFixed(2)+"%";
 const step = Math.max(1,Math.ceil(span/hour/5));
 let ticks = "";
 for(let t=from+hour*step;t<to;t+=hour*step) ticks += '<span class="tick" style="left:'+pct(t)+'">'+escapeText(hourOf(t))+'</span>';
 const rows = byWindow(items).map(e=>{
  const s = status(e);
  return '<button type="button" class="tl-row" data-event="'+escapeText(e.id)+'"><span class="tl-name">'+escapeText(e.title)+'</span><span class="tl-track"><span class="tl-bar tl-'+(s?.key||"later")+(isHigh(e)?" tl-high":"")+'" style="left:'+pct(e._win.start)+';width:'+pct(from+e._win.end-e._win.start)+'"><span class="sr-only">'+escapeText(e.window)+'</span></span></span></button>';
 }).join("");
 const nowLine = now>=from && now<=to ? '<span class="tl-now" style="left:'+pct(now)+'"><span>Now</span></span>' : "";
 box.innerHTML = '<div class="section-heading"><h2>Tonight’s pickup windows</h2><span class="tl-legend"><i class="tl-key tl-high"></i>High potential</span></div>'
  +'<div class="tl-card"><div class="tl-grid"><div class="tl-axis"><span class="tl-name"></span><span class="tl-track">'+ticks+'</span></div>'+rows
  +'<div class="tl-overlay"><span class="tl-name"></span><span class="tl-track">'+nowLine+'</span></div></div></div>';
 box.hidden = false;
}
function renderToday(){
 const same = byWindow(events.filter(onToday));
 const next = sorted(events.filter(e=>e.date>today && e.date<=nextDate(today,7)));
 const live = same.filter(e=>status(e)?.key!=="done").length;
 $("#todayDate").textContent = fullDate(today)+" · Miami";
 $("#todayCount").textContent = !same.length ? "No tracked events today" : same.length+(same.length===1?" tracked event":" tracked events")+" today"+(live<same.length?" · "+live+" still ahead":"");
 renderNextUp();
 renderTimeline(same);
 $("#todayEvents").innerHTML = same.length ? same.map(eventCard).join("") : emptyState("Nothing tracked for today","No major events are listed in the current feed for today. This isn't a complete city calendar.");
 $("#nextPreview").innerHTML = next.length ? next.slice(0,5).map(compactCard).join("") : emptyState("Nothing upcoming in this feed","Check the full calendar or refresh the listings.");
 $("#previewTitle").textContent = next.some(e=>active(e,nextDate(today,1))) ? "Tomorrow & this week" : "Coming up this week";
}
function buildFilters(){
 for(const [selector,key,allLabel] of [["#areaFilter","area","All areas"],["#categoryFilter","category","All types"]]){
  const sel = $(selector), prior = sel.value, values = [...new Set(events.map(e=>e[key]).filter(Boolean))].sort();
  sel.innerHTML = '<option value="all">'+allLabel+'</option>'+values.map(x=>'<option value="'+escapeText(x)+'">'+escapeText(x)+'</option>').join("");
  sel.value = values.includes(prior)?prior:"all";
 }
 area = $("#areaFilter").value; category = $("#categoryFilter").value;
}
function renderUpcoming(){
 const max = range==="7"?nextDate(today,6):range==="30"?nextDate(today,29):"9999-12-31";
 const matching = filtered(events.filter(e=>e.date<=max));
 const filtersOn = searchTerm||area!=="all"||category!=="all"||highOnly;
 $("#resultsLabel").textContent = matching.length+(matching.length===1?" event":" events")+" found";
 if(!matching.length){
  $("#upcomingEvents").innerHTML = emptyState("No matching events","Try a different date range, neighborhood, or search.",filtersOn?'<button type="button" class="btn" id="clearFilters">Clear filters</button>':"");
  return;
 }
 const group = new Map();
 matching.forEach(e=>{const key = e.date<today?today:e.date; if(!group.has(key))group.set(key,[]);group.get(key).push(e)});
 $("#upcomingEvents").innerHTML = [...group].map(([day,items])=>'<div class="date-group"><div class="date-group-header"><h2>'+escapeText(day===today?"Today · "+fullDate(day):day===nextDate(today,1)?"Tomorrow · "+fullDate(day):fullDate(day))+'</h2><span class="group-line"></span><span class="group-count">'+items.length+'</span></div><div class="event-stack">'+items.map(eventCard).join("")+'</div></div>').join("");
}
function monthMove(by){
 monthIndex += by;
 if(monthIndex<0){monthIndex = 11;monthYear--}
 if(monthIndex>11){monthIndex = 0;monthYear++}
 renderCalendar();
}
function renderCalendar(){
 $("#monthTitle").textContent = new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(new Date(monthYear,monthIndex,1));
 const startWeekday = new Date(Date.UTC(monthYear,monthIndex,1)).getUTCDay();
 const monthDays = new Date(Date.UTC(monthYear,monthIndex+1,0)).getUTCDate();
 const total = Math.ceil((startWeekday+monthDays)/7)*7;
 const monthKey = monthYear+"-"+String(monthIndex+1).padStart(2,"0");
 let buttons = "";
 for(let i=0;i<total;i++){
  const iso = new Date(Date.UTC(monthYear,monthIndex,i-startWeekday+1)).toISOString().slice(0,10);
  const num = Number(iso.slice(8));
  const dayEvents = events.filter(e=>active(e,iso));
  const count = dayEvents.length, high = dayEvents.filter(isHigh).length;
  const selected = iso===selectedDate, current = iso===today, past = iso<today;
  const dots = count ? '<i class="day-dot'+(high?"":" dim")+'"></i>'+(count>1?'<i class="day-dot'+(high>1?"":" dim")+'"></i>':"")+(count>2?'<span class="day-more">+'+(count-2)+'</span>':"") : "";
  buttons += '<button type="button" class="'+(iso.slice(0,7)!==monthKey?"other-month ":"")+(past?"past ":"")+(count?"has-events ":"")+(selected?"selected ":"")+(current?"today ":"")+'" data-day="'+iso+'" aria-label="'+escapeText(fullDate(iso)+", "+count+" tracked events")+'" aria-pressed="'+selected+'"><span class="day-number">'+num+'</span><span class="day-dots" aria-hidden="true">'+dots+'</span></button>';
 }
 $("#monthGrid").innerHTML = buttons;
 renderCalendarDay();
}
function renderCalendarDay(){
 const matching = sorted(events.filter(e=>active(e,selectedDate)));
 $("#selectedDayTitle").textContent = (selectedDate===today?"Today · ":"")+fullDate(selectedDate);
 $("#selectedDayEvents").innerHTML = matching.length ? matching.map(eventCard).join("") : emptyState("No tracked events","There are no events in the current feed for this date.");
}
function render(){renderToday();renderUpcoming();renderCalendar();updateDate();}

// ---------- Navigation ----------
const VIEWS = ["today","upcoming","calendar"];
function navigate(view,{push=true}={}){
 if(!VIEWS.includes(view)) view = "today";
 const changed = view!==currentView;
 currentView = view;
 $$(".view").forEach(v=>v.hidden = v.id!==view+"View");
 $$("[data-view]").forEach(b=>{const on = b.dataset.view===view;b.classList.toggle("active",on);if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
 if(push && location.hash.slice(1)!==view) history.pushState(null,"","#"+view);
 if(changed) window.scrollTo({top:0,behavior:"instant"});
}
// #today, #upcoming, #calendar, or a shared link like #event=some-id
function route(){
 const hash = location.hash.slice(1);
 if(!hash.startsWith("event=")){navigate(hash||"today",{push:false});return}
 const id = decodeURIComponent(hash.slice(6));
 history.replaceState(null,"","#"+currentView);
 navigate(currentView,{push:false});
 if(events.length) showDetail(id); else pendingEventId = id;
}
window.addEventListener("popstate",route);

// ---------- Event details ----------
let detailEvent = null;
function showDetail(id){
 const e = events.find(item=>item.id===id);if(!e)return;
 detailEvent = e;
 const s = status(e);
 $("#detailTag").textContent = (e.category||"Event")+" · "+(e.area||"Miami");
 $("#detailTitle").textContent = e.title;
 $("#detailMeta").textContent = fullDate(e.date)+(e.date_end && e.date_end!==e.date?" to "+shortDate(e.date_end):"")+" · "+e.venue;
 $("#detailStatus").innerHTML = s ? '<div class="chip-row">'+statusChip(e)+'</div>' : "";
 $("#detailWindow").textContent = e.window||"Not available";
 $("#detailWindowNote").textContent = e.window_type||"Planning estimate";
 $("#detailStart").textContent = clock(e.start);
 $("#detailEnd").textContent = endText(e);
 $("#detailAddress").textContent = place(e);
 $("#detailNotes").textContent = e.note||"Check the official event page for details before traveling.";
 $("#detailDirections").href = mapURL(e);
 $("#detailWaze").href = wazeURL(e);
 $("#detailSource").href = officialURL(e);
 $("#detailCalendar").textContent = e._win ? "Add pickup to calendar" : "Add event to calendar";
 const dialog = $("#detailDialog");if(!dialog.open)dialog.showModal();
}
const icsText = x => String(x||"").replace(/\\/g,"\\\\").replace(/[,;]/g,m=>"\\"+m).replace(/\r?\n/g,"\\n");
const icsStamp = ms => new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
function downloadCalendar(e){
 let when;
 if(e._win) when = "DTSTART:"+icsStamp(e._win.start-15*60000)+"\r\nDTEND:"+icsStamp(e._win.end);
 else if(/^\d{2}:\d{2}$/.test(e.start||"")){const s = miamiTime(e.date,Number(e.start.slice(0,2))*60+Number(e.start.slice(3)));when = "DTSTART:"+icsStamp(s)+"\r\nDTEND:"+icsStamp(s+3*3600000)}
 else when = "DTSTART;VALUE=DATE:"+e.date.replace(/-/g,"")+"\r\nDTEND;VALUE=DATE:"+nextDate(e.date_end||e.date,1).replace(/-/g,"");
 const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Miami Ride Radar//EN","BEGIN:VEVENT",
  "UID:"+e.id+"@miami-ride-radar","DTSTAMP:"+icsStamp(Date.now()),when,
  "SUMMARY:"+icsText((e._win?"Pickup: ":"")+e.title),"LOCATION:"+icsText(place(e)),
  "DESCRIPTION:"+icsText("Suggested pickup window: "+(e.window||"n/a")+" ("+(e.window_type||"planning estimate")+").\n"+(e.note||"")+"\n"+officialURL(e)),
  "BEGIN:VALARM","TRIGGER:-PT30M","ACTION:DISPLAY","DESCRIPTION:"+icsText("Head toward "+e.venue),"END:VALARM",
  "END:VEVENT","END:VCALENDAR"].join("\r\n");
 const a = document.createElement("a");
 a.href = URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));
 a.download = e.id+".ics";
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
async function shareEvent(e){
 const url = location.href.split("#")[0]+"#event="+encodeURIComponent(e.id);
 const text = e.title+" · "+fullDate(e.date)+" · "+e.venue+". Pickup window: "+(e.window||"n/a");
 try{
  if(navigator.share){await navigator.share({title:e.title,text,url});return}
  await navigator.clipboard.writeText(text+"\n"+url);
  toast("Link copied");
 }catch(err){if(err?.name!=="AbortError")toast("Couldn't share this event")}
}
let toastTimer;
function toast(message){
 let el = $("#toast");
 if(!el){el = document.createElement("div");el.id = "toast";el.className = "toast";el.setAttribute("role","status");document.body.appendChild(el)}
 el.textContent = message;el.classList.add("show");
 clearTimeout(toastTimer);toastTimer = setTimeout(()=>el.classList.remove("show"),2200);
}

// ---------- Theme ----------
function setTheme(value,save=true){
 document.documentElement.dataset.theme = value;
 $("#themeToggle").textContent = value==="dark"?"☀":"◐";
 $("#themeToggle").setAttribute("aria-label",value==="dark"?"Switch to light mode":"Switch to dark mode");
 $("#themeToggle").title = value==="dark"?"Light mode":"Dark mode";
 $('meta[name="theme-color"]').content = value==="dark"?"#111719":"#f6f6f3";
 if(save) try{localStorage.setItem("ride-radar-theme",value)}catch{}
}
setTheme(document.documentElement.dataset.theme==="dark"?"dark":"light",false);

// ---------- Wiring ----------
$("#themeToggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
$("#refreshButton").addEventListener("click",load);
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
$$("[data-range]").forEach(b=>b.addEventListener("click",()=>{range = b.dataset.range;$$("[data-range]").forEach(x=>{x.classList.toggle("active",x.dataset.range===range);x.setAttribute("aria-pressed",x.dataset.range===range)});renderUpcoming()}));
$("#highOnly").addEventListener("click",e=>{highOnly = !highOnly;e.currentTarget.setAttribute("aria-pressed",highOnly);e.currentTarget.classList.toggle("active",highOnly);renderUpcoming()});
$("#searchEvents").addEventListener("input",e=>{searchTerm = e.target.value.trim().toLowerCase();renderUpcoming()});
$("#areaFilter").addEventListener("change",e=>{area = e.target.value;renderUpcoming()});
$("#categoryFilter").addEventListener("change",e=>{category = e.target.value;renderUpcoming()});
$("#upcomingEvents").addEventListener("click",e=>{
 if(!e.target.closest("#clearFilters"))return;
 searchTerm = "";area = "all";category = "all";highOnly = false;
 $("#searchEvents").value = "";$("#areaFilter").value = "all";$("#categoryFilter").value = "all";
 $("#highOnly").classList.remove("active");$("#highOnly").setAttribute("aria-pressed","false");
 renderUpcoming();
});
$("#prevMonth").addEventListener("click",()=>monthMove(-1));
$("#nextMonth").addEventListener("click",()=>monthMove(1));
$("#jumpToday").addEventListener("click",()=>{monthYear = Number(today.slice(0,4));monthIndex = Number(today.slice(5,7))-1;selectedDate = today;renderCalendar()});
$("#monthGrid").addEventListener("click",e=>{const button = e.target.closest("[data-day]");if(!button)return;selectedDate = button.dataset.day;const m = selectedDate.slice(0,7).split("-");monthYear = Number(m[0]);monthIndex = Number(m[1])-1;renderCalendar();$('[data-day="'+selectedDate+'"]')?.focus()});
document.addEventListener("click",e=>{const target = e.target.closest("[data-event]");if(target)showDetail(target.dataset.event)});
$("#detailClose").addEventListener("click",()=>$("#detailDialog").close());
$("#detailDialog").addEventListener("click",e=>{if(e.target===$("#detailDialog"))$("#detailDialog").close()});
$("#detailCalendar").addEventListener("click",()=>detailEvent&&downloadCalendar(detailEvent));
$("#detailShare").addEventListener("click",()=>detailEvent&&shareEvent(detailEvent));
$("#openCalendar").addEventListener("click",()=>navigate("calendar"));
$("#openUpcoming").addEventListener("click",()=>navigate("upcoming"));

// Keep countdowns and statuses live; roll over to the new day after midnight
function tick(){
 now = Date.now();
 const day = getMiamiToday();
 if(day!==today){today = day;selectedDate = day;render();return}
 renderToday();
}
setInterval(tick,30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick()});

async function load(){
 $("#refreshButton").disabled = true;
 $("#refreshButton").setAttribute("aria-label","Refreshing events");
 $("#refreshButton").classList.add("spinning");
 try{
  const response = await fetch("./events.json?t="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw new Error("Could not load events");
  const payload = await response.json();
  if(!Array.isArray(payload.events))throw new Error("Invalid events feed");
  now = Date.now();today = getMiamiToday();
  events = sorted(payload.events.filter(e=>e.date && e.title).map(e=>({...e,_win:parseWindow(e)})).filter(current));
  updatedAt = payload.updated_at||"";
  buildFilters();render();
  $("#feedNotice").hidden = true;
  if(pendingEventId){showDetail(pendingEventId);pendingEventId = ""}
 }catch(e){
  if(!events.length){$("#todayEvents").innerHTML = emptyState("Events temporarily unavailable","Could not load the calendar. Tap refresh to try again.");$("#nextPreview").innerHTML = "";$("#upcomingEvents").innerHTML = "";$("#selectedDayEvents").innerHTML = ""}
  $("#feedNotice").textContent = "Event feed could not be refreshed. Check your connection and try again.";
  $("#feedNotice").hidden = false;
 }finally{
  $("#refreshButton").disabled = false;$("#refreshButton").setAttribute("aria-label","Refresh events");
  setTimeout(()=>$("#refreshButton").classList.remove("spinning"),400);
 }
}
$("#todayDate").textContent = fullDate(today)+" · Miami";
route();
load();
})();
