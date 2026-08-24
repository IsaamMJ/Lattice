// FIXTURE (intentionally defective) — core/control-char-in-output.
// A backtick inside a CSS comment terminates the template literal. tsc reports
// the damage far below; the diagnosis has to point HERE.
export const CSS = `
  /* use two dashes, never a backtick ` */
  .card { color: red; }
`;

export const MORE = `<div class="card"></div>`;
