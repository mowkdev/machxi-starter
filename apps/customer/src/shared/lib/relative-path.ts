/**
 * A path on this origin, and nothing that can be read as another one.
 *
 * The fence every location this app is handed and later navigates to passes
 * through: `/login`'s `redirect` (its route's `validateSearch`) and, since
 * `D19.5`, the same value carried across the round trip through Google, which
 * the landing route reads back out of session storage (ADR-0072 §4). One
 * function, so the two cannot come to disagree about what is safe.
 *
 * Each clause closes a bypass that was verified against
 * `new URL(value, "https://account.example.com/login")` rather than reasoned
 * about, because a leading-slash regex looks sufficient and is not:
 *
 * - `//evil.com` — the obvious one.
 * - `/\evil.com` — the WHATWG parser treats `\` as `/` in special schemes, so
 *   this resolves to `https://evil.com`.
 * - `/<TAB>/evil.com`, and the same with LF or CR — the parser strips those
 *   characters *before* parsing, so they resolve off-origin too.
 */
export const relativePath = (value: string): boolean =>
  /^\/(?![/\\])/.test(value) &&
  !value.includes("\\") &&
  // eslint-disable-next-line no-control-regex -- stripped by the URL parser, which is the bypass
  !/[\u0000-\u001f]/.test(value);
