import {
  DEFAULT_PRESENTATION_TOOL_POLICY,
  type PresentationCapabilitySet,
  type PresentationSceneSnapshot,
  type PresentationToolPolicy,
} from "./index.js";

export function scene(): PresentationSceneSnapshot {
  return {
    binding: { documentRevision: "doc-r1", contextRevision: "ctx-r1", viewId: "main" },
    width: 1000,
    height: 700,
    elements: [{
      elementId: "group-1",
      kind: "container",
      label: "Order lane",
      presentation: {
        geometry: { x: 20, y: 20, width: 700, height: 400 },
        pinned: false,
        appearance: { groupLabelAnchor: 0.25 },
      },
    }, {
      elementId: "node-1",
      kind: "node",
      label: "A very long order-processing label for compact-summary tests",
      parentElementId: "group-1",
      presentation: {
        geometry: { x: 80, y: 100, width: 160, height: 72 },
        placement: "generated",
        appearance: { style: { fill: "#ffffff" } },
      },
    }, {
      elementId: "node-2",
      kind: "node",
      label: "Delivery",
      parentElementId: "group-1",
      presentation: { geometry: { x: 420, y: 100, width: 160, height: 72 } },
    }, {
      elementId: "edge-1",
      kind: "edge",
      label: "next",
      sourceElementId: "node-1",
      targetElementId: "node-2",
      presentation: {
        appearance: { style: { stroke: "#333333" } },
        routing: { routeMode: "manual", waypoints: [{ x: 330, y: 136 }] },
      },
    }],
    memberships: [{
      groupElementId: "group-1",
      memberElementId: "node-1",
      role: "membership",
    }],
  };
}

export function capabilities(): PresentationCapabilitySet {
  return {
    contextRevision: "ctx-r1",
    fieldRules: [
      { field: "geometry", elementKinds: ["node", "container"] },
      { field: "pinned", elementKinds: ["node", "container"] },
      { field: "placement", elementKinds: ["node", "container"] },
      { field: "appearance.templateOptionId", elementKinds: ["node", "container", "edge"] },
      { field: "appearance.iconOptionId", elementKinds: ["node", "container"] },
      { field: "appearance.styleOptionId", elementKinds: ["node", "container", "edge"] },
      { field: "appearance.style.fill", elementKinds: ["node", "container"] },
      { field: "appearance.style.stroke", elementKinds: ["node", "container", "edge"] },
      { field: "appearance.nodeIconOffset", elementKinds: ["node"] },
      { field: "appearance.nodeIconScale", elementKinds: ["node"] },
      { field: "appearance.nodeIconSize", elementKinds: ["node"] },
      { field: "appearance.groupLabelAnchor", elementKinds: ["container"] },
      { field: "appearance.edgeCaption", elementKinds: ["edge"] },
      { field: "routing.routeMode", elementKinds: ["edge"] },
      { field: "routing.waypoints", elementKinds: ["edge"] },
      { field: "routing.curve", elementKinds: ["edge"] },
      { field: "routing.labelOffset", elementKinds: ["edge"] },
      { field: "routing.sourceMarker", elementKinds: ["edge"] },
      { field: "routing.targetMarker", elementKinds: ["edge"] },
    ],
    templates: [
      { optionId: "template-node", label: "Task", elementKinds: ["node"] },
      { optionId: "template-edge", label: "Flow", elementKinds: ["edge"] },
    ],
    icons: [{ optionId: "icon-order", label: "Order", summary: "Registered order icon", elementKinds: ["node"] }],
    styles: [{ optionId: "style-alert", label: "Alert", elementKinds: ["node", "edge"] }],
    routeModes: ["auto", "straight", "orthogonal", "curve", "manual"],
    markers: ["none", "arrow", "open-arrow"],
  };
}

export function policy(overrides: Partial<PresentationToolPolicy> = {}): PresentationToolPolicy {
  const base = structuredClone(DEFAULT_PRESENTATION_TOOL_POLICY);
  return {
    ...base,
    ...overrides,
    coordinates: { ...base.coordinates, ...(overrides.coordinates ?? {}) },
    tokens: { ...base.tokens, ...(overrides.tokens ?? {}) },
  };
}
