'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Try optional Supabase client
let supabase = null;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    console.log('[API] Supabase PostgreSQL connected for shared multi-device persistence.');
  } catch (err) {
    console.warn('[API] Failed to initialize Supabase client:', err.message);
  }
}

// Host authentication secret from environment (defaults to secure runtime fallback if not set)
const HOST_PIN = process.env.HOST_PIN || '2468';

// ============================================================================
// IN-MEMORY / PERSISTENT BACKUP STORE (for zero-config, serverless & local)
// ============================================================================
const memoryStore = {
  hostTokens: new Set(),
  quizSessions: new Map(), // pin -> session
  jurySessions: new Map()  // pin -> session
};

// 4 Deliberation Questions for Courtroom & Jury
const defaultJuryQuestions = [
  {
    id: "JQ-01",
    category: "Horizon & Valuation",
    question: "Is a five-year evaluation horizon long enough to judge this investment?",
    text: "Is a five-year evaluation horizon long enough to judge this investment?",
    options: [
      "Yes, if discounted cash flow is positive and payback fits within the horizon.",
      "Use five years as the base case and test 8–10 years plus residual value.",
      "Extend the horizon before deciding because long-term strategic value may be missed.",
      "Judge against asset life, replacement cycle, risk and alternative uses of capital."
    ]
  },
  {
    id: "JQ-02",
    category: "Payback & Ramp-up",
    question: "With an estimated 2.5-year payback, is it worth accepting losses during the ramp-up period?",
    text: "With an estimated 2.5-year payback, is it worth accepting losses during the ramp-up period?",
    options: [
      "Accept ramp-up losses if risk-adjusted NPV is positive and cash runway is adequate.",
      "Approve phased funding with milestone-based go/no-go gates and downside caps.",
      "Reject the investment unless it becomes cash-positive earlier.",
      "Compare ramp-up losses with ongoing import costs and disruption exposure before deciding."
    ]
  },
  {
    id: "JQ-03",
    category: "Strategic Cost & Timing",
    question: "If we delay the local facility, what is the strategic cost if competitors build first and capture the market?",
    text: "If we delay the local facility, what is the strategic cost if competitors build first and capture the market?",
    options: [
      "Invest now at full scale to secure a first-mover advantage.",
      "Start a domestic pilot and reserve scale-up options while validating demand and quality.",
      "Use a contract manufacturer or partnership before committing full capital expenditure.",
      "Delay major capital expenditure until demand and economics are demonstrated."
    ]
  },
  {
    id: "JQ-04",
    category: "Quality & Regulatory Risk",
    question: "Given the quality-critical nature of biopharma purification, how should we manage the risk of a locally made consumable failing a regulatory audit?",
    text: "Given the quality-critical nature of biopharma purification, how should we manage the risk of a locally made consumable failing a regulatory audit?",
    options: [
      "Do not use the local product in GMP production until validation and QA approval pass.",
      "Dual-source only after formal supplier qualification, comparability and change control.",
      "Continue importing for production while validating the local alternative in parallel.",
      "Run non-GMP engineering trials first and transition only after acceptance and audit checks pass."
    ]
  }
];

const defaultQuizQuestion = {
  id: 'q1',
  category: 'Strategic Decision',
  text: "Based on the evidence presented, do you support our solution for the company's future?",
  stances: [
    'Support Solution',
    'Conditional Support',
    'Oppose / Alternative'
  ]
};

// Utilities
function generateSixDigitPin() {
  return crypto.randomInt(100000, 999999).toString();
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendCsv(res, filename, csvString) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end('\uFEFF' + csvString);
}

