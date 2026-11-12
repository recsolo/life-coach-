# First Light

Your mind is forty open tabs: the unpaid bill, the novel you keep meaning to start, the dentist, the business idea from the shower. Now imagine one quiet screen in early light, coffee warming your hand, and a single inbox where you empty it all: rambling voice notes, half-formed ideas, chores, ambitions, deadlines, dreams, worries. The AI reads everything instantly, sorting and connecting it into clear goals, projects, habits, priorities, and next actions. It learns you: your personality, energy patterns, motivation style, strengths, and your particular traps (procrastination, distraction, perfectionism, impulsivity, overspending, burnout), then coaches accordingly, blending gentle encouragement, firm accountability, timely nudges, deliberate friction, rewards, and plans sized to your real capacity. It links your money to your ambitions, mapping budgets, spending triggers, and savings onto the goals they fund. Each morning: one clear focus. Each week: an honest review. The result is less chaos and guilt, more discipline, momentum, and goals actually finished.

## Run it

Open `index.html` in a browser. There is no build step, no account, and no server; everything you enter stays in that browser's local storage.

```
npm start   # optional: serves the folder at http://localhost:5173
npm test    # engine unit tests (Node 18+)
```

## What it does

| Screen | What happens there |
| --- | --- |
| **Welcome** | A short profile: how to talk to you (gently, plainly, firmly), when your energy peaks, what trips you up, what you are good at. |
| **Inbox** | Type or dictate a brain dump. Each thought is read as an action, goal, habit, idea, worry, or want; dates, amounts, and life areas are pulled out; actions are linked to the goals they serve. You correct anything misread before it is filed. |
| **Today** | An energy check-in, a coach's note, and a short focus list with "the one thing" on top. Everything else is parked out of sight. |
| **Goals** | Each goal with its linked actions, progress, and savings. Habits, parked ideas, and written-down worries live here too. |
| **Money** | Monthly budget, what is left per day, spending log, a cooling list for wants, and your spending triggers. |
| **Review** | The last seven days: finished, deferred, habits kept, spent, unplanned, saved, plus one suggested adjustment and one commitment from you. |
| **You** | A plain-language list of how you are being coached, your profile, export, and erase. |

## How the profile changes the coaching

These are behaviours in the app, not just different wording.

- **Procrastination:** a "Start 2 minutes" button on every focus task, and after two deferrals "Not today" stops working: you must shrink the task, schedule it, or drop it.
- **Distraction:** the focus list never exceeds three, even on a high-energy day.
- **Perfectionism:** a "Good enough, done" button, and the coach asks for a rough version first.
- **Impulsivity / overspending:** wants wait 48 hours on the cooling list instead of 24, each priced in weeks of delay to your savings goal. Letting one go counts the money toward that goal.
- **Burnout:** two focus items a day, one on a low-energy day.
- **Tone:** every coach note, review verdict, and deferral prompt has gentle, plain, and firm versions.
- **Energy:** deep-work tasks are labelled for your peak window; the daily check-in adds or removes a task.

## How it is built

- `js/engine.js` is pure logic with no DOM: parsing, sorting, linking, day planning, coach notes, budget maths, spending triggers, weekly review. It is covered by `test/engine.test.js`.
- `js/app.js` is the interface and local storage.
- `styles.css` holds the visual design, with light and dark themes.

No dependencies.

## Known limits

- The "AI" is a rules engine (keyword and pattern matching), not a language model. It handles plain phrasing well and will misread unusual sentences, which is why the inbox shows a correctable preview before filing. Swapping in a language model means replacing `sortDump` and `coachNote` in `engine.js`; that needs a small server so the API key is not exposed in the browser.
- Data lives in one browser. There is no sync or login. "Download a copy" and "Restore from a copy" (on the You screen) are the backup, and the way to move to another device.
- Served over http(s) it installs to a phone home screen and works offline; opened as a file it runs without those two extras.
- Voice input uses the browser's speech recognition, so it appears only where the browser supports it (Chrome, Edge, Safari).
- Money is entered by hand in dollars; there is no bank connection.
- There are no notifications; nudges appear when you open the app.
