/* Ada: GPT-Live 1 over WebRTC with a GPT 5.6 backend and client-executed tools. Expects globals: B (bundle), $, esc, h, fmtCountdown. */
(function(){
const VS = { peer:null, ch:null, mic:null, audio:null, ready:false, mode:'table', muted:false, closeT:null, timeT:null, remote:null, pendingCalls:0, state:'idle', startedAt:0, asked:[], memo:'', memoOn:false, toolsUsed:{} };
const PT = 'America/Los_Angeles';
const nowPT = () => new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:PT});
const LUNCH = new Date('2026-09-15T12:00:00-07:00');
function minsTo(d){ return Math.round((d - new Date())/60000); }
function toMin(t){ const m=/^(\d{1,2}):(\d{2})/.exec(t||''); return m? (+m[1])*60+(+m[2]) : null; }
function nowMin(){ const [hh,mm]=nowPT().split(':').map(Number); return hh*60+mm; }
const notesKey='ada_notes';
function getNotes(){ try{ return JSON.parse(localStorage.getItem(notesKey)||'[]'); }catch{ return []; } }
function addNote(t){ const n=getNotes(); n.push({t, at:new Date().toISOString()}); try{ localStorage.setItem(notesKey, JSON.stringify(n)); }catch{} renderNotes(); return n.length; }
function renderNotes(){ const el=$('#vnotes'); if(!el) return; const n=getNotes(); el.innerHTML = n.length? '<div class="mono" style="margin:14px 0 6px">Notes Ada saved</div>'+n.slice(-8).map(x=>`<div style="font-size:13px;color:rgba(255,255,255,.8);padding:6px 0;border-top:1px solid var(--line)">${esc(x.t)}</div>`).join('') : ''; }

