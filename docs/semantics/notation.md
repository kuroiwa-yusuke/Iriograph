# Semantic and presentation notation

[日本語版](../../docs_ja/semantics/notation.md)

## Purpose

`semantic.source` stores only meaning that must survive for LLM understanding, validation, query, other views, other hosts, and reuse. Classes or predicates that exist only to choose a shape, color, template, or icon are not semantic data.

This boundary is not primarily about shorter Turtle. It prevents a visual edit from changing the semantic graph or the agent input and allows multiple views over one meaning.

## Resource and vocabulary IRIs

A domain resource IRI identifies a business object or event. Its local name does not need to be human-readable. Stable identity survives rename; humans and agents use `rdfs:label` and `rdfs:comment`.

Ordinary UI does not expose compact IRIs as a fallback. It uses an unnamed label plus opaque presentation identity. Complete IRIs remain in editable source and internal transaction/audit identity. Their spelling is never interpreted as class, relation, or structure.

File name, workspace path, and `documentId` do not determine resource IRIs or the Turtle base. `semantic.baseIri` is an explicit portable fallback, Turtle `@base` is a standard source directive, and `@prefix` is only an IRI alias. External vocabulary remains available through absolute IRIs or prefixes without implicit ontology fetching.

Vocabulary IRIs appear as predicates, `rdf:type` objects, schema resources, and hierarchy/domain/range statements. Resource and vocabulary roles are not inferred from namespace, casing, or label; a profile declares roles while RDF's ability for one IRI to have multiple roles remains intact.

Predicate resources use their own labels and comments as relation names and descriptions. Search is label-first, but storage and write commands preserve the selected predicate IRI.

## What belongs in Turtle

Information is semantic when it is needed for any of:

- LLM understanding or editing;
- validation;
- query, indexing, search, or inference;
- cross-document or cross-host reference;
- reuse with meaning preserved.

Bag membership, Seq order, Alt alternatives, labels, references, retries, and meaningful domain relations belong in Turtle.

Plain membership can use `rdfs:member`. A domain-specific membership predicate may be declared as its subproperty and carry its own label/description. Per-statement evidence or temporal metadata requires an explicit relation-resource or another profile; it does not justify turning every membership into a custom relation object.

Presentation-only information includes:

- a green start circle;
- a person icon for a task;
- a diamond gateway;
- view-specific template or color;
- geometry, routing, and pins.

Do not create `StartEvent` or `UserTask` types solely for those effects. A real domain classification belongs in Turtle only when validation, query, agents, or reuse also depend on it.

## Appearance

Catalogs provide reusable templates and assets, including templates without semantic rules. A named view stores explicit `appearance.templateRef` or `appearance.iconRef` overrides.

```json
{
  "semanticRef": "urn:example:flow:start",
  "appearance": {
    "templateRef": "urn:example:template:start-event:1"
  }
}
```

An overlay choice is never reverse-engineered into a type. Changing a template creates no semantic revision. Changing Turtle preserves compatible user appearance for surviving resources.

## Example

Avoid appearance-only typing:

```turtle
:start a :StartEvent ; rdfs:label "Start"@en .
:review a :UserTask ; rdfs:label "Review"@en .
```

Semantic content alone may be:

```turtle
:start rdfs:label "Start"@en .
:review rdfs:label "Review"@en ;
  rdfs:seeAlso :approvalPolicy ;
  :retry :review .
```

The view selects the start circle and task icon. If task classification later becomes a genuine domain requirement, it is added as a versioned semantic change, not as justification for an existing appearance.

## LLM and serialization

Agents receive Turtle plus allowed vocabulary and structure constraints, not overlays, templates, or asset URLs. Appearance-only types would teach the model nonexistent domain classifications and are therefore prohibited.

Direct human Turtle commits retain valid source bytes. Structured commands and LLM edits serialize deterministically from expanded RDF tuples. Prefix aliases, triple order, `a` versus `rdf:type`, and full versus prefixed IRI notation do not change semantics.
