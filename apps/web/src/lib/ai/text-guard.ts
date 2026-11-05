/**
 * Checks on model-written text. The model may explain numbers the app computed; it may not introduce its own.
 *
 * Text is cleaned first: NFKC (folds fullwidth forms, superscripts and circled digits), invisible format
 * characters removed (zero-width spaces and bidi controls could split or hide a number), and every
 * decimal digit of any script (Arabic-Indic, Devanagari, Thai, …) folded to ASCII.
 */
const DIGIT = /\p{Nd}/u;

function digitValue(ch: string): number {
  // Decimal digits sit in runs of ten from a zero; count back to the zero of this run.
  const cp = ch.codePointAt(0)!;
  let zero = cp;
  while (DIGIT.test(String.fromCodePoint(zero - 1))) zero--;
  return (cp - zero) % 10;
}

function clean(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Nd}/gu, (d) => String(digitValue(d)));
}

// Quantity words a model could use to smuggle a number in without a digit. "one" is left out: it is mostly a pronoun.
const NUMBER_WORDS =
  /(?<![\p{L}\p{N}])(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|trillions?|tens|percent|per\s+cent|basis\s+points?|double[sd]?|triple[sd]?|(?:quadr|quint|oct|dec)uple[sd]?|dozens?|score|pair|couple|several|half|halves|quarter|quarters|third|thirds|twice|(?:fir|seven|eigh|nin|ten|twentie)(?:th|ths)|(?:fif|six|four|seven|eigh|nin|ten|hundred)(?:th|ths)|fourth|fifth|sixth|[a-z]+fold|drei|vier|f[uü]nf|zehn|dos|tres|cinco|diez|trois|cinq|dix|huit|три|пять|десять)(?![\p{L}\p{N}])/iu;
const CJK_NUMERALS = /[零〇一二三四五六七八九十百千万億亿兩两壹貳贰参參肆伍陸陆柒捌玖拾佰仟萬]/;
// Roman numerals written as capitals (NFKC turns Ⅲ into III), two letters or more so a lone "I" is fine.
const ROMAN = /\b(?=[IVXLCDM]{2,}\b)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\b/;

/** True if the text contains any digit (in any script) or a quantity word. */
export function hasNumber(s: string): boolean {
  const t = clean(s);
  return /\d/.test(t) || NUMBER_WORDS.test(t) || CJK_NUMERALS.test(t) || ROMAN.test(t);
}

/** The numbers written in the text, as tokens ("6.2", "6,2", "44"). A comma or dot inside a number stays part of it. */
function numbersIn(s: string): string[] {
  return clean(s).match(/\d+(?:[.,]\d+)*/g) ?? [];
}

/** True if every number in the text is in the allowed set, and it uses no number words or CJK numerals. */
export function onlyNumbersFrom(s: string, allowed: Set<string>): boolean {
  const t = clean(s);
  if (NUMBER_WORDS.test(t.replace(/\bpercentage\b/gi, "~")) || CJK_NUMERALS.test(t) || ROMAN.test(t)) return false;
  return numbersIn(t).every((n) => allowed.has(n));
}

/** Only https links, so a link built from API data can never be a javascript: or data: URL. */
export const safeHttps = (url: unknown): string | null => {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};