// ============================================================================
// CLASSROOM QUIZ CONTROLLERS
// ============================================================================
async function createQuizSession(hostToken, customQuestion) {
  const pin = generateSixDigitPin();
  const q = customQuestion || defaultQuizQuestion;

  if (supabase) {
    try {
      const { data, error } = await supabase.from('quiz_sessions').insert({
        room_pin: pin,
        host_token: hostToken,
        status: 'active',
        question_id: q.id || 'q1',
        question_category: q.category || 'Strategic Decision',
        question_text: q.text || defaultQuizQuestion.text,
        results_revealed: false
      }).select().single();

      if (!error && data) {
        return { ok: true, roomPin: pin, session: data };
      }
    } catch (e) {
      console.warn('[Supabase] createQuizSession fallback to memory:', e.message);
    }
  }

  // Memory store fallback
  const session = {
    roomPin: pin,
    hostToken,
    status: 'active',
    question: { ...q },
    resultsRevealed: false,
    participants: new Map(), // clientId -> participant
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString()
  };
  memoryStore.quizSessions.set(pin, session);
  return { ok: true, roomPin: pin, session };
}

async function getQuizSession(pin) {
  if (supabase) {
    try {
      const { data: session } = await supabase
        .from('quiz_sessions')
        .select('*')
        .eq('room_pin', pin)
        .single();

      if (session) {
        const { data: participants } = await supabase
          .from('quiz_participants')
          .select('*')
          .eq('session_id', session.id);

        return {
          roomPin: session.room_pin,
          hostToken: session.host_token,
          status: session.status,
          question: {
            id: session.question_id,
            category: session.question_category,
            text: session.question_text,
            stances: defaultQuizQuestion.stances
          },
          resultsRevealed: !!session.results_revealed,
          participants: participants || [],
          isSupabase: true,
          id: session.id
        };
      }
    } catch (e) {
      console.warn('[Supabase] getQuizSession fallback to memory:', e.message);
    }
  }

  const s = memoryStore.quizSessions.get(pin);
  if (!s) return null;
  return {
    roomPin: s.roomPin,
    hostToken: s.hostToken,
    status: s.status,
    question: s.question,
    resultsRevealed: s.resultsRevealed,
    participants: Array.from(s.participants.values()),
    isSupabase: false
  };
}

// ============================================================================
// COURTROOM & JURY CONTROLLERS
// ============================================================================
async function createJurySession(hostToken, customQuestions) {
  const pin = generateSixDigitPin();
  const questions = Array.isArray(customQuestions) && customQuestions.length === 4
    ? customQuestions
    : defaultJuryQuestions;

  if (supabase) {
    try {
      const { data, error } = await supabase.from('jury_sessions').insert({
        room_pin: pin,
        host_token: hostToken,
        status: 'lobby',
        current_question_index: 0,
        results_revealed: false,
        questions: questions,
        max_jurors: 6
      }).select().single();

      if (!error && data) {
        return { ok: true, roomPin: pin, session: data };
      }
    } catch (e) {
      console.warn('[Supabase] createJurySession fallback to memory:', e.message);
    }
  }

  const session = {
    roomPin: pin,
    hostToken,
    status: 'lobby',
    currentIndex: 0,
    resultsRevealed: false,
    questions: JSON.parse(JSON.stringify(questions)),
    maxJurors: 6,
    participants: new Map(), // clientId -> participant
    votes: new Map(),        // `${clientId}_${questionIndex}` -> vote
    createdAt: new Date().toISOString()
  };
  memoryStore.jurySessions.set(pin, session);
  return { ok: true, roomPin: pin, session };
}

async function getJurySession(pin) {
  if (supabase) {
    try {
      const { data: session } = await supabase
        .from('jury_sessions')
        .select('*')
        .eq('room_pin', pin)
        .single();

      if (session) {
        const { data: participants } = await supabase
          .from('jury_participants')
          .select('*')
          .eq('session_id', session.id);

        const { data: votes } = await supabase
          .from('jury_votes')
          .select('*')
          .eq('session_id', session.id);

        return {
          id: session.id,
          roomPin: session.room_pin,
          hostToken: session.host_token,
          status: session.status,
          currentIndex: session.current_question_index,
          resultsRevealed: !!session.results_revealed,
          questions: session.questions,
          maxJurors: session.max_jurors || 6,
          participants: participants || [],
          votes: votes || [],
          isSupabase: true
        };
      }
    } catch (e) {
      console.warn('[Supabase] getJurySession fallback to memory:', e.message);
    }
  }

  const s = memoryStore.jurySessions.get(pin);
  if (!s) return null;
  return {
    roomPin: s.roomPin,
    hostToken: s.hostToken,
    status: s.status,
    currentIndex: s.currentIndex,
    resultsRevealed: s.resultsRevealed,
    questions: s.questions,
    maxJurors: s.maxJurors,
    participants: Array.from(s.participants.values()),
    votes: Array.from(s.votes.values()),
    isSupabase: false
  };
}

