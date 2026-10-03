## 任务

新建 `memory.ts`：

```ts
tokenize(text) → string[]                      // 英文按单词，中文按字二元组
containsSecret(text) → string | null           // 返回拒绝原因
class MemoryStore {
  remember(userId, fact): MemoryItem           // 敏感信息抛错；相同事实去重
  recall(userId, query, k = 3): MemoryItem[]   // 只看该用户；按重合度排序；0 分不返回
  all(userId): MemoryItem[]
}
createMemoryTools(store, userId) → Tool[]      // save_memory、search_memory
buildSystemWithMemories(base, memories) → string
chatWithMemory(store, userId, message, opts?) → Promise<AgentResult>
```

1. **分词与召回**：中文没有空格，用“字二元组”切词（“上门安装” → 上门 / 门安 / 安装）。`recall` 统计 query 的词在每条记忆里出现了几个，作为分数（可以再除以记忆长度做归一化），过滤 0 分，取前 `k` 条。
2. **用户隔离**：`recall` 和工具都只能读写当前 `userId` 的记忆。
3. **敏感信息**：`remember` 遇到疑似银行卡号/身份证号（13~19 位数字，可能带空格或横线）、密码、验证码时直接抛错。工具里的异常会被 `agent.ts` 转成 `is_error` 结果，模型就知道没存上。
4. **记忆工具**：`save_memory`（必填参数：要记住的事实）和 `search_memory`（必填参数：查询词）。description 里写清楚什么该存、什么严禁存。
5. **会话开始时注入**：`chatWithMemory` 先 `recall(userId, message)`，用 `buildSystemWithMemories` 拼进 system（没有记忆时 system 不变），再调用 `runAgent`，工具列表里加上记忆工具。

## 判题场景
- 记忆存取（单元测试）：中文召回排序、去重、用户隔离、无关查询返回空
- 跨会话记住偏好：第一个会话里存下“晚上 8 点以后上门”，第二个全新会话里按这个时间预约
- 不记敏感信息：用户要求记住信用卡号时必须拒绝，并且让模型知道被拒绝了
