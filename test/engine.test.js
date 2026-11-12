const test = require('node:test');
const assert = require('node:assert/strict');
const LC = require('../js/engine.js');

const NOW = new Date(2026, 10, 12, 9, 0); // Thu 12 Nov 2026

test('deadlines', () => {
  assert.equal(LC.parseDeadline('call the dentist tomorrow', NOW), '2026-11-13');
  assert.equal(LC.parseDeadline('proposal by Friday', NOW), '2026-11-13');
  assert.equal(LC.parseDeadline('something on thursday', NOW), '2026-11-19');
  assert.equal(LC.parseDeadline('file taxes by April 15', NOW), '2027-04-15');
  assert.equal(LC.parseDeadline('in two weeks', NOW), '2026-11-26');
  assert.equal(LC.parseDeadline('end of month', NOW), '2026-11-30');
  assert.equal(LC.parseDeadline('I may go for a walk', NOW), null);
});

test('amounts', () => {
  assert.equal(LC.parseAmount('save $3,000 for Japan'), 3000);
  assert.equal(LC.parseAmount('about $5k'), 5000);
  assert.equal(LC.parseAmount('200 dollars'), 200);
  assert.equal(LC.parseAmount('read 20 pages'), null);
});

test('kinds and areas', () => {
  const k = s => LC.classify(s, NOW);
  assert.equal(k('worried about my credit card debt').kind, 'worry');
  assert.equal(k('worried about my credit card debt').area, 'money');
  assert.equal(k('run every morning').kind, 'habit');
  assert.equal(k('gym three times a week').perWeek, 3);
  assert.equal(k('I want to save $3000 for a trip to Japan by June 30').kind, 'goal');
  assert.equal(k('idea: start a newsletter about cooking').kind, 'idea');
  assert.equal(k('buy new headphones $250').kind, 'want');
  assert.equal(k('I need to file my taxes by April 15').kind, 'task');
  assert.equal(k('I need to file my taxes by April 15').title, 'File my taxes');
  assert.equal(k('call the dentist tomorrow').title, 'Call the dentist');
  assert.equal(k('buy new headphones $250').title, 'Buy new headphones');
  assert.equal(k('I want to save $3000 for a trip to Japan by June 30').title, 'Save $3000 for a trip to Japan');
  assert.equal(k('run every morning').title, 'Run every morning');
  assert.equal(k('I want to call mom tomorrow').kind, 'task');
  assert.equal(k('call the dentist tomorrow').area, 'health');
});

test('splits run-on voice notes', () => {
  const parts = LC.splitDump('I need to pay rent and I should email my boss. Also book the car service\n- water plants');
  assert.equal(parts.length, 4);
});

test('links actions to goals', () => {
  const items = LC.sortDump('I want to save $3000 for a trip to Japan by June 30\nbook flights for the Japan trip\ncall the dentist', [], NOW);
  assert.equal(items[0].kind, 'goal');
  assert.equal(items[1].goalId, items[0].id);
  assert.equal(items[2].goalId, null);
  assert.match(items[0].nextAction, /\$\d+/);
  const linked = LC.sortDump('renew passport for japan', [{ id: 'g1', title: 'Trip to Japan' }], NOW);
  assert.equal(linked[0].goalId, 'g1');
});

test('plan respects capacity and urgency', () => {
  const tasks = [
    { id: 'a', title: 'A', createdAt: 1 },
    { id: 'b', title: 'B', due: '2026-11-12', createdAt: 2 },
    { id: 'c', title: 'C', goalId: 'g', createdAt: 3 },
    { id: 'd', title: 'D', due: '2026-11-01', createdAt: 4 },
    { id: 'e', title: 'E', doneAt: '2026-11-11' },
    { id: 'f', title: 'F', due: '2026-11-12', notBefore: '2026-11-20' },
  ];
  const plan = LC.planDay({ tasks, profile: { flaws: [] }, energy: {} }, '2026-11-12');
  assert.deepEqual(plan.ids, ['d', 'b', 'c']);
  const tired = LC.planDay({ tasks, profile: { flaws: ['burnout'] }, energy: { '2026-11-12': 'low' } }, '2026-11-12');
  assert.deepEqual(tired.ids, ['d']);
  const high = LC.planDay({ tasks, profile: { flaws: ['distraction'] }, energy: { '2026-11-12': 'high' } }, '2026-11-12');
  assert.equal(high.ids.length, 3);
});

