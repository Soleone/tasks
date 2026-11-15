# Goals

A goal is a number of tasks to finish a day or a week, per category, plus one for everything else. Goals and category colors are shared settings: they live in the workspace and sync to every device (`home.shared-settings`). Without goals, nothing here shows and the done count is as before.

## Counting

| Rule | When | Then |
| --- | --- | --- |
| `goals.fill` | A task is done today | It fills its category's goal, or the goal for everything else when its category has none, never spilling into another goal past its target. The done count's ring is each goal's progress up to its target against all of today's targets added up, so it's full only once every goal is met; a goal past its target never stands in for an open one |
| `goals.week` | A weekly goal | Today's target is what's left of the week over the days left, today included, rounded up. A slow week raises it, and logging into an earlier day of the week can lower it. Met for the week, it stays met until the week ends |
| `goals.names` | The goal for everything else | Reads "All tasks" while no category has a goal, "Everything else" once one does. With no goals at all, there are no rings |
| `goals.day-ends` | Goals are set | Today begins when the day ends (Settings › General, 04:00 by default), so 2am still counts as yesterday, for the done count, the done lens and goals. Weeks start on the chosen weekday. Without goals, "today" stays the last 24 hours (`done.today`) |

## Header

| Rule | When | Then |
| --- | --- | --- |
| `goals.header` | Goals are set | The done count's check becomes a ring for today's total and shows from the start of the day, even at zero. With two goals or more, each open category goal follows as a small ring in its category's color, up to four, then "+N". Met ones fold into one check with a pip in each category's color, up to three, then "✓N". Once every goal is met the check folds into the done count's ring too, leaving it alone. Everything else gets no small ring or pip: it would read as a second total, so the done count's ring and tooltip carry it. A ring's arc eases to its new length. With a category filter on, only that category's goal stays. The header narrows to two small rings on a phone, one below 390px and none below 360px, each folding into "+N". Clicking any of them toggles the done lens |
| `goals.hover` | Hovering the done count | The whole group lights up as one: the ring is the goals added up |
| `goals.tooltips` | Hovering a part | The done count: "Done today" with today's total, no target (only a goal has one), then each goal's numbers, and Show what's done `D`. A goal ring: its name and today's numbers; a weekly goal labels Today and This week. The met check: "Met today" and each met goal's numbers. A weekly goal's pill in the done lens: just This week, since the pill shows the rest. A check sits in its own slot left of met numbers, and numbers line up in columns however many digits they have |
| `goals.flight` | A completion flies to the header (`done.flight`) | The rings hold their numbers until it lands on the ring of the goal it fills, which then fills and bumps, then a dot in that goal's color carries on to the done count. The done count's ring fills rather than bumps. When that goal is already met, or the task fills no goal ring, it lands on the done count as before |
| `goals.celebrate` | A completion meets the last open goal | Once the done count's ring closes, the met check's pips arc into it, bumping it as each lands, while the check fades. A sheen sweeps the header, and on the frame it reaches the ring the check's slot closes and the counts are knocked right into it, past where they land and back. Then sparks fly from the ring in the met goals' colors. Without the check on screen, as with one goal, nothing moves: the sheen passes over the ring and the sparks follow. With reduced motion the check just goes |

## Done lens

| Rule | When | Then |
| --- | --- | --- |
| `goals.lens` | The done lens on today with goals set | The count line reads e.g. "3 done today", then a button per goal with its color and today's numbers as e.g. "1/2" (the goal dimmed). Clicking one narrows the lens to it: its category, or for everything else the tasks outside every goal category, and the count line counts against that goal, e.g. "2/3 done today". Clicking it again shows them all. Opening the lens, the buttons fade in as its count lands (`done.lens-flip`), and each category goal whose ring shows in the header sends a copy of it down onto its button's dot |

## Goal report

