/* First Light — interface. State lives in localStorage; logic lives in engine.js. */
(function () {
  'use strict';
  const LC = window.LC;
  const KEY = 'firstlight.v1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => LC.isoDate(new Date());
  const fmt = LC.money;

  const blank = () => ({
    v: 1, profile: null, tasks: [], goals: [], habits: [], ideas: [], worries: [],
    money: { income: 0, budgets: [], expenses: [], cooling: [] },
    plans: {}, energy: {}, log: [], reviews: [],
  });
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return Object.assign(blank(), s, { money: Object.assign(blank().money, s.money) });
    } catch (e) { /* fall through to a fresh start */ }
    return blank();
  }
  let state = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Could not save on this device.'); } };
  const ui = { view: 'today', draft: '', preview: null, editBudget: false, timer: null };

  const task = id => state.tasks.find(t => t.id === id);
  const goal = id => state.goals.find(g => g.id === id);
  const has = flaw => !!state.profile && state.profile.flaws.includes(flaw);

  // ---------- plan ----------
  function plan() {
    const t = today();
    if (!state.plans[t]) {
      const p = LC.planDay(state, t);
      state.plans[t] = { ids: p.ids, capacity: p.capacity, why: p.why, deferred: [] };
      save();
    }
    return state.plans[t];
  }
  function replan() {
    const t = today();
    const old = state.plans[t] || { ids: [], deferred: [] };
    const doneIds = old.ids.filter(id => (task(id) || {}).doneAt === t);
    const p = LC.planDay(state, t, old.deferred);
    const room = Math.max(0, p.capacity - doneIds.length);
    state.plans[t] = { ids: doneIds.concat(p.ids.slice(0, room)), capacity: p.capacity, why: p.why, deferred: old.deferred };
  }
  function addTask(fields) {
    const t = Object.assign({ id: uid(), title: '', area: 'life', due: null, effort: 'light', goalId: null, skips: 0, createdAt: Date.now() }, fields);
    state.tasks.push(t);
    return t;
  }

  // ---------- small render helpers ----------
  function dueLabel(iso) {
    const d = LC.daysBetween(today(), iso);
    if (d < 0) return `<span class="chip warn">${-d}d overdue</span>`;
    if (d === 0) return '<span class="chip">Due today</span>';
    if (d === 1) return '<span class="chip">Due tomorrow</span>';
    return `<span class="chip plain">${esc(LC.fromIso(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>`;
  }
  const bar = (value, max, cls) => `<div class="bar ${cls || ''}"><i style="width:${max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0}%"></i></div>`;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3600);
  }
  function openDialog(html) { const d = $('#dlg'); d.innerHTML = html; if (!d.open) d.showModal(); }
  const closeDialog = () => { const d = $('#dlg'); if (d.open) d.close(); };

  function profileForm(p, cta) {
    p = p || { name: '', tone: 'balanced', peak: 'morning', flaws: [], strengths: [] };
    const radio = (name, value, label, hint) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${p[name] === value ? 'checked' : ''}><span>${label}<small>${hint}</small></span></label>`;
    const box = (name, value, label) => `<label class="choice"><input type="checkbox" name="${name}" value="${value}" ${p[name].includes(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    return `<form data-f="profile">
      <div class="field"><label for="pname">What should I call you?</label><input id="pname" name="name" value="${esc(p.name)}" autocomplete="given-name" maxlength="40"></div>
      <fieldset><legend>How should I talk to you?</legend><div class="choices">
        ${radio('tone', 'gentle', 'Gently', 'Encourage me')}
        ${radio('tone', 'balanced', 'Plainly', 'Just the facts')}
        ${radio('tone', 'firm', 'Firmly', 'Hold me to it')}
      </div></fieldset>
      <fieldset><legend>When is your energy best?</legend><div class="choices">
        ${radio('peak', 'morning', 'Morning', 'Before 11am')}
        ${radio('peak', 'afternoon', 'Afternoon', '1–4pm')}
        ${radio('peak', 'evening', 'Evening', 'After 7pm')}
      </div></fieldset>
      <fieldset><legend>What trips you up? Be honest.</legend><div class="choices">
        ${Object.entries(LC.FLAWS).map(([k, v]) => box('flaws', k, v)).join('')}
      </div></fieldset>
      <fieldset><legend>What are you good at?</legend><div class="choices">
        ${Object.entries(LC.STRENGTHS).map(([k, v]) => box('strengths', k, v)).join('')}
      </div></fieldset>
      <button class="btn sun">${cta}</button>
    </form>`;
  }

  // ---------- views ----------
  const views = {};

  views.welcome = () => `
    <header class="hero">
      <p class="eyebrow">First Light</p>
      <h1>Empty your head. Wake up to one clear thing.</h1>
      <p class="lede">Tell me how you work, including where you get stuck, and I will plan and coach around it. Everything stays on this device.</p>
    </header>
    <div class="card">${profileForm(null, 'Begin')}</div>`;

  views.today = () => {
    const t = today(), p = plan(), prof = state.profile;
    const now = new Date();
    const part = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
    const focus = p.ids.map(task).filter(Boolean);
    const openFocus = focus.filter(x => !x.doneAt);
    const y = LC.shiftIso(t, -1);
    const ms = state.money.budgets.length ? LC.monthStats(state.money, t) : null;
    const note = LC.coachNote(prof, {
      doneToday: state.tasks.filter(x => x.doneAt === t).length,
      parked: state.tasks.filter(x => !x.doneAt && !p.ids.includes(x.id) && !(x.notBefore && x.notBefore > t)).length,
      streak: LC.streak(state.tasks, t),
      doneYesterday: state.tasks.filter(x => x.doneAt === y).length,
      plannedYesterday: state.plans[y] ? state.plans[y].ids.length : 0,
      overdue: state.tasks.filter(x => !x.doneAt && x.due && x.due < t).length,
      main: openFocus[0] || null,
      perDay: ms ? ms.perDay : null,
      dayIndex: Math.floor(LC.fromIso(t) / 864e5),
    });
    const parked = state.tasks.filter(x => !x.doneAt && !p.ids.includes(x.id));
    const allDone = focus.length > 0 && openFocus.length === 0;

    const energy = state.energy[t]
      ? ''
      : `<div class="card"><p>How is your energy this ${part}?</p><div class="row">
          <button class="btn" data-a="energy" data-v="low">Low</button>
          <button class="btn" data-a="energy" data-v="steady">Steady</button>
          <button class="btn" data-a="energy" data-v="high">High</button></div></div>`;

    const item = (x, i) => {
      const g = x.goalId && goal(x.goalId);
      const first = x === openFocus[0];
      const actions = x.doneAt ? '' : `<div class="row">
          ${has('procrastination') ? `<button class="btn small sun" data-a="timer" data-id="${x.id}" data-min="2">Start 2 minutes</button>` : ''}
          <button class="btn small ${has('procrastination') ? '' : 'sun'}" data-a="timer" data-id="${x.id}" data-min="25">Focus 25</button>
          ${has('perfectionism') ? `<button class="btn small" data-a="toggle" data-id="${x.id}">Good enough, done</button>` : ''}
          <button class="btn small quiet" data-a="defer" data-id="${x.id}">Not today</button></div>`;
      return `<li class="focus ${x.doneAt ? 'done' : ''} ${first ? 'main' : ''}">
        <button class="check" data-a="toggle" data-id="${x.id}" aria-label="${x.doneAt ? 'Mark not done' : 'Mark done'}: ${esc(x.title)}"></button>
        <div class="body">
          ${first ? '<p class="eyebrow">The one thing</p>' : ''}
          <div class="title">${esc(x.title)}</div>
          <div class="meta">${x.due ? dueLabel(x.due) : ''}${g ? `<span class="chip plain">→ ${esc(g.title)}</span>` : ''}<span class="chip plain">${esc(LC.whenLabel(x, prof))}</span></div>
          ${actions}
        </div></li>`;
    };

    const focusCard = focus.length
      ? `<div class="card"><ul class="list">${focus.map(item).join('')}</ul>
          ${allDone ? `<hr><p>That is today's list, finished. Stop here, or pull one more.</p>${parked.length ? '<button class="btn" data-a="pull">Pull one more</button>' : ''}` : ''}
          <p class="small muted" style="margin:12px 0 0">${focus.length} of ${state.tasks.filter(x => !x.doneAt).length + focus.filter(x => x.doneAt).length} on your plate today: ${esc(p.why)}.</p></div>`
      : `<div class="card empty"><p>Nothing planned ${parked.length ? 'for today' : 'yet'}.</p><div class="row" style="justify-content:center">${parked.length ? '<button class="btn sun" data-a="pull">Pull one in</button>' : ''}<button class="btn ${parked.length ? '' : 'sun'}" data-a="go" data-v="inbox">Empty your head</button></div></div>`;

    const habits = state.habits.length ? `<h2>Habits</h2><div class="card"><ul class="list">${state.habits.map(h => {
      const wk = LC.weekReview({ profile: prof, tasks: [], habits: [h], log: [], money: { expenses: [] } }, t);
      const n = wk.days.filter(d => h.checks[d]).length;
      return `<li class="item ${h.checks[t] ? 'done' : ''}"><button class="check ${h.checks[t] ? 'on' : ''}" data-a="habit" data-id="${h.id}" aria-label="Toggle ${esc(h.title)}"></button>
        <span class="grow">${esc(h.title)}</span><span class="chip plain">${n}/${h.perWeek} this week</span></li>`;
    }).join('')}</ul></div>` : '';

    const moneyLine = ms ? `<div class="card spread"><span>${ms.left >= 0 ? `<b>${fmt(ms.left)}</b> left this month` : `<b>${fmt(-ms.left)}</b> over budget`}</span>
      <span class="muted small">${ms.left > 0 ? `${fmt(ms.perDay)} a day for ${ms.daysLeft} days` : 'No room for wants until next month'}</span></div>` : '';

    const parkedHtml = parked.length ? `<details><summary>${parked.length} more parked, out of sight on purpose</summary><div class="card"><ul class="list">${
      parked.map(x => `<li class="item"><button class="check" data-a="toggle" data-id="${x.id}" aria-label="Mark done: ${esc(x.title)}"></button><span class="grow">${esc(x.title)}</span>${x.due ? dueLabel(x.due) : ''}<button class="btn small quiet danger" data-a="deltask" data-id="${x.id}" aria-label="Delete ${esc(x.title)}">Delete</button></li>`).join('')
    }</ul></div></details>` : '';

    return `<header class="hero">
        <p class="eyebrow">${esc(now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
        <h1>Good ${part}${prof.name ? ', ' + esc(prof.name) : ''}.</h1>
      </header>
      ${energy}
      <div class="card coach"><p class="eyebrow">Your coach</p>${esc(note)}</div>
      ${focusCard}${moneyLine}${habits}${parkedHtml}`;
  };

  const KINDS = { task: 'Action', goal: 'Goal', habit: 'Habit', idea: 'Idea', worry: 'Worry', want: 'Want' };
  const SAMPLE = `I need to file my taxes by April 15
call the dentist tomorrow
I want to save $3000 for a trip to Japan by June 30
worried about my credit card debt
run every morning
idea: start a newsletter about home cooking
buy new headphones $250
finish the client proposal by Friday
book flights for the Japan trip
read 20 pages every day`;

  views.inbox = () => {
    if (ui.preview) {
      const names = Object.fromEntries(state.goals.map(g => [g.id, g.title]).concat(ui.preview.filter(i => i.kind === 'goal').map(i => [i.id, i.title])));
      return `<header class="hero"><p class="eyebrow">Inbox</p><h1>Here is what I heard.</h1>
          <p class="lede">${ui.preview.length} thoughts, sorted. Fix anything I misread, then file it.</p></header>
        <div class="card"><ul class="list preview">${ui.preview.map(i => `<li>
          <select data-c="pkind" data-id="${i.id}" aria-label="Type">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${i.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input data-c="ptitle" data-id="${i.id}" value="${esc(i.title)}" aria-label="Title">
          <button class="btn small quiet" data-a="premove" data-id="${i.id}" aria-label="Remove ${esc(i.title)}">Remove</button>
          <div class="meta"><span class="chip plain">${esc(i.area)}</span>${i.due ? dueLabel(i.due) : ''}${i.amount ? `<span class="chip">${fmt(i.amount)}</span>` : ''}
            ${i.kind === 'habit' ? `<span class="chip plain">${i.perWeek || 7}× a week</span>` : ''}
            ${i.goalId && names[i.goalId] && i.kind !== 'goal' ? `<span class="chip plain">→ ${esc(names[i.goalId])}</span>` : ''}
            ${i.kind === 'goal' || i.kind === 'worry' ? `<span>First step: ${esc(LC.firstStep(i, today()))}</span>` : ''}
            ${i.kind === 'want' ? `<span>${i.amount ? `Waits ${LC.coolingHours(state.profile)}h on the cooling list` : 'No price found, so this becomes an action'}</span>` : ''}
          </div></li>`).join('')}</ul></div>
        <div class="row"><button class="btn sun" data-a="accept" ${ui.preview.length ? '' : 'disabled'}>File it all</button><button class="btn quiet" data-a="discard">Back to editing</button></div>`;
    }
    const voice = window.SpeechRecognition || window.webkitSpeechRecognition;
    return `<header class="hero"><p class="eyebrow">Inbox</p><h1>What is on your mind?</h1>
        <p class="lede">Chores, ideas, deadlines, dreams, worries. One per line or one long ramble. Do not organise it; that is my job.</p></header>
      <textarea id="dump" aria-label="Brain dump" placeholder="pay the electric bill by Friday&#10;I want to learn Spanish&#10;worried about the presentation…">${esc(ui.draft)}</textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn sun" data-a="sort">Sort it</button>
        ${voice ? `<button class="btn" data-a="voice" id="mic">${ui.listening ? 'Stop listening' : 'Speak instead'}</button>` : ''}
        <button class="btn quiet" data-a="sample">Try an example</button>
      </div>`;
  };

  views.goals = () => {
    const t = today();
    const goalCard = g => {
      const linked = state.tasks.filter(x => x.goalId === g.id);
      const done = linked.filter(x => x.doneAt).length;
      const open = linked.filter(x => !x.doneAt);
      return `<div class="card">
        <div class="spread"><h3>${esc(g.title)}</h3><span class="row">${g.due ? dueLabel(g.due) : ''}<span class="chip plain">${esc(g.area)}</span></span></div>
        ${linked.length ? `${bar(done, linked.length, 'ok')}<p class="small muted">${done} of ${linked.length} actions finished</p>` : '<p class="small muted">No actions yet. A goal without a next action is a wish.</p>'}
        ${g.target ? `${bar(g.saved, g.target)}<div class="spread small"><span>${fmt(g.saved)} of ${fmt(g.target)} saved</span>
          <form data-f="contribute" data-id="${g.id}" class="inline"><input class="amount" name="amount" type="number" min="1" step="any" placeholder="$" aria-label="Amount to add" required><button class="btn small">Add</button></form></div>` : ''}
        <ul class="list" style="margin-top:8px">${open.map(x => `<li class="item"><button class="check" data-a="toggle" data-id="${x.id}" aria-label="Mark done: ${esc(x.title)}"></button><span class="grow">${esc(x.title)}</span>${x.due ? dueLabel(x.due) : ''}</li>`).join('')}</ul>
        <form data-f="addaction" data-id="${g.id}" class="inline" style="margin-top:10px"><input name="title" placeholder="Next action for this goal" aria-label="Next action" required><button class="btn small">Add</button></form>
        <div class="row end" style="margin-top:8px"><button class="btn small quiet" data-a="achieve" data-id="${g.id}">Mark achieved</button><button class="btn small quiet danger" data-a="delgoal" data-id="${g.id}">Delete</button></div>
      </div>`;
    };
    const active = state.goals.filter(g => !g.doneAt), achieved = state.goals.filter(g => g.doneAt);
    const simple = (arr, del, extra) => arr.map(x => `<li class="item"><span class="grow">${esc(x.title)}</span>${extra ? extra(x) : ''}<button class="btn small quiet danger" data-a="${del}" data-id="${x.id}">Remove</button></li>`).join('');
    return `<header class="hero"><p class="eyebrow">Goals</p><h1>What all this effort is for.</h1></header>
      ${active.length ? active.map(goalCard).join('') : '<div class="card empty">No goals yet. Write one below, or put it in the inbox.</div>'}
      <form data-f="addgoal" class="inline"><input name="title" placeholder="A goal, e.g. save $2000 by March 1" aria-label="New goal" required><button class="btn">Add goal</button></form>
      <h2>Habits</h2>
      ${state.habits.length ? `<div class="card"><ul class="list">${simple(state.habits, 'delhabit', h => `<span class="chip plain">${h.perWeek}× a week</span>`)}</ul></div>` : ''}
      <form data-f="addhabit" class="inline"><input name="title" placeholder="A habit, e.g. walk three times a week" aria-label="New habit" required><button class="btn">Add habit</button></form>
      ${state.ideas.length ? `<h2>Parked ideas</h2><div class="card"><ul class="list">${simple(state.ideas, 'delidea', x => `<button class="btn small" data-a="promote" data-id="${x.id}">Make it a goal</button>`)}</ul></div>` : ''}
      ${state.worries.length ? `<h2>Worries, written down</h2><div class="card"><ul class="list">${simple(state.worries, 'delworry')}</ul><p class="small muted" style="margin:8px 0 0">Each one has a ten-minute step in your actions. Remove it when it no longer bites.</p></div>` : ''}
      ${achieved.length ? `<h2>Achieved</h2><div class="card"><ul class="list">${achieved.map(g => `<li class="item done"><span class="check on"></span><span class="grow">${esc(g.title)}</span><span class="muted small">${esc(g.doneAt)}</span></li>`).join('')}</ul></div>` : ''}`;
  };

  const DEFAULT_CATS = ['Essentials', 'Food', 'Transport', 'Fun', 'Shopping'];
  const FEELINGS = ['bored', 'stressed', 'tired', 'celebrating', 'social'];
  views.money = () => {
    const m = state.money, t = today();
    if (!m.budgets.length || ui.editBudget) {
      const cats = m.budgets.length ? m.budgets : DEFAULT_CATS.map(cat => ({ cat, limit: '' }));
      return `<header class="hero"><p class="eyebrow">Money</p><h1>Give every dollar a job.</h1>
          <p class="lede">Monthly take-home pay, then a ceiling for each category. Whatever is left over is what funds your goals.</p></header>
        <form data-f="budget" class="card">
          <div class="field"><label for="inc">Monthly income after tax</label><input id="inc" name="income" type="number" min="1" step="any" value="${m.income || ''}" required></div>
          ${cats.map((b, i) => `<div class="inline" style="margin-bottom:8px"><input name="cat${i}" value="${esc(b.cat)}" aria-label="Category ${i + 1}"><input class="amount" name="limit${i}" type="number" min="0" step="any" value="${b.limit}" placeholder="$ / month" aria-label="Monthly limit for ${esc(b.cat)}"></div>`).join('')}
          <div class="inline" style="margin-bottom:14px"><input name="cat${cats.length}" placeholder="Another category" aria-label="New category"><input class="amount" name="limit${cats.length}" type="number" min="0" step="any" placeholder="$ / month" aria-label="Limit for new category"></div>
          <div class="row"><button class="btn sun">Save budget</button>${ui.editBudget ? '<button type="button" class="btn quiet" data-a="budgetcancel">Cancel</button>' : ''}</div>
        </form>`;
    }
    const s = LC.monthStats(m, t);
    const target = state.goals.find(g => !g.doneAt && g.target && g.saved < g.target);
    const hours = LC.coolingHours(state.profile);
    const trig = LC.spendingTriggers(m.expenses, t);
    const cooling = m.cooling.map(c => {
      const leftH = Math.ceil(hours - (Date.now() - c.addedAt) / 36e5);
      const delay = target ? LC.delayWeeks(c.amount, s.plannedSavings) : null;
      return `<li class="item" style="flex-wrap:wrap"><span class="grow"><b>${esc(c.item)}</b> · ${fmt(c.amount)}
          <br><span class="small muted">${delay != null ? `Costs about ${delay} week${delay === 1 ? '' : 's'} of progress on “${esc(target.title)}”. ` : ''}${leftH > 0 ? `Ready to decide in ${leftH}h.` : 'The wait is over. Still want it?'}</span></span>
        <span class="row">${leftH > 0
          ? `<button class="btn small quiet" data-a="buyanyway" data-id="${c.id}">Buy anyway</button>`
          : `<button class="btn small" data-a="buy" data-id="${c.id}">Yes, buy it</button>`}
          <button class="btn small sun" data-a="letgo" data-id="${c.id}">Let it go</button></span></li>`;
    }).join('');
    const recent = m.expenses.slice().sort((a, b) => b.ts - a.ts).slice(0, 8);
    return `<header class="hero"><p class="eyebrow">Money</p>
        <h1>${s.left >= 0 ? `${fmt(s.left)} left this month.` : `${fmt(-s.left)} over this month.`}</h1>
        <p class="lede">${s.left > 0 ? `That is ${fmt(s.perDay)} a day for the next ${s.daysLeft} days.` : 'Every new want goes on the cooling list until the month resets.'}
          ${s.plannedSavings > 0 ? `Your budget frees ${fmt(s.plannedSavings)} a month for goals.` : 'Your budget uses all of your income, so nothing is left for goals yet.'}</p></header>
      <div class="card">${s.byCat.map(c => `<div class="spread small"><span>${esc(c.cat)}</span><span class="muted">${fmt(c.spent)} of ${fmt(c.limit)}</span></div>${bar(c.spent, c.limit, c.spent > c.limit ? 'over' : '')}`).join('')}
        <div class="row end" style="margin-top:10px"><button class="btn small quiet" data-a="budgetedit">Edit budget</button></div></div>
      <h2>Log spending</h2>
      <form data-f="expense" class="card">
        <div class="inline"><input class="amount" name="amount" type="number" min="0.01" step="any" placeholder="$" aria-label="Amount" required>
          <select name="cat" aria-label="Category">${m.budgets.map(b => `<option>${esc(b.cat)}</option>`).join('')}</select>
          <input name="note" placeholder="What was it?" aria-label="Note"></div>
        <div class="inline" style="margin-top:10px"><label class="inline"><input type="checkbox" name="impulse"> Unplanned</label>
          <select name="feeling" aria-label="How were you feeling?"><option value="">Feeling… (optional)</option>${FEELINGS.map(f => `<option>${f}</option>`).join('')}</select>
          <button class="btn sun">Log it</button></div>
      </form>
      <h2>Cooling list</h2>
      <p class="muted">Wants wait here for ${hours} hours. Most of them stop mattering.</p>
      ${cooling ? `<div class="card"><ul class="list">${cooling}</ul></div>` : ''}
      <form data-f="want" class="inline"><input name="item" placeholder="Something you want to buy" aria-label="Item" required><input class="amount" name="amount" type="number" min="1" step="any" placeholder="$" aria-label="Price" required><button class="btn">Add</button></form>
      <h2>Your spending triggers</h2>
      <div class="card">${trig.length ? `<ul>${trig.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Mark purchases as unplanned, with how you felt. After three, patterns appear here.</p>'}
        ${s.impulse > 0 ? `<p class="small muted" style="margin:8px 0 0">${fmt(s.impulse)} unplanned so far this month.</p>` : ''}</div>
      ${recent.length ? `<h2>Recent</h2><div class="card"><ul class="list">${recent.map(e => `<li class="item"><span class="grow">${esc(e.note || e.cat)} <span class="muted small">· ${e.note ? esc(e.cat) + ' · ' : ''}${esc(e.date.slice(5))}</span></span>${e.impulse ? '<span class="chip warn">unplanned</span>' : ''}<b>${fmt(e.amount)}</b><button class="btn small quiet danger" data-a="delexpense" data-id="${e.id}" aria-label="Delete expense">Delete</button></li>`).join('')}</ul></div>` : ''}`;
  };

  views.review = () => {
    const r = LC.weekReview(state, today());
    const max = Math.max(1, ...r.perDay);
    const last = state.reviews[state.reviews.length - 1];
    return `<header class="hero"><p class="eyebrow">Weekly review</p><h1>The last seven days.</h1><p class="lede">${esc(r.verdict)}</p></header>
      <div class="stats">
        <div class="stat"><b>${r.done}</b><span>finished</span></div>
        <div class="stat"><b>${r.defers}</b><span>deferred</span></div>
        <div class="stat"><b>${r.habitRate == null ? '–' : Math.round(r.habitRate * 100) + '%'}</b><span>habits kept</span></div>
        <div class="stat"><b>${fmt(r.spent)}</b><span>spent</span></div>
        <div class="stat"><b>${fmt(r.impulse)}</b><span>unplanned</span></div>
        <div class="stat"><b>${fmt(r.saved)}</b><span>toward goals</span></div>
      </div>
      <div class="card"><p class="eyebrow">Finished per day</p><div class="week">${r.days.map((d, i) => `<div><span>${r.perDay[i] || ''}</span><i class="${r.perDay[i] ? '' : 'zero'}" style="height:${r.perDay[i] / max * 80}%"></i><span>${esc(LC.fromIso(d).toLocaleDateString(undefined, { weekday: 'narrow' }))}</span></div>`).join('')}</div></div>
      <div class="card coach"><p class="eyebrow">One adjustment</p>${esc(r.suggestion)}</div>
      ${last ? `<div class="card"><p class="eyebrow">You committed on ${esc(last.date)}</p><p style="margin:0">${esc(last.text)}</p></div>` : ''}
      <form data-f="review" class="card"><div class="field"><label for="rv">One thing I will change next week</label><input id="rv" name="text" maxlength="200" required></div><button class="btn sun">Commit</button></form>`;
  };

  views.you = () => `<header class="hero"><p class="eyebrow">You</p><h1>How I coach you.</h1></header>
    <div class="card"><ul style="margin:0;padding-left:20px">${LC.coachingPlan(state.profile).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <h2>Change your profile</h2><div class="card">${profileForm(state.profile, 'Save')}</div>
    <h2>Your data</h2><p class="muted">Stored only in this browser. Download a copy now and then; restoring one also moves your data to another device.</p>
    <div class="row"><button class="btn" data-a="export">Download a copy</button><button class="btn" data-a="import">Restore from a copy</button><button class="btn danger" data-a="reset">Erase everything</button></div>
    <input type="file" id="importfile" accept="application/json,.json" hidden>`;

  const NAV = [['today', 'Today'], ['inbox', 'Inbox'], ['goals', 'Goals'], ['money', 'Money'], ['review', 'Review'], ['you', 'You']];
  function render() {
    const view = state.profile ? ui.view : 'welcome';
    $('#view').innerHTML = views[view]();
    const nav = $('#nav');
    nav.hidden = !state.profile;
    nav.innerHTML = NAV.map(([k, label]) => `<button data-a="go" data-v="${k}" ${k === view ? 'aria-current="page"' : ''}>${label}</button>`).join('');
  }
  function go(view) {
    ui.view = view; render(); window.scrollTo(0, 0);
    const el = $('#view');
    el.classList.add('enter'); clearTimeout(go.t); go.t = setTimeout(() => el.classList.remove('enter'), 450);
  }
  const commit = () => { save(); render(); };

  // ---------- timer ----------
  function tick() {
    const el = $('#timerbar');
    if (!ui.timer) { el.hidden = true; return; }
    const left = Math.max(0, Math.round((ui.timer.end - Date.now()) / 1000));
    if (left === 0) {
      clearInterval(ui.timer.h); const title = ui.timer.title; ui.timer = null; el.hidden = true;
      toast(`Time. Mark "${title}" done, or go again.`);
      return;
    }
    el.hidden = false;
    el.innerHTML = `<span>${esc(ui.timer.title)}</span><b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b><button class="btn small" data-a="timerstop">Stop</button>`;
  }
  function stopTimer() { if (ui.timer) clearInterval(ui.timer.h); ui.timer = null; tick(); }

  // ---------- inbox filing ----------
  function accept() {
    const idMap = {}, count = {};
    const bump = k => { count[k] = (count[k] || 0) + 1; };
    const t = today();
    const items = ui.preview.map(i => (i.kind === 'want' && !i.amount ? Object.assign({}, i, { kind: 'task' }) : i));
    items.filter(i => i.kind === 'goal').forEach(i => {
      const g = { id: uid(), title: i.title, area: i.area, due: i.due, target: i.amount || null, saved: 0, createdAt: Date.now() };
      state.goals.push(g); idMap[i.id] = g.id; bump('goal');
      addTask({ title: LC.firstStep(i, t), area: i.area, goalId: g.id });
    });
    const link = i => idMap[i.goalId] || (goal(i.goalId) ? i.goalId : null);
    items.forEach((i, n) => {
      if (i.kind === 'task') { addTask({ title: i.title, area: i.area, due: i.due, effort: i.effort, goalId: link(i), createdAt: Date.now() + n }); bump('action'); }
      else if (i.kind === 'habit') { state.habits.push({ id: uid(), title: i.title, area: i.area, perWeek: i.perWeek || 7, checks: {}, goalId: link(i) }); bump('habit'); }
      else if (i.kind === 'idea') { state.ideas.push({ id: uid(), title: i.title, createdAt: Date.now() }); bump('idea'); }
      else if (i.kind === 'worry') {
        state.worries.push({ id: uid(), title: i.title, createdAt: Date.now() }); bump('worry');
        addTask({ title: LC.firstStep(i, t), area: i.area, goalId: link(i) });
      } else if (i.kind === 'want') { state.money.cooling.push({ id: uid(), item: i.title, amount: i.amount, addedAt: Date.now() }); bump('want'); }
    });
    ui.preview = null; ui.draft = '';
    replan(); save();
    toast('Filed: ' + Object.entries(count).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', '));
    go('today');
  }

  function deferDialog(x) {
    const tone = state.profile.tone;
    const line = { gentle: 'Something about this one is heavy. Let us make it lighter instead of carrying it another day.', firm: 'Moving it again is not a plan. Pick one.', balanced: 'It keeps slipping. Change the task, not the date.' }[tone];
    openDialog(`<h3>“${esc(x.title)}” has been put off ${x.skips} time${x.skips === 1 ? '' : 's'}.</h3><p class="muted" style="margin-top:8px">${line}</p>
      <form data-f="shrink" data-id="${x.id}"><label for="sh">A smaller version you would actually start</label><div class="inline" style="margin-top:4px"><input id="sh" name="title" required><button class="btn sun">Shrink it</button></div></form>
      <form data-f="schedule" data-id="${x.id}"><label for="sc">Or give it a real date</label><div class="inline" style="margin-top:4px"><input id="sc" name="date" type="date" min="${LC.shiftIso(today(), 1)}" required><button class="btn">Schedule it</button></div></form>
      <hr><div class="row"><button class="btn" data-a="timer" data-id="${x.id}" data-min="2">Do 2 minutes now</button><button class="btn danger" data-a="drop" data-id="${x.id}">Drop it for good</button><button class="btn quiet" data-a="closedlg">Cancel</button></div>`);
  }

  function removeFrom(list, id) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }
  function logExpense(amount, cat, note, impulse, feeling) {
    state.money.expenses.push({ id: uid(), date: today(), ts: Date.now(), hour: new Date().getHours(), amount, cat, note, impulse: !!impulse, feeling: feeling || '' });
  }
  const spendCat = () => (state.money.budgets.find(b => /shop/i.test(b.cat)) || state.money.budgets[0] || { cat: 'Other' }).cat;

  // ---------- actions ----------
  let recog = null;
  const actions = {
    go: d => go(d.v),
    energy: d => { state.energy[today()] = d.v; replan(); commit(); },
    toggle: d => {
      const x = task(d.id); if (!x) return;
      x.doneAt = x.doneAt ? null : today();
      if (x.doneAt && ui.timer && ui.timer.id === x.id) stopTimer();
      closeDialog(); commit();
      if (x.doneAt) {
        const p = plan();
        const left = p.ids.map(task).filter(k => k && !k.doneAt).length;
        if (p.ids.includes(x.id)) toast(left ? `Done. ${left} to go.` : 'That is the whole list. Well done.');
      }
    },
    defer: d => {
      const x = task(d.id); if (!x) return;
      if ((x.skips || 0) >= LC.deferLimit(state.profile)) return deferDialog(x);
      x.skips = (x.skips || 0) + 1;
      state.log.push({ t: 'defer', date: today(), id: x.id });
      const p = plan(); p.ids = p.ids.filter(i => i !== x.id); p.deferred.push(x.id);
      commit(); toast('Moved off today. It will be back tomorrow.');
    },
    drop: d => { removeFrom(state.tasks, d.id); const p = plan(); p.ids = p.ids.filter(i => i !== d.id); closeDialog(); commit(); toast('Dropped. One less thing to carry.'); },
    deltask: d => { removeFrom(state.tasks, d.id); commit(); },
    pull: () => {
      const p = plan(), t = today();
      const next = LC.planDay(state, t, p.ids.concat(p.deferred)).ids[0];
      if (next) p.ids.push(next);
      commit();
    },
    timer: d => {
      const x = task(d.id); if (!x) return;
      stopTimer(); closeDialog();
      ui.timer = { id: x.id, title: x.title, end: Date.now() + (+d.min) * 60000, h: setInterval(tick, 1000) };
      tick();
    },
    timerstop: stopTimer,
    closedlg: closeDialog,
    habit: d => { const h = state.habits.find(k => k.id === d.id); const t = today(); if (h.checks[t]) delete h.checks[t]; else h.checks[t] = true; commit(); },

    sample: () => { ui.draft = SAMPLE; render(); },
    sort: () => {
      ui.draft = $('#dump').value;
      const items = LC.sortDump(ui.draft, state.goals.filter(g => !g.doneAt), new Date());
      if (!items.length) return toast('Write something first. Anything.');
      ui.preview = items; render(); window.scrollTo(0, 0);
    },
    discard: () => { ui.preview = null; render(); },
    premove: d => { removeFrom(ui.preview, d.id); render(); },
    accept,
    voice: () => {
      if (recog) { recog.stop(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recog = new SR(); recog.continuous = true; recog.interimResults = false;
      recog.onresult = e => {
        const box = $('#dump'); if (!box) return;
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) box.value += (box.value && !/\n$/.test(box.value) ? '\n' : '') + e.results[i][0].transcript.trim();
        ui.draft = box.value;
      };
      recog.onerror = () => toast('The microphone is not available here. Typing works just as well.');
      recog.onend = () => { recog = null; ui.listening = false; const b = $('#mic'); if (b) b.textContent = 'Speak instead'; };
      ui.listening = true; $('#mic').textContent = 'Stop listening';
      recog.start();
    },

    achieve: d => { goal(d.id).doneAt = today(); commit(); toast('Achieved. That one is finished for good.'); },
    delgoal: d => {
      if (!confirm('Delete this goal? Its actions stay, unlinked.')) return;
      state.tasks.forEach(x => { if (x.goalId === d.id) x.goalId = null; });
      state.habits.forEach(x => { if (x.goalId === d.id) x.goalId = null; });
      removeFrom(state.goals, d.id); commit();
    },
    delhabit: d => { removeFrom(state.habits, d.id); commit(); },
    delidea: d => { removeFrom(state.ideas, d.id); commit(); },
    delworry: d => { removeFrom(state.worries, d.id); commit(); },
    promote: d => {
      const idea = state.ideas.find(x => x.id === d.id); if (!idea) return;
      const c = LC.classify(idea.title, new Date());
      const g = { id: uid(), title: idea.title, area: c.area, due: c.due, target: null, saved: 0, createdAt: Date.now() };
      state.goals.push(g);
      addTask({ title: LC.firstStep(Object.assign(c, { kind: 'goal', amount: null }), today()), area: c.area, goalId: g.id });
      removeFrom(state.ideas, d.id); replan(); commit();
    },

    budgetedit: () => { ui.editBudget = true; render(); },
    budgetcancel: () => { ui.editBudget = false; render(); },
    delexpense: d => { removeFrom(state.money.expenses, d.id); commit(); },
    buy: d => { const c = state.money.cooling.find(x => x.id === d.id); logExpense(c.amount, spendCat(), c.item, false); removeFrom(state.money.cooling, d.id); commit(); toast('Bought on purpose. Logged as planned.'); },
    buyanyway: d => { const c = state.money.cooling.find(x => x.id === d.id); logExpense(c.amount, spendCat(), c.item, true); removeFrom(state.money.cooling, d.id); commit(); toast('Logged as unplanned.'); },
    letgo: d => {
      const c = state.money.cooling.find(x => x.id === d.id);
      const g = state.goals.find(k => !k.doneAt && k.target && k.saved < k.target);
      removeFrom(state.money.cooling, d.id);
      if (g) { g.saved += c.amount; state.log.push({ t: 'save', date: today(), amount: c.amount }); toast(`${fmt(c.amount)} kept. Counted toward “${g.title}”.`); }
      else toast(`${fmt(c.amount)} kept.`);
      commit();
    },

    export: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      a.download = `first-light-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
    },
    import: () => $('#importfile').click(),
    reset: () => { if (confirm('Erase everything on this device? This cannot be undone.')) { localStorage.removeItem(KEY); state = blank(); stopTimer(); go('today'); } },
  };

  const forms = {
    profile: f => {
      const first = !state.profile;
      state.profile = { name: (f.get('name') || '').trim(), tone: f.get('tone') || 'balanced', peak: f.get('peak') || 'morning', flaws: f.getAll('flaws'), strengths: f.getAll('strengths') };
      replan(); save();
      if (first) go('inbox'); else { render(); toast('Saved. Coaching updated.'); }
    },
    addgoal: f => {
      const c = LC.classify(f.get('title'), new Date());
      const g = { id: uid(), title: c.title, area: c.area, due: c.due, target: c.amount || null, saved: 0, createdAt: Date.now() };
      state.goals.push(g);
      addTask({ title: LC.firstStep(Object.assign(c, { kind: 'goal' }), today()), area: c.area, goalId: g.id });
      replan(); commit();
    },
    addaction: (f, d) => {
      const c = LC.classify(f.get('title'), new Date());
      addTask({ title: c.title, area: c.area, due: c.due, effort: c.effort, goalId: d.id });
      replan(); commit();
    },
    addhabit: f => {
      const c = LC.classify(f.get('title'), new Date());
      state.habits.push({ id: uid(), title: c.title, area: c.area, perWeek: c.perWeek || 7, checks: {}, goalId: null });
      commit();
    },
    contribute: (f, d) => {
      const g = goal(d.id), n = parseFloat(f.get('amount'));
      if (!(n > 0)) return;
      g.saved += n; state.log.push({ t: 'save', date: today(), amount: n });
      commit(); toast(g.saved >= g.target ? 'Fully funded.' : `${fmt(g.target - g.saved)} to go.`);
    },
    budget: f => {
      const budgets = [];
      for (let i = 0; f.has('cat' + i); i++) {
        const cat = (f.get('cat' + i) || '').trim(), limit = parseFloat(f.get('limit' + i));
        if (cat && limit > 0 && !budgets.some(b => b.cat === cat)) budgets.push({ cat, limit });
      }
      if (!budgets.length) return toast('Give at least one category a monthly limit.');
      state.money.income = parseFloat(f.get('income')) || 0;
      state.money.budgets = budgets; ui.editBudget = false; commit();
    },
    expense: f => {
      const n = parseFloat(f.get('amount')); if (!(n > 0)) return;
      logExpense(n, f.get('cat'), (f.get('note') || '').trim(), f.get('impulse'), f.get('feeling'));
      commit();
      const s = LC.monthStats(state.money, today());
      toast(s.left >= 0 ? `Logged. ${fmt(s.left)} left this month.` : `Logged. ${fmt(-s.left)} over budget.`);
    },
    want: f => {
      const n = parseFloat(f.get('amount')); if (!(n > 0)) return;
      state.money.cooling.push({ id: uid(), item: f.get('item').trim(), amount: n, addedAt: Date.now() });
      commit();
    },
    review: f => {
      const r = LC.weekReview(state, today());
      state.reviews.push({ date: today(), text: f.get('text').trim(), done: r.done, defers: r.defers });
      commit(); toast('Committed. I will hold you to it next week.');
    },
    shrink: (f, d) => { const x = task(d.id); x.title = f.get('title').trim() || x.title; x.skips = 0; x.effort = 'light'; closeDialog(); commit(); toast('Smaller. Now it fits today.'); },
    schedule: (f, d) => {
      const x = task(d.id), date = f.get('date'); if (!date) return;
      x.due = date; x.notBefore = date; x.skips = 0;
      const p = plan(); p.ids = p.ids.filter(i => i !== x.id);
      closeDialog(); commit(); toast('Scheduled. It is off your mind until then.');
    },
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (el && actions[el.dataset.a]) actions[el.dataset.a](el.dataset, el);
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-f]');
    if (!form) return;
    e.preventDefault();
    forms[form.dataset.f](new FormData(form), form.dataset);
  });
  document.addEventListener('input', e => { if (e.target.id === 'dump') ui.draft = e.target.value; });
  document.addEventListener('change', e => {
    if (e.target.id === 'importfile') {
      const file = e.target.files[0]; if (!file) return;
      file.text().then(text => {
        let s = null;
        try { s = JSON.parse(text); } catch (err) { /* handled below */ }
        const ok = s && s.v === 1 && s.profile && Array.isArray(s.profile.flaws) && Array.isArray(s.tasks) && Array.isArray(s.goals) && Array.isArray(s.habits) && s.money && Array.isArray(s.money.expenses);
        if (!ok) return toast('That file is not a First Light copy.');
        if (!confirm('Replace everything on this device with this copy?')) return;
        localStorage.setItem(KEY, JSON.stringify(s));
        state = load(); stopTimer(); go('today'); toast('Restored.');
      });
      return;
    }
    const d = e.target.dataset;
    if (!ui.preview || !d.c) return;
    const it = ui.preview.find(i => i.id === d.id); if (!it) return;
    if (d.c === 'ptitle') it.title = e.target.value.trim() || it.title;
    if (d.c === 'pkind') { it.kind = e.target.value; if (it.kind === 'habit' && !it.perWeek) it.perWeek = 7; }
    render();
  });
  $('#dlg').addEventListener('click', e => { if (e.target === e.currentTarget) closeDialog(); });

  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
