import assert from "node:assert/strict";
// Native pinned internals are used only by this qualification fixture.
import { t as create, r as merge, i as normalize } from "/app/dist/usage-accumulator-Cd3yWsMu.mjs";
const measured = total => ({ input: total, output: 0, total, usageReport: { state: "available" } });
for (const missing of [undefined, {}, {input: 0, output: 0, total: 0, cost: {total: 0}}, { cost: { total: 1 } }, { usageReport: { state: "unavailable" } }]) {
  const sum = create();
  merge(sum, measured(40));
  merge(sum, missing);
  assert.equal(normalize(sum)?.usageReport?.state, "unavailable", "Missing attempt usage must invalidate the aggregate");
  merge(sum, measured(60));
  assert.equal(normalize(sum)?.usageReport?.state, "unavailable", "A later successful attempt cannot erase unknown usage");
}
const sum = create();
for (const total of [40, 60, 20]) merge(sum, measured(total));
assert.equal(normalize(sum).total, 120, "Reported retry and compaction contributions accumulate");
const zero = create();
merge(zero, measured(0));
assert.equal(normalize(zero).total, 0, "Explicitly measured zero remains known");
console.log("Pinned native usage accumulator: missing attempts remain unavailable; measured contributions accumulate.");
