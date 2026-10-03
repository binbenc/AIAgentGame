/** 美元 / 百万 token。只用来估算基准成本；未知模型返回 null。 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'mock-default': { input: 3, output: 15 },
  'mock-fast': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export function priceOf(model: string): { input: number; output: number } | null {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model]
  const key = Object.keys(MODEL_PRICES).find((k) => model.startsWith(k))
  return key ? MODEL_PRICES[key] : null
}