/* ---------- tools ---------- */
const person = p => ({ name:p.name, tier:p.tier, title:p.title, company:p.company, what:p.what, why:p.why, opener:p.opener, speaker:!!p.speaker, linkedin:p.linkedin });
const T = {
  get_time: { d:'Current Pacific time, minutes until the 12:00 lunch, what is happening now and next on George\'s timeline. Call this whenever time or the schedule matters.', p:{type:'object',properties:{}}, f(){ const tl=(B.day?.timeline||[]); const nm=nowMin(); let cur=null,next=null; for(const it of tl){ const m=toMin(it.t); if(m==null) continue; if(m<=nm) cur=it; else if(!next){ next=it; } } return { time_pt: nowPT(), date:'Tuesday 15 September 2026', minutes_until_lunch: minsTo(LUNCH), lunch:'12:00 to 13:00 PT, Gemini Room level 2, Google Bay View', leave_home_by: B.day?.leave, now: cur? {t:cur.t,h:cur.h} : null, next: next? {t:next.t,h:next.h, in_minutes: toMin(next.t)-nm} : null, mode: VS.mode }; } },
  get_schedule: { d:'George\'s full day plan: the timeline of hops with times, the route options, the evening events, and key facts (fare, weather, what to bring).', p:{type:'object',properties:{part:{type:'string',enum:['timeline','options','evening','cells','all'],description:'which part, default all'}}}, f({part='all'}={}){ const D=B.day||{}; const strip=s=>String(s||'').replace(/<[^>]+>/g,''); const out={}; if(part==='timeline'||part==='all') out.timeline=(D.timeline||[]).map(i=>({t:i.t,h:i.h,s:strip(i.s)})); if(part==='options'||part==='all') out.options=(D.options||[]).map(o=>({name:o.name,meta:o.meta,text:o.text})); if(part==='evening'||part==='all') out.evening=(D.evening||[]).map(i=>({t:i.t,h:i.h,s:strip(i.s)})); if(part==='cells'||part==='all') out.facts=(D.cells||[]).map(c=>c.k+': '+c.v); out.plan=D.plan; return out; } },
  find_people: { d:'Search the 67 lunch guests by name, company, role, industry or keyword (e.g. "investor", "insurance", "robotics", "Anthropic"). Returns up to 10 matches with why they matter and an opener line. Use tier to filter: A = must talk to, B = good, C = low priority.', p:{type:'object',properties:{query:{type:'string'},tier:{type:'string',enum:['A','B','C']},limit:{type:'integer'}}}, f({query='',tier,limit=10}={}){ const q=query.toLowerCase().split(/\s+/).filter(Boolean); let P=(B.people||[]); if(tier) P=P.filter(p=>p.tier===tier); if(q.length) P=P.map(p=>{ const hay=[p.name,p.title,p.company,p.what,p.why,p.bio].join(' ').toLowerCase(); const score=q.reduce((s,w)=>s+(hay.includes(w)?1:0),0); return [score,p]; }).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]||a[1].tier.localeCompare(b[1].tier)).map(x=>x[1]); else P=P.slice().sort((a,b)=>a.tier.localeCompare(b.tier)); return { count:P.length, people:P.slice(0,limit).map(person) }; } },
  get_person: { d:'Full record for one guest or host by name (fuzzy). Includes title, company, what they do, why they matter to George, the opener line, and for hosts the three things George can say to them.', p:{type:'object',properties:{name:{type:'string'}},required:['name']}, f({name}){ const n=String(name||'').toLowerCase(); const hst=(B.hosts||[]).find(x=>x.name.toLowerCase().includes(n)||n.includes(x.name.toLowerCase().split(' ')[0])); if(hst) return { host:true, name:hst.name, role:hst.role, notes:hst.lines, say:hst.say, links:hst.links }; const P=(B.people||[]); const hit=P.find(p=>p.name.toLowerCase()===n)||P.find(p=>p.name.toLowerCase().includes(n))||P.find(p=>n.split(' ').some(w=>w.length>2&&p.name.toLowerCase().includes(w))); return hit? person(hit) : { error:'no guest by that name', hint:'try find_people with a keyword' }; } },
  get_hosts: { d:'Both hosts, Lisa Dolan and John Werner: who they are, their sessions today, and the three things George can say to each.', p:{type:'object',properties:{}}, f(){ return (B.hosts||[]).map(x=>({name:x.name, role:x.role, notes:x.lines, say:x.say})); } },
  get_summit: { d:'The Imagination in Action summit programme for today (all stages). Filter by a time like "13:00" or a keyword like "robotics", "Lisa Dolan", "Mercor". Returns matching lines of the schedule.', p:{type:'object',properties:{query:{type:'string'}}}, f({query=''}={}){ const raw=B.summit_raw||''; const lines=raw.split('\n'); if(!query) return { lines: lines.slice(0,120) }; let q=query.toLowerCase(); const tm=/^(\d{1,2}):(\d{2})$/.exec(q.trim()); if(tm){ let hh=+tm[1]; const ap=hh>=12?'pm':'am'; hh=hh%12||12; q=hh+':'+tm[2]+' '+ap; } const out=[]; for(let i=0;i<lines.length;i++){ if(lines[i].toLowerCase().includes(q)){ out.push(lines.slice(Math.max(0,i-2),i+6).join(' | ')); if(out.length>12) break; } } return { matches: out }; } },
  get_pitch: { d:'George\'s prepared material: the 40 second intro, the 15 second version, the one line, answers to Lisa\'s three questions, the facts sheet, the 8 story beats, rules for the room, questions to ask, the follow-up email.', p:{type:'object',properties:{section:{type:'string',enum:['intro','three','facts','story','rules','ask','followup','objections','all']}}}, f({section='all'}={}){ const C=B.content||{}; const m={intro:C.intro,three:C.three,facts:C.facts,story:(C.story||[]).map(s=>({n:s.n,title:s.title,line:s.line})),rules:C.rules,ask:C.ask,followup:C.followup,objections:C.objections}; return section==='all'? m : {[section]: m[section]}; } },
  get_drill: { d:'Practice questions with model answers and traps. cat: investor, builder, theme (lunch topics) or objection. Returns n random ones (default 3).', p:{type:'object',properties:{cat:{type:'string',enum:['investor','builder','theme','objection','any']},n:{type:'integer'}}}, f({cat='any',n=3}={}){ const C=B.content||{}; let Q=(C.drill||[]).map(q=>({cat:q.cat,q:q.q,a:q.a,trap:q.trap})); Q=Q.concat((C.objections||[]).map(o=>({cat:'objection',q:o.o,a:o.r}))); if(cat!=='any') Q=Q.filter(x=>x.cat===cat); Q.sort(()=>Math.random()-.5); return { questions:Q.slice(0,n) }; } },
  search_research: { d:'Search the deep research notes: hosts, the summit, the lunch thesis (trucking, insurance underwriting, extractive industries, biology data wall, data labeling, robotics data) with numbers and sources, plus the route notes. Returns matching paragraphs.', p:{type:'object',properties:{query:{type:'string'}},required:['query']}, f({query}){ const q=String(query).toLowerCase().split(/\s+/).filter(w=>w.length>2); const paras=((B.hosts_md||'')+'\n\n'+(B.route_md||'')).split(/\n\s*\n/); const hits=paras.map(p=>[q.reduce((s,w)=>s+(p.toLowerCase().includes(w)?1:0),0),p]).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]).slice(0,6).map(x=>x[1].slice(0,900)); return { paragraphs: hits }; } },
  save_note: { d:'Save a note for George (a person he met, a follow-up, a fact to remember, a thing to fix in the pitch). Shows in the app.', p:{type:'object',properties:{text:{type:'string'}},required:['text']}, f({text}){ const n=addNote(text); return { saved:true, total:n }; } },
  list_notes: { d:'List the notes saved so far.', p:{type:'object',properties:{}}, f(){ return { notes:getNotes() }; } },
  set_mode: { d:'Switch the coaching mode: table (Lisa opens, go round the table), grill (skeptical investor), drill (rapid questions with scores), free.', p:{type:'object',properties:{mode:{type:'string',enum:['table','grill','drill','free']}},required:['mode']}, f({mode}){ setMode(mode, true); return { mode }; } },
  get_state: { d:'Everything about the current session state: mode, how long the session has run, which app tab George has open, notes and scores saved so far, drill questions already asked, whether a memo is being recorded, tools used. Call it when you need to know where you are or what has been covered.', p:{type:'object',properties:{}}, f(){ const notes=getNotes(); return { mode:VS.mode, session_seconds: VS.startedAt? Math.round((Date.now()-VS.startedAt)/1000):0, app_tab: (typeof tab!=='undefined'? tab : null), notes_count: notes.length, last_notes: notes.slice(-5).map(n=>n.t), scores: notes.filter(n=>/^Score \d\/5/.test(n.t)).map(n=>n.t), drill_asked: VS.asked.slice(-10), memo_recording: VS.memoOn, memo_chars: VS.memo.length, tools_used: VS.toolsUsed, time: T.get_time.f() }; } },
  end_memo: { d:'Finish the voice memo George is recording: saves the transcript as a note and returns it so you can read back a two sentence summary.', p:{type:'object',properties:{}}, f(){ return endMemo(); } },
  model_answer: { d:'The sharp prepared TRU Synth answer to a question, written as George would say it. Call this the moment George says "I don\'t know", "idk", "tell me", "what would you say", "skip", "help", or gives up on a question. Finds the closest drill question, objection, or one of Lisa\'s three, and returns the model answer plus the trap to avoid. If nothing matches closely, it returns the facts sheet so you can compose a tight answer yourself.', p:{type:'object',properties:{question:{type:'string',description:'the question George was asked, in your words'}},required:['question']}, f({question}){ const C=B.content||{}; const q=String(question||'').toLowerCase().split(/\W+/).filter(w=>w.length>3); const pool=[]; (C.drill||[]).forEach(d=>pool.push({kind:d.cat,q:d.q,a:d.a,trap:d.trap})); (C.objections||[]).forEach(o=>pool.push({kind:'objection',q:o.o,a:o.r})); (C.three||[]).forEach(t=>pool.push({kind:'lisa',q:t.q,a:t.a,trap:t.remember?'remember: '+t.remember:''})); const scored=pool.map(x=>[q.reduce((n,w)=>n+((x.q+' '+x.a).toLowerCase().includes(w)?1:0),0),x]).sort((a,b)=>b[0]-a[0]); const best=scored[0]; if(best && best[0]>=2) return { match:best[1].q, answer:best[1].a, trap:best[1].trap||'', say_it_as:'first person, George speaking, two to four sentences, calm, concrete, then ask him to repeat it back', also:scored.slice(1,3).filter(x=>x[0]>=2).map(x=>({q:x[1].q,a:x[1].a})) }; return { match:null, facts:(C.facts||[]).map(f=>f.k+': '+f.v), one_line:C.intro?.one_line, forty:C.intro?.forty, rules:C.rules, hint:'compose a sharp two to four sentence answer from these facts, first person as George, no hedging' }; } },
  score_answer: { d:'Record a score George got on a practice answer so progress is tracked. 1 to 5.', p:{type:'object',properties:{question:{type:'string'},score:{type:'integer'},fix:{type:'string'}},required:['question','score']}, f({question,score,fix}){ addNote(`Score ${score}/5 · ${question}${fix?' · fix: '+fix:''}`); return { recorded:true }; } }
};
const toolDefs = () => Object.entries(T).map(([name,t])=>({ type:'function', name, description:t.d, parameters:t.p, strict:false }));
function runTool(name, argsJson){ const t=T[name]; if(!t) return { error:'unknown tool '+name }; let a={}; try{ a=argsJson? JSON.parse(argsJson):{}; }catch{ } try{ return t.f(a); }catch(e){ return { error:String(e.message||e) }; } }

