# skos-shacl: [SHACL](https://www.w3.org/TR/shacl/) shapes for [SKOS](https://www.w3.org/2004/02/skos/)

SHACL shapes for SKOS that:

- Clearly delineate constraints derived directly from the SKOS specification from "opinions"
- Support SKOS-XL as well as SKOS
- Do not use SPARQL-based constraints
- Validate shapes against real-world SKOS data graphs such as [AGROVOC](https://agrovoc.fao.org/browse/agrovoc/en/) and the [UNESCO Thesaurus](https://vocabularies.unesco.org/browser/thesaurus/en/)

## Structure of this repository

- `.github/`: GitHub Actions workflow for running tests
- `shapes/`: SKOS shape definitions in Turtle
- `tests/`: valid and invalid SKOS test data

## Alternatives

- [Shape Repository for SkoHub](https://github.com/skohub-io/skohub-shapes)
- [EU Office of Publications](https://op.europa.eu/fr/web/eu-vocabularies/application-profiles)