| Rule | When | Then |
| --- | --- | --- |
| `goals.report` | `G`, the week in the done lens, or Goal report in the `Ctrl/⌘+K` palette, with goals set | The goal report takes the list's place on this month, the header staying, with the done count pressed. `Shift+G` opens it on the year instead. `G`, `Escape`, its × or the done count go back to whatever it covered, as it was. Without goals, a toast says to set one in Settings › Goals |
| `goals.report-open` | The done lens on today, or hovering the done count | Seven dots show this week: each fills with green as its day nears every daily goal, solid once met, today ringed in the accent. In the lens they sit at the end of the count line, under it on a phone, and open the report |
| `goals.report-judged` | Showing any past day | Days are judged by today's goals, so changing a goal re-judges the whole history. A day is met when every daily goal is; weekly goals never hold a day back and get their own column. With only weekly goals, a day counts as met once they are met for its week |
| `goals.report-month` | The month | Weeks are rows starting on the chosen weekday. Each day shows how many tasks got done inside a ring of its daily goals, solid once met, and below it a pip in each goal's color for a daily goal it met or a weekly goal it did something for. A thread joins met days next to each other. With weekly goals, a last column shows each one's week, with a check once met. Above, the month's met days out of the days so far, the current streak (up to yesterday while today is open), the month's best streak and what got done. Days after today and before anything was done show only their date |
| `goals.report-year` | The year | Every day from 1 January to 31 December as a small square, a column per week: green once met, fainter the less of its goals it got to, quiet when nothing got done. The stats count the year |
| `goals.report-keys` | Keys in the report | Arrows move the selected day: in the month left and right are a day and up and down a week; in the year, left and right are a week. Moving past the month or year shows the next. `Ctrl/⌘+Left/Right` go a month or year back or on, keeping the day of the month. `Home` goes to today. Days never go past today or before the first day anything was done. `Shift+G` switches between month and year. Pointing at a day, or moving to it, shows its date, whether it was met and each goal's numbers |
| `goals.report-day` | `Enter` or clicking a day | The done lens shows that day's tasks, its count line reading e.g. "5 done on Fri, Nov 13" with that day's goal numbers |
| `goals.report-back` | Going back from a day's done lens, in any way the lens goes back | The report returns on that day, month or year as it was, ready for the next day |
| `goals.report-tally` | Delete done tasks removes tasks | Each day's count per category of what it removed is added to a tally in the shared settings, so the report still counts them. Renaming a category carries its tally |
| `goals.report-motion` | The report opens, moves or closes | From `G`, a copy of the done count's ring flies to today; from the lens's week, each dot flies to its day. The days spread out from where they land, the thread draws backward from today and the stats count up. A new month or year slides in from its side. A day opened flies to the lens's count line; closing onto today's done lens sends this week's days back into its dots. When today's daily goals are all met, the first look at the report afterward, or the moment it happens with the report open, closes the day: its ring bumps, sparks fly in the met goals' colors, a sheen crosses its week and the streak ticks up. Reduced motion turns it all off |

## Settings

| Rule | When | Then |
| --- | --- | --- |
| `settings.goals` | Settings › Goals | Lists each goal with its category's color (set in Settings › Categories, not here), a number and a day or a week, then Add a goal… for a category without one, then everything else. `Up` / `Down` move between goals in the same column, `Tab` goes to the number, then a day / a week. A category goal's × removes it and moves on to the next row; clearing a number removes its goal too. Renaming a category carries its goal |
| `settings.days` | Settings › General › Days and weeks | Day ends at (midnight to 11:00) and Week starts on, shared by every device |

## Logging

| Rule | When | Then |
| --- | --- | --- |
| `capture.log` | `L` on the list | The New task editor opens for a task already done. `Tab` from the title goes to its "when" pill: Done now, Done this morning, Done yesterday, or Done on a day picked; `Left` / `Right` or a click change it and `Enter` saves. The task is created done at that time (`create.logged`): this morning is 9:00, a day is its noon, never later than now |
