## Production notes

- **ReAct and Plan-and-Execute each have their place**. ReAct (think as you go) suits exploratory tasks where the next move depends on what you just saw, like debugging an unknown failure. Plan-and-Execute suits "the user asked for several things at once" and tasks whose steps can mostly be decided up front: it rarely drops items, the process is auditable, and you can show the plan to the user for confirmation first.
- Planning isn't free: it adds a planning call and a synthesis call. For simple questions (answerable in a step or two), plain ReAct is faster and cheaper. A common production pattern is to **route first**: decide whether a request is complex, then pick the path (level 11).
- **Pass results between steps, not whole conversations**. Each step starts from a clean context, so token use grows roughly linearly with the number of steps; a single ReAct loop keeps growing, and every later step pays for every earlier tool result.
- The plan is structured output: **validate** it like any other model output (zod / JSON Schema), and cap the number of steps so the model can't produce a 50-step plan.
- **Cap replanning**. Replanning with a concrete error message works far better than blind retries, but unbounded replanning is as dangerous as an infinite loop.
- Planning and execution can use different models: a strong model to think the plan through, a cheap fast model for simple steps. LangGraph's plan-and-execute template and the OpenAI Agents SDK's handoff orchestration are essentially this structure.
- A plan is a natural progress bar: show the step list to the user live ("Step 2/4: cancelling order..."). It's a much better experience than staring at a spinner (level 13).
