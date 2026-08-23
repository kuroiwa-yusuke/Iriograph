import {
  compareCodePoints,
  type ProjectionCatalogV1,
  type ResolvedAuthoringTerm,
  type VisualStyle,
} from "@iriograph/core";

export type CreationPaletteCard = {
  templateRef: string;
  classIri?: string;
  kind: "node" | "region";
  structuralKind: "node" | "container" | "region";
  label: string;
  description: string;
  shape: string;
  iconRef?: string;
  style: VisualStyle;
  size: { width: number; height: number };
};

/** Catalog/profile-driven palette; no business-domain shape names are embedded here. */
export function catalogCreationPalette(
  catalog: ProjectionCatalogV1 | undefined,
  terms: readonly ResolvedAuthoringTerm[],
  viewKind: "node-link" | "region" = "node-link",
): CreationPaletteCard[] {
  if (!catalog) return [];
  const termLabels = new Map(terms.map((term) => [term.iri, term.label]));
  const declaredClasses = new Set(terms.filter((term) => term.kind === "class").map((term) => term.iri));
  const cards = catalog.rules.flatMap((rule): CreationPaletteCard[] => {
    if (rule.match.kind !== "type") return [];
    if (rule.project.operator === "membership-container") {
      const structuralKind = viewKind === "region" ? "region" as const : "container" as const;
      const templateRef = viewKind === "region"
        ? catalog.defaults?.regionTemplateRef
        : rule.templateRef;
      const template = templateRef ? catalog.templates[templateRef] : undefined;
      if (!template || template.structuralKind === "edge" || template.structuralKind === "annotation") return [];
      return [{
        templateRef: template.templateRef,
        classIri: rule.match.iri,
        kind: "region",
        structuralKind,
        label: termLabels.get(rule.match.iri) ?? compactIri(rule.match.iri),
        description: "意味上の包含を持つ領域",
        shape: template.shape ?? "region",
        iconRef: template.iconRef,
        style: template.style,
        size: template.defaultSize ?? { width: 240, height: 120 },
      }];
    }
    if (rule.project.operator === "membership-region") {
      if (!declaredClasses.has(rule.match.iri)) return [];
      const templateRef = rule.templateRef ?? catalog.defaults?.nodeTemplateRef;
      const template = templateRef ? catalog.templates[templateRef] : undefined;
      if (!template || template.structuralKind !== "node") return [];
      return [{
        templateRef: template.templateRef,
        classIri: rule.match.iri,
        kind: "node",
        structuralKind: "node",
        label: termLabels.get(rule.match.iri) ?? compactIri(rule.match.iri),
        description: "分類領域としても利用できる概念クラス",
        shape: template.shape ?? "rectangle",
        iconRef: template.iconRef,
        style: template.style,
        size: template.defaultSize ?? { width: 120, height: 60 },
      }];
    }
    if (rule.project.operator !== "resource" || !declaredClasses.has(rule.match.iri)) return [];
    const structuralKind = rule.project.structuralKind;
    const templateRef = rule.templateRef ?? catalog.defaults?.nodeTemplateRef;
    const template = templateRef ? catalog.templates[templateRef] : undefined;
    if (!template || template.structuralKind === "edge" || template.structuralKind === "annotation") return [];
    return [{
      templateRef: template.templateRef,
      classIri: rule.match.iri,
      kind: structuralKind === "node" ? "node" : "region",
      structuralKind,
      label: termLabels.get(rule.match.iri) ?? compactIri(rule.match.iri),
      description: structuralKind === "container" ? "要素を含める領域" : "意味グラフの要素",
      shape: template.shape ?? (structuralKind === "node" ? "rectangle" : "region"),
      iconRef: template.iconRef,
      style: template.style,
      size: template.defaultSize ?? { width: 120, height: 60 },
    }];
  });
  const genericTemplateRef = catalog.defaults?.nodeTemplateRef;
  const genericTemplate = genericTemplateRef ? catalog.templates[genericTemplateRef] : undefined;
  if (genericTemplate?.structuralKind === "node") {
    cards.push({
      templateRef: genericTemplate.templateRef,
      classIri: undefined,
      kind: "node",
      structuralKind: "node",
      label: "基本の要素",
      description: "意味型を決めず、名前や関係から作成",
      shape: genericTemplate.shape ?? "rectangle",
      iconRef: genericTemplate.iconRef,
      style: genericTemplate.style,
      size: genericTemplate.defaultSize ?? { width: 120, height: 60 },
    });
  }
  const unique = new Map(cards.map((card) => [
    JSON.stringify([card.kind, card.templateRef, card.classIri]),
    card,
  ]));
  return [...unique.values()].sort((left, right) => (
    compareCodePoints(left.kind, right.kind)
    || compareCodePoints(left.label, right.label)
    || compareCodePoints(left.templateRef, right.templateRef)
    || compareCodePoints(left.classIri ?? "", right.classIri ?? "")
  ));
}

function compactIri(value: string): string {
  const hash = value.lastIndexOf("#");
  const slash = value.lastIndexOf("/");
  const colon = value.lastIndexOf(":");
  return value.slice(Math.max(hash, slash, colon) + 1) || value;
}
