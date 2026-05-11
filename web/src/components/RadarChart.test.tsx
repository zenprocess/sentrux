import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RadarChart } from "./RadarChart";
import { SAMPLE_INDICATORS } from "../test/fixtures";
import { INDICATOR_LABELS, INDICATOR_ORDER } from "../api/types";

describe("RadarChart", () => {
  it("renders an svg with the five axis labels", () => {
    render(<RadarChart indicators={SAMPLE_INDICATORS} />);
    const svg = screen.getByTestId("radar-chart");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    // @visx/text mounts an off-screen measurement <text> in addition to the
    // visible label, so scope label lookups to the radar's own svg.
    const inRadar = within(svg);
    for (const k of INDICATOR_ORDER) {
      expect(inRadar.getByText(INDICATOR_LABELS[k])).toBeInTheDocument();
    }
  });

  it("renders the current-value polygon", () => {
    render(<RadarChart indicators={SAMPLE_INDICATORS} />);
    expect(screen.getByTestId("radar-current")).toBeInTheDocument();
  });

  it("renders a baseline polygon when baseline is provided", () => {
    render(
      <RadarChart
        indicators={SAMPLE_INDICATORS}
        baseline={SAMPLE_INDICATORS}
      />,
    );
    expect(screen.getByTestId("radar-baseline")).toBeInTheDocument();
  });

  it("does not render a baseline polygon when baseline is null", () => {
    render(<RadarChart indicators={SAMPLE_INDICATORS} baseline={null} />);
    expect(screen.queryByTestId("radar-baseline")).toBeNull();
  });
});
