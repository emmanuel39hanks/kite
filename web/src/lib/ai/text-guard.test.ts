import assert from "node:assert/strict";
import { test } from "node:test";
import { hasNumber, onlyNumbersFrom, safeHttps } from "./text-guard";

test("catches digits in any script, fullwidth forms and circled digits", () => {
  for (const s of ["rose 12", "rose ５", "rose ٥", "rose ५", "rose ๕", "rose ⑤", "rose ½", "rose 5²"]) assert.equal(hasNumber(s), true, s);
});

test("catches quantity words, including plurals and -fold", () => {
  for (const s of ["fell by twenty", "doubled", "a small percent", "hundreds of trades", "tenfold", "twice as much", "half of it", "三十", "百分之五十"]) assert.equal(hasNumber(s), true, s);
});

test("leaves ordinary prose alone", () => {
  for (const s of ["This moves less than most crypto.", "It keeps one trade small and steady.", "Gold cushions drops."]) assert.equal(hasNumber(s), false, s);
});

test("allowed-number check folds look-alike digits and removes invisible characters", () => {
  const ok = new Set(["6.2", "44.8"]);
  assert.equal(onlyNumbersFrom("over by 6.2 points", ok), true);
  assert.equal(onlyNumbersFrom("over by ６.２ points", ok), true); // fullwidth folds to 6.2
  assert.equal(onlyNumbersFrom("over by ٦.٢ points", ok), true); // Arabic-Indic folds to 6.2
  assert.equal(onlyNumbersFrom("over by 6​.2 points", ok), true); // zero-width space removed
  assert.equal(onlyNumbersFrom("over by 6,2 points", ok), false); // comma form is not 6.2
  assert.equal(onlyNumbersFrom("rose 12%", ok), false);
  assert.equal(onlyNumbersFrom("it doubled to 6.2", ok), false);
  assert.equal(onlyNumbersFrom("6.2 percentage points over", ok), true);
});

test("a number split by zero-width characters is read as the whole number", () => {
  assert.equal(onlyNumbersFrom("5​0 points", new Set(["5", "0"])), false);
  assert.equal(onlyNumbersFrom("5​0 points", new Set(["50"])), true);
});

test("only https links pass", () => {
  assert.ok(safeHttps("https://etherscan.io/tx/0x1"));
  for (const u of ["javascript:alert(1)", "data:text/html,x", "http://x.com", "//x.com", "", null, 5]) assert.equal(safeHttps(u), null, String(u));
});
