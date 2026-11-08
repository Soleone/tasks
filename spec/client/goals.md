# Goals

A goal is a number of tasks to finish a day or a week, per category, plus one for everything else. Goals and category colors are shared settings: they live in the workspace and sync to every device (`home.shared-settings`). Without goals, nothing here shows and the done count is as before.

## Counting

| Rule | When | Then |
| --- | --- | --- |
| `goals.fill` | A task is done today | It fills its category's goal, or the goal for everything else when its category has none, and the done count's ring. Past its target it fills only the done count's ring, never spilling into everything else. The done count's target is all of today's targets added up |
| `goals.week` | A weekly goal | Today's target is what's left of the week over the days left, today included, rounded up. A slow week raises it, and logging into an earlier day of the week can lower it. Met for the week, it stays met until the week ends |
| `goals.names` | The goal for everything else | Reads "All tasks" while no category has a goal, "Everything else" once one does. With no goals at all, there are no rings |
| `goals.day-ends` | Goals are set | Today begins when the day ends (Settings › General, 04:00 by default), so 2am still counts as yesterday, for the done count, the done lens and goals. Weeks start on the chosen weekday. Without goals, "today" stays the last 24 hours (`done.today`) |

## Header

| Rule | When | Then |
| --- | --- | --- |
| `goals.header` | Goals are set | The done count's check becomes a ring for today's total and shows from the start of the day, even at zero. With two goals or more, each open category goal follows as a small ring in its category's color, up to four, then "+N". Met ones fold into one check with a pip in each category's color, up to three, then "✓N". Everything else gets no small ring or pip: it would read as a second total, so the done count's ring and tooltip carry it. A ring's arc eases to its new length. With a category filter on, only that category's goal stays. Small rings fold away on a narrow window. Clicking any of them toggles the done lens |
| `goals.hover` | Hovering the done count | The whole group lights up as one: the ring is the goals added up |
| `goals.tooltips` | Hovering a part | The done count: "Done today" with today's total against the target, then each goal's numbers when there are two or more, and Show what's done `D`. A goal ring: its name and today's numbers; a weekly goal labels Today and This week. The met check: "Met today" and each met goal's numbers. A check sits in its own slot left of met numbers, and numbers line up in columns however many digits they have |
| `goals.flight` | A completion flies to the header (`done.flight`) | The rings hold their numbers until it lands on the ring of the goal it fills, which then fills and bumps, then a dot in that goal's color carries on to the done count. The done count's ring fills rather than bumps. When that goal is already met, or the task fills no goal ring, it lands on the done count as before |

## Done lens

| Rule | When | Then |
| --- | --- | --- |
| `goals.lens` | The done lens on today with goals set | The count line reads e.g. "3 of 7 done today", then a button per goal with its color and today's numbers. Clicking one narrows the lens to it: its category, or for everything else the tasks outside every goal category, and the count line counts against that goal. Clicking it again shows them all |

## Settings

| Rule | When | Then |
| --- | --- | --- |
| `settings.goals` | Settings › Goals | Lists each goal with its category's color (set in Settings › Categories, not here), a number and a day or a week, then Add a goal… for a category without one, then everything else. `Up` / `Down` move between goals in the same column, `Tab` goes to the number, then a day / a week. Clearing a number removes its goal. Renaming a category carries its goal |
| `settings.days` | Settings › General › Days and weeks | Day ends at (midnight to 06:00) and Week starts on, shared by every device |

## Logging

| Rule | When | Then |
| --- | --- | --- |
| `capture.log` | `L` on the list | The New task editor opens for a task already done. `Tab` from the title goes to its "when" pill: Done now, Done this morning, Done yesterday, or Done on a day picked; `Left` / `Right` or a click change it and `Enter` saves. The task is created done at that time (`create.logged`): this morning is 9:00, a day is its noon, never later than now |
