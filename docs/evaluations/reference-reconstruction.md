# Reference reconstruction evaluation history

[日本語版](../../docs_ja/evaluations/reference-reconstruction.md)

This file records non-normative evaluation history. Current commands, invariants, and budgets live in [Development and verification](../development/testing.md) and [Layout, routing, and performance](../editor/layout.md).

## Evaluation scope

The reference image depicts a pizza-order and delivery workflow with customer and shop lanes, nested staff roles, direct process edges, message/data relations, event/task/gateway-like templates, and long cross-lane routes. It is used to evaluate whether generic semantic projection and display completion can reconstruct a rich business diagram without sample-specific code.

The published `docs/experiments/references` set intentionally excludes the pizza image. It contains only the unrelated purchase-approval and service-architecture references; pizza measurements below are historical evaluation evidence, not a distributed reconstruction input.

The seed and evaluation preserve the distinction between:

- semantic structure in Turtle;
- generated display completion;
- user or agent-adjusted sparse overlay;
- structural similarity to the image;
- pixel/visual similarity to the image.

A high structural score does not imply pixel equality, and a visually similar overlay does not justify changing semantics.

## Standard verification evidence

Repository releases run:

- full package tests, type checks, and builds;
- packed-tarball consumer verification;
- real-browser E2E for editor interactions;
- fixed normal/stress layout fixtures;
- host-conformance checks in the Local Mock and Cloud;
- production browser, console, request, health, log, and disk checks when a host deployment is in scope.

Exact historical counts and timings belong to immutable release commits/tags and are not normative budgets.

## Reference structure score

The fixed reference evaluator checks semantic and Scene facts rather than image pixels. Its maximum score covers:

- required resources, labels, and workflow relations;
- customer, shop, staff, kitchen, and delivery grouping;
- nested and multi-membership constraints;
- sequence/alternative semantics where present;
- direct message/data relations;
- templates/icons and localized labels;
- region geometry and membership intersections;
- route and endpoint validity.

The evaluator must remain independent of seed IRIs, label spellings, array sizes, and manually recognized coordinates.

## Image similarity

Image comparison is a secondary evaluation using normalized screenshots and a declared proxy/metric. It considers:

- relative group and lane geometry;
- left-to-right or top-to-bottom flow;
- node template and size;
- label readability;
- edge crossings, overlap, and route shape;
- icon placement;
- whitespace and component packing.

It does not become a correctness gate for arbitrary documents. Improvements derived from the image must be restated as generic layout or interaction invariants and validated on unrelated fixtures.

## Agent overlay experiments

Presentation experiments provide an agent with:

- the rendered screenshot or opaque screenshot ID;
- a closed Scene index;
- target and capability summaries;
- a sparse patch schema;
- geometry and request/token budgets.

The agent does not receive Turtle when the experiment is presentation-only and cannot change semantic source. Candidates are rendered, scored, and reviewed before application. Reports record model/effort where available, initial and follow-up instruction count, cycles/tool/browser operations, wall time, and input/cached/output/reasoning tokens. Unavailable metrics are not estimated.

Earlier experiments demonstrated that unrestricted whole-document context produces excessive cached-token volume relative to the portable document size. The production direction is therefore an indexed Scene/tool interface with bounded targets rather than repeatedly prompting with the full editor implementation and specification.

## Image-to-semantic reconstruction

Independent reconstruction experiments receive only the source image and minimum format/profile guidance. They create Turtle first, validate it, then allow deterministic display completion and optionally a bounded overlay adjustment.

Evaluation separates:

1. semantic resource and relation correctness;
2. group/membership/order/alternative correctness;
3. label and description extraction;
4. generated layout quality;
5. final overlay visual similarity;
6. token and interaction cost.

A model may not invent unsupported vocabulary merely to imitate a symbol. When the image is ambiguous, it should prefer profile-supported generic relations and record uncertainty in descriptions rather than appearance-only semantic types.

## Repeated evaluations

Multi-document repeated evaluations use fixed inputs, clean sessions, identical package/catalog versions, and independent output files. Reports distinguish deterministic package output from agent-authored semantic or presentation changes.

Results are evidence for package-level improvements only when the same rule benefits multiple unrelated fixtures. Reference-specific branches are prohibited.
