import { describe, expect, it } from "vitest";

import { statementIdentity } from "./identity";
import {
  createStandardLayoutRegistry,
  STANDARD_LAYOUT_REFS,
} from "./layout";
import type { IriographDocumentV1, ProjectionCatalogV1 } from "./model";
import { buildIriographView, type ProjectionRuntimeContext } from "./scene";
import { standardRdfRdfsCatalog } from "./standard-catalog";
import { applyViewCommand } from "./view-commands";

describe("atomic ViewCommand", () => {
  it("adds a named view and generates its minimum overlay", async () => {
    const source = documentFor();

    const result = await applyViewCommand(source, {
      command: "add",
      viewId: "review",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
      locale: "en",
    }, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.affectedViewId).toBe("review");
    expect(result.document.views).toHaveLength(2);
    expect(Object.keys(result.document.views[1]!.overlay).length).toBeGreaterThan(0);
    expect(source.views).toHaveLength(1);
  });

  it("duplicates the exact overlay under a newly allocated immutable view ID", async () => {
    const source = documentFor();
    const overlay = structuredClone(source.views[0]!.overlay);

    const result = await applyViewCommand(source, {
      command: "duplicate",
      sourceViewId: "main",
      viewId: "main-copy",
    }, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.document.views[1]).toEqual({
      ...source.views[0],
      viewId: "main-copy",
      overlay,
    });
    expect(result.document.views[0]!.viewId).toBe("main");
  });

  it("keeps the exact overlay for a locale-only configuration change", async () => {
    const source = documentFor();
    const overlayJson = JSON.stringify(source.views[0]!.overlay);

    const result = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      locale: "en-US",
    }, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.document.views[0]!.locale).toBe("en-US");
    expect(JSON.stringify(result.document.views[0]!.overlay)).toBe(overlayJson);
  });

  it("reconciles only the configured target and leaves an invalid sibling byte-exact", async () => {
    const source = documentFor();
    source.views.push({
      ...structuredClone(source.views[0]!),
      viewId: "broken-sibling",
      profileRef: "urn:test:profile:missing",
    });
    const siblingJson = JSON.stringify(source.views[1]);

    const result = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
    }, runtimeContext());

    expect(result.accepted).toBe(true);
    expect(result.document.views[0]!.layoutRef).toBe(STANDARD_LAYOUT_REFS.hierarchicalTb);
    expect(JSON.stringify(result.document.views[1])).toBe(siblingJson);
  });

  it("switches layout direction for one view while preserving semantic and user overlay", async () => {
    const source = documentFor();
    source.views.push({
      ...structuredClone(source.views[0]!),
      viewId: "review",
      locale: "en",
    });
    const semanticSource = source.semantic.source;
    const userOverlay = structuredClone(source.views[0]!.overlay.a);
    const manualRouting = structuredClone(source.views[0]!.overlay.edge);
    const siblingJson = JSON.stringify(source.views[1]);
    const context = runtimeContext();
    const before = await buildIriographView(source, "main", context);

    const result = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalTb,
    }, context);

    expect(result.accepted).toBe(true);
    expect(result.document.semantic.source).toBe(semanticSource);
    expect(result.document.views[0]!.layoutRef).toBe(STANDARD_LAYOUT_REFS.hierarchicalTb);
    expect(result.document.views[0]!.overlay.a).toEqual(userOverlay);
    expect(result.document.views[0]!.overlay.edge).toEqual(manualRouting);
    expect(JSON.stringify(result.document.views[1])).toBe(siblingJson);

    const reloaded = JSON.parse(JSON.stringify(result.document)) as IriographDocumentV1;
    const after = await buildIriographView(reloaded, "main", context);
    const beforeGenerated = before.nodes.find((node) => node.semanticRef === "urn:test:view:b")!;
    const afterGenerated = after.nodes.find((node) => node.semanticRef === "urn:test:view:b")!;
    expect(afterGenerated.geometry).not.toEqual(beforeGenerated.geometry);
    expect(afterGenerated.placement).toBe("generated");
    expect(after.nodes.find((node) => node.semanticRef === "urn:test:view:a")).toMatchObject({
      geometry: userOverlay!.geometry,
      pinned: true,
      placement: "user",
    });
    expect(afterGenerated.geometry.y).toBeGreaterThan(
      after.nodes.find((node) => node.semanticRef === "urn:test:view:a")!.geometry.y,
    );
  });

  it("reconciles a profile change against the old primitive instead of the changed target", async () => {
    const source = documentFor();
    source.views[0]!.overlay.a!.appearance = {
      templateRef: standardRdfRdfsCatalog.defaults!.nodeTemplateRef,
      iconRef: "urn:test:icon:node-only",
    };

    const result = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      profileRef: "urn:test:profile:second",
    }, runtimeContext());

    expect(result.accepted).toBe(true);
    const entry = Object.entries(result.document.views[0]!.overlay)
      .find(([, overlay]) => overlay.semanticRef === "urn:test:view:a");
    expect(entry?.[0]).not.toBe("a");
    expect(entry?.[1].appearance?.iconRef).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reconcile-primitive-changed",
      semanticRef: "urn:test:view:a",
    }));
  });

  it("allows deletion of an invalid view but rejects deletion of the last view", async () => {
    const source = documentFor();
    source.views.push({
      ...structuredClone(source.views[0]!),
      viewId: "broken",
      profileRef: "urn:test:profile:missing",
    });

    const deleted = await applyViewCommand(source, {
      command: "delete",
      viewId: "broken",
    }, runtimeContext());
    expect(deleted.accepted).toBe(true);
    expect(deleted.document.views.map((view) => view.viewId)).toEqual(["main"]);

    const last = await applyViewCommand(deleted.document, {
      command: "delete",
      viewId: "main",
    }, runtimeContext());
    expect(last.accepted).toBe(false);
    expect(last.diagnostics).toContainEqual(expect.objectContaining({
      code: "last-view-delete-rejected",
    }));
    expect(last.document).toEqual(deleted.document);
  });

  it("resets only the target overlay and rolls back invalid commands atomically", async () => {
    const source = documentFor();
    source.views.push({ ...structuredClone(source.views[0]!), viewId: "other" });
    const siblingJson = JSON.stringify(source.views[1]);

    const reset = await applyViewCommand(source, {
      command: "reset-overlay",
      viewId: "main",
    }, runtimeContext());
    expect(reset.accepted).toBe(true);
    expect(reset.document.views[0]!.overlay).not.toEqual(source.views[0]!.overlay);
    expect(Object.values(reset.document.views[0]!.overlay).every((entry) => (
      entry.placement === undefined || entry.placement === "generated"
    ))).toBe(true);
    expect(JSON.stringify(reset.document.views[1])).toBe(siblingJson);

    const rejected = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      layoutRef: "urn:test:layout:missing",
    }, runtimeContext());
    expect(rejected.accepted).toBe(false);
    expect(rejected.document).toEqual(source);
  });

  it("rejects duplicate IDs and invalid locale without mutating the document", async () => {
    const source = documentFor();
    const duplicate = await applyViewCommand(source, {
      command: "add",
      viewId: "main",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
    }, runtimeContext());
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.diagnostics[0]?.code).toBe("view-id-conflict");

    const locale = await applyViewCommand(source, {
      command: "configure",
      viewId: "main",
      locale: "not_a_locale",
    }, runtimeContext());
    expect(locale.accepted).toBe(false);
    expect(locale.document).toEqual(source);
  });
});

