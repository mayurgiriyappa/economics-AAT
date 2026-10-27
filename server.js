'use strict';
process.on('uncaughtException', (err) => {
  console.error('[Process Error Guard] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Error Guard] Unhandled Rejection:', reason);
});

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 1e6, pingInterval: 25000, pingTimeout: 20000 });
// Load a local .env file without an extra dependency; deployment platforms can use native env vars.
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      let value = match[2];
      if ((value.startsWith(') && value.endsWith(')) || (value.startsWith(") && value.endsWith("))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
} catch (_) { /* .env is optional */ }
const PORT = Number(process.env.PORT || 3000);
const HOST_PIN = process.env.HOST_PIN || '2468';
if (process.env.NODE_ENV === 'production' && !process.env.HOST_PIN) {
  console.warn('Notice: HOST_PIN is running with development default "2468". Set HOST_PIN env var for custom PIN.');
}
const MAX_PARTICIPANTS = Math.max(41, Number(process.env.MAX_PARTICIPANTS || 500));
const DATA_DIR = path.join(__dirname, 'data');
const BANK_PATH = path.join(DATA_DIR, 'quiz-questions.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}

const starterQuestions = [
  {id:'q1', category:'Strategy', text:'The domestic consumable is not yet qualified for critical biopharmaceutical use. What is the most defensible immediate strategy?', options:['Stop importing immediately','Use phased localization while retaining a qualified supply source','Choose the cheapest supplier without testing','Assume local supply is automatically equivalent'], correctIndex:1, explanation:'A phased approach preserves continuity while local manufacturing, comparability, validation and supplier qualification evidence is generated.', points:1000},
  {id:'q2', category:'Economics', text:'The imported unit price is US$420 and the assumed exchange rate is ₹87 per US dollar. What is the product purchase cost before freight and import charges?', options:['₹36,540','₹38,340','₹420','₹40,200'], correctIndex:0, explanation:'US$420 × ₹87/US$ = ₹36,540. Freight and applicable non-recoverable charges must be added separately.', points:1000},
  {id:'q3', category:'Economics', text:'The rupee depreciates against the US dollar, while the supplier keeps the USD price unchanged. What happens to the INR product purchase cost?', options:['It decreases','It stays exactly the same','It increases','It becomes zero'], correctIndex:2, explanation:'A higher INR-per-USD rate increases the INR cost of an unchanged foreign-currency invoice.', points:1000},
  {id:'q4', category:'Manufacturing', text:'A process has 92% usable yield. To deliver 5,000 usable units, approximately how many units must be attempted?', options:['4,600','5,000','5,435','5,920'], correctIndex:2, explanation:'Required attempts = usable output ÷ yield = 5,000 ÷ 0.92 ≈ 5,435 attempts.', points:1000},
  {id:'q5', category:'Economics', text:'Which cost is most clearly an initial localization investment rather than a recurring per-unit cost?', options:['Routine packaging for each unit','Raw material consumed per batch','Tooling and equipment setup','Freight paid on each import'], correctIndex:2, explanation:'Tooling and equipment setup is typically an upfront capital investment; the model should keep it separate from recurring unit costs.', points:1000},
  {id:'q6', category:'Tax & landed cost', text:'When calculating economic import cost, how should recoverable input GST generally be treated?', options:['Always add it as a permanent cost','Exclude it from cost to the extent it is recoverable, while tracking cash-flow timing separately','Ignore every tax and charge','Count it twice to be conservative'], correctIndex:1, explanation:'Recoverable input tax is generally not a permanent economic cost to the extent credit can be claimed. Confirm transaction-specific eligibility and cash-flow impacts.', points:1000},
  {id:'q7', category:'Quality', text:'Before replacing a qualified imported chromatography consumable with a locally manufactured alternative, what should be demonstrated?', options:['Only a lower list price','Only a supplier marketing statement','Specification fit, performance comparability, appropriate validation and approved change control','Only that the product is manufactured in India'], correctIndex:2, explanation:'A sourcing decision must preserve product quality and process performance through documented qualification, testing, validation as applicable, and change control.', points:1000},
  {id:'q8', category:'Supply chain', text:'What is the strongest direct benefit of dual sourcing when both suppliers are qualified?', options:['It guarantees no disruptions','It can reduce dependence on one source, although cost and comparability must be managed','It always halves the unit cost','It removes the need for quality assurance'], correctIndex:1, explanation:'Qualified dual sourcing can improve resilience, but benefits depend on capacity, inventory, supplier independence, qualification and transition costs.', points:1000},
  {id:'q9', category:'Decision analysis', text:'What does a break-even demand estimate identify in an import-versus-local model?', options:['The demand level at which modeled costs are equal under stated assumptions','The number of employees needed for every factory','A government-guaranteed sales quantity','The product’s regulatory approval date'], correctIndex:0, explanation:'Break-even demand identifies the modeled volume at which the cost of the alternatives is equal. Fixed costs, yields, capacity and cost definitions must be consistent.', points:1000},
  {id:'q10', category:'Evidence', text:'Which is the most reliable basis for claiming that a specific Indian incentive applies to the proposed consumable?', options:['A social media post about Make in India','A generic blog about manufacturing','Current official scheme guidelines matched to the product, applicant and eligibility conditions','A competitor’s unverified estimate'], correctIndex:2, explanation:'Use current official scheme guidelines and verify the exact applicant, product, investment and eligibility requirements. Do not infer eligibility from general policy branding.', points:1000}
];


// ==================== JURY LIVE SERVER ENGINE (USER PROTOCOL) ====================
const defaultJuryQuestions = [
  {
    id: 'j1',
    text: 'What is the most credible reason the imported column costs more than a locally packed one?',
    options: [
      'Currency risk and freight add ~20–30% above manufacturing cost',
      'The supplier charges a quality premium for pre-packed convenience',
      'Import duties and GST make domestic production impossible to justify'
    ]
  },
  {
    id: 'j2',
    text: 'Before switching to a locally packed column, what evidence is most critical?',
    options: [
      'A lower quotation from the domestic supplier',
      'Demonstrated bed efficiency, peak symmetry and process compatibility data',
      'Government scheme certification confirming Make in India eligibility'
    ]
  },
  {
    id: 'j3',
    text: 'Which sourcing strategy best balances cost savings and supply risk?',
    options: [
      'Continue importing — existing supply is qualified and risk is known',
      'Phased localization — develop local capability while retaining the import as backup',
      'Full switch to local — cut costs immediately after pilot batch approval'
    ]
  },
  {
    id: 'j4',
    text: 'What is the biggest technical barrier to packing columns in-house?',
    options: [
      'Achieving reproducible bed uniformity and pressure/flow profiles batch to batch',
      'Sourcing the resin — most resins are imported anyway',
      'Regulatory documentation — GMP change control is too slow for urgent supply'
    ]
  },
  {
    id: 'j5',
    text: 'What single piece of evidence would most change your vote today?',
    options: [
      'A verified domestic supplier quotation showing >20% unit cost saving',
      'Pilot batch data showing equivalent performance to the imported column',
      'A confirmed PLI or government subsidy that covers tooling and validation costs'
    ]
  }
];

let juryBank = JSON.parse(JSON.stringify(defaultJuryQuestions));
let juryGame = {
  roomCode: crypto.randomInt(100000, 999999).toString(),
  status: 'lobby',
  currentIndex: -1,
  questions: JSON.parse(JSON.stringify(juryBank)),
  resultsVisible: false,
  participants: {}
};
const juryHostSockets = new Set();
const JURY_MAX_PARTICIPANTS = 6;

function getJuryOptionCounts(game) {
  if (!game || game.currentIndex < 0) return [];
  const q = game.questions[game.currentIndex];
  if (!q) return [];
  const counts = q.options.map((label, index) => ({ index, label, count: 0 }));
  for (const p of Object.values(game.participants)) {
    const v = p.votes && p.votes[game.currentIndex];
    if (v && Number.isInteger(v.optionIndex) && counts[v.optionIndex]) {
      counts[v.optionIndex].count++;
    }
  }
  return counts;
}

function getJuryAllResults(game) {
  if (!game) return [];
  const totalJurors = Object.keys(game.participants).length;
  return game.questions.map((q, qIdx) => {
    const counts = q.options.map(label => ({ label, count: 0 }));
    let totalVotes = 0;
    for (const p of Object.values(game.participants)) {
      const v = p.votes && p.votes[qIdx];
      if (v && Number.isInteger(v.optionIndex) && counts[v.optionIndex]) {
        counts[v.optionIndex].count++;
        totalVotes++;
      }
    }
    const optionsWithPct = counts.map(c => ({
      ...c,
      percent: totalVotes ? Number(((c.count / totalVotes) * 100).toFixed(1)) : 0
    }));
    return {
      text: q.text,
      totalVotes,
      totalJurors,
      options: optionsWithPct
    };
  });
}

function getJuryAllResponses(game) {
  if (!game) return [];
  return game.questions.map((q, qIdx) => {
    const responses = [];
    for (const p of Object.values(game.participants)) {
      const v = p.votes && p.votes[qIdx];
      if (v && Number.isInteger(v.optionIndex)) {
        responses.push({
          name: p.name,
          option: q.options[v.optionIndex] || '',
          reason: v.reason || '',
          submittedAt: v.submittedAt || new Date().toISOString()
        });
      }
    }
    return {
      text: q.text,
      responses: responses.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    };
  });
}

function getJuryHostState() {
  if (!juryGame) return { hasRoom: false, bank: juryBank, maxJurors: JURY_MAX_PARTICIPANTS };
  const q = juryGame.currentIndex >= 0 ? juryGame.questions[juryGame.currentIndex] : null;
  const participantsList = Object.values(juryGame.participants);
  const votedCount = q ? participantsList.filter(p => p.votes && p.votes[juryGame.currentIndex]).length : 0;

  return {
    hasRoom: true,
    status: juryGame.status,
    roomCode: juryGame.roomCode,
    currentIndex: juryGame.currentIndex,
    currentQuestion: q ? { ...q } : null,
    participantCount: participantsList.length,
    connectedCount: participantsList.filter(p => p.connected).length,
    votedCount,
    resultsVisible: !!juryGame.resultsVisible,
    optionCounts: getJuryOptionCounts(juryGame),
    participants: participantsList.map(p => ({
      id: p.id,
      name: p.name,
      connected: !!p.connected,
      vote: (p.votes && q && p.votes[juryGame.currentIndex]) ? {
        option: q.options[p.votes[juryGame.currentIndex].optionIndex] || '',
        optionIndex: p.votes[juryGame.currentIndex].optionIndex,
        reason: p.votes[juryGame.currentIndex].reason || '',
        submittedAt: p.votes[juryGame.currentIndex].submittedAt
      } : null
    })),
    bank: juryBank,
    maxJurors: JURY_MAX_PARTICIPANTS,
    allResults: juryGame.status === 'ended' ? getJuryAllResults(juryGame) : null,
    allResponses: juryGame.status === 'ended' ? getJuryAllResponses(juryGame) : null
  };
}

function getJuryParticipantState(clientId) {
  if (!juryGame) return { hasRoom: false };
  const p = juryGame.participants[clientId];
  const q = juryGame.currentIndex >= 0 ? juryGame.questions[juryGame.currentIndex] : null;
  const myVote = (p && p.votes && q && p.votes[juryGame.currentIndex]) || null;
  const participantsList = Object.values(juryGame.participants);
  const votedCount = q ? participantsList.filter(x => x.votes && x.votes[juryGame.currentIndex]).length : 0;

  let currentResults = null;
  if (juryGame.resultsVisible && q) {
    const counts = getJuryOptionCounts(juryGame);
    currentResults = {
      options: counts.map(c => ({
        ...c,
        percent: votedCount ? Number(((c.count / votedCount) * 100).toFixed(1)) : 0
      })),
      totalVotes: votedCount,
      totalJurors: participantsList.length
    };
  }

  return {
    hasRoom: true,
    status: juryGame.status,
    roomCode: juryGame.roomCode,
    currentIndex: juryGame.currentIndex,
    question: q ? { id: q.id, text: q.text, options: q.options } : null,
    participantCount: participantsList.length,
    connectedCount: participantsList.filter(x => x.connected).length,
    votedCount,
    resultsVisible: !!juryGame.resultsVisible,
    myVote: myVote ? {
      optionIndex: myVote.optionIndex,
      option: q.options[myVote.optionIndex] || '',
      reason: myVote.reason || ''
    } : null,
    results: currentResults,
    allResults: juryGame.status === 'ended' ? getJuryAllResults(juryGame) : null
  };
}

function broadcastJury() {
  const hostState = getJuryHostState();
  for (const s of io.sockets.sockets.values()) {
    if (s.data?.isJuryHost) {
      s.emit('jury:host:state', hostState);
    } else if (s.data?.role === 'juryParticipant' && s.data?.juryClientId) {
      s.emit('jury:participant:state', getJuryParticipantState(s.data.juryClientId));
    }
  }
}

let questionBank = loadQuestionBank();
let game = null;
const hostSockets = new Set();

function loadQuestionBank(){
  try {
    if(fs.existsSync(BANK_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'));
      if(Array.isArray(parsed) && parsed.length) return parsed.map(normalizeQuestion);
    }
  } catch(e) { console.error('Unable to load saved questions:', e.message); }
  saveQuestionBank(starterQuestions);
  return starterQuestions.map(q => ({...q, options:[...q.options]}));
}
function saveQuestionBank(bank){
  try {
    fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2));
  } catch (e) {
    console.warn('Notice: Question bank kept in-memory (read-only filesystem):', e.message);
  }
}
function normalizeQuestion(q, index=0){
  const options = Array.isArray(q.options) ? q.options.slice(0,4).map(v=>String(v||'').trim()) : [];
  while(options.length<4) options.push('Option '+(options.length+1));
  return { id:String(q.id||`q${index+1}`), category:String(q.category||'General').slice(0,60), text:String(q.text||'').slice(0,1000), options, correctIndex:Math.min(3,Math.max(0,Number(q.correctIndex)||0)), explanation:String(q.explanation||'').slice(0,1800), points:Math.min(5000,Math.max(100,Number(q.points)||1000)) };
}
function cleanText(v, max=100){ return String(v||'').trim().replace(/[\u0000-\u001f]/g,'').slice(0,max); }
function roomCode(){ return crypto.randomInt(100000, 999999).toString(); }
function ensureGame(){ if(!game) throw new Error('No quiz session is open. The host must open a room first.'); }
function getQuestion(){ return game && game.currentIndex>=0 ? game.questions[game.currentIndex] : null; }
function participantTotal(){ return game ? Object.keys(game.participants).length : 0; }
function currentResponses(){
  const q=getQuestion(); if(!game || !q) return [];
  return Object.values(game.participants).map(p=>({id:p.id, name:p.name, connected:!!p.connected, response:p.answers[q.id]||null}));
}
function optionCounts(){
  const q=getQuestion(); if(!q) return [];
  const counts=q.options.map((label,index)=>({index,label,count:0}));
  for(const p of Object.values(game.participants)){ const r=p.answers[q.id]; if(r && Number.isInteger(r.answerIndex) && counts[r.answerIndex]) counts[r.answerIndex].count++; }
  return counts;
}
function hostState(){
  if(!game) return {hasGame:false, bank:questionBank, maxParticipants:MAX_PARTICIPANTS};
  const q=getQuestion();
  return {hasGame:true, roomCode:game.roomCode, status:game.status, currentIndex:game.currentIndex, questionCount:game.questions.length, questions:game.questions.map((x)=>({...x})), currentQuestion:q?{...q}:null, participants:Object.values(game.participants).map(p=>({id:p.id,name:p.name,connected:!!p.connected,score:p.score,answer:q&&p.answers[q.id]?{answerIndex:p.answers[q.id].answerIndex,answeredAt:p.answers[q.id].answeredAt}:null})), totalParticipants:participantTotal(), answeredCount:q?Object.values(game.participants).filter(p=>!!p.answers[q.id]).length:0, optionCounts:optionCounts(), leaderboard:Object.values(game.participants).map(p=>({id:p.id,name:p.name,score:p.score,connected:!!p.connected})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)), bank:questionBank, maxParticipants:MAX_PARTICIPANTS };
}
function playerState(playerId){
  if(!game) return {hasGame:false};
  const p=game.participants[playerId];
  const q=getQuestion();
  const ownAnswer=q&&p?p.answers[q.id]||null:null;
  const revealed=game.status==='revealed'||game.status==='ended';
  return {hasGame:true, roomCode:game.roomCode, status:game.status, currentIndex:game.currentIndex, questionCount:game.questions.length, participantCount:participantTotal(), answeredCount:q?Object.values(game.participants).filter(x=>!!x.answers[q.id]).length:0, question:q?{id:q.id,category:q.category,text:q.text,options:q.options,correctIndex:revealed?q.correctIndex:undefined,explanation:revealed?q.explanation:undefined,points:q.points}:null, myAnswer:ownAnswer?{answerIndex:ownAnswer.answerIndex,correct:revealed?ownAnswer.answerIndex===q.correctIndex:undefined}:null, score:p?p.score:0, revealed, leaderboard:revealed?Object.values(game.participants).map(x=>({name:x.name,score:x.score})).sort((a,b)=>b.score-a.score).slice(0,10):[] };
}
function pushStates(){
  for(const s of io.sockets.sockets.values()){
    if(s.data && s.data.isHost) s.emit('host:state',hostState());
    else if(s.data && s.data.role==='player' && game && s.data.roomCode===game.roomCode) s.emit('player:state',playerState(s.data.playerId));
  }
}
function broadcastState(){ pushStates(); }
function persistBankFromInput(arr){
  if(!Array.isArray(arr) || arr.length<1 || arr.length>50) throw new Error('Keep between 1 and 50 questions.');
  const ids=new Set();
  const normalized=arr.map((q,i)=>{
    const item=normalizeQuestion(q,i);
    if(!item.text) throw new Error(`Question ${i+1} needs question text.`);
    if(item.options.some(o=>!o)) throw new Error(`Question ${i+1} needs four non-empty options.`);
    if(new Set(item.options.map(x=>x.toLowerCase())).size<4) throw new Error(`Question ${i+1} must have four distinct options.`);
    if(ids.has(item.id)) item.id=`q-${crypto.randomBytes(5).toString('hex')}`;
    ids.add(item.id);
    return item;
  });
  questionBank=normalized; saveQuestionBank(questionBank);
}

