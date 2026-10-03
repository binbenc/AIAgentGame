Nova's smart ACs are selling well, and customers keep asking: "How hot is it at my place today? Should I turn the AC on early?"

> **Mia**: The model's knowledge was frozen at training time. It has no idea what the weather is today.

> **Zhou**: That's why we give it **tools**. Mind you, the model doesn't run the tool. It only says "I'd like to call `get_weather` with `{city: "Shanghai"}`". **Your code does the actual work.** Then you hand the result back to the model as a `tool_result`. That round trip is the atomic operation of every agent.

> **Zhou**: One more thing: a tool's `description` and parameter schema are a prompt written for the model. Make them vague, and the model won't use the tool, or will misuse it.
