## 任务

在 `structured.ts` 中实现：

```ts
extractTicket(email: string, maxRetries = 2): Promise<Ticket>
```

`TicketSchema`（zod）已经给你定义好了。

1. 写一个 prompt，要求模型**只输出 JSON**，并说明每个字段的取值范围。
2. 实现 `parseJsonLoose(text)`：能处理被 ```json 代码块包住的情况，也能处理 JSON 前后夹带说明文字的情况。
3. 用 `TicketSchema.safeParse` 做校验。
4. 解析或校验失败时：把模型的原始回答作为 `assistant` 消息追加进对话，再追加一条 `user` 消息，内容是**具体的错误信息**（比如 zod 的 issues），然后重试。
5. 最多重试 `maxRetries` 次（也就是最多调用 `maxRetries + 1` 次模型），全部失败就 `throw`。

## 判题场景
- 干净 JSON：prompt 里得明确要求输出 JSON
- 代码块包裹：要能剥掉 ```json
- 校验失败自我修正：重试时要带上原回答和错误信息
- 无可救药：重试次数用完后必须抛错，不能无限重试