// Never expose server code, environment examples, or the editable bank (which includes answers).
app.use(['/data','/server.js','/package.json','/package-lock.json','/.env.example'], (req,res)=>res.sendStatus(404));
app.use(express.static(__dirname, { extensions:['html'], dotfiles:'ignore' }));
app.use(express.static(process.cwd(), { extensions:['html'], dotfiles:'ignore' }));

// Pre-load and cache HTML files.
// Explicit string literals ensure @vercel/nft traces and bundles both files in serverless.
let cachedIndexHtml = '';
let cachedDashboardHtml = '';
let cachedQuizHtml = '';

try {
  cachedIndexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
} catch (_) {
  try { cachedIndexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); } catch (_) {}
}

try {
  cachedDashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
} catch (_) {
  try { cachedDashboardHtml = fs.readFileSync(path.join(process.cwd(), 'dashboard.html'), 'utf8'); } catch (_) {}
}

try {
  cachedQuizHtml = fs.readFileSync(path.join(__dirname, 'quiz.html'), 'utf8');
} catch (_) {
  try { cachedQuizHtml = fs.readFileSync(path.join(process.cwd(), 'quiz.html'), 'utf8'); } catch (_) {}
}

function getIndexHtml() {
  if (cachedIndexHtml) return cachedIndexHtml;
  try { cachedIndexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); } catch (_) {}
  if (!cachedIndexHtml) {
    try { cachedIndexHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); } catch (_) {}
  }
  return cachedIndexHtml;
}