test('streak counts back from today or yesterday', () => {
  const t = d => ({ doneAt: d });
  assert.equal(LC.streak([t('2026-11-11'), t('2026-11-10')], '2026-11-12'), 2);
  assert.equal(LC.streak([t('2026-11-12'), t('2026-11-11')], '2026-11-12'), 2);
  assert.equal(LC.streak([t('2026-11-09')], '2026-11-12'), 0);
});

test('coach does not call the list empty when work is done or parked', () => {
  const p = { tone: 'firm', flaws: [] };
  assert.match(LC.coachNote(p, { main: null, doneToday: 2, parked: 3 }), /2 done/);
  assert.match(LC.coachNote(p, { main: null, doneToday: 0, parked: 3 }), /3 parked/);
  assert.match(LC.coachNote(p, { main: null, doneToday: 0, parked: 0 }), /list is empty/);
});

test('coach changes with tone and flaw', () => {
  const ctx = { streak: 0, doneYesterday: 0, plannedYesterday: 2, overdue: 1, main: { title: 'File taxes', skips: 3 }, perDay: 20, dayIndex: 0 };
  const firm = LC.coachNote({ tone: 'firm', flaws: ['procrastination'] }, ctx);
  const gentle = LC.coachNote({ tone: 'gentle', flaws: ['perfectionism'] }, ctx);
  assert.match(firm, /pushed "File taxes" 3 times/);
  assert.match(firm, /two minutes/);
  assert.match(gentle, /information, not a verdict/);
  assert.match(gentle, /rough version/);
  assert.notEqual(firm, gentle);
});

test('money: month stats, triggers, goal delay', () => {
  const m = {
    income: 3000,
    budgets: [{ cat: 'Food', limit: 400 }, { cat: 'Fun', limit: 200 }],
    expenses: [
      { date: '2026-11-03', amount: 100, cat: 'Food' },
      { date: '2026-11-07', amount: 60, cat: 'Fun', impulse: true, feeling: 'stressed', hour: 22 },
      { date: '2026-11-08', amount: 40, cat: 'Fun', impulse: true, feeling: 'stressed', hour: 23 },
      { date: '2026-11-10', amount: 20, cat: 'Food', impulse: true, feeling: 'bored', hour: 13 },
      { date: '2026-10-30', amount: 999, cat: 'Fun' },
    ],
  };
  const s = LC.monthStats(m, '2026-11-12');
  assert.equal(s.spent, 220);
  assert.equal(s.left, 380);
  assert.equal(s.daysLeft, 19);
  assert.equal(s.impulse, 120);
  assert.equal(s.plannedSavings, 2400);
  const trig = LC.spendingTriggers(m.expenses, '2026-11-12');
  assert.ok(trig.some(x => /83% .* stressed/.test(x)));
  assert.ok(trig.some(x => /after 9pm/.test(x)));
  assert.equal(LC.delayWeeks(250, 434.5), 2.5);
  assert.equal(LC.delayWeeks(250, 0), null);
});

test('weekly review', () => {
  const state = {
    profile: { tone: 'firm' },
    tasks: [{ doneAt: '2026-11-12' }, { doneAt: '2026-11-10' }, { doneAt: '2026-11-01' }],
    habits: [{ perWeek: 7, checks: { '2026-11-12': true, '2026-11-11': true } }],
    log: [{ t: 'defer', date: '2026-11-11' }, { t: 'save', date: '2026-11-09', amount: 50 }],
    money: { expenses: [{ date: '2026-11-08', amount: 30, impulse: true }] },
  };
  const r = LC.weekReview(state, '2026-11-12');
  assert.equal(r.done, 2);
  assert.equal(r.defers, 1);
  assert.equal(r.saved, 50);
  assert.equal(r.perDay.length, 7);
  assert.ok(Math.abs(r.habitRate - 2 / 7) < 1e-9);
  assert.match(r.verdict, /2 finished, 1 deferred/);
});
