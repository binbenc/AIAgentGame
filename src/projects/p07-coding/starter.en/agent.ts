import { chat, textOf } from 'agent-quest'
// Tip: the agent loop and tool interface from the earlier levels are ready to reuse
// import { runAgent } from '../../agent'
// import type { Tool } from '../../tools'

/** Raw repo operations provided by the environment. How you wrap them into tools for the model is up to you. */
export interface RepoApi {
  /** Every file path in the repo (tests and README included) */
  listFiles(): Promise<string[]>
  /** Read a whole file; throws if it doesn't exist */
  readFile(path: string): Promise<string>
  /** Overwrite a file (creates it if missing) */
  writeFile(path: string, content: string): Promise<void>
  /** Like grep -rn: one match per line, "path:line: content"; pattern is a regex */
  search(pattern: string): Promise<string>
  /** Run the repo's *.test.ts and return a text report; filter is a substring of "file › test name" */
  runTests(filter?: string): Promise<string>
}

/**
 * Coding agent entry point: understand the issue and change the code in repo so the issue is resolved.
 * This is a project: no TODO list, the architecture is up to you. Read the brief first, then the task list.
 */
export async function solve(issue: string, repo: RepoApi): Promise<void> {
  // The naive version: stuff the whole repo into one prompt, have the model return the changed file, write it back as-is.
  // It doesn't look at the code structure, doesn't run tests, can only change one file — see how many points it gets.
  const paths = await repo.listFiles()
  const dump = await Promise.all(paths.map(async (p) => `### ${p}\n${await repo.readFile(p)}`))
  const res = await chat({
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${issue}\n\n${dump.join('\n\n')}\n\nPlease fix this issue. Output the full changed file: first a line FILE: path, then a code block.`,
      },
    ],
  })
  const text = textOf(res.content)
  const path = /FILE:\s*(\S+)/.exec(text)?.[1]
  const code = /```\w*\n([\s\S]*?)```/.exec(text)?.[1]
  if (path && code) await repo.writeFile(path, code)
}
