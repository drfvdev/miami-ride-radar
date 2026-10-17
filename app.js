(() => {
"use strict";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const TZ = "America/New_York";
const HOUR = 3600000;
const STALE_AFTER_HOURS = 48;
let events = [], updatedAt = "", currentView = "", range = "7", selectedDate, monthYear, monthIndex;
let searchTerm = "", area = "all", category = "all", highOnly = false, pendingEventId = "";
let now = Date.now();

// ---------- Miami dates and times ----------
const miamiDate = ms => {
  const parts = new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));
  const z = Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return z.year+"-"+z.month+"-"+z.day;
};
let today = miamiDate(Date.now());
selectedDate = today;
monthYear = Number(today.slice(0,4));
monthIndex = Number(today.slice(5,7))-1;
const nextDate = (iso,days) => {const t = new Date(iso+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+days);return t.toISOString().slice(0,10)};
const dayOfWeek = iso => new Date(iso+"T12:00:00Z").getUTCDay();
const dateFmt = (d,opt={}) => new Intl.DateTimeFormat("en-US",{timeZone:"UTC",...opt}).format(new Date(d+"T12:00:00Z"));
const fullDate = d => dateFmt(d,{weekday:"long",month:"long",day:"numeric"});
const mediumDate = d => dateFmt(d,{weekday:"short",month:"short",day:"numeric"});
const shortDate = d => dateFmt(d,{month:"short",day:"numeric"});
const weekday = d => dateFmt(d,{weekday:"short"});
const timeOf = ms => new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"}).format(new Date(ms));
const hourOf = ms => new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric"}).format(new Date(ms)).replace(" ","").toLowerCase();
const relativeDay = d => d===today ? "Today" : d===nextDate(today,1) ? "Tomorrow" : weekday(d);
// Miami's UTC offset (minutes) on a calendar day, so times stay right across daylight saving changes
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
const hhmm = s => /^\d{2}:\d{2}$/.test(s||"") ? Number(s.slice(0,2))*60+Number(s.slice(3)) : null;
const duration = ms => {
  const mins = Math.max(1,Math.round(ms/60000));
  if(mins < 60) return mins+" min";
  const h = Math.floor(mins/60), m = mins%60;
  return h+"h"+(m?" "+m+"m":"");
};

// ---------- Pickup windows ----------
// Reads "10:15–11:45 PM" or "10:30 PM–12:15 AM" into timestamps. Optional window_start / window_end ("22:15") win if present.
const toMinutes = (h,m,ap) => (Number(h)%12 + (ap==="PM"?12:0))*60 + Number(m);
function parseWindow(e){
  let start, end;
  if(hhmm(e.window_start)!==null && hhmm(e.window_end)!==null){start = hhmm(e.window_start);end = hhmm(e.window_end)}
  else{
    const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(e.window||"");
    if(!m) return null;
    const ap2 = m[6].toUpperCase(), ap1 = (m[3]||ap2).toUpperCase();
    start = toMinutes(m[1],m[2],ap1);end = toMinutes(m[4],m[5],ap2);
  }
  // An early-morning window for an evening event belongs to the following night
  const eventStart = hhmm(e.start);
  if(eventStart!==null && start < eventStart-60){start += 1440;end += 1440}
  if(end <= start) end += 1440;
  return {start:miamiTime(e.date,start), end:miamiTime(e.date,end)};
}
function windowText(e){
  const w = e._win;
  if(!w) return {time:e.window||"Not available", day:"", text:true};
  const a = timeOf(w.start), b = timeOf(w.end);
  const time = a.slice(-2)===b.slice(-2) ? a.slice(0,-3)+"–"+b : a+" – "+b;
  const startDay = miamiDate(w.start);
  return {time, day:startDay!==e.date ? weekday(startDay) : "", text:false};
}
function status(e){
  const w = e._win;
  if(!w) return null;
  if(now >= w.end) return {key:"done", label:"Pickup window passed"};
  if(now >= w.start) return {key:"open", label:"Open now · "+duration(w.end-now)+" left"};
  if(w.start-now < 18*HOUR) return {key:"soon", label:"Starts in "+duration(w.start-now)};
  return null;
}
const windowLabel = e => /rough/i.test(e.window_type||"") ? "Pickup window · rough estimate" : "Pickup window · estimate";
const statusLine = e => {const s = status(e);return s ? '<p class="status s-'+s.key+'">'+(s.key==="open"?'<i class="dot" aria-hidden="true"></i>':"")+esc(s.label)+'</p>' : ""};