/* ---------- prompts ---------- */
function liveInstructions(){
  const base = (B.content?.voice_persona || 'You are Ada, a calm founder coach.');
  return base + `

## Live rules
Speak warmly, quickly, naturally, like a sharp friend, not a narrator. Short turns. Stop the moment George speaks. Light backchannels are fine.
Whenever George asks about the time, the schedule, the route, a person, the summit programme, the pitch text, facts, or research, delegate to the backend: it has tools that look these up. Never guess a name, a time, or a number. While the backend works, keep it brief: say you are checking, then read out the result in one or two sentences.
Modes: table, grill, drill, flow, memo, free. Switch when George asks. In memo mode you are silent until the memo ends.
The bail-out rule, in every mode: if George says "I don't know", "idk", "tell me", "what would you say", "skip", "help me", or clearly stalls, do not push back and do not lecture. Delegate immediately to get the prepared TRU Synth answer, then deliver it as George would say it, first person, two to four sentences, sharp and concrete, and finish with "now you say it". When he repeats it, give one line of feedback and move on.`;
}
function backendInstructions(){
  return (B.backend_instructions||'') + `

## Tools
You have tools that read the live prep package on George's phone: get_time (always call it for anything time related, it also tells you what is happening now and next), get_schedule, find_people, get_person, get_hosts, get_summit, get_pitch, get_drill, search_research, save_note, list_notes, set_mode, score_answer, model_answer, get_state, end_memo. Call get_state when unsure what has been covered. Call them instead of guessing. When George bails on a question with anything like I don't know, tell me, what would you say, skip, or help, call model_answer with the question and return the answer written in first person as George would say it, two to four sentences, no hedging, ending with a cue for him to repeat it. Chain them when useful (find_people then get_person). When George says he met someone or wants to remember something, call save_note. When you score a practice answer, call score_answer. Return results as short spoken sentences, at most three, with the exact names and numbers from the tools. Never invent a person who is not in the list.`;
}
function modeText(m){ const M=(B.content?.voice_modes)||{}; return M[m] || 'Mode '+m+'.'; }


