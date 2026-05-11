import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBanner } from "./ScoreBanner";

describe("ScoreBanner", () => {
  it("shows the score, verdict and source", () => {
    render(
      <ScoreBanner
        score={72}
        scannedAt="2026-05-11T15:12:14Z"
        source="sentrux 0.5.7+serve.1"
        delta={null}
      />,
    );
    expect(screen.getByTestId("score-value")).toHaveTextContent("72");
    expect(screen.getByTestId("score-verdict")).toHaveTextContent("READY");
    expect(screen.queryByTestId("score-delta")).toBeNull();
  });

  it("formats positive deltas with a + sign", () => {
    render(
      <ScoreBanner
        score={42}
        scannedAt="2026-05-11T15:12:14Z"
        source="sentrux"
        delta={5}
      />,
    );
    expect(screen.getByTestId("score-verdict")).toHaveTextContent(
      "CONDITIONAL",
    );
    expect(screen.getByTestId("score-delta")).toHaveTextContent(
      "+5 vs baseline",
    );
  });

  it("uses BLOCK verdict for low scores", () => {
    render(
      <ScoreBanner
        score={20}
        scannedAt="2026-05-11T00:00:00Z"
        source="sentrux"
        delta={-3}
      />,
    );
    expect(screen.getByTestId("score-verdict")).toHaveTextContent("BLOCK");
    expect(screen.getByTestId("score-delta")).toHaveTextContent(
      "-3 vs baseline",
    );
  });
});
