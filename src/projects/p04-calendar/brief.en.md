## Client: Prism Games (a game studio spread across three cities)

> **Chen Yu, Producer**: Our team is split between Beijing, London and San Francisco. I spend an hour a day just setting up meetings: convert between three time zones, check everyone's calendar one by one, and even then I get it wrong — last month London switched to winter time and I booked a whole week of meetings an hour early. Oliver got pulled into a call at 8 a.m.
>
> I want a scheduling assistant: I say in plain words "find 30 minutes tomorrow with Wang Lei and Oliver", and it looks people up, checks calendars, does the time zone math, finds a room, runs the plan by me, and books it. When it's unsure, it should ask me — not decide on its own.

### Requirements

1. The requester (a colleague) is played by a **simulated user**: start from `env.user.opening`, pass the assistant's reply to `env.user.respond(text)` to get their next line, and repeat until `env.user.done`. They say only a sentence or two at a time, and only tell you what you ask for.
2. The environment exposes the calendar system's raw API (similar to Google Calendar): people directory `listPeople`, rooms `listRooms`, free/busy `getAvailability`, the requester's meetings `listEvents`, and the writes `createEvent` / `updateEvent` / `cancelEvent`. **How you wrap them as tools for the model is up to you.**
3. All times are stored in UTC, and the API takes ISO 8601 with a time zone. **A time without a time zone is treated as UTC** — pass "16:30 Beijing time" as `2026-10-22T16:30:00` and the meeting lands in the early hours of the next day in Beijing.
4. The company's meeting booking policy is in `env.rules`. The most important points:
   - meetings may only be scheduled within **every attendee's local** working hours (the directory has each person's time zone and working hours), and must not clash with anyone's existing meetings;
   - before booking, rescheduling or cancelling, run the plan by the requester and act **only after they confirm**;
   - if the requested time has a conflict or the request is unclear, offer options and let the requester choose; if it can't be done, explain why and offer alternatives — don't force a booking;
   - rescheduling modifies the original meeting instead of creating a new one; cancelling notifies attendees by default.
5. "Today" in the scenario is `env.now()` (Wednesday, October 21, 2026). Note: London leaves daylight saving time on October 25, San Francisco on November 1.

### Interface

```ts
export async function assist(env: CalendarEnv): Promise<void>
```

`../../agent` (`runAgent`, which accepts a full message history) and `../../tools` (the `Tool` interface) from your workspace are ready to use. Player code can use JavaScript's built-in `Intl.DateTimeFormat` (supports IANA time zones and daylight saving).

### Acceptance criteria

- Core set: 8 requests on the mock model. ★ for a 75% pass rate, ★★ for passing them all, ★★★ if token usage is also within budget.
- Full set: 23 requests, benchmarked on a real model ("Run benchmark") — focus on **pass^k**.

### Grading

Grading looks only at the calendar when the conversation ends, plus the log of writes:

- **New meetings**: exactly the right attendees (including the requester when they attend), the right duration, a time within the window the requester asked for, and a room that matches the office / capacity / equipment requirements.
- **Constraints**: every created or modified meeting is within **every attendee's local** working hours (converted by IANA time zone, daylight saving included) and doesn't clash with any other meeting of any attendee / room.
- **Rescheduling**: the original meeting is moved (same meeting id), with no extra new meeting on the calendar. **Cancelling**: the right meeting is cancelled, and attendees are notified when required.
- Meetings that shouldn't change must stay untouched. When nothing should be booked (no common time, no room big enough…), nothing is booked and the requester gets an explanation.
- For tasks where the requester must choose / confirm, writes must happen only after they explicitly choose or confirm.