/* ---------- memo ---------- */
function startMemo(){ VS.memo=''; VS.memoOn=true; $('#vdone').hidden=false; setStatus('Recording memo. Talk. Tap Done or say "done".'); if(VS.ready) sendEv({type:'session.instructions.append', event_id:'memo_on', delegation_id:null, content:'MEMO MODE. George is recording a voice memo. Stay completely silent. Do not speak, do not backchannel, do not respond, until the memo is ended by a tool result or George clearly says "done" or "end memo". Then call end_memo through the backend and read back a two sentence summary.'}); }
function endMemo(){ VS.memoOn=false; $('#vdone').hidden=true; const text=VS.memo.trim(); if(text){ addNote('Memo · '+text.slice(0,600)); } setStatus(text? 'Memo saved.' : 'Empty memo.'); const t=text; VS.memo=''; return { saved: !!t, memo: t || '(nothing captured)' }; }
$('#vdone').onclick = () => { const r=endMemo(); if(VS.ready) sendEv({type:'session.instructions.append', event_id:'memo_off', delegation_id:null, content:'Memo ended. Memo text: "'+String(r.memo).slice(0,900)+'". Read back a two sentence summary now, then return to mode '+(VS.mode==='memo'?'free':VS.mode)+'.'}); if(VS.mode==='memo') setMode('free', true); };
$('#vtr').addEventListener('click', () => $('#vtr').classList.toggle('full'));

