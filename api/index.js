'use strict';

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

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const url = req.url || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (url.includes('/room-code') || url.includes('/create-room')) {
    const roomCode = generateRoomCode();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, roomCode }));
    return;
  }

  if (url.includes('/quiz-info') || url.includes('/info') || url.includes('/healthz')) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      service: 'strategy-court-live-quiz',
      supportsLiveParticipants: true,
      maxParticipants: 500,
      questionCount: starterQuestions.length
    }));
    return;
  }

  
  if (url.includes('/jury/state') || url.includes('/jury')) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      roomCode: 'JURY-928104',
      status: 'active',
      currentQuestionIndex: 0,
      questionCount: 5,
      allQuestions: [{"id":"JQ-01","category":"Economics","question":"What is the most credible reason the imported column costs more than a locally packed one?","options":["Currency risk and freight add ~20–30% above the manufacturing cost","The supplier charges a quality premium for pre-packed convenience","Import duties and GST make domestic production impossible to justify"]},{"id":"JQ-02","category":"Quality & Regulation","question":"Before switching to a locally packed column, what evidence is most critical?","options":["A lower quotation from the domestic supplier","Demonstrated bed efficiency, peak symmetry and process compatibility data","Government scheme certification confirming Make in India eligibility"]},{"id":"JQ-03","category":"Strategy","question":"Which sourcing strategy best balances cost savings and supply risk?","options":["Continue importing — existing supply is qualified and risk is known","Phased localization — develop local capability while retaining the import as backup","Full switch to local — cut costs immediately after pilot batch approval"]},{"id":"JQ-04","category":"Technical","question":"What is the biggest technical barrier to packing columns in-house?","options":["Achieving reproducible bed uniformity and pressure/flow profiles batch to batch","Sourcing the resin — most resins are imported anyway","Regulatory documentation — GMP change control is too slow for urgent supply"]},{"id":"JQ-05","category":"Decision","question":"What single piece of evidence would most change your vote today?","options":["A verified domestic supplier quotation showing >20% unit cost saving","Pilot batch data showing equivalent performance to the imported column","A confirmed PLI or government subsidy that covers tooling and validation costs"]}],
      currentQuestion: {"id":"JQ-01","category":"Economics","question":"What is the most credible reason the imported column costs more than a locally packed one?","options":["Currency risk and freight add ~20–30% above the manufacturing cost","The supplier charges a quality premium for pre-packed convenience","Import duties and GST make domestic production impossible to justify"]},
      showResult: false,
      totalParticipants: 1,
      totalVotes: 0,
      optionCounts: [
        { index: 0, label: 'Currency risk and freight add ~20–30% above the manufacturing cost', count: 0, pct: 0 },
        { index: 1, label: 'The supplier charges a quality premium for pre-packed convenience', count: 0, pct: 0 },
        { index: 2, label: 'Import duties and GST make domestic production impossible to justify', count: 0, pct: 0 }
      ],
      leadingOption: null,
      recentVotes: [],
      matrix: [{"index":0,"category":"Economics","question":"What is the most credible reason the imported column costs more than a locally packed one?","totalVotes":0,"leadingIndex":-1},{"index":1,"category":"Quality & Regulation","question":"Before switching to a locally packed column, what evidence is most critical?","totalVotes":0,"leadingIndex":-1},{"index":2,"category":"Strategy","question":"Which sourcing strategy best balances cost savings and supply risk?","totalVotes":0,"leadingIndex":-1},{"index":3,"category":"Technical","question":"What is the biggest technical barrier to packing columns in-house?","totalVotes":0,"leadingIndex":-1},{"index":4,"category":"Decision","question":"What single piece of evidence would most change your vote today?","totalVotes":0,"leadingIndex":-1}]
    }));
    return;
  }

  if (url.includes('/questions')) {
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      questions: starterQuestions
    }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, status: 'online' }));
};
