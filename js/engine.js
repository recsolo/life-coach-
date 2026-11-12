/*
 * First Light — engine
 * Pure logic, no DOM: reads a brain dump, sorts it, plans the day,
 * writes the coach's note, and does the money maths.
 * Works as a plain <script> (window.LC) and as a Node module (tests).
 */
(function (root) {
  'use strict';

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const shiftIso = (iso, n) => isoDate(addDays(fromIso(iso), n));
  const daysBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 864e5);

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NUM = { a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6 };

  function parseDeadline(text, now) {
    const t = text.toLowerCase();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const future = (month, day) => {
      if (month < 0 || month > 11 || day < 1 || day > 31) return null;
      let d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
      return isoDate(d);
    };
    const mon = MONTHS.join('|');
    let m = t.match(new RegExp(`\\b(${mon})[a-z]*\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (m) return future(MONTHS.indexOf(m[1]), +m[2]);
    m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${mon})[a-z]*\\b`));
    if (m) return future(MONTHS.indexOf(m[2]), +m[1]);
    m = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (m) { const r = future(+m[1] - 1, +m[2]); if (r) return r; }

    if (/\b(today|tonight|asap|right now)\b/.test(t)) return isoDate(today);
    if (/\btomorrow\b/.test(t)) return isoDate(addDays(today, 1));
    m = t.match(/\bin (\d+|a|an|one|two|three|four|five|six|a couple of) (day|week|month)s?\b/);
    if (m) {
      const n = NUM[m[1]] || (m[1] === 'a couple of' ? 2 : +m[1]);
      return isoDate(addDays(today, n * { day: 1, week: 7, month: 30 }[m[2]]));
    }
    if (/\bnext week\b/.test(t)) return isoDate(addDays(today, 7));
    if (/\bnext month\b/.test(t)) return isoDate(addDays(today, 30));
    if (/\bend of (the )?month\b/.test(t)) return isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    if (/\b(this week|end of (the )?week)\b/.test(t)) return isoDate(addDays(today, (5 - today.getDay() + 7) % 7));
    if (/\b(this )?weekend\b/.test(t)) return isoDate(addDays(today, (6 - today.getDay() + 7) % 7));
    m = t.match(new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`));
    if (m) return isoDate(addDays(today, ((WEEKDAYS.indexOf(m[1]) - today.getDay() + 7) % 7) || 7));
    return null;
  }

  function parseAmount(text) {
    let m = text.match(/[$£€]\s?(\d[\d,]*(?:\.\d+)?)\s?(k\b)?/i);
    if (!m) m = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s?(k)?\s?(?:dollars|bucks|usd|pounds|euros)\b/i);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
    return isFinite(n) && n > 0 ? n : null;
  }

  // ---------- reading a thought ----------
  const AREAS = [
    ['money', /\b(bills?|rent|budget|debts?|loans?|credit card|sav(e|ing|ings)|tax(es)?|invoices?|pay(ing)?|spend(ing)?|bank|money|afford|subscriptions?|insurance|mortgage|refund)\b|[$£€]/gi],
    ['work', /\b(boss|clients?|meeting|report|email|presentation|resume|cv|job|interview|promotion|career|launch|deck|proposal|colleague|business|manager|deadline)\b/gi],
    ['health', /\b(gym|run(ning)?|workout|exercise|sleep|doctor|dentist|diet|weight|meditat(e|ion)|walk|yoga|therapy|therapist|water|stretch|marathon)\b/gi],
    ['home', /\b(clean|laundry|dishes|groceries|kitchen|garage|repair|fix|landlord|car|vacuum|trash|declutter|garden|plumber)\b/gi],
    ['growth', /\b(learn|read(ing)?|books?|course|study|writ(e|ing)|novel|language|spanish|french|guitar|piano|practice|degree|podcast|blog|newsletter|portfolio|pages)\b/gi],
    ['people', /\b(mom|mum|dad|friends?|partner|wife|husband|kids?|son|daughter|birthday|family|anniversary|sister|brother|grandma|grandpa)\b/gi],
    ['adventure', /\b(trip|travel|flights?|vacation|holiday|passport|hik(e|ing)|camping)\b/gi],
  ];
  function areaOf(text) {
    let best = 'life', top = 0;
    for (const [name, re] of AREAS) {
      const n = (text.match(re) || []).length;
      if (n > top) { top = n; best = name; }
    }
    return best;
  }

  const WORRY = /\b(worr(y|ied|ying)|anxious|anxiety|afraid|scared|stress(ed|ing)?|nervous|overwhelm(ed|ing)?|dread(ing)?|can'?t stop thinking|keeps? me up|freaking out|panic(king)?|guilty|ashamed|behind on)\b/i;
  const HABIT = /\b(every (single )?(day|morning|night|evening|week|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|each (day|morning|night)|weekly|(times|x) (a|per) week|(once|twice) a week|habit|routine)\b/i;
  const IDEA = /\b(idea|maybe i|what if (i|we)|might be (cool|fun)|could (build|start|make|write|try)|imagine)\b/i;
  const HARD_GOAL = /\b(someday|one day|my dream|dream of|my goal|eventually|become|get better at|get in shape|lose \d+|run a marathon|start a (business|company|podcast|blog)|write a (book|novel)|pay off|learn (to |how to )?\w+|move to|buy a house|change careers?|get promoted)\b|\bsave (up )?([$£€]\s?)?\d/i;
  const SOFT_GOAL = /\b(i want to|i'd (love|like) to|i would (love|like) to|i wish)\b/i;
  const WANT = /\b(buy|order|purchase|upgrade)\b/i;
  const DEEP = /\b(write|plan|design|study|build|prepare|research|report|tax(es)?|learn|proposal|presentation|draft|outline|apply|finish|review)\b/i;

  const LEAD = /^(?:(?:and|so|also|oh|um|uh|ok|okay|then),? )*(?:someday i(?:'d| would)? (?:love|like|want) to|one day i(?:'ll| will| want to)?|i(?:'d| would) (?:love|like) to|i (?:really )?(?:need|have|ought|want)(?: to)?|i should(?: probably)?|i must|i gotta|gotta|need to|have to|remember to|don'?t forget to|to-?do:?|my (?:dream|goal) is to|i(?:'m| am) (?:really |so )?(?:worried|anxious|stressed|nervous|scared) (?:about|that)|(?:worried|stressed|anxious) about|idea:?|maybe i (?:could|should)|what if i)\s+/i;

  function cleanTitle(raw) {
    let t = raw.trim().replace(/^[-*•\s]+|^\d+[.)]\s+/, '');
    for (let i = 0; i < 2; i++) t = t.replace(LEAD, '');
    t = t.replace(/[\s.!;,]+$/, '').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : raw.trim();
  }

  const DATE_TAIL = new RegExp(
    '\\s*,?\\s*\\b(?:(?:by|on|before|due|until)\\s+)?(?:the\\s+)?(?:today|tonight|tomorrow|(?:this|next) (?:week|month|weekend)|' +
    'end of (?:the )?(?:week|month)|in (?:\\d+|a|an|one|two|three|four|five|six|a couple of) (?:day|week|month)s?|' +
    '(?:(?:this|next) )?(?:' + WEEKDAYS.join('|') + ')|(?:' + MONTHS.join('|') + ')[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}\\/\\d{1,2})\\s*$', 'i');
  const PRICE_TAIL = /\s*,?\s*(?:for\s+)?[$£€]\s?\d[\d,.]*k?\s*$/i;
  const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : t);

  function splitDump(text) {
    return text
      .split(/\n+/)
      .flatMap(l => l.split(/(?<=[.!?;])\s+(?=[A-Z0-9"'(])/))
      .flatMap(l => l.split(/,?\s+(?:oh and|and also|and then|also)\s+|,?\s+and\s+(?=i (?:need|have|should|want|must)\b|i'm )/i))
      .map(s => s.trim().replace(/^[-*•\s]+|^\d+[.)]\s+/, ''))
      .filter(s => s.replace(/[^a-z0-9]/gi, '').length >= 3);
  }

  function habitPerWeek(text) {
    const t = text.toLowerCase();
    const m = t.match(/\b(\d|once|twice|two|three|four|five|six)\s?(?:times |x )?(?:a|per) week\b/);
    if (m) return { once: 1, twice: 2, two: 2, three: 3, four: 4, five: 5, six: 6 }[m[1]] || +m[1];
    if (/\b(weekly|every week|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(t)) return 1;
    if (/\bevery weekday\b/.test(t)) return 5;
    return 7;
  }

  const STOP = new Set('the and for with that this from have need want about into over just really some more than then them they your you are was get got out off not but all any can will its it\'s i\'m every each day week month year time thing things stuff going make take new'.split(' '));
  function tokens(text) {
    return (text.toLowerCase().match(/[a-z]{3,}/g) || [])
      .filter(w => !STOP.has(w))
      .map(w => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w));
  }

  function classify(raw, now) {
    const due = parseDeadline(raw, now);
    const amount = parseAmount(raw);
    const today = isoDate(now);
    let kind = 'task';
    if (WORRY.test(raw)) kind = 'worry';
    else if (HABIT.test(raw)) kind = 'habit';
    else if (IDEA.test(raw)) kind = 'idea';
    else if (HARD_GOAL.test(raw)) kind = 'goal';
    else if (SOFT_GOAL.test(raw) && !(due && daysBetween(today, due) <= 14)) kind = 'goal';
    else if (WANT.test(raw) && amount) kind = 'want';
    let title = cleanTitle(raw);
    if (due && kind !== 'habit') title = cap(title.replace(DATE_TAIL, '').trim()) || title;
    if (kind === 'want') title = cap(title.replace(PRICE_TAIL, '').trim()) || title;
    return {
      raw, kind, due, amount, title,
      area: areaOf(raw),
      effort: DEEP.test(raw) ? 'deep' : 'light',
      perWeek: kind === 'habit' ? habitPerWeek(raw) : null,
    };
  }

  const money = n => '$' + Math.round(n).toLocaleString('en-US');

  function firstStep(item, todayIso) {
    if (item.kind === 'worry') {
      return item.area === 'money'
        ? `10 minutes, numbers only: list every balance and due date behind "${item.title}"`
        : `10 minutes: write the worst case for "${item.title}", then one step that shrinks it`;
    }
    if (item.amount && item.due) {
      const weeks = Math.max(1, Math.ceil(daysBetween(todayIso, item.due) / 7));
      return `Move ${money(Math.ceil(item.amount / weeks))} toward "${item.title}" this week`;
    }
    if (item.amount) return `Pick a weekly amount and a date for "${item.title}"`;
    return `15 minutes: write the first three steps for "${item.title}"`;
  }

  /** Read a raw dump and return sorted, linked items. Nothing is saved here. */
  function sortDump(text, existingGoals, now) {
    const todayIso = isoDate(now);
    const items = splitDump(text).map((raw, i) => Object.assign(classify(raw, now), { id: 'n' + i, goalId: null }));
    const goals = existingGoals.map(g => ({ id: g.id, title: g.title }))
      .concat(items.filter(i => i.kind === 'goal').map(g => ({ id: g.id, title: g.title })));
    const goalTokens = goals.map(g => ({ id: g.id, set: new Set(tokens(g.title)) }));
    for (const it of items) {
      if (it.kind === 'goal') { it.nextAction = firstStep(it, todayIso); continue; }
      if (it.kind === 'worry') it.nextAction = firstStep(it, todayIso);
      const mine = tokens(it.title);
      let best = null, top = 0;
      for (const g of goalTokens) {
        const n = mine.filter(w => w.length >= 4 && g.set.has(w)).length;
        if (n > top) { top = n; best = g.id; }
      }
      it.goalId = best;
    }
    return items;
  }

  // ---------- planning the day ----------
  function scoreTask(task, todayIso) {
    let s = 10;
    if (task.due) {
      const d = daysBetween(todayIso, task.due);
      s = d < 0 ? 100 : d === 0 ? 90 : d <= 2 ? 70 : d <= 7 ? 45 : 15;
    }
    if (task.goalId) s += 20;
    if (task.area === 'money') s += 10;
    s += Math.min((task.skips || 0) * 5, 15);
    return s;
  }

  function capacityFor(profile, energy) {
    const flaws = (profile && profile.flaws) || [];
    let cap = 3;
    const why = [];
    if (flaws.includes('burnout')) { cap = 2; why.push('kept small because you are guarding against burnout'); }
    if (energy === 'low') { cap -= 1; why.push('trimmed for a low-energy day'); }
    if (energy === 'high') {
      if (flaws.includes('distraction')) why.push('held at three so nothing splits your attention');
      else { cap += 1; why.push('one extra because your energy is high'); }
    }
    cap = Math.max(1, Math.min(cap, 4));
    return { cap, why: why.join('; ') || 'three things is what a real day holds' };
  }

  function planDay(state, todayIso, exclude) {
    const skip = new Set(exclude || []);
    const { cap, why } = capacityFor(state.profile, (state.energy || {})[todayIso]);
    const open = state.tasks
      .filter(t => !t.doneAt && !skip.has(t.id) && !(t.notBefore && t.notBefore > todayIso))
      .map(t => ({ t, s: scoreTask(t, todayIso) }))
      .sort((a, b) => b.s - a.s || (a.t.createdAt || 0) - (b.t.createdAt || 0));
    return { ids: open.slice(0, cap).map(x => x.t.id), capacity: cap, why };
  }

  const PEAK = { morning: 'before 11am', afternoon: '1–4pm', evening: 'after 7pm' };
  function whenLabel(task, profile) {
    const peak = PEAK[(profile && profile.peak) || 'morning'];
    return task.effort === 'deep' ? `Deep work · ${peak}` : 'Light · any gap';
  }

  function streak(tasks, todayIso) {
    const days = new Set(tasks.filter(t => t.doneAt).map(t => t.doneAt));
    let d = days.has(todayIso) ? todayIso : shiftIso(todayIso, -1), n = 0;
    while (days.has(d)) { n++; d = shiftIso(d, -1); }
    return n;
  }

  // ---------- the coach ----------
  const FLAWS = {
    procrastination: 'Procrastination',
    distraction: 'Distraction',
    perfectionism: 'Perfectionism',
    impulsivity: 'Impulsivity',
    overspending: 'Overspending',
    burnout: 'Burnout',
  };
  const STRENGTHS = {
    reliable: 'I show up for other people',
    starter: 'I start fast',
    finisher: 'I finish carefully',
    curious: 'I love learning',
  };

  function tactic(flaw, main, ctx) {
    const x = `"${main.title}"`;
    switch (flaw) {
      case 'procrastination': return `Give ${x} two minutes. Starting is the whole job; stopping after two is allowed.`;
      case 'distraction': return `Phone in another room until ${x} is done. One tab, one task.`;
      case 'perfectionism': return `Ship a rough version of ${x} first. Done at 80% beats perfect in your head.`;
      case 'impulsivity': return `Any unplanned yes or purchase today waits ten minutes. ${x} comes first.`;
      case 'overspending': return ctx.perDay != null
        ? `You have ${money(Math.max(0, ctx.perDay))} a day left this month. Anything beyond that goes on the cooling list.`
        : `Set a budget in Money so I can tell you what today can afford.`;
      case 'burnout': return `Do ${x}, then stop on purpose. Rest is on the plan, not a reward for finishing it.`;
      default: return `Start with ${x}.`;
    }
  }

  /** ctx: {streak, doneYesterday, plannedYesterday, overdue, main, perDay, dayIndex} */
  function coachNote(profile, ctx) {
    const tone = (profile && profile.tone) || 'balanced';
    const flaws = (profile && profile.flaws) || [];
    const say = (gentle, firm, balanced) => ({ gentle, firm, balanced })[tone];
    if (!ctx.main && ctx.doneToday > 0) return say(
      `Today's list is finished: ${ctx.doneToday} done. Rest is part of the plan, so stop here without guilt.`,
      `${ctx.doneToday} done and today's list is clear. You kept your word. Stop, or pull one more on purpose.`,
      `Today's list is finished: ${ctx.doneToday} done. Stop here, or pull one more.`);
    if (!ctx.main && ctx.parked > 0) return say(
      `Nothing is planned for today, and ${ctx.parked} parked. Pull one in only if you have the room.`,
      `Nothing planned today, ${ctx.parked} parked. Pull one in and start it.`,
      `Nothing planned today; ${ctx.parked} parked. Pull one in when you are ready.`);
    if (!ctx.main) return say(
      'Nothing is waiting on you. If your head feels full anyway, empty it into the inbox and I will sort it.',
      'Your list is empty. That is rarely true of your head. Put everything in the inbox.',
      'Clear list. Drop whatever is on your mind into the inbox and I will sort it.');
    const parts = [];
    if (ctx.streak >= 3) parts.push(say(
      `${ctx.streak} days in a row with something finished. That is what change looks like.`,
      `${ctx.streak}-day streak. Do not negotiate with it today.`,
      `${ctx.streak} days running. Keep the chain.`));
    else if (ctx.plannedYesterday > 0 && ctx.doneYesterday === 0) parts.push(say(
      'Yesterday did not go to plan. That is information, not a verdict.',
      'Nothing on yesterday\'s list got finished. Today\'s list is short so there is no excuse.',
      'Yesterday slipped. Today is sized to be winnable.'));
    else if (ctx.doneYesterday > 0) parts.push(say(
      `You finished ${ctx.doneYesterday} yesterday. Build on that.`,
      `${ctx.doneYesterday} done yesterday. Match it.`,
      `${ctx.doneYesterday} finished yesterday. Same again.`));
    else parts.push(say(
      'One clear thing is enough to begin.',
      'Begin the first item before you check anything else.',
      'Here is the short list. Start at the top.'));
    if (ctx.overdue > 0) parts.push(`${ctx.overdue} ${ctx.overdue === 1 ? 'item is' : 'items are'} past due; the most urgent is first.`);
    if ((ctx.main.skips || 0) >= 2) parts.push(say(
      `"${ctx.main.title}" has been put off ${ctx.main.skips} times. Would a smaller version help?`,
      `You have pushed "${ctx.main.title}" ${ctx.main.skips} times. Do it, shrink it, or drop it.`,
      `"${ctx.main.title}" has slipped ${ctx.main.skips} times. Shrink it if it is too big.`));
    if (flaws.length) parts.push(tactic(flaws[ctx.dayIndex % flaws.length], ctx.main, ctx));
    else parts.push(tactic(null, ctx.main, ctx));
    return parts.join(' ');
  }

  function coachingPlan(profile) {
    const out = [];
    const f = profile.flaws || [];
    out.push({
      gentle: 'Tone: encouragement first. Misses are treated as information.',
      firm: 'Tone: direct. I will name what slipped and how often.',
      balanced: 'Tone: plain and steady, without pressure or padding.',
    }[profile.tone || 'balanced']);
    out.push(`Deep work is scheduled ${PEAK[profile.peak || 'morning']}, when your energy peaks.`);
    if (f.includes('procrastination')) out.push('Procrastination: a two-minute start button, and after two deferrals you must shrink, schedule, or drop the task.');
    if (f.includes('distraction')) out.push('Distraction: never more than three things in view; everything else stays parked.');
    if (f.includes('perfectionism')) out.push('Perfectionism: tasks finish at "good enough", and I ask for a rough version first.');
    if (f.includes('impulsivity')) out.push('Impulsivity: unplanned purchases wait 48 hours on the cooling list.');
    if (f.includes('overspending')) out.push('Overspending: a daily spending allowance, and every want is priced in weeks of goal delay.');
    if (f.includes('burnout')) out.push('Burnout: two things a day at most, fewer on low-energy days.');
    const s = profile.strengths || [];
    if (s.includes('reliable')) out.push('Strength: you keep promises to others, so tell one person your one thing each morning.');
    if (s.includes('starter')) out.push('Strength: you start fast, so the hardest task goes first while momentum is free.');
    if (s.includes('finisher')) out.push('Strength: you finish carefully, so I give you fewer, larger tasks.');
    if (s.includes('curious')) out.push('Strength: you love learning, so growth goals get a standing slot each week.');
    return out;
  }

  const deferLimit = profile => ((profile && profile.flaws) || []).includes('procrastination') ? 2 : 3;
  const coolingHours = profile => {
    const f = (profile && profile.flaws) || [];
    return f.includes('overspending') || f.includes('impulsivity') ? 48 : 24;
  };

  // ---------- money ----------
  function monthStats(m, todayIso) {
    const key = todayIso.slice(0, 7);
    const month = m.expenses.filter(e => e.date.slice(0, 7) === key);
    const byCat = m.budgets.map(b => ({
      cat: b.cat, limit: b.limit,
      spent: month.filter(e => e.cat === b.cat).reduce((a, e) => a + e.amount, 0),
    }));
    const budgetTotal = m.budgets.reduce((a, b) => a + b.limit, 0);
    const spent = month.reduce((a, e) => a + e.amount, 0);
    const d = fromIso(todayIso);
    const daysLeft = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
    const left = budgetTotal - spent;
    return {
      byCat, budgetTotal, spent, left, daysLeft,
      perDay: left / daysLeft,
      impulse: month.filter(e => e.impulse).reduce((a, e) => a + e.amount, 0),
      plannedSavings: Math.max(0, m.income - budgetTotal),
    };
  }

  function spendingTriggers(expenses, todayIso) {
    const since = shiftIso(todayIso, -60);
    const imp = expenses.filter(e => e.impulse && e.date >= since);
    if (imp.length < 3) return [];
    const total = imp.reduce((a, e) => a + e.amount, 0);
    const share = fn => imp.filter(fn).reduce((a, e) => a + e.amount, 0) / total;
    const out = [];
    const top = (key) => {
      const sums = {};
      imp.forEach(e => { if (e[key]) sums[e[key]] = (sums[e[key]] || 0) + e.amount; });
      const best = Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
      return best && best[1] / total >= 0.4 ? [best[0], Math.round(best[1] / total * 100)] : null;
    };
    const feel = top('feeling');
    if (feel) out.push(`${feel[1]}% of your unplanned spending happens when you feel ${feel[0]}.`);
    const cat = top('cat');
    if (cat) out.push(`${cat[1]}% of it goes to ${cat[0]}.`);
    const late = share(e => e.hour != null && (e.hour >= 21 || e.hour < 5));
    if (late >= 0.4) out.push(`${Math.round(late * 100)}% of it happens after 9pm.`);
    const wkend = share(e => [0, 6].includes(fromIso(e.date).getDay()));
    if (wkend >= 0.5) out.push(`${Math.round(wkend * 100)}% of it happens on weekends.`);
    return out;
  }

  const delayWeeks = (amount, monthlySavings) =>
    monthlySavings > 0 ? Math.round(amount / (monthlySavings / 4.345) * 10) / 10 : null;

  // ---------- weekly review ----------
  function weekReview(state, todayIso) {
    const days = Array.from({ length: 7 }, (_, i) => shiftIso(todayIso, i - 6));
    const inWeek = d => d >= days[0] && d <= todayIso;
    const perDay = days.map(d => state.tasks.filter(t => t.doneAt === d).length);
    const done = perDay.reduce((a, b) => a + b, 0);
    const defers = state.log.filter(l => l.t === 'defer' && inWeek(l.date)).length;
    const saved = state.log.filter(l => l.t === 'save' && inWeek(l.date)).reduce((a, l) => a + l.amount, 0);
    const exp = state.money.expenses.filter(e => inWeek(e.date));
    const spent = exp.reduce((a, e) => a + e.amount, 0);
    const impulse = exp.filter(e => e.impulse).reduce((a, e) => a + e.amount, 0);
    let checks = 0, expected = 0;
    state.habits.forEach(h => {
      expected += h.perWeek;
      checks += Math.min(h.perWeek, days.filter(d => h.checks[d]).length);
    });
    const habitRate = expected ? checks / expected : null;
    const activeDays = perDay.filter(Boolean).length;

    let suggestion;
    if (done === 0 && defers === 0) suggestion = 'Nothing was planned or finished. Start next week with a brain dump.';
    else if (defers > done) suggestion = 'More was deferred than finished. Plans are too big: shrink each task until it fits in 30 minutes.';
    else if (habitRate != null && habitRate < 0.5) suggestion = 'Habits landed under half. Keep one, pause the rest, and attach it to something you already do daily.';
    else if (spent > 0 && impulse / spent > 0.3) suggestion = `${Math.round(impulse / spent * 100)}% of spending was unplanned. Route every want through the cooling list next week.`;
    else if (activeDays <= 3) suggestion = 'Progress came in bursts. Aim for one finished thing on five different days.';
    else suggestion = 'The system is working. Keep the same load; do not add more.';

    const tone = (state.profile && state.profile.tone) || 'balanced';
    const verdict = done === 0
      ? { gentle: 'A quiet week. No guilt; just begin again with one thing.', firm: 'Zero finished. Next week starts with one task done before noon on Monday.', balanced: 'Nothing finished this week. Reset with one small win.' }[tone]
      : { gentle: `You finished ${done} things across ${activeDays} days. That is real progress.`, firm: `${done} finished, ${defers} deferred, ${activeDays} of 7 days active.`, balanced: `${done} finished across ${activeDays} days, ${defers} deferred.` }[tone];
    return { days, perDay, done, defers, saved, spent, impulse, habitRate, activeDays, verdict, suggestion };
  }

  const api = {
    isoDate, fromIso, shiftIso, daysBetween, parseDeadline, parseAmount, splitDump, classify, sortDump,
    areaOf, cleanTitle, tokens, firstStep, scoreTask, capacityFor, planDay, whenLabel, streak,
    coachNote, coachingPlan, deferLimit, coolingHours, monthStats, spendingTriggers, delayWeeks,
    weekReview, money, FLAWS, STRENGTHS,
  };
  root.LC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
