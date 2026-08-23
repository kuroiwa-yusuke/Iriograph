import { afterEach, describe, expect, it } from "vitest";
import {
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { nextTick } from "vue";

import {
  STANDARD_LAYOUT_REFS,
  standardRdfRdfsCatalog,
  type DiagramScene,
  type ElementGeometry,
  type IriographDocument,
  type IriographDocumentV1,
  type Point,
} from "@iriograph/core";

import DiagramCanvas from "./DiagramCanvas.vue";
import IriographEditor from "./IriographEditor.vue";
import {
  diagramFitZoom,
  type IriographEditorNavigationApi,
} from "../viewport";

const NS = "urn:test:editor:";
const initialSource = `
@prefix : <${NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:a rdfs:label "A" ; :rel :b .
:b rdfs:label "B" .
`;

describe("IriographEditor transaction regression", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("一つのdrag gestureを一つのhistory itemとしてundo/redoする", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const node = canvas.props("scene").nodes.find((item) => item.semanticRef === `${NS}a`)!;
    const firstGeometry = offset(node.geometry, 35, 18);
    const finalGeometry = offset(node.geometry, 52, 31);

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "geometryChange", { elementId: node.elementId, geometry: firstGeometry });
    emitCanvas(canvas, "geometryChange", { elementId: node.elementId, geometry: finalGeometry });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toMatchObject({
      geometry: finalGeometry,
      pinned: true,
      placement: "user",
    });

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toBeUndefined();

    await buttonWithTitle(wrapper, "Redo (Ctrl/Cmd+Y)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), `${NS}a`)).toMatchObject({
      geometry: finalGeometry,
      placement: "user",
    });
  });

  it("edge routing gestureをmanual overlayとして保存しundoできる", async () => {
    wrapper = await mountEditor();
    const canvas = wrapper.getComponent(DiagramCanvas);
    const edge = canvas.props("scene").edges[0]!;
    const waypoints: Point[] = [{ x: 220, y: 90 }, { x: 260, y: 150 }];

    emitCanvas(canvas, "gestureStart");
    emitCanvas(canvas, "routingChange", { elementId: edge.elementId, waypoints });
    emitCanvas(canvas, "gestureEnd");
    await settle();

    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toMatchObject({
      pinned: true,
      placement: "user",
      routing: { waypoints },
    });

    await buttonWithTitle(wrapper, "Undo (Ctrl/Cmd+Z)").trigger("click");
    await settle();
    expect(overlayFor(latestDocument(wrapper), edge.semanticRef)).toBeUndefined();
  });

  it("valid Turtleを検証後に原文のまま適用する", async () => {
    wrapper = await mountEditor();
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(candidate);

    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => latestDocument(wrapper!).semantic.source === candidate);

    expect(latestDocument(wrapper).semantic.source).toBe(candidate);
    expect(wrapper.text()).toContain("Turtle valid");
    await waitUntil(() => summaryNodeCount(wrapper!) === 3);
  });

  it("invalid Turtleをrollbackしてdocument正本とSceneを維持する", async () => {
    wrapper = await mountEditor();
    const initialNodeCount = summaryNodeCount(wrapper);
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(
      `@prefix : <${NS}> .\n:a :rel .`,
    );

    await buttonWithText(wrapper, "検証して適用").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-diagnostics .error").exists());

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(summaryNodeCount(wrapper)).toBe(initialNodeCount);
    expect(await exposedApi(wrapper).flushPendingEdits()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("保存要求がpending Turtleのflush完了を待ち、失敗時はsaveをemitしない", async () => {
    wrapper = await mountEditor();
    const candidate = `${initialSource}\n:c rdfs:label "C" .\n`;
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(candidate);

    await wrapper.get(".iriograph-editor-header button").trigger("click");
    await waitUntil(() => (wrapper!.emitted("save")?.length ?? 0) === 1);

    expect(latestDocument(wrapper).semantic.source).toBe(candidate);
    expect(wrapper.emitted("save")).toHaveLength(1);

    wrapper.unmount();
    wrapper = await mountEditor();
    await openTurtlePanel(wrapper);
    await wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Turtle source"]').setValue(
      `@prefix : <${NS}> .\n:a :rel .`,
    );
    await wrapper.get(".iriograph-editor-header button").trigger("click");
    await waitUntil(() => wrapper!.find(".iriograph-diagnostics .error").exists());

    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("pan、fit、selection revealをdocument/historyと分離して公開する", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes.find((node) => node.semanticRef === `${NS}b`)!;
    const api = wrapper.vm as unknown as IriographEditorNavigationApi;

    api.panBy(80, 45);
    expect(viewport.element.scrollLeft).toBe(80);
    expect(viewport.element.scrollTop).toBe(45);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    expect(await api.focusElement(target.elementId)).toBe(true);
    expect(wrapper.emitted("selectionChanged")?.at(-1)?.[0]).toBe(target.elementId);
    expect(viewport.element.scrollLeft).toBeGreaterThan(100);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await api.fitToView();
    const expectedFit = diagramFitZoom(canvas.props("scene"), { width: 180, height: 140 });
    expect(wrapper.get(".zoom-value").text()).toBe(`${Math.round(expectedFit * 100)}%`);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(await api.focusElement("missing-element")).toBe(false);
  });

  it("viewport focusの矢印はpan、node focusの矢印は既存編集に使い分ける", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const canvas = wrapper.getComponent(DiagramCanvas);
    const target = canvas.props("scene").nodes[0]!;
    const selectionApi = wrapper.vm as unknown as { selectElement(elementId: string): void };
    selectionApi.selectElement(target.elementId);
    await nextTick();
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowRight" });
    expect(viewport.element.scrollLeft).toBe(64);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();

    await wrapper.get(".iriograph-scene-node.selected").trigger("keydown", { key: "ArrowRight" });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
  });

  it("readOnlyでもnavigationを許可しpresentation editは発行しない", async () => {
    wrapper = await mountEditor({ readOnly: true });
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");

    await viewport.trigger("keydown", { key: "ArrowDown" });
    expect(viewport.element.scrollTop).toBe(64);
    await wrapper.get('button[aria-label="全体を表示"]').trigger("click");
    await settle();
    expect(Number.parseInt(wrapper.get(".zoom-value").text(), 10)).toBeLessThan(100);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("source tabを往復してもsession viewportを保持する", async () => {
    wrapper = await mountEditor();
    configureEditorViewport(wrapper, 180, 140);
    const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll");
    const api = wrapper.vm as unknown as IriographEditorNavigationApi;
    api.panBy(96, 72);
    await api.zoomTo(.8);
    const before = {
      left: viewport.element.scrollLeft,
      top: viewport.element.scrollTop,
    };

    await openTurtlePanel(wrapper);
    await buttonWithText(wrapper, "Diagram").trigger("click");
    await settle();

    expect(wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element.scrollLeft).toBe(before.left);
    expect(wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element.scrollTop).toBe(before.top);
    expect(wrapper.text()).toContain("80%");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });
});

async function mountEditor(extraProps: Record<string, unknown> = {}): Promise<VueWrapper> {
  const wrapper = mount(IriographEditor, {
    attachTo: document.body,
    props: {
      modelValue: documentFixture(),
      catalog: standardRdfRdfsCatalog,
      title: "Editor regression fixture",
      ...extraProps,
    },
  });
  await waitUntil(() => wrapper.getComponent(DiagramCanvas).props("scene").nodes.length === 2);
  return wrapper;
}

function configureEditorViewport(wrapper: VueWrapper, width: number, height: number): void {
  const viewport = wrapper.get<HTMLElement>(".iriograph-canvas-scroll").element;
  const stage = wrapper.get<HTMLElement>(".iriograph-canvas-stage").element;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
  Object.defineProperties(stage, {
    offsetLeft: { configurable: true, value: 20 },
    offsetTop: { configurable: true, value: 20 },
  });
  window.dispatchEvent(new Event("resize"));
}

async function openTurtlePanel(wrapper: VueWrapper): Promise<void> {
  await buttonWithText(wrapper, "Turtle").trigger("click");
  await nextTick();
}

function emitCanvas(
  canvas: unknown,
  event: string,
  payload?: unknown,
): void {
  const instance = (canvas as { vm: { $emit: (event: string, payload?: unknown) => void } }).vm;
  instance.$emit(event, payload);
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`button containing ${text} was not found`);
  return button;
}

function buttonWithTitle(wrapper: VueWrapper, title: string) {
  return wrapper.get<HTMLButtonElement>(`button[title="${title}"]`);
}

function exposedApi(wrapper: VueWrapper): { flushPendingEdits: () => Promise<boolean> } {
  return wrapper.vm as unknown as { flushPendingEdits: () => Promise<boolean> };
}

function latestDocument(wrapper: VueWrapper): IriographDocument {
  const document = wrapper.emitted("update:modelValue")?.at(-1)?.[0];
  if (!document) throw new Error("editor has not emitted a document update");
  return document as IriographDocument;
}

function overlayFor(document: IriographDocument, semanticRef: string) {
  return Object.values(document.views[0]?.overlay ?? {})
    .find((overlay) => overlay.semanticRef === semanticRef);
}

function summaryNodeCount(wrapper: VueWrapper): number {
  return Number(wrapper.get(".iriograph-view-summary b").text());
}

function offset(geometry: ElementGeometry, x: number, y: number): ElementGeometry {
  return {
    ...geometry,
    x: geometry.x + x,
    y: geometry.y + y,
  };
}

async function waitUntil(predicate: () => boolean, message = "editor did not settle"): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    if (predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error(message);
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
}

function documentFixture(): IriographDocumentV1 {
  return {
    schemaVersion: "1",
    kind: "iriograph.document",
    documentId: "editor-regression",
    semantic: {
      format: "text/turtle",
      baseIri: NS,
      authoringProfileRef: "urn:test:authoring:1",
      source: initialSource,
    },
    views: [{
      viewId: "main",
      kind: "node-link",
      profileRef: standardRdfRdfsCatalog.profileRef,
      layoutRef: STANDARD_LAYOUT_REFS.hierarchicalLr,
      overlay: {},
    }],
  };
}
