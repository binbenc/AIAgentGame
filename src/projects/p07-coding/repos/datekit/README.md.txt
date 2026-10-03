# datekit

零依赖的日期小工具。日期用 `{ year, month, day }` 表示（month 从 1 开始），不涉及时区。

- `parseDate('2024-03-15')` / `compareDates(a, b)` / `isLeapYear` / `daysInMonth`
- `addDays(date, n)`、`addMonths(date, n)`：n 可以为负；加月份时如果目标月没有这一天，取该月最后一天
- `formatDate(date, 'YYYY-MM-DD')`：支持 YYYY、MM、DD、M、D

运行测试：`npm test`
