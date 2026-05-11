import type { Diagnostics } from "../api/types";

interface DiagnosticsGridProps {
  diagnostics: Diagnostics;
}

const ROWS: readonly { key: keyof Diagnostics; label: string; suffix?: string }[] = [
  { key: "god_file_count", label: "God files" },
  { key: "cycle_count", label: "Cycles" },
  { key: "complex_fn_count", label: "Complex fns" },
  { key: "hotspot_count", label: "Hotspots" },
  { key: "max_depth", label: "Max depth" },
  { key: "coupling_score", label: "Coupling", suffix: "" },
] as const;

export function DiagnosticsGrid({ diagnostics }: DiagnosticsGridProps): JSX.Element {
  return (
    <dl className="diagnostics-grid" data-testid="diagnostics-grid">
      {ROWS.map((row) => {
        const raw = diagnostics[row.key];
        const display =
          typeof raw === "number" && !Number.isInteger(raw)
            ? raw.toFixed(2)
            : String(raw);
        return (
          <div key={row.key} className="diagnostic">
            <dt>{row.label}</dt>
            <dd>
              {display}
              {row.suffix ?? ""}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
