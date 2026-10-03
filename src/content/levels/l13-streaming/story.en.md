The AI support assistant in the Nova App ships to beta testers. The very first piece of feedback is three words: "Is it frozen?"

> **Mia**: Users send a question and the spinner spins for 6 seconds, then a big block of text suddenly pops out all at once. As far as the user can tell, 6 seconds of blank screen means "broken".

> **Mia**: Also, when users realize they asked the wrong thing, they want to hit "Stop", and there's no such button. Even if there were, the model would keep generating in the background and we'd still be billed for the tokens.

> **Qiang**: The model service had a hiccup last week. Some requests didn't produce a single token for 30 seconds, and the frontend just hung.

> **Zhou**: Three things: **streaming**, push the first token to the user the moment it exists; **cancellation**, when the user hits Stop, actually abort the request; **first-token timeout**, if nothing comes out for too long, give up decisively and retry or fall back. And when the agent calls tools, tell the user what it's doing instead of leaving them staring at a cursor.