/* ---------- ui ---------- */
const setStatus = s => { const el=$('#vst'); if(el) el.textContent=s; };
function setViz(state){ VS.state=state; if(window.AdaViz){ try{ AdaViz.setState(state); }catch{} } else { const o=$('#orb'); if(o) o.className = 'orb ' + ({listening:'listen',speaking:'talk'}[state]||''); } const lb=$('#vstate'); if(lb) lb.textContent = ({idle:'', connecting:'connecting', listening:'listening', thinking:'thinking', speaking:'speaking', ended:'ended'})[state]||''; }
function setMode(m, fromTool){ const prev=VS.mode; VS.mode=m; if(m==='memo' && !VS.memoOn) startMemo(); if(prev==='memo' && m!=='memo' && VS.memoOn) endMemo(); [...$('#modes').children].forEach(x=>x.classList.toggle('on', x.dataset.m===m)); if(VS.ready && !fromTool) sendEv({type:'session.instructions.append', event_id:'mode_'+Date.now(), delegation_id:null, content: modeText(m)}); if(fromTool && VS.ready) sendEv({type:'session.instructions.append', event_id:'mode_'+Date.now(), delegation_id:null, content: modeText(m)}); }
function sendEv(o){ if(VS.ch && VS.ch.readyState==='open') VS.ch.send(JSON.stringify(o)); }
function line(cls, txt){ const tr=$('#vtr'); let last=tr.lastElementChild; if(last && last.className===cls && last.dataset.open==='1'){ last.textContent += txt; } else { last=document.createElement('div'); last.className=cls; last.dataset.open='1'; last.textContent=txt; tr.append(last); } tr.scrollTop=tr.scrollHeight; }
function toolLine(txt){ const tr=$('#vtr'); const d=document.createElement('div'); d.className='tool'; d.textContent=txt; tr.append(d); tr.scrollTop=tr.scrollHeight; }
function closeLines(){ [...$('#vtr').children].forEach(x=>x.dataset.open='0'); }
function getKey(){ try{ return (localStorage.getItem('oak')||'').trim(); }catch{ return ''; } }

