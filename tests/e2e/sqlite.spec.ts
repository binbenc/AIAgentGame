import { expect, test } from '@playwright/test'

test('sql.js 能在浏览器 Worker 里运行', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const src = `
      try {
        const { openDatabase, rowsOf } = await import('${location.origin}/src/projects/shared/sqlite.ts')
        const db = await openDatabase("CREATE TABLE t(a INT); INSERT INTO t VALUES (2),(3);")
        postMessage(rowsOf(db, 'SELECT SUM(a) AS s FROM t'))
      } catch (e) { postMessage('ERR ' + e.message + ' ' + e.stack) }`
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url, { type: 'module' })
    return new Promise((res, rej) => {
      w.onmessage = (e) => res(e.data)
      w.onerror = (e) => rej(new Error(e.message))
    })
  })
  expect(result).toEqual([{ s: 5 }])
})
