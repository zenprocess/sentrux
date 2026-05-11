import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Treemap } from "./Treemap";
import { SAMPLE_TREEMAP } from "../test/fixtures";

describe("Treemap", () => {
  it("renders one tile per non-zero file", () => {
    render(<Treemap data={SAMPLE_TREEMAP.treemap} />);
    expect(screen.getByTestId("treemap")).toBeInTheDocument();
    // SAMPLE_TREEMAP has 5 files, all with size > 0.
    expect(screen.getAllByTestId("treemap-tile")).toHaveLength(5);
  });

  it("shows a per-file tooltip on hover", () => {
    render(<Treemap data={SAMPLE_TREEMAP.treemap} />);
    const tiles = screen.getAllByTestId("treemap-tile");
    fireEvent.mouseEnter(tiles[0]);
    const tip = screen.getByTestId("treemap-tooltip");
    expect(tip).toHaveTextContent("magnitude");
    fireEvent.mouseLeave(tiles[0]);
    expect(screen.queryByTestId("treemap-tooltip")).toBeNull();
  });

  it("shows summary metadata when nothing is hovered", () => {
    render(<Treemap data={SAMPLE_TREEMAP.treemap} />);
    expect(screen.getByText(/max blast radius 219/)).toBeInTheDocument();
    expect(screen.getByText(/160 files in attack surface/)).toBeInTheDocument();
  });

  it("renders an empty state when there are no files", () => {
    render(
      <Treemap
        data={{
          files: [],
          max_blast_file: null,
          max_blast_radius: 0,
          attack_surface_files: 0,
        }}
      />,
    );
    expect(screen.getByTestId("treemap-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("treemap")).toBeNull();
  });
});
