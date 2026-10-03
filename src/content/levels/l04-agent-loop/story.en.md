Customer questions rarely get answered in one step. "Where's my latest order?" means: find the customer by email, list their orders, pick the newest one, then check its shipping.

> **Zhou**: Last level you wrote a single tool round trip by hand. Now turn it into a **loop**: as long as the model wants to call tools, run them, feed the results back and ask again, until it says "I'm done". That's an agent. No magic involved.

> **Zhou**: But a loop also means it might **never stop**. I once saw an agent hit the same endpoint 4,000 times overnight, and finance came knocking the next morning. So it must have a maximum number of steps.
