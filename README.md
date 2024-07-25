# skos-shacl

[SHACL](https://www.w3.org/TR/shacl/) shapes for [SKOS](https://www.w3.org/2004/02/skos/) that:

- Clearly delineate constraints derived directly from the SKOS specification from "opinions"
- Model SKOS-XL as well as SKOS
- Do not use SPARQL-based constraints
- Validate shapes against real-world SKOS data graphs such as [AGROVOC](https://agrovoc.fao.org/browse/agrovoc/en/) and the [UNESCO Thesaurus](https://vocabularies.unesco.org/browser/thesaurus/en/)
- Support code and form generation from SHACL in addition to validation

## Structure of this repository

- `.github/`: GitHub Actions workflow for running tests
- `data/`: valid and invalid SKOS test data
- `shapes/`: SKOS shape definitions in Turtle
- `script/`: shell scripts conforming to the [Scripts To Rule Them All](https://github.com/github/scripts-to-rule-them-all) patterns

## Alternatives

- [Shape Repository for SkoHub](https://github.com/skohub-io/skohub-shapes)
- [EU Office of Publications](https://op.europa.eu/fr/web/eu-vocabularies/application-profiles)