$('#pill').onclick = () => { $('#voice').classList.add('on'); const k=getKey(); $('#vkey').value=k; renderNotes(); if(window.AdaViz && !VS.vizMounted){ try{ AdaViz.mount($('#orbwrap')); VS.vizMounted=true; setViz('idle'); }catch(e){ console.warn('viz',e); } } if(!k){ $('#vsettings').classList.add('on'); setStatus('Paste an OpenAI API key in settings, then start.'); } };
$('#vclose').onclick = () => { $('#voice').classList.remove('on'); };
$('#vset').onclick = () => $('#vsettings').classList.toggle('on');
$('#vkey').addEventListener('change', e => { try{ localStorage.setItem('oak', e.target.value.trim()); }catch{} });
$('#vvoice').addEventListener('change', e => { try{ localStorage.setItem('oav', e.target.value); }catch{} });
try{ const v=localStorage.getItem('oav'); if(v) $('#vvoice').value=v; }catch{}
$('#modes').addEventListener('click', e => { const b=e.target.closest('.chip'); if(!b) return; setMode(b.dataset.m, false); });

function vcleanup(){ if(VS.memoOn) endMemo(); clearTimeout(VS.closeT); clearInterval(VS.timeT); VS.mic?.getTracks().forEach(t=>t.stop()); try{VS.ch?.close()}catch{} try{VS.peer?.close()}catch{} if(VS.audio) VS.audio.srcObject=null; VS.ready=false; $('#vstart').hidden=false; $('#vstop').hidden=true; $('#vmute').hidden=true; $('#pill').classList.remove('live'); setViz(VS.state==='connecting'?'idle':'ended'); setTimeout(()=>{ if(!VS.ready) setViz('idle'); }, 2500); }
$('#vstop').onclick = () => { if(!VS.ready) return vcleanup(); setStatus('Ending…'); sendEv({type:'session.close'}); VS.closeT=setTimeout(vcleanup, 8000); };
$('#vmute').onclick = () => { VS.muted=!VS.muted; sendEv({type: VS.muted?'session.input_audio.mute':'session.input_audio.unmute', event_id:'m'+Date.now()}); $('#vmute').textContent = VS.muted?'Unmute':'Mute'; };

let speakT=null;
function onEvent(ev){
  switch(ev.type){
    case 'session.started': {
      VS.ready=true; VS.startedAt=Date.now(); setStatus('Live. Talk.'); $('#vstop').hidden=false; $('#vmute').hidden=false; $('#pill').classList.add('live'); setViz('listening');
      const t=T.get_time.f();
      sendEv({type:'session.thinking.append', event_id:'ctx0', delegation_id:null, content:`It is ${t.time_pt} Pacific on Tuesday 15 September 2026. Lunch is in ${t.minutes_until_lunch} minutes. Mode: ${VS.mode}. George is on his phone.`});
      sendEv({type:'session.instructions.append', event_id:'mode0', delegation_id:null, content: modeText(VS.mode)}); if(VS.mode==='memo') startMemo();
      VS.timeT = setInterval(()=>{ const t=T.get_time.f(); sendEv({type:'session.thinking.append', event_id:'clock'+Date.now(), delegation_id:null, content:`Time check: ${t.time_pt} PT, ${t.minutes_until_lunch} minutes to lunch.${t.next?' Next: '+t.next.t+' '+t.next.h:''} Mode ${VS.mode}, session ${Math.round((Date.now()-VS.startedAt)/60000)} min, ${getNotes().length} notes.`}); }, 5*60000);
      break; }
    case 'session.closed': setStatus('Ended. ' + (ev.usage?.seconds? Math.round(ev.usage.seconds)+'s used.':'')); vcleanup(); break;
    case 'session.input_transcript.delta': setViz('listening'); line('u', ev.delta||''); if(VS.memoOn){ VS.memo += (ev.delta||''); if(/\b(done|end memo|stop memo)\b\s*[.!]?\s*$/i.test(VS.memo.slice(-40))){ VS.memo=VS.memo.replace(/\b(done|end memo|stop memo)\b\s*[.!]?\s*$/i,''); $('#vdone').click(); } } break;
    case 'session.output_transcript.delta': setViz('speaking'); line('m', ev.delta||''); clearTimeout(speakT); speakT=setTimeout(()=>{ if(VS.ready) setViz('listening'); closeLines(); }, 1400); break;
    case 'session.delegation.created': setViz('thinking'); break;
    case 'response.event': {
      const e=ev.event||{};
      if(e.type==='response.output_item.done' && e.item?.type==='function_call'){
        const {name, arguments:args, call_id} = e.item; toolLine('→ '+name+(args && args!=='{}'? ' '+args.slice(0,80):''));
        const out = runTool(name, args); VS.toolsUsed[name]=(VS.toolsUsed[name]||0)+1; if(name==='get_drill' && out.questions) out.questions.forEach(q=>VS.asked.push(q.q));
        sendEv({type:'response.item.create', event_id:'tool_'+Date.now(), item:{type:'function_call_output', call_id, output: JSON.stringify(out).slice(0, 12000)}});
        sendEv({type:'response.create', event_id:'cont_'+Date.now()});
      } else if(e.type==='response.completed' || e.type==='response.failed'){ if(VS.state==='thinking') setViz('listening'); }
      break; }
    case 'session.usage.updated': break;
    case 'error': setStatus('Error: ' + (ev.error?.message || JSON.stringify(ev).slice(0,140))); break;
    default: break;
  }
}

