import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

/** Raw repo operations provided by the environment */
export interface RepoApi {
  listFiles(): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  search(pattern: string): Promise<string>
  runTests(filter?: string): Promise<string>
}

const SYSTEM = `You are a careful open-source maintainer fixing issues in a TypeScript repo.

Workflow:
1. Understand the issue: the repro steps and expected behavior are reliable; the reporter's guesses about the cause and suggested fixes may be wrong. The README and existing tests are the source of truth.
2. Locate: use search_code to find the relevant functions / keywords, then read_file to read the whole relevant files. The bug may not be in the file the issue mentions.
3. Edit: make the smallest change with str_replace; old_str must match the file exactly (including indentation) and be unique. Use write_file only for new files.
4. Verify: always call run_tests after editing. If anything fails, work out why and keep fixing the source until everything passes.
5. Never modify test files (*.test.ts), and don't make the problem "go away" by removing features.
6. When done, summarize what you changed in a sentence or two.`

const isTestFile = (path: string) => /\.test\.ts$/.test(path)

function numbered(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${i + 1}\t${line}`)
    .join('\n')
}

function count(haystack: string, needle: string): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) n++
  return n
}

/** Agent-computer interface (ACI): few, focused tools, clear errors, line-numbered and bounded output */
export function createRepoTools(repo: RepoApi): Tool[] {
  const guardTests = (path: string) => {
    if (isTestFile(path)) throw new Error(`${path} is a test file and must not be modified. Change the source so the tests pass.`)
  }
  return [
    {
      spec: {
        name: 'search_code',
        description: 'Regex search across the whole repo (like grep -rn). Returns "path:line: content". Use it to find definitions and call sites.',
        input_schema: { type: 'object', properties: { pattern: { type: 'string', description: 'Regex or keyword, e.g. "function taxFor"' } }, required: ['pattern'] },
      },
      run: ({ pattern }) => repo.search(String(pattern)),
    },
    {
      spec: {
        name: 'list_files',
        description: 'List every file path in the repo.',
        input_schema: { type: 'object', properties: {} },
      },
      run: async () => (await repo.listFiles()).join('\n'),
    },
    {
      spec: {
        name: 'read_file',
        description: 'Read a whole file. Each line is prefixed with its line number and a tab (the line numbers are not part of the file).',
        input_schema: { type: 'object', properties: { path: { type: 'string', description: 'File path, e.g. "src/date.ts"' } }, required: ['path'] },
      },
      run: async ({ path }) => {
        try {
          return numbered(await repo.readFile(String(path)))
        } catch {
          const all = await repo.listFiles()
          const name = String(path).split('/').pop() ?? ''
          const similar = all.filter((p) => p.includes(name.replace(/\.ts$/, '')))
          throw new Error(`File not found: ${path}. ${similar.length ? `Did you mean: ${similar.join(', ')}?` : `Use list_files to see which files exist.`}`)
        }
      },
    },
    {
      spec: {
        name: 'str_replace',
        description: 'Replace a snippet of a file with new text. old_str must match the file exactly (indentation included, no line numbers) and occur exactly once.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            old_str: { type: 'string', description: 'Text to replace (include enough context to make it unique)' },
            new_str: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_str', 'new_str'],
        },
      },
      run: async ({ path, old_str, new_str }) => {
        const p = String(path)
        guardTests(p)
        const src = await repo.readFile(p)
        const n = count(src, String(old_str))
        if (n === 0) throw new Error(`old_str not found in ${p}. Whitespace and indentation must match exactly, without line numbers; read_file first to see the original.`)
        if (n > 1) throw new Error(`old_str occurs ${n} times in ${p}. Include a few more lines of context to make it unique.`)
        const at = src.indexOf(String(old_str))
        await repo.writeFile(p, src.slice(0, at) + String(new_str) + src.slice(at + String(old_str).length))
        const line = src.slice(0, at).split('\n').length
        return `Edited ${p} (around line ${line}).`
      },
    },
    {
      spec: {
        name: 'write_file',
        description: 'Create a file, or overwrite one with full content. Prefer str_replace for editing existing files.',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'Full file content' } },
          required: ['path', 'content'],
        },
      },
      run: async ({ path, content }) => {
        guardTests(String(path))
        await repo.writeFile(String(path), String(content))
        return `Wrote ${path}.`
      },
    },
    {
      spec: {
        name: 'run_tests',
        description: 'Run all tests in the repo (*.test.ts) and return failure details plus a summary. Use filter to run only tests whose name contains a substring.',
        input_schema: { type: 'object', properties: { filter: { type: 'string', description: 'Optional: filter by "file › test name"' } } },
      },
      run: ({ filter }) => repo.runTests(typeof filter === 'string' ? filter : undefined),
    },
  ]
}

export async function solve(issue: string, repo: RepoApi): Promise<void> {
  const result = await runAgent(`<issue>\n${issue}\n</issue>\n\nPlease fix this issue.`, createRepoTools(repo), { system: SYSTEM, maxSteps: 25 })
  log(`Coding agent finished: ${result.stopReason}, ${result.steps} steps. ${result.output.slice(0, 120)}`)
}