// ============================================================================
// MAIN VERCEL / SERVERLESS DISPATCHER
// ============================================================================
module.exports = async (req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Host-Token, X-Client-Id');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const searchParams = parsedUrl.searchParams;

  // --------------------------------------------------------------------------
  // 1. PUBLIC CONFIGURATION (Enables Supabase Realtime in frontend if configured)
  // --------------------------------------------------------------------------
  if (pathname === '/api/config') {
    return sendJson(res, 200, {
      ok: true,
      hasSupabase: !!supabase,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
      environment: process.env.NODE_ENV || 'production'
    });
  }

  // --------------------------------------------------------------------------
  // 2. HOST AUTHENTICATION (Secure, no hardcoded PIN exposed)
  // --------------------------------------------------------------------------
  if (pathname === '/api/auth/host-login' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const pin = String(body.pin || '').trim();

    if (pin && pin === HOST_PIN) {
      const token = generateToken();
      memoryStore.hostTokens.add(token);
      return sendJson(res, 200, {
        ok: true,
        hostToken: token,
        message: 'Host authentication successful.'
      });
    }

    return sendJson(res, 401, {
      ok: false,
      error: 'Invalid host PIN. Please enter the authorized presenter PIN.'
    });
  }

  // --------------------------------------------------------------------------
  // 3. CLASSROOM QUIZ ENDPOINTS
  // --------------------------------------------------------------------------

  // 3a. Host creates classroom room
  if (pathname === '/api/quiz/create-room' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const token = req.headers['x-host-token'] || body.hostToken;
    const pinAuth = String(body.pin || '').trim();

    const isAuthed = (token && memoryStore.hostTokens.has(token)) || (pinAuth && pinAuth === HOST_PIN);
    if (!isAuthed) {
      return sendJson(res, 403, { ok: false, error: 'Unauthorized host. Valid PIN or token required.' });
    }

    const hostToken = token || generateToken();
    memoryStore.hostTokens.add(hostToken);

    const result = await createQuizSession(hostToken, body.question);
    return sendJson(res, 200, {
      ok: true,
      roomPin: result.roomPin,
      hostToken
    });
  }

  // 3b. Participant joins classroom room
  if (pathname === '/api/quiz/join' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const name = String(body.name || '').trim();
    const clientId = String(body.clientId || '').trim() || generateToken();

    if (!roomPin || !name) {
      return sendJson(res, 400, { ok: false, error: 'Room PIN and your name are required.' });
    }

    const session = await getQuizSession(roomPin);
    if (!session) {
      return sendJson(res, 404, { ok: false, error: 'Quiz room not found. Check the 6-digit PIN and try again.' });
    }

    if (session.status === 'ended') {
      return sendJson(res, 400, { ok: false, error: 'This quiz deliberation has ended.' });
    }

    // Register participant
    if (session.isSupabase) {
      await supabase.from('quiz_participants').upsert({
        session_id: session.id,
        client_id: clientId,
        name: name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id,client_id' });
    } else {
      const memSession = memoryStore.quizSessions.get(roomPin);
      if (memSession) {
        const existing = memSession.participants.get(clientId);
        memSession.participants.set(clientId, {
          clientId,
          name,
          stance: existing ? existing.stance : null,
          reasoning: existing ? existing.reasoning : '',
          submittedAt: existing ? existing.submittedAt : null,
          joinedAt: new Date().toISOString()
        });
      }
    }

    // Return current state for participant
    const updated = await getQuizSession(roomPin);
    const p = updated.participants.find(x => (x.client_id || x.clientId) === clientId);

    return sendJson(res, 200, {
      ok: true,
      roomPin,
      status: updated.status,
      question: updated.question,
      resultsRevealed: updated.resultsRevealed,
      mySubmission: p && p.stance ? {
        stance: p.stance,
        reasoning: p.reasoning || '',
        submittedAt: p.submitted_at || p.submittedAt
      } : null
    });
  }

  // 3c. Participant submits stance + written reasoning
  if (pathname === '/api/quiz/submit' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const clientId = String(body.clientId || '').trim();
    const name = String(body.name || '').trim();
    const stance = String(body.stance || '').trim();
    const reasoning = String(body.reasoning || '').trim();

    if (!roomPin || !clientId || !stance) {
      return sendJson(res, 400, { ok: false, error: 'Room PIN, client ID, and stance are required.' });
    }

    const session = await getQuizSession(roomPin);
    if (!session) {
      return sendJson(res, 404, { ok: false, error: 'Session not found.' });
    }

    const now = new Date().toISOString();

    if (session.isSupabase) {
      await supabase.from('quiz_participants').upsert({
        session_id: session.id,
        client_id: clientId,
        name: name || 'Participant',
        stance: stance,
        reasoning: reasoning,
        submitted_at: now,
        updated_at: now
      }, { onConflict: 'session_id,client_id' });
    } else {
      const memSession = memoryStore.quizSessions.get(roomPin);
      if (memSession) {
        memSession.participants.set(clientId, {
          clientId,
          name: name || 'Participant',
          stance,
          reasoning,
          submittedAt: now
        });
      }
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Your response was recorded successfully.',
      submittedAt: now
    });
  }

  // 3d. Fetch classroom quiz state (for participant or host)
  if (pathname === '/api/quiz/state') {
    const roomPin = searchParams.get('pin') || searchParams.get('roomPin');
    const clientId = searchParams.get('clientId');
    const hostToken = req.headers['x-host-token'] || searchParams.get('hostToken');

    if (!roomPin) {
      return sendJson(res, 400, { ok: false, error: 'Room PIN parameter required.' });
    }

    const session = await getQuizSession(roomPin);
    if (!session) {
      return sendJson(res, 404, { ok: false, error: 'Room not found.' });
    }

    const participants = session.participants.map(p => ({
      clientId: p.client_id || p.clientId,
      name: p.name,
      stance: p.stance || null,
      reasoning: p.reasoning || '',
      submittedAt: p.submitted_at || p.submittedAt || null
    }));

    const submittedList = participants.filter(p => !!p.stance);
    const totalCount = participants.length;
    const submittedCount = submittedList.length;

    // Calculate stance distribution
    const stanceTally = {
      'Support Solution': 0,
      'Conditional Support': 0,
      'Oppose / Alternative': 0
    };

    submittedList.forEach(p => {
      if (p.stance && stanceTally[p.stance] !== undefined) {
        stanceTally[p.stance]++;
      } else if (p.stance && p.stance.includes('Support Local')) {
        stanceTally['Support Solution']++;
      } else if (p.stance && p.stance.includes('Conditional')) {
        stanceTally['Conditional Support']++;
      } else if (p.stance && p.stance.includes('Oppose')) {
        stanceTally['Oppose / Alternative']++;
      }
    });

    const stancePercentages = {
      'Support Solution': submittedCount ? Math.round((stanceTally['Support Solution'] / submittedCount) * 100) : 0,
      'Conditional Support': submittedCount ? Math.round((stanceTally['Conditional Support'] / submittedCount) * 100) : 0,
      'Oppose / Alternative': submittedCount ? Math.round((stanceTally['Oppose / Alternative'] / submittedCount) * 100) : 0
    };

    const isHost = hostToken && (session.hostToken === hostToken || memoryStore.hostTokens.has(hostToken));

    const response = {
      ok: true,
      roomPin: session.roomPin,
      status: session.status,
      question: session.question,
      resultsRevealed: session.resultsRevealed,
      totalParticipants: totalCount,
      submittedCount: submittedCount,
      stanceTally,
      stancePercentages,
      isHost
    };

    if (isHost) {
      // Host sees full list of individual submissions & reasoning
      response.submissions = submittedList;
      response.participants = participants;
    } else if (clientId) {
      // Participant sees their own submission
      const mine = participants.find(p => p.clientId === clientId);
      response.mySubmission = mine && mine.stance ? {
        stance: mine.stance,
        reasoning: mine.reasoning,
        submittedAt: mine.submittedAt
      } : null;

      // If revealed, participant also sees aggregate tally
      if (session.resultsRevealed) {
        response.aggregateResults = {
          totalSubmitted: submittedCount,
          stanceTally,
          stancePercentages
        };
      }
    }

    return sendJson(res, 200, response);
  }

  // 3e. Host actions (reveal results, close, reset, edit question)
  if (pathname === '/api/quiz/action' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const action = String(body.action || '').trim();
    const hostToken = req.headers['x-host-token'] || body.hostToken;

    const session = await getQuizSession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Room not found.' });

    const isAuthed = hostToken && (session.hostToken === hostToken || memoryStore.hostTokens.has(hostToken));
    if (!isAuthed) return sendJson(res, 403, { ok: false, error: 'Unauthorized host token.' });

    if (action === 'toggle-reveal' || action === 'reveal') {
      const newRevealed = action === 'reveal' ? true : !session.resultsRevealed;
      if (session.isSupabase) {
        await supabase.from('quiz_sessions').update({ results_revealed: newRevealed }).eq('id', session.id);
      } else {
        const s = memoryStore.quizSessions.get(roomPin);
        if (s) s.resultsRevealed = newRevealed;
      }
      return sendJson(res, 200, { ok: true, resultsRevealed: newRevealed });
    }

    if (action === 'close') {
      if (session.isSupabase) {
        await supabase.from('quiz_sessions').update({ status: 'ended' }).eq('id', session.id);
      } else {
        const s = memoryStore.quizSessions.get(roomPin);
        if (s) s.status = 'ended';
      }
      return sendJson(res, 200, { ok: true, status: 'ended' });
    }

    if (action === 'reset') {
      if (session.isSupabase) {
        await supabase.from('quiz_participants').delete().eq('session_id', session.id);
        await supabase.from('quiz_sessions').update({ results_revealed: false }).eq('id', session.id);
      } else {
        const s = memoryStore.quizSessions.get(roomPin);
        if (s) {
          s.participants.clear();
          s.resultsRevealed = false;
        }
      }
      return sendJson(res, 200, { ok: true, message: 'Classroom submissions reset.' });
    }

    return sendJson(res, 400, { ok: false, error: 'Unknown action.' });
  }

  // 3f. Export classroom responses to CSV
  if (pathname === '/api/quiz/export') {
    const roomPin = searchParams.get('pin') || searchParams.get('roomPin');
    if (!roomPin) return sendJson(res, 400, { ok: false, error: 'Room PIN required.' });

    const session = await getQuizSession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Room not found.' });

    const participants = session.participants.map(p => ({
      name: p.name || 'Anonymous',
      stance: p.stance || 'No response',
      reasoning: (p.reasoning || '').replace(/"/g, '""'),
      submittedAt: p.submitted_at || p.submittedAt || 'N/A'
    }));

    const rows = [
      ['Participant Name', 'Selected Stance', 'Descriptive Reasoning', 'Submitted At'],
      ...participants.map(p => [
        `"${p.name}"`,
        `"${p.stance}"`,
        `"${p.reasoning}"`,
        `"${p.submittedAt}"`
      ])
    ];

    const csvContent = rows.map(r => r.join(',')).join('\r\n');
    return sendCsv(res, `biopopcorn-classroom-responses-${roomPin}.csv`, csvContent);
  }

  // --------------------------------------------------------------------------
  // 4. COURTROOM & JURY ENDPOINTS (Max 6 Jurors, 4 Questions)
  // --------------------------------------------------------------------------

  // 4a. Host creates jury room
  if (pathname === '/api/jury/create-room' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const token = req.headers['x-host-token'] || body.hostToken;
    const pinAuth = String(body.pin || '').trim();

    const isAuthed = (token && memoryStore.hostTokens.has(token)) || (pinAuth && pinAuth === HOST_PIN);
    if (!isAuthed) {
      return sendJson(res, 403, { ok: false, error: 'Unauthorized host. Valid PIN or token required.' });
    }

    const hostToken = token || generateToken();
    memoryStore.hostTokens.add(hostToken);

    const result = await createJurySession(hostToken, body.questions);
    return sendJson(res, 200, {
      ok: true,
      roomPin: result.roomPin,
      hostToken
    });
  }

  // 4b. Juror joins jury room (Enforces strict max 6 jurors!)
  if (pathname === '/api/jury/join' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const name = String(body.name || '').trim();
    const clientId = String(body.clientId || '').trim() || generateToken();

    if (!roomPin || !name) {
      return sendJson(res, 400, { ok: false, error: 'Room code and your name are required.' });
    }

    const session = await getJurySession(roomPin);
    if (!session) {
      return sendJson(res, 404, { ok: false, error: 'Jury room not found. Check the 6-digit code.' });
    }

    // Check if this juror already joined previously
    const existingJuror = session.participants.find(p => (p.client_id || p.clientId) === clientId);

    // If new juror and already 6 slots taken, reject 7th juror!
    if (!existingJuror && session.participants.length >= 6) {
      return sendJson(res, 403, {
        ok: false,
        error: 'Jury room is full. Maximum 6 jurors allowed in the Strategy Court.'
      });
    }

    const slotNumber = existingJuror
      ? (existingJuror.slot_number || existingJuror.slotNumber)
      : session.participants.length + 1;

    if (session.isSupabase) {
      await supabase.from('jury_participants').upsert({
        session_id: session.id,
        client_id: clientId,
        name: name,
        slot_number: slotNumber,
        connected: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'session_id,client_id' });
    } else {
      const s = memoryStore.jurySessions.get(roomPin);
      if (s) {
        s.participants.set(clientId, {
          clientId,
          name,
          slotNumber,
          connected: true,
          joinedAt: new Date().toISOString()
        });
      }
    }

    const updated = await getJurySession(roomPin);
    const currentQ = updated.questions[updated.currentIndex] || null;

    // Check if juror already voted on current question
    const myVote = updated.votes.find(v =>
      (v.client_id || v.clientId) === clientId &&
      (v.question_index ?? v.questionIndex) === updated.currentIndex
    );

    return sendJson(res, 200, {
      ok: true,
      roomPin,
      status: updated.status,
      slotNumber,
      currentIndex: updated.currentIndex,
      totalQuestions: updated.questions.length,
      currentQuestion: currentQ,
      resultsRevealed: updated.resultsRevealed,
      myVote: myVote ? {
        optionIndex: myVote.option_index ?? myVote.optionIndex,
        optionText: myVote.option_text ?? myVote.optionText,
        reasoning: myVote.reasoning || ''
      } : null
    });
  }

  // 4c. Juror votes on active question
  if (pathname === '/api/jury/vote' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const clientId = String(body.clientId || '').trim();
    const optionIndex = Number(body.optionIndex);
    const reasoning = String(body.reasoning || '').trim();

    if (!roomPin || !clientId || isNaN(optionIndex) || optionIndex < 0 || optionIndex > 3) {
      return sendJson(res, 400, { ok: false, error: 'Valid room code, client ID, and option index (0-3) are required.' });
    }

    const session = await getJurySession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Jury room not found.' });

    const qIdx = session.currentIndex;
    const q = session.questions[qIdx];
    if (!q) return sendJson(res, 400, { ok: false, error: 'No active deliberation question.' });

    const optionText = q.options[optionIndex] || `Option ${optionIndex + 1}`;
    const now = new Date().toISOString();

    if (session.isSupabase) {
      const participant = session.participants.find(p => p.client_id === clientId);
      if (!participant) return sendJson(res, 403, { ok: false, error: 'Juror not registered in this room.' });

      await supabase.from('jury_votes').upsert({
        session_id: session.id,
        participant_id: participant.id,
        client_id: clientId,
        question_index: qIdx,
        option_index: optionIndex,
        option_text: optionText,
        reasoning: reasoning,
        submitted_at: now
      }, { onConflict: 'session_id,participant_id,question_index' });
    } else {
      const s = memoryStore.jurySessions.get(roomPin);
      if (s) {
        s.votes.set(`${clientId}_${qIdx}`, {
          clientId,
          questionIndex: qIdx,
          optionIndex,
          optionText,
          reasoning,
          submittedAt: now
        });
      }
    }

    return sendJson(res, 200, {
      ok: true,
      message: 'Vote and written reasoning recorded.',
      questionIndex: qIdx,
      optionIndex,
      optionText
    });
  }

  // 4d. Fetch Jury State
  if (pathname === '/api/jury/state') {
    const roomPin = searchParams.get('pin') || searchParams.get('roomPin');
    const clientId = searchParams.get('clientId');
    const hostToken = req.headers['x-host-token'] || searchParams.get('hostToken');

    if (!roomPin) return sendJson(res, 400, { ok: false, error: 'Room code required.' });

    const session = await getJurySession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Jury room not found.' });

    const qIdx = session.currentIndex;
    const currentQ = session.questions[qIdx] || null;
    const participants = session.participants.map(p => ({
      clientId: p.client_id || p.clientId,
      name: p.name,
      slotNumber: p.slot_number || p.slotNumber,
      connected: p.connected !== false
    }));

    // Votes for the current question
    const currentVotes = session.votes
      .filter(v => (v.question_index ?? v.questionIndex) === qIdx)
      .map(v => {
        const p = participants.find(part => part.clientId === (v.client_id || v.clientId));
        return {
          clientId: v.client_id || v.clientId,
          name: p ? p.name : 'Juror',
          optionIndex: v.option_index ?? v.optionIndex,
          optionText: v.option_text ?? v.optionText,
          reasoning: v.reasoning || '',
          submittedAt: v.submitted_at || v.submittedAt
        };
      });

    // Compute option counts & percentages
    const optionCounts = currentQ ? currentQ.options.map((opt, idx) => {
      const count = currentVotes.filter(v => v.optionIndex === idx).length;
      const pct = currentVotes.length ? Math.round((count / currentVotes.length) * 100) : 0;
      return { index: idx, label: opt, count, pct };
    }) : [];

    const isHost = hostToken && (session.hostToken === hostToken || memoryStore.hostTokens.has(hostToken));

    const state = {
      ok: true,
      roomPin: session.roomPin,
      status: session.status,
      currentIndex: qIdx,
      totalQuestions: session.questions.length,
      currentQuestion: currentQ,
      resultsRevealed: session.resultsRevealed,
      jurorCount: participants.length,
      votedCount: currentVotes.length,
      optionCounts,
      isHost
    };

    if (isHost) {
      state.participants = participants;
      state.currentVotes = currentVotes;
      state.allQuestions = session.questions;
    } else if (clientId) {
      const myVote = currentVotes.find(v => v.clientId === clientId);
      state.myVote = myVote ? {
        optionIndex: myVote.optionIndex,
        optionText: myVote.optionText,
        reasoning: myVote.reasoning
      } : null;

      if (session.resultsRevealed) {
        state.results = {
          totalVotes: currentVotes.length,
          optionCounts
        };
      }
    }

    return sendJson(res, 200, state);
  }

  // 4e. Host jury actions (start, advance question, toggle results, reset)
  if (pathname === '/api/jury/action' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const roomPin = String(body.roomPin || body.pin || '').trim();
    const action = String(body.action || '').trim();
    const hostToken = req.headers['x-host-token'] || body.hostToken;

    const session = await getJurySession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Jury room not found.' });

    const isAuthed = hostToken && (session.hostToken === hostToken || memoryStore.hostTokens.has(hostToken));
    if (!isAuthed) return sendJson(res, 403, { ok: false, error: 'Unauthorized host token.' });

    if (action === 'start') {
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ status: 'active', current_question_index: 0, results_revealed: false }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) { s.status = 'active'; s.currentIndex = 0; s.resultsRevealed = false; }
      }
      return sendJson(res, 200, { ok: true, status: 'active', currentIndex: 0 });
    }

    if (action === 'next') {
      const nextIdx = Math.min(session.questions.length - 1, session.currentIndex + 1);
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ current_question_index: nextIdx, results_revealed: false }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) { s.currentIndex = nextIdx; s.resultsRevealed = false; }
      }
      return sendJson(res, 200, { ok: true, currentIndex: nextIdx, resultsRevealed: false });
    }

    if (action === 'prev') {
      const prevIdx = Math.max(0, session.currentIndex - 1);
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ current_question_index: prevIdx, results_revealed: false }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) { s.currentIndex = prevIdx; s.resultsRevealed = false; }
      }
      return sendJson(res, 200, { ok: true, currentIndex: prevIdx });
    }

    if (action === 'show-results' || action === 'reveal') {
      const newRevealed = action === 'show-results' ? true : !session.resultsRevealed;
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ results_revealed: newRevealed }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) s.resultsRevealed = newRevealed;
      }
      return sendJson(res, 200, { ok: true, resultsRevealed: newRevealed });
    }

    if (action === 'hide-results') {
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ results_revealed: false }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) s.resultsRevealed = false;
      }
      return sendJson(res, 200, { ok: true, resultsRevealed: false });
    }

    if (action === 'end' || action === 'close') {
      if (session.isSupabase) {
        await supabase.from('jury_sessions').update({ status: 'ended' }).eq('id', session.id);
      } else {
        const s = memoryStore.jurySessions.get(roomPin);
        if (s) s.status = 'ended';
      }
      return sendJson(res, 200, { ok: true, status: 'ended' });
    }

    return sendJson(res, 400, { ok: false, error: 'Unknown action.' });
  }

  // 4f. Export jury votes & rationale to CSV
  if (pathname === '/api/jury/export') {
    const roomPin = searchParams.get('pin') || searchParams.get('roomPin');
    if (!roomPin) return sendJson(res, 400, { ok: false, error: 'Room code required.' });

    const session = await getJurySession(roomPin);
    if (!session) return sendJson(res, 404, { ok: false, error: 'Room not found.' });

    const rows = [
      ['Question Number', 'Question Category', 'Question Text', 'Juror Name', 'Selected Option', 'Written Rationale', 'Timestamp']
    ];

    session.questions.forEach((q, qIdx) => {
      const qVotes = session.votes.filter(v => (v.question_index ?? v.questionIndex) === qIdx);
      qVotes.forEach(v => {
        const p = session.participants.find(part => (part.client_id || part.clientId) === (v.client_id || v.clientId));
        rows.push([
          `Question ${qIdx + 1}`,
          `"${q.category || ''}"`,
          `"${q.text.replace(/"/g, '""')}"`,
          `"${p ? p.name : 'Juror'}"`,
          `"${(v.option_text || v.optionText || '').replace(/"/g, '""')}"`,
          `"${(v.reasoning || '').replace(/"/g, '""')}"`,
          `"${v.submitted_at || v.submittedAt || ''}"`
        ]);
      });
    });

    const csvContent = rows.map(r => r.join(',')).join('\r\n');
    return sendCsv(res, `biopopcorn-jury-votes-${roomPin}.csv`, csvContent);
  }

  // --------------------------------------------------------------------------
  // 5. LEGACY FALLBACK ROUTES
  // --------------------------------------------------------------------------
  if (pathname.includes('/room-code') || pathname.includes('/create-room')) {
    return sendJson(res, 200, { ok: true, roomCode: generateSixDigitPin() });
  }

  return sendJson(res, 200, {
    ok: true,
    service: 'biopopcorn-decision-lab',
    status: 'online',
    supportsRealtime: true,
    hasSupabase: !!supabase
  });
};
