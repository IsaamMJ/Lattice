// FIXTURE (clean) — core/control-char-in-output.
import { spawnSync } from "child_process";

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g;

export function sanitizeTitle(text) {
  return text.replace(CONTROL_CHARS, " ").trim();
}

// A NUL separator in a quoted string is the documented stdin protocol for
// `git check-ignore -z`; it is a byte on a pipe, not a byte in a page.
export function ignored(paths) {
  return spawnSync("git", ["check-ignore", "-z", "--stdin"], {
    input: paths.join("\0") + "\0",
  });
}

// String.raw is exempt by TAG, not by spelling: raw text is its whole point.
export const WIN_HINT = String.raw`C:\0users\temp`;

// ANSI colours as escapes rather than literal ESC bytes.
export const RED = "\u001b[31m";
