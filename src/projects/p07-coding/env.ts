/**
 * P7 的环境：内存里的虚拟仓库 + 一个迷你测试框架（testkit）+ 隔离的测试运行器。
 *
 * - 仓库文件以 `.txt` 形式存放在 repos/ 下（这样不会被 tsc / Vite 当成项目源码），
 *   路径去掉 `.txt` 后缀就是仓库里的路径，例如 repos/datekit/src/date.ts.txt → src/date.ts。
 * - 每次跑测试都新建一个模块系统（createModuleSystem），玩家改过的代码不会串到下一次运行，
 *   判定时也会在全新的模块系统里跑。
 * - 仓库代码只能 import 相对路径和 'testkit'。
 * - 防护：每个测试单独 try/catch，输出有长度上限。同步死循环没法从内部打断——
 *   写出死循环的修改会让这次运行卡住直到超时，这也是生产环境要把不可信代码放进沙箱（容器 + 超时）的原因。
 */
import { L, LOCALE } from '../../engine/locale'
import { createModuleSystem } from '../../engine/sandbox/loader'
import type { EnvCtx } from '../types'

export type RepoName = 'datekit' | 'cartcalc' | 'mdlite'
export type Files = Record<string, string>

const RAW = import.meta.glob('./repos/**/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// English versions of the repo files (comments, README, test names, error messages); files missing here fall back to repos/
const RAW_EN = import.meta.glob('./repos.en/**/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function loadRepos(raw: Record<string, string>, dir: string, into: Record<RepoName, Files>) {
  for (const [key, text] of Object.entries(raw)) {
    const rest = key.slice(key.indexOf(dir) + dir.length).replace(/\.txt$/, '')
    const repo = rest.slice(0, rest.indexOf('/')) as RepoName
    into[repo][rest.slice(rest.indexOf('/') + 1)] = text
  }
  return into
}

/** 未植入 bug 的基线仓库 */
export const BASE_REPOS: Record<RepoName, Files> = loadRepos(RAW, '/repos/', { datekit: {}, cartcalc: {}, mdlite: {} })
if (LOCALE === 'en') loadRepos(RAW_EN, '/repos.en/', BASE_REPOS)

export interface Patch {
  path: string
  find: string
  replace: string
}

/** 精确替换一处（find 必须恰好出现一次） */
export function applyPatch(files: Files, p: Patch): Files {
  const src = files[p.path]
  if (src === undefined) throw new Error(L(`补丁的目标文件不存在：${p.path}`, `Patch target does not exist: ${p.path}`))
  const at = src.indexOf(p.find)
  if (at < 0 || src.indexOf(p.find, at + 1) >= 0) throw new Error(L(`补丁在 ${p.path} 中没有唯一匹配：${p.find.slice(0, 60)}`, `Patch has no unique match in ${p.path}: ${p.find.slice(0, 60)}`))
  return { ...files, [p.path]: src.slice(0, at) + p.replace + src.slice(at + p.find.length) }
}

export const isTestFile = (path: string) => /\.test\.ts$/.test(path)
export const testFilesOf = (files: Files) => Object.keys(files).filter(isTestFile).sort()

// ———————————————————— testkit：仓库测试用的迷你测试框架 ————————————————————

class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssertionError'
  }
}