// ---------- Event helpers ----------
const esc = x => String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clock = s => {const v = hhmm(s);if(v===null)return "";const h = Math.floor(v/60), m = v%60;return (h%12||12)+":"+String(m).padStart(2,"0")+" "+(h>=12?"PM":"AM")};
const active = (e,d) => e.date <= d && (e.date_end||e.date) >= d;
// Still relevant: on today's calendar or later, or last night's event whose pickup window hasn't closed
const current = e => (e.date_end||e.date) >= today || (e._win && e._win.end > now);
const onToday = e => active(e,today) || (e.date < today && e._win && e._win.end > now);
const isHigh = e => e.priority === "High";
const endHTML = e => e.end_verified && clock(e.end)
  ? esc(clock(e.end))+(e.end_date && e.end_date!==e.date ? " "+esc(weekday(e.end_date)) : "")+'<span class="official">Official</span>'
  : '<span class="unpublished">Not published</span>';
const endPlain = e => e.end_verified && clock(e.end) ? clock(e.end)+(e.end_date && e.end_date!==e.date ? " "+weekday(e.end_date) : "")+" (official)" : "Not published";
const place = e => e.address||e.venue||"Miami, FL";
const mapURL = e => "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(place(e));
const wazeURL = e => "https://waze.com/ul?navigate=yes&q="+encodeURIComponent(place(e));
const officialURL = e => /^https:\/\//i.test(e.source||"") ? e.source : "https://www.google.com/search?q="+encodeURIComponent(e.title+" "+e.venue);
const sorted = arr => [...arr].sort((a,b)=>a.date.localeCompare(b.date)||(a.start||"99:99").localeCompare(b.start||"99:99")||Number(isHigh(b))-Number(isHigh(a)));
// Today: open windows first, then soonest, passed windows last
const byWindow = arr => [...arr].sort((a,b)=>{
  const da = status(a)?.key==="done", db = status(b)?.key==="done";
  if(da !== db) return da ? 1 : -1;
  return (a._win?.start ?? Infinity)-(b._win?.start ?? Infinity) || Number(isHigh(b))-Number(isHigh(a));
});
const filtered = arr => sorted(arr.filter(e => (area==="all"||e.area===area)&&(category==="all"||e.category===category)&&(!highOnly||isHigh(e))&&(!searchTerm||[e.title,e.venue,e.area,e.category,e.address].join(" ").toLowerCase().includes(searchTerm))));
const plural = (n,word) => n+" "+word+(n===1?"":"s");

// ---------- Building blocks ----------
// App icons drawn after the Waze and Google Maps logos so drivers recognize them at a glance
const WAZE_ICON = '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 3.6c-4.6 0-8 3.1-8 7.3 0 1.3.3 2.4.9 3.3-.5 1-1.4 1.7-2.5 2 .9.9 2.5 1.4 4 1.1 1.3.9 3 1.4 4.8 1.4h1.1c4.6-.2 7.6-3.3 7.6-7.5 0-4.4-3.4-7.6-7.9-7.6z" fill="#fff" stroke="#0b0b0b" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="9.6" r="1.05" fill="#0b0b0b"/><circle cx="15" cy="9.6" r="1.05" fill="#0b0b0b"/><path d="M9.4 12.4c.8 1.2 1.9 1.8 3.1 1.8s2.3-.6 3.1-1.8" fill="none" stroke="#0b0b0b" stroke-width="1.4" stroke-linecap="round"/><circle cx="8.3" cy="19.4" r="2.1" fill="#0b0b0b"/><circle cx="16.3" cy="19.4" r="2.1" fill="#0b0b0b"/></svg>';
const GMAPS_ICON = '<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><g clip-path="url(#gm-pin)"><rect x="0" y="0" width="12" height="9.1" fill="#ea4335"/><rect x="12" y="0" width="12" height="9.1" fill="#4285f4"/><rect x="0" y="9.1" width="12" height="15" fill="#fbbc04"/><rect x="12" y="9.1" width="12" height="15" fill="#34a853"/></g><circle cx="12" cy="9.1" r="3.2" fill="#fff"/></svg>';
const navButtons = e =>
  '<a class="btn btn-waze" href="'+esc(wazeURL(e))+'" target="_blank" rel="noopener noreferrer" aria-label="Navigate to '+esc(e.venue)+' with Waze">'+WAZE_ICON+'Waze</a>'
  +'<a class="btn btn-gmaps" href="'+esc(mapURL(e))+'" target="_blank" rel="noopener noreferrer" aria-label="Open '+esc(e.venue)+' in Google Maps">'+GMAPS_ICON+'Google Maps</a>';