$('#vstart').onclick = async () => {
  const key=getKey(); if(!key){ $('#vsettings').classList.add('on'); setStatus('Need an OpenAI API key first.'); return; }
  $('#vstart').hidden=true; setStatus('Connecting…'); $('#vtr').innerHTML=''; setViz('connecting');
  try{
    if(window.AdaViz && !VS.vizMounted){ try{ AdaViz.mount($('#orbwrap')); VS.vizMounted=true; }catch{} }
    if(!VS.audio){ VS.audio=new Audio(); VS.audio.autoplay=true; VS.audio.playsInline=true; VS.audio.setAttribute('playsinline',''); }
    const pc=new RTCPeerConnection(); VS.peer=pc;
    pc.addEventListener('track', ev => { const ms=new MediaStream([ev.track]); VS.remote=ms; VS.audio.srcObject=ms; VS.audio.play().catch(()=>{ setStatus('Tap the orb to unmute playback.'); $('#orbwrap').onclick=()=>VS.audio.play(); }); if(window.AdaViz){ try{ AdaViz.attachOutput(ms); }catch{} } });
    VS.mic = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}});
    VS.mic.getAudioTracks().forEach(t=>pc.addTrack(t, VS.mic));
    if(window.AdaViz){ try{ AdaViz.attachInput(VS.mic); }catch{} }
    const ch=pc.createDataChannel('oai-events'); VS.ch=ch;
    ch.addEventListener('message', ({data}) => { let ev; try{ ev=JSON.parse(data); }catch{ return; } onEvent(ev); });
    ch.addEventListener('close', () => { if(VS.ready) setStatus('Disconnected.'); vcleanup(); });
    const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
    if(pc.iceGatheringState!=='complete'){ await new Promise(res=>{ const to=setTimeout(res,4000); pc.addEventListener('icegatheringstatechange',()=>{ if(pc.iceGatheringState==='complete'){ clearTimeout(to); res(); } }); }); }
    const sdp=pc.localDescription.sdp;
    const voice=$('#vvoice').value||'gleam';
    const body={ session:{ model:'gpt-live-1', instructions: liveInstructions(), audio:{ output:{ voice } }, delegation:{ type:'responses', responses:{ model:'gpt-5.6-terra', instructions: backendInstructions(), tools: toolDefs(), tool_choice:'auto', parallel_tool_calls:false } } }, transport:{ type:'webrtc', sdp } };
    const r=await fetch('https://api.openai.com/v1/live/sessions',{ method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!r.ok){ const t=await r.text(); throw new Error('OpenAI '+r.status+': '+t.slice(0,220)); }
    const res=await r.json();
    await pc.setRemoteDescription({ type:'answer', sdp: res.transport.sdp });
    setStatus('Session up · waiting for start…');
  }catch(e){ setStatus(e.message||String(e)); vcleanup(); }
};
window.AdaTools = { run: runTool, defs: toolDefs, vs: VS, send: sendEv };
})();
