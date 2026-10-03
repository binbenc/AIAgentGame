import { transform } from 'sucrase'
import { L } from '../locale'

export class CompileError extends Error {
  constructor(
    public file: string,
    message: string,
  ) {
    super(`${file}: ${message}`)
    this.name = 'CompileError'
  }
}

/** TS → CommonJS。sucrase 只做类型擦除，不做类型检查（类型检查由编辑器负责）。 */
export function transpile(code: string, file: string): string {
  try {
    return transform(code, { transforms: ['typescript', 'imports'], filePath: file, production: true }).code
  } catch (e) {
    throw new CompileError(file, (e as Error).message)
  }
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * 迷你模块系统：在内存里的虚拟文件之间支持相对 import，
 * 外加白名单内置模块（agent-quest、zod 等）。
 */
export function createModuleSystem(files: Record<string, string>, builtins: Record<string, unknown>) {
  const cache = new Map<string, { exports: unknown }>()
  const compiled = new Map<string, string>()

  function resolve(from: string, spec: string): string {
    const base = normalize((dirname(from) ? dirname(from) + '/' : '') + spec)
    for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) if (cand in files) return cand
    throw new Error(`${from}: ${L('找不到模块', 'cannot find module')} "${spec}"`)
  }

  function load(path: string): unknown {
    const hit = cache.get(path)
    if (hit) return hit.exports
    if (!compiled.has(path)) compiled.set(path, transpile(files[path], path))
    const module = { exports: {} as Record<string, unknown> }
    cache.set(path, module)
    const require = (spec: string) => {
      if (spec in builtins) return builtins[spec]
      if (spec.startsWith('.')) return load(resolve(path, spec))
      throw new Error(
      L(
        `${path}: 不允许导入 "${spec}"（只能导入相对路径或 ${Object.keys(builtins).join(', ')}）`,
        `${path}: importing "${spec}" is not allowed (only relative paths or ${Object.keys(builtins).join(', ')})`,
      ),
    )
    }
    const fn = new Function('require', 'module', 'exports', `${compiled.get(path)}\n//# sourceURL=workspace/${path}`)
    fn(require, module, module.exports)
    return module.exports
  }

  return {
    require(path: string): unknown {
      const p = normalize(path)
      if (!(p in files)) throw new Error(L(`工作区里没有文件 ${p}`, `No file ${p} in the workspace`))
      return load(p)
    },
  }
}