function card(e){
 const s = status(e), w = windowText(e);
 const runs = e.date_end && e.date_end!==e.date ? '<div><dt>Runs</dt><dd>'+esc(shortDate(e.date))+' – '+esc(shortDate(e.date_end))+'</dd></div>' : "";
 return '<article class="opp'+(s?" is-"+s.key:"")+'">'
  +'<div class="opp-top"><div>'+statusLine(e)
  +'<p class="opp-window'+(w.text?" is-text":"")+'">'+esc(w.time)+(w.day?'<span class="opp-day">'+esc(w.day)+'</span>':"")+'</p>'
  +'<p class="opp-sub">'+esc(windowLabel(e))+'</p></div>'
  +(isHigh(e)?'<span class="level level-high">High</span>':e.priority?'<span class="level">'+esc(e.priority)+'</span>':"")+'</div>'
  +'<h3><button type="button" class="title-link" data-event="'+esc(e.id)+'">'+esc(e.title)+'</button></h3>'
  +'<p class="opp-place">'+esc(e.venue)+' · '+esc(e.area||"Miami")+'</p>'
  +'<dl class="facts"><div><dt>Starts</dt><dd>'+(clock(e.start)?esc(clock(e.start)):'<span class="unpublished">Not published</span>')+'</dd></div><div><dt>Ends</dt><dd>'+endHTML(e)+'</dd></div>'+runs+'</dl>'
  +'<div class="actions">'+navButtons(e)
  +'<button type="button" class="btn btn-more" data-event="'+esc(e.id)+'" aria-label="Details for '+esc(e.title)+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button></div></article>';
}
function row(e,showDate=true){
 const w = windowText(e);
 const d = e.date<today ? today : e.date;
 return '<button type="button" class="row'+(showDate?"":" no-date")+'" data-event="'+esc(e.id)+'">'
  +(showDate?'<span class="row-date"><b>'+esc(weekday(d))+'</b><span>'+Number(d.slice(8))+'</span></span>':"")
  +'<span><span class="row-title">'+esc(e.title)+'</span><span class="row-sub">'+(isHigh(e)?'<span class="hi">High</span> · ':"")+esc(e.venue)+'</span></span>'
  +'<span class="row-time">'+(w.text?'<small>Daytime</small>':'<b>'+esc(w.time)+'</b>'+(w.day?'<small>'+esc(w.day)+'</small>':""))+'</span></button>';
}
const list = (items,showDate=true) => '<div class="list">'+items.map(e=>row(e,showDate)).join("")+'</div>';
const groupHead = (title,meta="") => '<div class="group-h"><h2>'+esc(title)+'</h2><span>'+esc(meta)+'</span></div>';
const empty = (title,text,action="") => '<div class="empty"><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p>'+action+'</div>';

