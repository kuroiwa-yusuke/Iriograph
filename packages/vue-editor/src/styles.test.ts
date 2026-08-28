import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import SemanticIntentPanel from "./components/SemanticIntentPanel.vue";

describe("package style isolation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.head.querySelector("style[data-test-host-style]")?.remove();
  });

  it("hostのglobal fieldset borderをresetし専用group cardだけを囲う", async () => {
    const wrapper = mount(SemanticIntentPanel, {
      attachTo: document.body,
      props: {
        predicates: [{
          iri: "urn:test:derived",
          label: "派生元",
          category: "由来",
          sentencePattern: "AはBから派生した",
        }],
      },
    });
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.findAll("fieldset")).not.toHaveLength(0);
    expect(wrapper.findAll("fieldset").every((field) => field.classes().includes("iriograph-intent-group-card")))
      .toBe(true);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.iriograph-intent-panel fieldset\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/su);
    expect(css).toMatch(/\.iriograph-intent-panel \.iriograph-intent-group-card\s*\{[^}]*border:\s*1px solid/su);
    wrapper.unmount();
  });

  it("Diamond nodeはroot/contentを回転せずsurfaceと方向別内接boundsだけを持つ", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const rootRule = css.match(/\.iriograph-scene-node\.shape-diamond\s*\{(?<body>[^}]*)\}/su)
      ?.groups?.body ?? "";
    expect(rootRule).not.toContain("transform:");
    expect(css).not.toMatch(/\.shape-diamond\s+\.iriograph-node-content[^}]*rotate\(/su);
    expect(css).toMatch(/\.iriograph-node-diamond-surface\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/su);
    expect(css).toMatch(/\.content-horizontal\s*\{[^}]*width:\s*64%;[^}]*height:\s*24%;/su);
    expect(css).toMatch(/\.content-vertical\s*\{[^}]*width:\s*24%;[^}]*height:\s*64%;[^}]*flex-direction:\s*column;/su);
  });

  it("Canvasの型tagはnode本文を隠しにくいcompact typographyとpaddingに保つ", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.iriograph-node-type-tag\s*\{[^}]*min-height:\s*14px;[^}]*padding:\s*1px 4px;[^}]*font-size:\s*7px;/su);
  });
});
