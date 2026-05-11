import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RulesPanel } from "./RulesPanel";
import { SAMPLE_RULES, SAMPLE_RULES_NONE } from "../test/fixtures";

describe("RulesPanel", () => {
  it("renders an empty state when no rules.toml is present", () => {
    render(<RulesPanel rules={SAMPLE_RULES_NONE} />);
    expect(screen.getByTestId("rules-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("rules-panel")).toBeNull();
  });

  it("renders one row per violation with the rule name and severity", () => {
    render(<RulesPanel rules={SAMPLE_RULES} />);
    const rows = screen.getAllByTestId("rule-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("MaxCycles")).toBeInTheDocument();
    expect(screen.getByText("MaxGodFiles")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("summarises the violation count", () => {
    render(<RulesPanel rules={SAMPLE_RULES} />);
    expect(screen.getByTestId("rules-verdict")).toHaveTextContent(
      "2 violations",
    );
  });

  it("shows an all-pass verdict when there are no violations", () => {
    render(
      <RulesPanel
        rules={{
          repo: "/x",
          rules_loaded: true,
          rules_checked: 3,
          violations: [],
          violation_count: 0,
        }}
      />,
    );
    expect(screen.getByTestId("rules-verdict")).toHaveTextContent(
      "all rules pass",
    );
    expect(screen.queryByTestId("rule-row")).toBeNull();
  });
});
