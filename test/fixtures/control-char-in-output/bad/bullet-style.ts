// FIXTURE (intentionally defective) — core/control-char-in-output.
// The same truncated CSS escape as results-page.ts, but this stylesheet is
// only ever written to disk by the build. Same defect, smaller blast radius,
// so the tier drops to MEDIUM rather than HIGH.
import fs from "fs";

const BULLET = `
  li::marker { content:'\2014\0a0' }
`;

export function emit(dest: string) {
  fs.writeFileSync(dest, BULLET);
}