function documentFor(): IriographDocumentV1 {
  const edgeRef = statementIdentity("urn:test:view:a", "urn:test:view:p", "urn:test:view:b");
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "view-command-test",
    semantic: {
      format: "text/turtle",
      baseIri: "urn:test:view:",
      authoringProfileRef: "urn:test:authoring:1",
      source: `
        @prefix : <urn:test:view:> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        :a a :Special ; rdfs:label "A"@en, "エー"@ja ; :p :b .
        :b rdfs:label "B"@en, "ビー"@ja .
      `,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      locale: "ja",
      overlay: {
        a: {
          semanticRef: "urn:test:view:a",
          geometry: { x: 91, y: 73, width: 140, height: 64 },
          pinned: true,
          placement: "user",
          appearance: { styleToken: "accent" },
        },
        edge: {
          semanticRef: edgeRef,
          routing: { waypoints: [{ x: 250, y: 120 }] },
        },
      },
    }],
  };
}

function runtimeContext(): ProjectionRuntimeContext {
  const secondCatalog: ProjectionCatalogV1 = {
    ...structuredClone(standardRdfRdfsCatalog),
    catalogId: "urn:test:catalog:second",
    profileRef: "urn:test:profile:second",
    rules: [{
      ruleId: "urn:test:rule:special-container",
      priority: 1000,
      match: {
        kind: "type",
        iri: "urn:test:view:Special",
        entailment: "exact",
      },
      project: { operator: "resource", structuralKind: "container" },
      templateRef: "urn:iriograph:template:container:region:1",
    }, ...structuredClone(standardRdfRdfsCatalog.rules)],
  };
  return {
    catalogsByProfile: new Map([
      [standardRdfRdfsCatalog.profileRef, { catalog: standardRdfRdfsCatalog }],
      [secondCatalog.profileRef, { catalog: secondCatalog }],
    ]),
    layouts: createStandardLayoutRegistry(),
  };
}
