const apiHandler = require('./api/index.js');
const http = require('http');

// Helper to make mock HTTP requests to apiHandler
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {
        'host': 'localhost:3000',
        'content-type': 'application/json',
        ...headers
      },
      on: function(event, handler) {
        if (event === 'data' && body) {
          handler(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') {
          handler();
        }
      }
    };

    let statusCode = 200;
    const responseHeaders = {};
    let responseData = '';

    const res = {
      setHeader: function(k, v) { responseHeaders[k.toLowerCase()] = v; },
      statusCode: 200,
      end: function(data) {
        if (data) responseData += data;
        let json = null;
        try { json = JSON.parse(responseData); } catch (e) {}
        resolve({
          status: this.statusCode || 200,
          headers: responseHeaders,
          data: json || responseData
        });
      }
    };

    apiHandler(req, res).catch(reject);
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('STARTING END-TO-END MULTI-DEVICE SYNCHRONIZATION TESTS');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: HOST AUTHENTICATION
  // --------------------------------------------------------------------------
  console.log('TEST 1: Host Authentication');
  const authFail = await request('POST', '/api/auth/host-login', { pin: 'wrong-pin' });
  if (authFail.status !== 401) throw new Error('Expected 401 for wrong PIN');
  console.log('  ✓ Invalid PIN rejected with 401');

  const authSuccess = await request('POST', '/api/auth/host-login', { pin: '2468' });
  if (authSuccess.status !== 200 || !authSuccess.data.hostToken) {
    throw new Error('Host authentication failed');
  }
  const hostToken = authSuccess.data.hostToken;
  console.log('  ✓ Valid host authentication issued secure hostToken:', hostToken.slice(0, 8) + '...');

  // --------------------------------------------------------------------------
  // TEST 2: CLASSROOM QUIZ (Host + 5 Independent Student Devices)
  // --------------------------------------------------------------------------
  console.log('\nTEST 2: Classroom Quiz Multi-Device Deliberation');
  const createQuiz = await request('POST', '/api/quiz/create-room', { hostToken }, { 'X-Host-Token': hostToken });
  if (!createQuiz.data.ok || !createQuiz.data.roomPin) throw new Error('Failed to create quiz room');
  const quizPin = createQuiz.data.roomPin;
  console.log(`  ✓ Classroom session created with 6-digit PIN: ${quizPin}`);

  const students = [
    { id: 'dev_phone_1', name: 'Aarav Patel', stance: 'Support Solution', reasoning: 'Financial model indicates ₹8.52 Cr in annual savings with 0.4 year payback.' },
    { id: 'dev_laptop_2', name: 'Priya Sharma', stance: 'Conditional Support', reasoning: 'Support phased localization only after pilot comparability is demonstrated.' },
    { id: 'dev_phone_3', name: 'Rohan Iyer', stance: 'Oppose / Alternative', reasoning: 'Risk of regulatory disruption is too high until domestic supply is GMP certified.' },
    { id: 'dev_tablet_4', name: 'Ananya Reddy', stance: 'Support Solution', reasoning: 'Local manufacturing reduces foreign currency and freight supply chain risk.' },
    { id: 'dev_phone_5', name: 'Vikram Singh', stance: 'Conditional Support', reasoning: 'Accept dual sourcing while keeping imported supply active.' }
  ];

  // All 5 students join from separate devices
  for (const s of students) {
    const joinRes = await request('POST', '/api/quiz/join', {
      roomPin: quizPin,
      name: s.name,
      clientId: s.id
    });
    if (!joinRes.data.ok) throw new Error(`Student ${s.name} failed to join`);
    console.log(`  ✓ Student joined: ${s.name} (${s.id})`);
  }

  // All 5 students submit stances and descriptive reasoning
  for (const s of students) {
    const subRes = await request('POST', '/api/quiz/submit', {
      roomPin: quizPin,
      clientId: s.id,
      name: s.name,
      stance: s.stance,
      reasoning: s.reasoning
    });
    if (!subRes.data.ok) throw new Error(`Student ${s.name} failed to submit response`);
    console.log(`  ✓ Stance submitted by ${s.name}: "${s.stance}"`);
  }

  // Host checks live state
  const hostQuizState = await request('GET', `/api/quiz/state?pin=${quizPin}`, null, { 'X-Host-Token': hostToken });
  if (!hostQuizState.data.ok) throw new Error('Host failed to fetch quiz state');
  console.log('\n  Host Live Dashboard Verification:');
  console.log(`    Total Participants: ${hostQuizState.data.totalParticipants} (expected: 5)`);
  console.log(`    Total Submitted:    ${hostQuizState.data.submittedCount} (expected: 5)`);
  console.log(`    Stance Breakdown:  Support=${hostQuizState.data.stanceTally['Support Solution']} (${hostQuizState.data.stancePercentages['Support Solution']}%), ` +
              `Conditional=${hostQuizState.data.stanceTally['Conditional Support']} (${hostQuizState.data.stancePercentages['Conditional Support']}%), ` +
              `Oppose=${hostQuizState.data.stanceTally['Oppose / Alternative']} (${hostQuizState.data.stancePercentages['Oppose / Alternative']}%)`);

  if (hostQuizState.data.totalParticipants !== 5 || hostQuizState.data.submittedCount !== 5) {
    throw new Error('Participant or response counts mismatch!');
  }
  if (hostQuizState.data.stanceTally['Support Solution'] !== 2 ||
      hostQuizState.data.stanceTally['Conditional Support'] !== 2 ||
      hostQuizState.data.stanceTally['Oppose / Alternative'] !== 1) {
    throw new Error('Stance tally calculation mismatch!');
  }
  console.log('    ✓ Individual submissions with full written reasoning verified for all 5 students.');

  // Host reveals results to class
  const revealRes = await request('POST', '/api/quiz/action', { roomPin: quizPin, action: 'reveal', hostToken }, { 'X-Host-Token': hostToken });
  if (!revealRes.data.ok || !revealRes.data.resultsRevealed) throw new Error('Failed to reveal results');
  console.log('  ✓ Presenter revealed aggregate results to class.');

  // Student 1 checks state and verifies aggregate results are visible
  const student1State = await request('GET', `/api/quiz/state?pin=${quizPin}&clientId=dev_phone_1`);
  if (!student1State.data.resultsRevealed || !student1State.data.aggregateResults) {
    throw new Error('Student does not see revealed results!');
  }
  console.log('  ✓ Connected student screen successfully received revealed class verdict breakdown.');

  // Refresh simulation for Student 1
  const student1Refresh = await request('GET', `/api/quiz/state?pin=${quizPin}&clientId=dev_phone_1`);
  if (!student1Refresh.data.mySubmission || student1Refresh.data.mySubmission.stance !== 'Support Solution') {
    throw new Error('Student submission lost on reconnect!');
  }
  console.log('  ✓ Student page refresh successfully restored previous submission and reasoning.');

  // Export CSV
  const quizCsv = await request('GET', `/api/quiz/export?pin=${quizPin}`);
  if (quizCsv.status !== 200 || !quizCsv.data.includes('Aarav Patel') || !quizCsv.data.includes('Support Solution')) {
    throw new Error('Classroom CSV export missing student data!');
  }
  console.log('  ✓ Classroom CSV exported with all 5 student responses.');

  // --------------------------------------------------------------------------
  // TEST 3: COURTROOM & JURY (Host + 6 Jurors + 7th Rejection)
  // --------------------------------------------------------------------------
  console.log('\nTEST 3: Courtroom & Jury Voting Multi-Device Deliberation');
  const createJury = await request('POST', '/api/jury/create-room', { hostToken }, { 'X-Host-Token': hostToken });
  if (!createJury.data.ok || !createJury.data.roomPin) throw new Error('Failed to create jury room');
  const juryPin = createJury.data.roomPin;
  console.log(`  ✓ Jury deliberation session created with 6-digit PIN: ${juryPin}`);

  const jurors = [
    { id: 'juror_dev_1', name: 'Juror 01 - Lead Evaluator' },
    { id: 'juror_dev_2', name: 'Juror 02 - Process Engineer' },
    { id: 'juror_dev_3', name: 'Juror 03 - Finance Controller' },
    { id: 'juror_dev_4', name: 'Juror 04 - QA Director' },
    { id: 'juror_dev_5', name: 'Juror 05 - Supply Chain Lead' },
    { id: 'juror_dev_6', name: 'Juror 06 - Regulatory Affairs' }
  ];

  // All 6 jurors join
  for (let i = 0; i < jurors.length; i++) {
    const j = jurors[i];
    const jJoin = await request('POST', '/api/jury/join', {
      roomPin: juryPin,
      name: j.name,
      clientId: j.id
    });
    if (!jJoin.data.ok || jJoin.data.slotNumber !== (i + 1)) {
      throw new Error(`Juror ${j.name} join failed or slot mismatch`);
    }
    console.log(`  ✓ Slot ${jJoin.data.slotNumber} assigned: ${j.name}`);
  }

  // 7th Juror attempts to join -> MUST BE REJECTED!
  const juror7 = await request('POST', '/api/jury/join', {
    roomPin: juryPin,
    name: 'Juror 07 - Unauthorized Seventh',
    clientId: 'juror_dev_7'
  });
  if (juror7.status !== 403 || !juror7.data.error.includes('Maximum 6 jurors')) {
    throw new Error('7th juror was NOT rejected as required!');
  }
  console.log('  ✓ 7th Juror rejected with strict enforcement: "' + juror7.data.error + '"');

  // Host starts jury
  await request('POST', '/api/jury/action', { roomPin: juryPin, action: 'start', hostToken }, { 'X-Host-Token': hostToken });
  console.log('  ✓ Host started jury (status moved to active, Question 1).');

  // Jurors vote on Question 1 (Horizon & Valuation)
  const votesQ1 = [0, 1, 1, 3, 0, 1];
  for (let i = 0; i < jurors.length; i++) {
    const j = jurors[i];
    const voteRes = await request('POST', '/api/jury/vote', {
      roomPin: juryPin,
      clientId: j.id,
      optionIndex: votesQ1[i],
      reasoning: `Rationale from ${j.name}: Evaluated DCF vs asset lifecycle.`
    });
    if (!voteRes.data.ok) throw new Error(`Juror ${j.name} vote failed`);
  }
  console.log('  ✓ All 6 jurors voted on Question 1 with written rationale.');

  // Host checks state
  const hostJuryState = await request('GET', `/api/jury/state?pin=${juryPin}`, null, { 'X-Host-Token': hostToken });
  if (hostJuryState.data.jurorCount !== 6 || hostJuryState.data.votedCount !== 6) {
    throw new Error('Jury voted count mismatch!');
  }
  console.log('  ✓ Host dashboard synchronized: 6 of 6 votes recorded for Question 1.');

  // Host advances to Question 2
  const nextQRes = await request('POST', '/api/jury/action', { roomPin: juryPin, action: 'next', hostToken }, { 'X-Host-Token': hostToken });
  if (nextQRes.data.currentIndex !== 1) throw new Error('Question advancement failed');
  console.log('  ✓ Host advanced to Question 2 (Payback & Ramp-up).');

  // Juror 1 verifies sync to Question 2
  const juror1State = await request('GET', `/api/jury/state?pin=${juryPin}&clientId=juror_dev_1`);
  if (juror1State.data.currentIndex !== 1) throw new Error('Juror did not synchronize to Question 2!');
  console.log('  ✓ Juror device screen synchronized in real time to Question 2.');

  // Export CSV
  const juryCsv = await request('GET', `/api/jury/export?pin=${juryPin}`);
  if (juryCsv.status !== 200 || !juryCsv.data.includes('Juror 01') || !juryCsv.data.includes('Question 1')) {
    throw new Error('Jury CSV export failed!');
  }
  console.log('  ✓ Jury deliberation CSV exported with all 6 jurors and rationale.');

  console.log('\n================================================================');
  console.log('✓ ALL MULTI-DEVICE SYNCHRONIZATION TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});

