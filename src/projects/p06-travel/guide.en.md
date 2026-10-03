## Production notes

- **Let the model do what it's good at, and hand anything computable to code.** In the TravelPlanner paper, GPT-4-class models that looked up data and planned on their own passed less than 1% of the time, mostly failing on constraints that need arithmetic or cross-checking: adding up costs, checking opening hours. Looking up data, adding up money, working out the weekday and checking opening hours are all a few lines of deterministic code that get it right.
- **First turn the request into structured constraints** (`TripRequest`: level 2's structured output + zod validation). Retrieval, filtering and validation all build on it. When planning, put this constraint list **verbatim into the prompt** instead of hoping the model remembers every preference from a long paragraph.
- **Shrink the action space**: filter hard preferences (no flights, pets, accessibility, room type, minimum stay) out at the data layer. The model can't pick an option it never sees, and the context gets shorter and cheaper.
- **Plan → verify → revise** (level 15's evaluator-optimizer), but **don't use a model as the reviewer**: it's as bad at the arithmetic as the planner and will always say "looks good". Write a deterministic verifier, send the list of violations (which day, which id, what was broken, by how much) back to the model one by one to fix, cap the number of revisions, and return the draft with the fewest problems.
- **The verifier should cover every rule**, including the preferences already handled by filtering (defense in depth): if the filtering logic breaks one day, the verifier still catches it.
- **Say "infeasible" early and honestly**: compute a feasibility lower bound in code (the cheapest transport for each leg + the cheapest compliant hotel at each stop + the required meals and tickets). If even the lower bound is over budget, a leg has no compliant transport, or a stop has no compliant hotel, return `feasible: false` with the reason right away, without calling the model.
- **Only trust catalog ids**: render data for the model one option per line with the id first; when validating, treat any id that isn't among the options as an error. Put the weekday next to each date and pass opening hours and closing days through as-is, so the model has something to go on when revising.
- **Workflow or agent?** The data this task needs can be derived from the structured constraints (which legs, which cities), so fetching everything in parallel in code is much cheaper than letting the model look things up one at a time in a tool loop, where every step resends the whole history. Try both in benchmark mode and compare the tokens.
- After launch: add itineraries customers complained about to the task set; rerun the benchmark automatically whenever the catalog changes; record how many revision rounds each request took. More rounds usually means something is off in the prompt or in how the data is rendered.

## Reference architecture

```
request ──▶ parse request (model, structured output + zod) ──▶ TripRequest
                                                                │
                       ┌────────────────────────────────────────┤
                       ▼                                        ▼
          fetch in parallel (code): transport for      filter hard preferences (code):
          each leg, hotels / restaurants /        ──▶  flights / pets / accessibility /
          attractions in each city                     room type / minimum stay
                                                                │
                                                                ▼
                         feasibility lower bound (code) ── infeasible ──▶ { feasible: false, reason }
                                                                │ feasible
                                                                ▼
             ┌──▶ plan (model): <constraints> TripRequest + <options> compact data (ids, weekdays, opening hours)
             │                                                  │
             │                                                  ▼
             │                              verify (code): list every violation
             │                                                  │
             └──── problems left and under the revision cap ◀───┤
                                                                │ passed
                                                                ▼
                                                           TravelPlan
```
