# cartcalc

Checkout math for an online store. All amounts are **integer cents** to avoid floating-point errors.

## Coupon rules

1. Percent coupons (`kind: 'percent'`, `value: 10` means 10% off): at most one per order; the biggest discount is picked automatically.
2. Fixed coupons (`kind: 'fixed'`) stack. With `minSpend`, a coupon applies only when the **original subtotal** >= `minSpend`.
3. Percent discount first, then fixed coupons.
4. The amount after discounts never goes below 0.

## Tax

Tax is charged on the amount after discounts, rounded to the nearest cent.
