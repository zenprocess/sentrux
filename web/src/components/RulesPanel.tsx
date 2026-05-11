import type { RulesResponse, RuleViolation } from "../api/types";

export interface RulesPanelProps {
  rules: RulesResponse;
}

function severityClass(sev: string): string {
  if (sev === "error") return "rule-badge rule-badge-error";
  if (sev === "warning") return "rule-badge rule-badge-warning";
  return "rule-badge";
}

/**
 * Read-only view of the daemon's `.sentrux/rules.toml` enforcement result.
 *
 * The wire shape (see the daemon's `/rules` handler) is a list of *violations*,
 * not the rule definitions themselves — so the table is keyed on rule + message
 * with a pass/fail badge. When `rules_loaded` is false the repo has no
 * `.sentrux/rules.toml`; when it's true with zero violations every rule passes.
 * Editing is intentionally out of scope — the daemon stays the source of truth.
 */
export function RulesPanel({ rules }: RulesPanelProps): JSX.Element {
  if (!rules.rules_loaded) {
    return (
      <div className="rules-empty" data-testid="rules-empty">
        {rules.message ?? "no .sentrux/rules.toml in this repo"}
      </div>
    );
  }

  const violations: RuleViolation[] = rules.violations ?? [];

  return (
    <div className="rules-panel" data-testid="rules-panel">
      <div className="rules-summary">
        {typeof rules.rules_checked === "number" && (
          <span>{rules.rules_checked} rules checked</span>
        )}
        <span
          className={
            rules.violation_count === 0 ? "rules-ok" : "rules-bad"
          }
          data-testid="rules-verdict"
        >
          {rules.violation_count === 0
            ? "all rules pass"
            : `${rules.violation_count} violation${rules.violation_count === 1 ? "" : "s"}`}
        </span>
      </div>

      {violations.length === 0 ? (
        <p className="rules-allgreen">No violations reported.</p>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Rule</th>
              <th>Detail</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {violations.map((v, i) => (
              <tr key={`${v.rule}-${i}`} data-testid="rule-row">
                <td>
                  <span className={severityClass(v.severity)}>
                    {v.severity}
                  </span>
                </td>
                <td>
                  <code>{v.rule}</code>
                </td>
                <td>{v.message}</td>
                <td>
                  {v.files.length === 0 ? (
                    <span className="rule-nofiles">—</span>
                  ) : (
                    <ul className="rule-files">
                      {v.files.slice(0, 6).map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                      {v.files.length > 6 && (
                        <li className="rule-morefiles">
                          +{v.files.length - 6} more
                        </li>
                      )}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