// ---------- Today ----------
function renderToday(){
 const items = byWindow(events.filter(onToday));
 const ahead = items.filter(e=>status(e)?.key!=="done").length;
 $("#todayDate").textContent = fullDate(today);
 $("#todayCount").textContent = !items.length ? "" : plural(items.length,"event")+(ahead<items.length?", "+ahead+" still ahead":"");
 if(items.length) $("#todayEvents").innerHTML = items.map(card).join("");
 else{
  const next = sorted(events.filter(e=>e.date>today))[0];
  $("#todayEvents").innerHTML = empty("No major events tracked today","This feed lists large events only, so it isn't a complete city calendar."+(next?" The next one is below.":""))
   +(next?'<div style="margin-top:12px">'+list([next])+'</div>':"");
 }
 renderTimeline(items);
 renderAhead();
}
// Tomorrow, then this week / weekend buckets up to 7 days out, then the next few later events
function renderAhead(){
 const groups = [];
 const tomorrow = nextDate(today,1);
 const tItems = sorted(events.filter(e=>e.date===tomorrow));
 if(tItems.length) groups.push({title:"Tomorrow", meta:fullDate(tomorrow), items:tItems, showDate:false});
 const base = dayOfWeek(today)===0 ? tomorrow : today;  // on Sunday, "this week" means the week starting tomorrow
 const mondayOf = d => nextDate(d,-((dayOfWeek(d)+6)%7));
 const thisMonday = mondayOf(base);
 for(let i=2;i<=7;i++){
  const d = nextDate(today,i), dow = dayOfWeek(d), weekend = dow===0||dow===5||dow===6;
  const sameWeek = mondayOf(d)===thisMonday;
  const title = weekend ? (sameWeek?"This weekend":"Next weekend") : (sameWeek?"This week":"Next week");
  const dayItems = sorted(events.filter(e=>e.date===d));
  if(!dayItems.length) continue;
  let g = groups[groups.length-1];
  if(!g || g.title!==title){g = {title, items:[], showDate:true, from:d};groups.push(g)}
  g.items.push(...dayItems);g.to = d;
 }
 groups.forEach(g=>{if(g.from) g.meta = g.from===g.to ? mediumDate(g.from) : shortDate(g.from)+" – "+shortDate(g.to)});
 const later = sorted(events.filter(e=>e.date>nextDate(today,7))).slice(0,3);
 if(later.length) groups.push({title:"Later", meta:"Next "+plural(later.length,"event"), items:later, showDate:true});
 $("#ahead").innerHTML = groups.length
  ? groups.map(g=>groupHead(g.title,g.meta)+list(g.items,g.showDate)).join("")
  : groupHead("Coming up")+empty("Nothing else in the feed","Tap refresh later, or check the calendar.");
}
// One time axis for today's pickup windows, so overlapping or back-to-back pickups stand out
function renderTimeline(items){
 const box = $("#timeline");
 const withWin = items.filter(e=>e._win && e._win.end>now-2*HOUR && e._win.start<now+24*HOUR);
 if(withWin.length < 2){box.hidden = true;box.innerHTML = "";return}
 const earliest = Math.min(...withWin.map(e=>e._win.start));
 const from = Math.floor(Math.min(earliest-HOUR, now<earliest && earliest-now<3*HOUR ? now : Infinity)/HOUR)*HOUR;
 const to = Math.ceil(Math.max(...withWin.map(e=>e._win.end))/HOUR)*HOUR + HOUR;
 const span = to-from, pct = t => ((t-from)/span*100).toFixed(2)+"%";
 const step = Math.max(1,Math.ceil(span/HOUR/5));
 let ticks = "";
 for(let t=from+HOUR*step;t<to;t+=HOUR*step) ticks += '<span class="tick" style="left:'+pct(t)+'">'+esc(hourOf(t))+'</span>';
 const rows = byWindow(withWin).map(e=>{
  const s = status(e);
  return '<button type="button" class="tl-row" data-event="'+esc(e.id)+'"><span class="tl-name">'+esc(e.title)+'</span><span class="tl-track"><span class="tl-bar'+(isHigh(e)?" is-high":"")+(s?" is-"+s.key:"")+'" style="left:'+pct(e._win.start)+';width:'+pct(from+e._win.end-e._win.start)+'"><span class="sr-only">'+esc(windowText(e).time)+'</span></span></span></button>';
 }).join("");
 const nowLine = now>=from && now<=to ? '<span class="tl-now" style="left:'+pct(now)+'"><span>Now</span></span>' : "";
 box.innerHTML = groupHead("Pickup windows at a glance")
  +'<div class="tl"><div class="tl-axis"><span></span><span class="tl-track">'+ticks+'</span></div>'+rows
  +'<div class="tl-overlay"><span></span><span class="tl-track">'+nowLine+'</span></div></div>';
 box.hidden = false;
}

