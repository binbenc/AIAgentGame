## Production notes

- **Time zone math belongs to code, not the model.** The time differences in a model's head are "common knowledge from training data"; it doesn't know London switches to winter time next week. Use `Intl.DateTimeFormat({ timeZone })` inside your tools to convert everyone's working hours and free/busy, and hand the model a ready-made list of "common free slots" to pick from. Nine out of ten calendar-agent incidents come from time conversion.
- **Times in tools are always zoned UTC ISO strings** (`2026-10-22T08:30:00Z`). State the format in the tool description, reject times without a zone during argument validation, and say how to fix it in the error. For humans, add each person's local time and UTC offset ("London 09:30, UTC+1").
- **Tell the model what "now" is**: today's date, the weekday, and the requester's time zone. "Tomorrow", "next Monday" and "this Friday" all depend on it. Add a date table for the next two or three weeks (date + weekday) too — models often get weekdays wrong.
- **Tell the model who "I" am**: the requester's name, email and time zone. Otherwise it doesn't know who "I'll join too" refers to.
- **Policy goes in the system prompt; confirmation is a stop**: list the plan first (time, attendees, room), end the turn there and hand it back to the requester; after they confirm, call the write tool in the next turn. Same for conflicts and ambiguity: offer options, don't decide for people.
- **Carry the full conversation history into the next turn** (tool calls and results included): the "no meetings on Friday afternoons" from the requester's first message still has to hold in turn three.
- **Tools must be able to express intent**: rescheduling uses `update_event` (same meeting id), not "create a new one and forget to delete the old one"; cancelling must be able to "notify attendees". Without the right tool, the model cobbles something together from the wrong one.
- **If there's no time, say so**: when three cities share no working hours, the right move is to explain and offer alternatives (separate meetings, taking turns to accommodate), not to book a meeting someone has to attend at 2 a.m.
- After launch: build a regression set from real booking requests, score it on the final calendar state (the AppWorld approach), and rerun it every time you change the prompt or the model — paying special attention to the weeks around daylight saving changes.

## Reference architecture

```
                 ┌───────────────── conversation loop (≤ MAX_TURNS turns, full message history kept) ─────────────────┐
opening ──▶ messages ──▶ runAgent(messages, tools, { system })                                                       │
                 ▲          system = today (date + weekday + time zone) + date table + who the requester is           │
                 │                   + env.rules + how to work                                                        │
                 │          tools:                                                                                     │
                 │            find_people          → email, time zone, local working hours                            │
                 │            find_meeting_slots   → common free slots computed in code (Intl, daylight saving incl.; │
                 │                                   UTC + each person's local time)                                  │
                 │            list_rooms / list_events                                                                 │
                 │            create_event / update_event / cancel_event (zoned ISO only, otherwise an error)          │
                 │                     │                                                                               │
                 └── push(reply) ◀── env.user.respond(output) ──▶ done? ──yes──▶ end                                   │
                 └─────────────────────────────────────────────────────────────────────────────────────────────────────┘

Time flow: env (UTC) ──▶ tools (UTC + local time notes) ──▶ the model picks one ──▶ passed back verbatim to write tools (UTC)
```