function show(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (typeof v === 'function') return '[Function]'
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function expect(actual: unknown) {
  const matchers = (negate: boolean) => {
    const not = negate ? '.not' : ''
    const assert = (ok: boolean, matcher: string, expected: unknown, received: unknown = actual) => {
      if (ok === negate)
        throw new AssertionError(
          L(
            `expect(received)${not}.${matcher}\n期望：${negate ? '不是 ' : ''}${show(expected)}\n实际：${show(received)}`,
            `expect(received)${not}.${matcher}\nExpected: ${negate ? 'not ' : ''}${show(expected)}\nReceived: ${show(received)}`,
          ),
        )
    }
    return {
      toBe: (expected: unknown) => assert(Object.is(actual, expected), 'toBe(expected)', expected),
      toEqual: (expected: unknown) => assert(deepEqual(actual, expected), 'toEqual(expected)', expected),
      toBeTruthy: () => assert(!!actual, 'toBeTruthy()', 'truthy'),
      toBeFalsy: () => assert(!actual, 'toBeFalsy()', 'falsy'),
      toContain: (item: unknown) =>
        assert(
          typeof actual === 'string' ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((x) => deepEqual(x, item)),
          'toContain(item)',
          item,
        ),
      toBeCloseTo: (expected: number, digits = 2) =>
        assert(Math.abs((actual as number) - expected) < 10 ** -digits / 2, `toBeCloseTo(expected, ${digits})`, expected),
      toThrow: (expected?: string | RegExp) => {
        if (typeof actual !== 'function') throw new AssertionError(L('toThrow() 需要传入一个函数：expect(() => fn()).toThrow()', 'toThrow() needs a function: expect(() => fn()).toThrow()'))
        let thrown: unknown
        let threw = false
        try {
          actual()
        } catch (e) {
          threw = true
          thrown = e
        }
        const msg = thrown instanceof Error ? thrown.message : String(thrown)
        const matches = threw && (expected === undefined || (typeof expected === 'string' ? msg.includes(expected) : expected.test(msg)))
        const want =
          expected === undefined ? L('抛出异常', 'to throw') : L(`抛出包含 ${show(String(expected))} 的异常`, `to throw an error containing ${show(String(expected))}`)
        assert(matches, `toThrow(${expected === undefined ? '' : 'expected'})`, want, threw ? L(`抛出了 ${show(msg)}`, `threw ${show(msg)}`) : L('没有抛出异常', 'did not throw'))
      },
    }
  }
  return { ...matchers(false), not: matchers(true) }
}

// ———————————————————— 测试运行器 ————————————————————

export interface TestCase {
  file: string
  name: string
  ok: boolean
  error?: string
}

export interface SuiteResult {
  cases: TestCase[]
  loadErrors: { file: string; error: string }[]
}

function errorText(e: unknown): string {
  if (e instanceof AssertionError) return e.message
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

/** 在一个全新的模块系统里加载测试文件并逐个运行（每个测试单独 try/catch） */
export async function runSuite(files: Files, testPaths: string[], filter?: string): Promise<SuiteResult> {
  const registered: { file: string; name: string; fn: () => unknown }[] = []
  let current = ''
  let prefix = ''
  const register = (name: string, fn: () => unknown) => registered.push({ file: current, name: prefix + name, fn })
  const testkit = {
    test: register,
    it: register,
    expect,
    describe(name: string, fn: () => void) {
      const prev = prefix
      prefix = `${prev}${name} › `
      try {
        fn()
      } finally {
        prefix = prev
      }
    },
  }
  const modules = createModuleSystem(files, { testkit })
  const loadErrors: SuiteResult['loadErrors'] = []
  for (const path of testPaths) {
    current = path
    prefix = ''
    try {
      modules.require(path)
    } catch (e) {
      loadErrors.push({ file: path, error: errorText(e) })
    }
  }
  const cases: TestCase[] = []
  for (const t of registered) {
    if (filter && !`${t.file} › ${t.name}`.includes(filter)) continue
    try {
      await t.fn()
      cases.push({ file: t.file, name: t.name, ok: true })
    } catch (e) {
      cases.push({ file: t.file, name: t.name, ok: false, error: errorText(e) })
    }
  }
  return { cases, loadErrors }
}

export const MAX_REPORT_CHARS = 4000

/** 给 Agent 看的测试报告：失败详情 + 每个文件的通过数 + 汇总 */
export function formatReport(r: SuiteResult, filter?: string): string {
  const lines: string[] = []
  for (const l of r.loadErrors) lines.push(`✗ ${L('[加载失败]', '[load error]')} ${l.file}\n    ${l.error.replace(/\n/g, '\n    ')}`)
  for (const c of r.cases.filter((c) => !c.ok)) lines.push(`✗ ${c.file} › ${c.name}\n    ${(c.error ?? '').replace(/\n/g, '\n    ')}`)
  const perFile = new Map<string, { ok: number; all: number }>()
  for (const c of r.cases) {
    const s = perFile.get(c.file) ?? { ok: 0, all: 0 }
    s.all++
    if (c.ok) s.ok++
    perFile.set(c.file, s)
  }
  if (perFile.size) lines.push(L(`各文件通过数：${[...perFile].map(([f, s]) => `${f} ${s.ok}/${s.all}`).join('，')}`, `Passed per file: ${[...perFile].map(([f, s]) => `${f} ${s.ok}/${s.all}`).join(', ')}`))
  const failed = r.cases.filter((c) => !c.ok).length
  if (!r.cases.length && !r.loadErrors.length) lines.push(filter ? L(`没有匹配 "${filter}" 的测试`, `No tests match "${filter}"`) : L('没有找到测试', 'No tests found'))
  else
    lines.push(
      L(
        `汇总：共 ${r.cases.length} 个测试，${r.cases.length - failed} 通过，${failed} 失败${r.loadErrors.length ? `，${r.loadErrors.length} 个文件加载失败` : ''}`,
        `Summary: ${r.cases.length} tests, ${r.cases.length - failed} passed, ${failed} failed${r.loadErrors.length ? `, ${r.loadErrors.length} files failed to load` : ''}`,
      ),
    )
  const text = lines.join('\n')
  return text.length > MAX_REPORT_CHARS ? `${text.slice(0, MAX_REPORT_CHARS)}\n${L('……（输出过长，已截断）', '... (output truncated)')}` : text
}

// ———————————————————— 给玩家的仓库 API ————————————————————

export interface RepoApi {
  /** 仓库里的全部文件路径（含测试和 README） */
  listFiles(): Promise<string[]>
  /** 读文件全文；不存在时抛错 */
  readFile(path: string): Promise<string>
  /** 覆盖写入（文件不存在则新建） */
  writeFile(path: string, content: string): Promise<void>
  /** 类似 grep -rn：每行一个匹配，格式 "path:行号: 内容"；pattern 是正则（不合法时按普通文本匹配） */
  search(pattern: string): Promise<string>
  /** 运行仓库里的 *.test.ts（在隔离的模块系统里），返回可读的文本报告；filter 按 "文件 › 测试名" 子串过滤 */
  runTests(filter?: string): Promise<string>
}

export interface CodingEnv {
  issue: string
  repo: RepoApi
  /** 仓库的当前状态（判定时读取） */
  files: Files
  /** 初始状态（含 bug），用来检测测试文件是否被改过 */
  original: Files
}

function cleanPath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) throw new Error(L(`路径必须是非空字符串，收到：${JSON.stringify(path)}`, `path must be a non-empty string, got: ${JSON.stringify(path)}`))
  const p = path.trim().replace(/^\.?\//, '')
  if (p.split('/').includes('..')) throw new Error(L(`路径不能包含 ".."：${path}`, `path cannot contain "..": ${path}`))
  return p
}

const MAX_MATCHES = 80

export function createRepoEnv(issue: string, initial: Files, ctx: EnvCtx): CodingEnv {
  const env: CodingEnv = { issue, files: { ...initial }, original: { ...initial }, repo: undefined as unknown as RepoApi }
  env.repo = {
    listFiles: ctx.traced('listFiles', async () => {
      await ctx.delay(5)
      return Object.keys(env.files).sort()
    }),
    readFile: ctx.traced('readFile', async (path: string) => {
      await ctx.delay(5)
      const p = cleanPath(path)
      if (!(p in env.files)) throw new Error(L(`文件不存在：${p}`, `File not found: ${p}`))
      return env.files[p]
    }),
    writeFile: ctx.traced('writeFile', async (path: string, content: string) => {
      await ctx.delay(5)
      if (typeof content !== 'string') throw new Error(L(`content 必须是字符串，收到：${typeof content}`, `content must be a string, got: ${typeof content}`))
      env.files[cleanPath(path)] = content
    }),
    search: ctx.traced('search', async (pattern: string) => {
      await ctx.delay(10)
      if (typeof pattern !== 'string' || !pattern) throw new Error(L('pattern 必须是非空字符串', 'pattern must be a non-empty string'))
      let re: RegExp
      try {
        re = new RegExp(pattern)
      } catch {
        re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
      const out: string[] = []
      for (const path of Object.keys(env.files).sort())
        env.files[path].split('\n').forEach((line, i) => {
          if (re.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`)
        })
      if (!out.length) return L(`没有匹配 "${pattern}" 的内容`, `No matches for "${pattern}"`)
      return out.length > MAX_MATCHES
        ? `${out.slice(0, MAX_MATCHES).join('\n')}\n${L(`……（共 ${out.length} 处，只显示前 ${MAX_MATCHES} 处）`, `... (${out.length} matches, showing the first ${MAX_MATCHES})`)}`
        : out.join('\n')
    }),
    runTests: ctx.traced('runTests', async (filter?: string) => {
      await ctx.delay(300)
      const f = typeof filter === 'string' && filter.trim() ? filter.trim() : undefined
      return formatReport(await runSuite(env.files, testFilesOf(env.files), f), f)
    }),
  }
  return env
}
