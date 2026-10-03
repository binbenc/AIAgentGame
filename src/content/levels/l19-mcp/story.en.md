Nova's hardware team has shipped an **MCP server**, "Nova Smart Home Devices", that can list devices, set temperatures and check firmware. The same week, marketing wants your order tools in their marketing assistant, and the data team wants them in their BI bot.

> **Mia (PM)**: Every team is coming to you to "just integrate it". Three agents and five toolsets means fifteen piles of glue code, and when anyone changes a parameter, everything breaks at once.

> **Zhou**: That's the M×N problem. **MCP (Model Context Protocol)** turns it into M+N: a tool provider implements one MCP server, and any agent that speaks MCP — Claude Desktop, Claude Code, Cursor, and our own — can plug straight in. Under the hood it's just JSON-RPC 2.0. Nothing magic.

> **Zhou**: Today you build both ends: wrap the order tools in an MCP server, then write an MCP client so our agent can use the hardware team's device server and your own order server at the same time.

> **Vera**: One reminder: what a third-party server returns — and even **the tool descriptions themselves** — is untrusted input. Don't forget last level's lessons.
