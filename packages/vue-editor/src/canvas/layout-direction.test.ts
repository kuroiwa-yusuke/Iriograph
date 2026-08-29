import { describe, expect, it } from "vitest";

import { STANDARD_LAYOUT_REFS } from "@iriograph/core";

import {
  layoutDirectionForRef,
  layoutRefForDirection,
  standardLayoutRefForDirection,
} from "./layout-direction";

describe("editor layout direction choices", () => {
  it("maps Standard and ELK within their current adapter family", () => {
    expect(layoutDirectionForRef(STANDARD_LAYOUT_REFS.hierarchicalLr)).toBe("LR");
    expect(layoutRefForDirection(STANDARD_LAYOUT_REFS.hierarchicalLr, "TB"))
      .toBe(STANDARD_LAYOUT_REFS.hierarchicalTb);
    expect(layoutRefForDirection("urn:iriograph:layout:elk-layered-tb:1", "LR"))
      .toBe("urn:iriograph:layout:elk-layered-lr:1");
  });

  it("defaults new standard views to LR and fails closed for unknown layouts", () => {
    expect(standardLayoutRefForDirection("LR")).toBe(STANDARD_LAYOUT_REFS.hierarchicalLr);
    expect(layoutDirectionForRef("urn:test:layout:private")).toBeUndefined();
    expect(layoutRefForDirection("urn:test:layout:private", "TB")).toBeUndefined();
  });
});
