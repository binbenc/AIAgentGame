Mia has pulled together the dozen or so Nova help center docs: warranty policy, return rules, a user manual for each product...

> **Mia (PM)**: I tried asking the model straight up, "How long is the Robot Vacuum R5 warranty?" It confidently said "3 years". It's actually 2. A customer posted the screenshot online, and legal nearly had a word with me.

> **Zhou**: The model doesn't know our company's rules; it only knows how to sound plausible. The right approach is **RAG**: first **retrieve** the relevant passages from the docs, put them in the prompt, have the model answer only from them, and **cite the sources**, so users can click through and check, and we know where every answer came from.

> **Qiang (ops on-call)**: Don't stuff every doc into the prompt. A dozen is fine today; with thousands later, one request will blow up. Send only the most relevant chunks.

> **Vera (security lead)**: Two more things. First, the model sometimes invents a source that doesn't exist. It looks very professional and it's fake, so citations must match what we actually retrieved. Second, people ask support to write poems or pick stocks. **If retrieval can't find anything relevant, don't pay for a model call.**
