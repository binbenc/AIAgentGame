# datekit

Tiny zero-dependency date helpers. A date is `{ year, month, day }` (month starts at 1); no time zones.

- `parseDate('2024-03-15')` / `compareDates(a, b)` / `isLeapYear` / `daysInMonth`
- `addDays(date, n)`, `addMonths(date, n)`: n may be negative; when adding months lands on a day the target month doesn't have, the result is that month's last day
- `formatDate(date, 'YYYY-MM-DD')`: supports YYYY, MM, DD, M, D

Run the tests: `npm test`