// ---------- Upcoming ----------
function buildFilters(){
 for(const [selector,key,allLabel] of [["#areaFilter","area","All areas"],["#categoryFilter","category","All types"]]){
  const sel = $(selector), prior = sel.value, values = [...new Set(events.map(e=>e[key]).filter(Boolean))].sort();
  sel.innerHTML = '<option value="all">'+allLabel+'</option>'+values.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
  sel.value = values.includes(prior)?prior:"all";
 }
 area = $("#areaFilter").value;category = $("#categoryFilter").value;
}
function renderUpcoming(){
 const max = range==="7"?nextDate(today,6):range==="30"?nextDate(today,29):"9999-12-31";
 const matching = filtered(events.filter(e=>e.date<=max));
 const filtersOn = searchTerm||area!=="all"||category!=="all"||highOnly;
 $("#resultsLabel").textContent = plural(matching.length,"event")+(range==="all"?"":" in the next "+range+" days");
 if(!matching.length){
  $("#upcomingEvents").innerHTML = empty("No matching events","Try a longer date range or a different area.",filtersOn?'<button type="button" class="btn" id="clearFilters">Clear filters</button>':"");
  return;
 }
 const group = new Map();
 matching.forEach(e=>{const key = e.date<today?today:e.date;if(!group.has(key))group.set(key,[]);group.get(key).push(e)});
 $("#upcomingEvents").innerHTML = [...group].map(([day,items])=>{
  const near = day===today||day===nextDate(today,1);
  return groupHead(near?relativeDay(day):weekday(day)+", "+shortDate(day),near?mediumDate(day):"")+list(items,false);
 }).join("");
}

// ---------- Calendar ----------
function monthMove(by){
 monthIndex += by;
 if(monthIndex<0){monthIndex = 11;monthYear--}
 if(monthIndex>11){monthIndex = 0;monthYear++}
 renderCalendar();
}
function renderCalendar(){
 $("#monthTitle").textContent = new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(monthYear,monthIndex,1)));
 const startWeekday = new Date(Date.UTC(monthYear,monthIndex,1)).getUTCDay();
 const monthDays = new Date(Date.UTC(monthYear,monthIndex+1,0)).getUTCDate();
 const total = Math.ceil((startWeekday+monthDays)/7)*7;
 const monthKey = monthYear+"-"+String(monthIndex+1).padStart(2,"0");
 let buttons = "";
 for(let i=0;i<total;i++){
  const iso = new Date(Date.UTC(monthYear,monthIndex,i-startWeekday+1)).toISOString().slice(0,10);
  const dayEvents = events.filter(e=>active(e,iso));
  const count = dayEvents.length, high = dayEvents.filter(isHigh).length;
  const marks = Array.from({length:Math.min(count,3)},(_,k)=>'<i'+(k<high?' class="h"':"")+'></i>').join("");
  const cls = [iso.slice(0,7)!==monthKey&&"other", iso<today&&"past", count&&"has", iso===selectedDate&&"selected", iso===today&&"today"].filter(Boolean).join(" ");
  buttons += '<button type="button" class="'+cls+'" data-day="'+iso+'" aria-label="'+esc(fullDate(iso)+", "+plural(count,"event"))+'" aria-pressed="'+(iso===selectedDate)+'">'+Number(iso.slice(8))+'<span class="marks" aria-hidden="true">'+marks+'</span></button>';
 }
 $("#monthGrid").innerHTML = buttons;
 renderCalendarDay();
}
function renderCalendarDay(){
 const matching = sorted(events.filter(e=>active(e,selectedDate)));
 $("#selectedDayTitle").textContent = (selectedDate===today||selectedDate===nextDate(today,1)?relativeDay(selectedDate)+", ":"")+fullDate(selectedDate);
 $("#selectedDayCount").textContent = matching.length ? plural(matching.length,"event") : "";
 $("#selectedDayEvents").innerHTML = matching.length ? list(matching,false) : empty("No tracked events","Nothing in the feed for this date.");
}

