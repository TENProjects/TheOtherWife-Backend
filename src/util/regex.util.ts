/** @format */

// Free-text search input must never be interpreted as a regular expression:
// unescaped input allows regex injection and catastrophic-backtracking
// (ReDoS) patterns such as "(a+)+$". Escape metacharacters and cap the
// length before building a RegExp / $regex from user input.
export const MAX_SEARCH_LENGTH = 100;

export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const toSafeSearchRegex = (value: string): RegExp =>
  new RegExp(escapeRegex(value.trim().slice(0, MAX_SEARCH_LENGTH)), "i");
