// FIXTURE (clean) — core/control-char-in-output.
export function Card({ title }) {
  const ratio = 100 / 3;
  const slug = title.replace(/[^a-z0-9]+/gi, "-");
  return (
    <div className="card" style={{ color: "red" }}>
      <span>{slug}</span>
      <hr />
    </div>
  );
}
