/**
 * Checks on model-written text. The model may explain numbers the app computed; it may not introduce its own.
 * Text is normalised first (NFKC folds fullwidth and other-script digits to ASCII) so look-alike digits don't slip past.
 */
const normalise = (s: string) => s.normalize("NFKC");

// Quantity words a model could use to smuggle a number in without a digit. "one" is left out: it is mostly a pronoun.
const NUMBER_WORDS =
  /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent|double|triple|dozen)\b/i;

/** True if the text contains any digit (in any script) or a quantity word. */
export const hasNumber = (s: string) => /\p{Nd}/u.test(normalise(s)) || NUMBER_WORDS.test(normalise(s));

/** The numbers written in the text, as tokens ("6.2", "6,2", "44"). A comma or dot inside a number stays part of it. */
export const numbersIn = (s: string) => normalise(s).match(/\d+(?:[.,]\d+)*/g) ?? [];

/** True if every number in the text is in the allowed set. */
export const onlyNumbersFrom = (s: string, allowed: Set<string>) => numbersIn(s).every((n) => allowed.has(n));

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
