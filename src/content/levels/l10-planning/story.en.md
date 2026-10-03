Monday morning, Mia drops a chat screenshot into the group:

> Customer: I'm alice@example.com. Please: 1) show me all my pending orders; 2) cancel the smart lock order; 3) tell me the return policy; 4) where is my AC order NV-100001 now?

The agent looked up the orders, then looked them up again, then checked shipping, and then... it just answered. The lock wasn't cancelled, and the return policy never came up.

> **Mia**: The customer asked for four things in one go and it did one and a half. And it called the same API twice.

> **Zhou**: A pure ReAct loop works "one step at a time": at every step, the model has to remember what's left to do inside an ever-growing conversation. Once a request gets complicated, it goes in circles, repeats itself and drops items.

> **Zhou**: Complex requests need **plan first, then execute**. Have the model write a step list up front, then do the steps one by one, each focused on its own job, and synthesize everything at the end. When a step fails, **replan** with the failure reason instead of plowing ahead.
