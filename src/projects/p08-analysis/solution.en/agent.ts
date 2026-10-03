import { log } from 'agent-quest'
import { runAgent } from '../../agent'
import type { Tool } from '../../tools'

export interface DatasetSummary {
  name: string
  rows: number
  description: string
}

/** Raw API provided by the environment (in the sandbox, read data with `import { load } from 'data'`; values are raw strings) */
export interface AnalysisEnv {
  listDatasets(): Promise<DatasetSummary[]>
  preview(name: string, n?: number): Promise<string>
  runCode(code: string): Promise<string>
}

export interface AnalysisAnswer {
  answer: number | string
  code: string
  explanation: string
}

const SYSTEM = (catalog: string) => `You are the data analysis agent for FreshDash's ops analytics team. Every number must be computed by running code with run_code; never estimate or do mental math.

<datasets>
${catalog}
</datasets>

<sandbox>
run_code runs TypeScript (synchronously, no top-level await). Read data with import { load } from 'data': load(name) returns the rows parsed by header, and every value is a raw string (empty is ''); your code does the type conversion and cleaning. Print results with console.log; print summaries only, never whole tables.
</sandbox>

<cleaning rules>
- Count duplicate records once: sales by whole row, events by event_id, nps by resp_id.
- Missing / invalid values (empty, N/A, out-of-range scores) are excluded, never treated as 0.
- Different spellings of regions, platforms and cities (case, suffixes like "Region" / "City") are merged into the canonical name.
- Numbers may have thousands separators; strip them before converting.
</cleaning rules>

Workflow:
1. Use preview_dataset to see the header and first rows.
2. Data quality check: with code, count empty values per column, exact duplicate rows, every value of the category columns, and number formats. Clean first rows don't mean a clean table.
3. Write the analysis code following the cleaning rules; if it errors, read the error, fix it and rerun.
4. The final answer must be printed by one complete, standalone piece of code: the last line is console.log('ANSWER:', value), rounded to the precision the question asks for.
5. Final reply: first line "Answer: <value>", then a sentence or two on how you computed it.`

function analysisTools(env: AnalysisEnv, runs: { code: string; output: string }[]): Tool[] {
  return [
    {
      spec: {
        name: 'preview_dataset',
        description: "Show the first n lines of a dataset's raw CSV (header included) to learn the columns and formats. Note: the first rows don't tell you the data quality of the whole table.",
        input_schema: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Dataset name, e.g. "sales"' }, n: { type: 'number', description: 'Number of rows, default 5, max 50' } },
          required: ['name'],
        },
      },
      run: ({ name, n }) => env.preview(String(name), typeof n === 'number' ? n : 5),
    },
    {
      spec: {
        name: 'run_code',
        description: "Run TypeScript code in the sandbox (import { load } from 'data') and return the console.log output; on failure, returns the error message.",
        input_schema: { type: 'object', properties: { code: { type: 'string', description: 'Complete TypeScript code' } }, required: ['code'] },
      },
      run: async ({ code }) => {
        const output = await env.runCode(String(code))
        runs.push({ code: String(code), output })
        return output
      },
    },
  ]
}

/** Convert the answer text to the type the question wants: anything that parses as a number becomes a number */
function parseAnswer(text: string): number | string {
  const t = text.trim().replace(/^["'“]|["'”]$/g, '')
  const n = t.replace(/[,%\s]/g, '')
  return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t
}

const catalogs = new WeakMap<AnalysisEnv, Promise<string>>()
function catalogOf(env: AnalysisEnv): Promise<string> {
  let hit = catalogs.get(env)
  if (!hit) {
    hit = env.listDatasets().then((sets) => sets.map((s) => `- ${s.name} (${s.rows} rows): ${s.description}`).join('\n'))
    catalogs.set(env, hit)
  }
  return hit
}

export async function analyze(question: string, env: AnalysisEnv): Promise<AnalysisAnswer> {
  const runs: { code: string; output: string }[] = []
  const res = await runAgent(question, analysisTools(env, runs), { system: SYSTEM(await catalogOf(env)), maxSteps: 10 })
  // The code's output is the source of truth: take the last successful run that printed ANSWER
  const answered = runs.filter((r) => /ANSWER:/.test(r.output) && !/(^|\n)\s*Error:/.test(r.output))
  const last = answered[answered.length - 1]
  const fromOutput = last ? [...last.output.matchAll(/ANSWER:\s*(.+)/g)].pop()?.[1] : undefined
  const fromText = /Answer:\s*(.+)/i.exec(res.output)?.[1]
  const answer = parseAnswer(fromOutput ?? fromText ?? res.output)
  log(`Data analysis: ${res.stopReason}, ${res.steps} steps, ran code ${runs.length} times, answer ${answer}`)
  return { answer, code: last?.code ?? runs[runs.length - 1]?.code ?? '', explanation: res.output.replace(/^.*Answer:.*\n?/im, '').trim() }
}