// ---------- Freshness ----------
function renderFreshness(){
 const d = new Date(updatedAt);
 if(!updatedAt || Number.isNaN(d.getTime())){
  $("#footerUpdated").textContent = "Listing update time unknown.";
  showNotice("Listing update time unknown","Check official event pages before driving.");
  return;
 }
 const label = new Intl.DateTimeFormat("en-US",{timeZone:TZ,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(d);
 $("#footerUpdated").textContent = "Listings last updated "+label+".";
 const hours = (now-d.getTime())/HOUR;
 if(hours > STALE_AFTER_HOURS) showNotice("Listings may be out of date","Last updated "+label+" ("+Math.floor(hours/24)+" days ago). Confirm times on the official event pages before driving.");
 else $("#feedNotice").hidden = true;
}
function showNotice(title,text){
 $("#feedNotice").innerHTML = '<strong>'+esc(title)+'</strong>'+esc(text);
 $("#feedNotice").hidden = false;
}

function render(){renderToday();renderUpcoming();renderCalendar();renderFreshness()}

// ---------- Navigation ----------
const VIEWS = ["today","upcoming","calendar"];
function navigate(view,{push=true}={}){
 if(!VIEWS.includes(view)) view = "today";
 const changed = view!==currentView;
 currentView = view;
 $$(".view").forEach(v=>v.hidden = v.id!==view+"View");
 $$(".tabs [data-view], .tabbar [data-view]").forEach(b=>{const on = b.dataset.view===view;b.classList.toggle("active",on);if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
 if(push && location.hash.slice(1)!==view) history.pushState(null,"","#"+view);
 if(changed) window.scrollTo({top:0,behavior:"instant"});
}
// #today, #upcoming, #calendar, or a shared link like #event=some-id
function route(){
 const hash = location.hash.slice(1);
 if(!hash.startsWith("event=")){navigate(hash||"today",{push:false});return}
 const id = decodeURIComponent(hash.slice(6));
 const view = currentView||"today";
 history.replaceState(null,"","#"+view);
 navigate(view,{push:false});
 if(events.length) showDetail(id); else pendingEventId = id;
}
window.addEventListener("popstate",route);

// ---------- Detail sheet ----------
let detailEvent = null;
function showDetail(id){
 const e = events.find(item=>item.id===id);if(!e)return;
 detailEvent = e;
 const w = windowText(e);
 $("#sheetKicker").textContent = (e.category||"Event")+" · "+(e.area||"Miami");
 $("#sheetTitle").textContent = e.title;
 $("#sheetDate").textContent = fullDate(e.date)+(e.date_end && e.date_end!==e.date?" – "+fullDate(e.date_end):"");
 $("#sheetStatus").innerHTML = statusLine(e);
 $("#sheetWindow").textContent = w.time+(w.day?" "+w.day:"");
 $("#sheetWindowNote").textContent = e.window_type ? e.window_type.charAt(0).toUpperCase()+e.window_type.slice(1) : "Planning estimate";
 $("#sheetStart").textContent = clock(e.start)||"Not published";
 $("#sheetEnd").innerHTML = endHTML(e);
 $("#sheetLevel").textContent = e.priority ? e.priority : "Not rated";
 $("#sheetAddress").textContent = e.venue+(e.address?", "+e.address:"");
 $("#sheetNotes").textContent = e.note||"Check the official event page for road closures and pickup areas before driving.";
 $("#sheetNav").innerHTML = navButtons(e);
 $("#sheetSource").href = officialURL(e);
 const sheet = $("#sheet");if(!sheet.open)sheet.showModal();
 sheet.scrollTop = 0;
}
const icsText = x => String(x||"").replace(/\\/g,"\\\\").replace(/[,;]/g,m=>"\\"+m).replace(/\r?\n/g,"\\n");
const icsStamp = ms => new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
function downloadCalendar(e){
 let when;
 if(e._win) when = "DTSTART:"+icsStamp(e._win.start-15*60000)+"\r\nDTEND:"+icsStamp(e._win.end);
 else if(hhmm(e.start)!==null){const s = miamiTime(e.date,hhmm(e.start));when = "DTSTART:"+icsStamp(s)+"\r\nDTEND:"+icsStamp(s+3*HOUR)}
 else when = "DTSTART;VALUE=DATE:"+e.date.replace(/-/g,"")+"\r\nDTEND;VALUE=DATE:"+nextDate(e.date_end||e.date,1).replace(/-/g,"");
 const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Miami Ride Radar//EN","BEGIN:VEVENT",
  "UID:"+e.id+"@miami-ride-radar","DTSTAMP:"+icsStamp(Date.now()),when,
  "SUMMARY:"+icsText((e._win?"Pickup: ":"")+e.title),"LOCATION:"+icsText(place(e)),
  "DESCRIPTION:"+icsText("Suggested pickup window: "+(e.window||"n/a")+" ("+(e.window_type||"planning estimate")+").\nOfficial end: "+endPlain(e)+"\n"+(e.note||"")+"\n"+officialURL(e)),
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
 const w = windowText(e);
 const text = e.title+", "+mediumDate(e.date)+" at "+e.venue+". Pickup window: "+w.time+(w.day?" "+w.day:"")+".";
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
 $("#themeToggle").setAttribute("aria-label",value==="dark"?"Switch to light mode":"Switch to dark mode");
 $("#themeToggle").title = value==="dark"?"Light mode":"Dark mode";
 $('meta[name="theme-color"]').content = value==="dark"?"#0d0e10":"#f3f2ee";
 if(save) try{localStorage.setItem("ride-radar-theme",value)}catch{}
}
setTheme(document.documentElement.dataset.theme==="light"?"light":"dark",false);

// ---------- Wiring ----------
$("#themeToggle").addEventListener("click",()=>setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
$("#refreshButton").addEventListener("click",load);
document.addEventListener("click",e=>{
 const viewLink = e.target.closest("[data-view]");
 if(viewLink){e.preventDefault();navigate(viewLink.dataset.view);return}
 const target = e.target.closest("[data-event]");
 if(target) showDetail(target.dataset.event);
});
$$("[data-range]").forEach(b=>b.addEventListener("click",()=>{range = b.dataset.range;$$("[data-range]").forEach(x=>x.setAttribute("aria-pressed",x.dataset.range===range));renderUpcoming()}));
$("#highOnly").addEventListener("click",e=>{highOnly = !highOnly;e.currentTarget.setAttribute("aria-pressed",highOnly);renderUpcoming()});
$("#searchEvents").addEventListener("input",e=>{searchTerm = e.target.value.trim().toLowerCase();renderUpcoming()});
$("#areaFilter").addEventListener("change",e=>{area = e.target.value;renderUpcoming()});
$("#categoryFilter").addEventListener("change",e=>{category = e.target.value;renderUpcoming()});
$("#upcomingEvents").addEventListener("click",e=>{
 if(!e.target.closest("#clearFilters"))return;
 searchTerm = "";area = "all";category = "all";highOnly = false;
 $("#searchEvents").value = "";$("#areaFilter").value = "all";$("#categoryFilter").value = "all";
 $("#highOnly").setAttribute("aria-pressed","false");
 renderUpcoming();
});
$("#prevMonth").addEventListener("click",()=>monthMove(-1));
$("#nextMonth").addEventListener("click",()=>monthMove(1));
$("#jumpToday").addEventListener("click",()=>{monthYear = Number(today.slice(0,4));monthIndex = Number(today.slice(5,7))-1;selectedDate = today;renderCalendar()});
$("#monthGrid").addEventListener("click",e=>{
 const button = e.target.closest("[data-day]");if(!button)return;
 selectedDate = button.dataset.day;
 monthYear = Number(selectedDate.slice(0,4));monthIndex = Number(selectedDate.slice(5,7))-1;
 renderCalendar();
 $('[data-day="'+selectedDate+'"]')?.focus();
});
$("#sheetClose").addEventListener("click",()=>$("#sheet").close());
$("#sheet").addEventListener("click",e=>{if(e.target===$("#sheet"))$("#sheet").close()});
$("#sheetCalendar").addEventListener("click",()=>detailEvent&&downloadCalendar(detailEvent));
$("#sheetShare").addEventListener("click",()=>detailEvent&&shareEvent(detailEvent));

// Keep countdowns live and roll over to the new day after midnight
function tick(){
 now = Date.now();
 if(!events.length) return;
 const day = miamiDate(now);
 if(day!==today){today = day;selectedDate = day;render();return}
 renderToday();
}
setInterval(tick,30000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick()});

async function load(){
 const btn = $("#refreshButton");
 btn.disabled = true;btn.classList.add("spinning");
 try{
  const response = await fetch("./events.json?t="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw new Error("Could not load events");
  const payload = await response.json();
  if(!Array.isArray(payload.events))throw new Error("Invalid events feed");
  now = Date.now();today = miamiDate(now);
  events = sorted(payload.events.filter(e=>e.date && e.title).map(e=>({...e,_win:parseWindow(e)})).filter(current));
  updatedAt = payload.updated_at||"";
  buildFilters();render();
  if(pendingEventId){showDetail(pendingEventId);pendingEventId = ""}
 }catch(err){
  if(!events.length){
   $("#todayEvents").innerHTML = empty("Couldn't load events","Check your connection, then tap refresh.");
   $("#ahead").innerHTML = "";$("#upcomingEvents").innerHTML = "";$("#selectedDayEvents").innerHTML = "";
  }
  showNotice("Couldn't refresh listings","Showing what was loaded before. Check your connection and try again.");
 }finally{
  btn.disabled = false;
  setTimeout(()=>btn.classList.remove("spinning"),300);
 }
}
$("#todayDate").textContent = fullDate(today);
route();
load();
})();
