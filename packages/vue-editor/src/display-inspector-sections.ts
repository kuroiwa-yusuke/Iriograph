export type DisplayInspectorSection =
  | "appearance"
  | "icon"
  | "geometry"
  | "region-label"
  | "routing"
  | "edge-connection"
  | "edge-label";

export type DisplayInspectorSubject = {
  structuralKind: "node" | "edge" | "container" | "region";
  hasGeometry: boolean;
  groupFrame: boolean;
};

export type DisplayInspectorContextSection = "element" | "icon" | "line" | "group";

/** Target-specific progressive disclosure; order also selects the initially open primary section. */
export function displayInspectorSectionsFor(
  subject: DisplayInspectorSubject | undefined,
): readonly DisplayInspectorSection[] {
  if (!subject) return [];
  if (subject.structuralKind === "edge") {
    return ["routing", "edge-connection", "edge-label", "appearance"];
  }
  if (subject.structuralKind === "node") {
    return subject.hasGeometry
      ? ["appearance", "icon", "geometry"]
      : ["appearance", "icon"];
  }
  const sections: DisplayInspectorSection[] = ["appearance"];
  if (subject.structuralKind === "region" || subject.groupFrame) sections.push("region-label");
  if (subject.hasGeometry) sections.push("geometry");
  return sections;
}

export function primaryDisplayInspectorSection(
  subject: DisplayInspectorSubject | undefined,
): DisplayInspectorSection | undefined {
  return displayInspectorSectionsFor(subject)[0];
}

export function displayInspectorSectionForContextDestination(
  section: DisplayInspectorContextSection,
): DisplayInspectorSection {
  if (section === "line") return "routing";
  if (section === "group") return "region-label";
  if (section === "icon") return "icon";
  return "appearance";
}