function getDashboardHtml() {
  if (cachedDashboardHtml) return cachedDashboardHtml;
  try { cachedDashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'); } catch (_) {}
  if (!cachedDashboardHtml) {
    try { cachedDashboardHtml = fs.readFileSync(path.join(process.cwd(), 'dashboard.html'), 'utf8'); } catch (_) {}
  }
  return cachedDashboardHtml;
}


let cachedJuryHtml = '';
try {
  cachedJuryHtml = fs.readFileSync(path.join(__dirname, 'jury.html'), 'utf8');
} catch (_) {
  try { cachedJuryHtml = fs.readFileSync(path.join(process.cwd(), 'jury.html'), 'utf8'); } catch (_) {}
}

function getJuryHtml() {
  if (cachedJuryHtml) return cachedJuryHtml;
  try { cachedJuryHtml = fs.readFileSync(path.join(__dirname, 'jury.html'), 'utf8'); } catch (_) {}
  if (!cachedJuryHtml) {
    try { cachedJuryHtml = fs.readFileSync(path.join(process.cwd(), 'jury.html'), 'utf8'); } catch (_) {}
  }
  return cachedJuryHtml;
}

function getQuizHtml() {
  if (cachedQuizHtml) return cachedQuizHtml;
  try { cachedQuizHtml = fs.readFileSync(path.join(__dirname, 'quiz.html'), 'utf8'); } catch (_) {}
  if (!cachedQuizHtml) {
    try { cachedQuizHtml = fs.readFileSync(path.join(process.cwd(), 'quiz.html'), 'utf8'); } catch (_) {}
  }
  return cachedQuizHtml;
}

app.get(['/', '/index.html'], (req, res) => {
  const html = getIndexHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/dashboard', '/dashboard.html'], (req, res) => {
  const html = getDashboardHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});


app.get(['/jury', '/jury.html'], (req, res) => {
  const html = getJuryHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.sendFile(path.join(__dirname, 'jury.html'));
});

app.get(['/quiz.html', '/quiz'], (req, res) => {
  const html = getQuizHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.sendFile(path.join(__dirname, 'quiz.html'));
});
app.get('/healthz', (req,res)=>res.json({ok:true, service:'strategy-court-live-quiz', activeRoom:game?game.roomCode:null, participants:participantTotal()}));
app.get('/api/quiz-info',(req,res)=>res.json({supportsLiveParticipants:true, maxParticipants:MAX_PARTICIPANTS, questionCount:questionBank.length, activeRoom:game?game.roomCode:null}));
app.get('/api/room-code', (req,res)=>res.json({ok:true, roomCode: game ? game.roomCode : roomCode()}));
app.post('/api/create-room', (req,res)=>{
  if(!game){
    game={roomCode:roomCode(),status:'lobby',currentIndex:-1,questions:questionBank.map(q=>({...q,options:[...q.options]})),participants:{},createdAt:new Date().toISOString()};
  }
  res.json({ok:true, roomCode:game.roomCode});
});

app.get('/api/jury/state', (req, res) => {
  const clientId = req.query.clientId || null;
  res.json(getJuryState(clientId));
});

app.post('/api/jury/vote', express.json(), (req, res) => {
  try {
    const { clientId, name, optionIndex, reason } = req.body || {};
    if (!clientId) return res.status(400).json({ ok: false, message: 'Missing clientId' });
    const qIdx = juryGame.currentQuestionIndex;
    let p = juryGame.participants[clientId];
    if (!p) {
      p = juryGame.participants[clientId] = {
        id: clientId,
        name: cleanText(name, 40) || 'Juror',
        connected: true,
        votes: {}
      };
    }
    p.votes[qIdx] = {
      optionIndex: Number(optionIndex),
      reason: cleanText(reason, 500),
      at: new Date().toISOString()
    };
    broadcastJury();
    res.json({ ok: true, state: getJuryState(clientId) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/api/questions', (req,res)=>res.json({ok:true, questions:questionBank.map(q=>({id:q.id,category:q.category,text:q.text,options:q.options,points:q.points}))}));

io.on('connection', socket=>{


  // ---------- JURY LIVE SOCKET EVENTS (MATCHING USER HTML) ----------
  socket.on('jury:host:authenticate', (payload = {}) => {
    const pin = String(payload.pin || '').trim();
    if (pin !== HOST_PIN) {
      socket.emit('jury:host:authenticated', { ok: false, message: 'Incorrect host PIN.' });
      return;
    }
    socket.data.isJuryHost = true;
    juryHostSockets.add(socket.id);
    socket.emit('jury:host:authenticated', { ok: true });
    socket.emit('jury:host:state', getJuryHostState());
  });

  socket.on('jury:host:request-state', () => {
    if (socket.data?.isJuryHost) {
      socket.emit('jury:host:state', getJuryHostState());
    }
  });

  socket.on('jury:host:create-room', (_, ack) => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      juryGame = {
        roomCode: crypto.randomInt(100000, 999999).toString(),
        status: 'lobby',
        currentIndex: -1,
        questions: JSON.parse(JSON.stringify(juryBank)),
        resultsVisible: false,
        participants: {}
      };
      socket.emit('jury:room-created', { ok: true, roomCode: juryGame.roomCode });
      broadcastJury();
      if (typeof ack === 'function') ack({ ok: true, roomCode: juryGame.roomCode });
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
      if (typeof ack === 'function') ack({ ok: false, message: e.message });
    }
  });

  socket.on('jury:host:save-bank', (payload = {}) => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      if (juryGame && juryGame.status === 'live') throw new Error('Cannot edit questions during a live vote.');
      if (Array.isArray(payload.questions) && payload.questions.length === 5) {
        juryBank = payload.questions.map((q, i) => ({
          id: q.id || 'j' + (i + 1),
          text: String(q.text || '').trim(),
          options: (q.options || []).slice(0, 3).map(o => String(o || '').trim())
        }));
        if (juryGame && juryGame.status === 'lobby') {
          juryGame.questions = JSON.parse(JSON.stringify(juryBank));
        }
        socket.emit('jury:bank-saved', { bank: juryBank });
        broadcastJury();
      }
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
    }
  });

  socket.on('jury:host:start', () => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      if (!juryGame) throw new Error('No jury room opened.');
      juryGame.status = 'live';
      juryGame.currentIndex = 0;
      juryGame.resultsVisible = false;
      broadcastJury();
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
    }
  });

  socket.on('jury:host:show-results', () => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      if (!juryGame || juryGame.status !== 'live') throw new Error('Cannot showcase results now.');
      juryGame.resultsVisible = true;
      broadcastJury();
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
    }
  });

  socket.on('jury:host:hide-results', () => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      if (!juryGame) return;
      juryGame.resultsVisible = false;
      broadcastJury();
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
    }
  });

  socket.on('jury:host:next', () => {
    try {
      if (!socket.data?.isJuryHost) throw new Error('Host authorization required.');
      if (!juryGame) return;
      if (juryGame.currentIndex + 1 >= juryGame.questions.length) {
        juryGame.status = 'ended';
      } else {
        juryGame.currentIndex++;
        juryGame.resultsVisible = false;
      }
      broadcastJury();
    } catch (e) {
      socket.emit('jury:error', { message: e.message });
    }
  });

  // Participant events
  socket.on('jury:participant:join', (payload = {}) => {
    try {
      if (!juryGame) throw new Error('No jury room is open. The host must open a room first.');
      const code = String(payload.roomCode || '').trim();
      if (code !== juryGame.roomCode) throw new Error('Room code not found. Check the code shared by your host.');
      if (juryGame.status === 'ended') throw new Error('This jury session has ended.');
      const name = cleanText(payload.name, 35) || 'Juror';
      const clientId = cleanText(payload.clientId, 80) || socket.id;

      let p = juryGame.participants[clientId];
      if (!p && Object.keys(juryGame.participants).length >= JURY_MAX_PARTICIPANTS) {
        throw new Error('This room has reached the maximum of 6 jurors.');
      }
      if (!p) {
        p = juryGame.participants[clientId] = {
          id: clientId,
          name,
          connected: true,
          votes: {}
        };
      } else {
        p.name = name;
        p.connected = true;
      }
      socket.data.role = 'juryParticipant';
      socket.data.juryClientId = clientId;
      socket.data.juryRoomCode = juryGame.roomCode;

      socket.emit('jury:participant:joined', { ok: true, name: p.name });
      socket.emit('jury:participant:state', getJuryParticipantState(clientId));
      broadcastJury();
    } catch (e) {
      socket.emit('jury:participant:join-error', { message: e.message });
    }
  });

  socket.on('jury:participant:vote', (payload = {}) => {
    try {
      if (!juryGame || juryGame.status !== 'live') throw new Error('Voting is not open right now.');
      if (juryGame.resultsVisible) throw new Error('Voting is locked while results are showcased.');
      const clientId = socket.data?.juryClientId;
      if (!clientId) throw new Error('Join the room before voting.');
      const p = juryGame.participants[clientId];
      if (!p) throw new Error('Juror session not found. Please rejoin.');
      const optIdx = Number(payload.optionIndex);
      const reason = cleanText(payload.reason, 1000);
      const q = juryGame.questions[juryGame.currentIndex];
      if (!q || optIdx < 0 || optIdx >= q.options.length) throw new Error('Choose one of the 3 available options.');

      p.votes[juryGame.currentIndex] = {
        optionIndex: optIdx,
        reason,
        submittedAt: new Date().toISOString()
      };
      socket.emit('jury:participant:vote-accepted');
      broadcastJury();
    } catch (e) {
      socket.emit('jury:participant:vote-error', { message: e.message });
    }
  });

  socket.on('host:authenticate',(payload={})=>{
    const pin=String(payload.pin||'');
    if(pin.length>200 || pin!==HOST_PIN){ socket.emit('host:authenticated',{ok:false,message:'Incorrect host PIN.'}); return; }
    socket.data.isHost=true; socket.data.role='host'; hostSockets.add(socket.id);
    socket.emit('host:authenticated',{ok:true}); socket.emit('host:state',hostState());
  });
  socket.on('host:create-session',(_,ack)=>{
    try{
      if(!socket.data.isHost) throw new Error('Host authorization is required.');
      game={roomCode:roomCode(),status:'lobby',currentIndex:-1,questions:questionBank.map(q=>({...q,options:[...q.options]})),participants:{},createdAt:new Date().toISOString()};
      socket.data.roomCode=game.roomCode;
      socket.emit('host:session-created',{ok:true,roomCode:game.roomCode});
      broadcastState(); if(typeof ack==='function')ack({ok:true,roomCode:game.roomCode});
    }catch(e){socket.emit('quiz:error',{message:e.message}); if(typeof ack==='function')ack({ok:false,message:e.message});}
  });
  socket.on('host:save-bank',(payload={})=>{
    try{
      if(!socket.data.isHost) throw new Error('Host authorization is required.');
      if(game && ['live','revealed'].includes(game.status)) throw new Error('Question editing is locked during a live session. End the session before editing the question bank.');
      persistBankFromInput(payload.questions);
      socket.emit('host:bank-saved',{ok:true,bank:questionBank}); broadcastState();
    }catch(e){socket.emit('quiz:error',{message:e.message});}
  });
  socket.on('host:start',()=>{
    try{if(!socket.data.isHost) throw new Error('Host authorization is required.');ensureGame();if(game.status!=='lobby')throw new Error('The session is not in the lobby.');if(!game.questions.length)throw new Error('Add at least one question first.');game.currentIndex=0;game.status='live';broadcastState();}
    catch(e){socket.emit('quiz:error',{message:e.message});}
  });
  socket.on('host:reveal',()=>{
    try{if(!socket.data.isHost)throw new Error('Host authorization is required.');ensureGame();if(game.status!=='live')throw new Error('The question is not accepting answers.');const q=getQuestion();for(const p of Object.values(game.participants)){const r=p.answers[q.id];if(r && !r.scored){if(r.answerIndex===q.correctIndex)p.score+=q.points;r.scored=true;}}game.status='revealed';broadcastState();}
    catch(e){socket.emit('quiz:error',{message:e.message});}
  });
  socket.on('host:next',()=>{
    try{if(!socket.data.isHost)throw new Error('Host authorization is required.');ensureGame();if(game.status!=='revealed')throw new Error('Reveal the answer before moving to the next question.');if(game.currentIndex+1>=game.questions.length){game.status='ended';broadcastState();return;}game.currentIndex++;game.status='live';broadcastState();}
    catch(e){socket.emit('quiz:error',{message:e.message});}
  });
  socket.on('host:end',()=>{try{if(!socket.data.isHost)throw new Error('Host authorization is required.');ensureGame();game.status='ended';broadcastState();}catch(e){socket.emit('quiz:error',{message:e.message});}});
  socket.on('participant:join',(payload={})=>{
    try{
      ensureGame(); const code=cleanText(payload.roomCode,12).toUpperCase();
      if(code!==game.roomCode) throw new Error('Room code not found. Check the code shared by your host.');
      if(game.status==='ended') throw new Error('This quiz has ended. Ask the host to open a new room.');
      const name=cleanText(payload.name,28); if(name.length<2) throw new Error('Enter a display name with at least 2 characters.');
      const playerId=cleanText(payload.clientId,80);if(playerId.length<8)throw new Error('Could not create a participant ID. Refresh and try again.');
      let p=game.participants[playerId];
      if(!p && participantTotal()>=MAX_PARTICIPANTS)throw new Error(`This room has reached its participant limit (${MAX_PARTICIPANTS}).`);
      if(!p) p=game.participants[playerId]={id:playerId,name,score:0,answers:{},joinedAt:new Date().toISOString(),connected:true};
      p.name=name;p.connected=true;socket.data.role='player';socket.data.playerId=playerId;socket.data.roomCode=game.roomCode;
      socket.emit('participant:joined',{ok:true,name:p.name});socket.emit('player:state',playerState(playerId));broadcastState();
    }catch(e){socket.emit('participant:join-error',{message:e.message});}
  });
  socket.on('participant:answer',(payload={})=>{
    try{
      if(socket.data.role!=='player'||!game||socket.data.roomCode!==game.roomCode)throw new Error('Join the active room before answering.');
      if(game.status!=='live')throw new Error('The host is not accepting answers right now.');
      const p=game.participants[socket.data.playerId];if(!p)throw new Error('Participant session not found. Rejoin using the room code.');
      const q=getQuestion();if(!q)throw new Error('There is no active question.');
      if(p.answers[q.id])throw new Error('Your answer has already been recorded for this question.');
      const answerIndex=Number(payload.answerIndex);if(!Number.isInteger(answerIndex)||answerIndex<0||answerIndex>=q.options.length)throw new Error('Choose one of the available answers.');
      p.answers[q.id]={answerIndex,answeredAt:new Date().toISOString(),scored:false};socket.emit('participant:answer-accepted',{questionId:q.id,answerIndex});broadcastState();
    }catch(e){socket.emit('participant:answer-error',{message:e.message});}
  });
  socket.on('disconnect',()=>{
    hostSockets.delete(socket.id);
    juryHostSockets.delete(socket.id);
    if (socket.data?.juryClientId && juryGame && juryGame.participants[socket.data.juryClientId]) { juryGame.participants[socket.data.juryClientId].connected = false; broadcastJury(); }
    
    if(socket.data && socket.data.role==='player' && game && socket.data.roomCode===game.roomCode){const p=game.participants[socket.data.playerId];if(p)p.connected=false;broadcastState();}
  });
});

if (process.env.VERCEL !== '1' && require.main === module) {
  server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Strategy Court live quiz listening on http://localhost:${PORT}`);
    console.log(`Host PIN: ${HOST_PIN==='2468'?'2468 (DEFAULT — change via HOST_PIN in production)':'configured via environment'}`);
    console.log(`Configured participant capacity: ${MAX_PARTICIPANTS}`);
  });
}

module.exports = app;
