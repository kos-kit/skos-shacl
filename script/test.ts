import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printTable } from "console-table-printer";
import PrefixMap from "@rdfjs/prefix-map/PrefixMap.js";
import { sh, skos } from "@tpluscode/rdf-ns-builders";
import { Term } from "@rdfjs/types";

const rootDirectoryPath = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
);
const dataDirectoryPath = path.join(rootDirectoryPath, "data");
const invalidDataDirectoryPath = path.join(dataDirectoryPath, "invalid");
const prefixMap = new PrefixMap(
  [
    ["", rdf.namedNode("http://kos-kit.github.io/skos-shacl/ns#")],
    ["hasset", rdf.namedNode("https://hasset.ukdataservice.ac.uk/")],
    ["sh", sh[""]],
    ["skos", skos[""]],
  ],
  { factory: rdf }
);
const shapesDirectoryPath = path.join(rootDirectoryPath, "shapes");
const shapesFileOrder = ["skos-shacl-spec.ttl"];
const validDataDirectoryPath = path.join(dataDirectoryPath, "valid");

async function getDataFilePaths(
  dataDirectoryPath: string
): Promise<readonly string[]> {
  return (
    await fs.promises.readdir(dataDirectoryPath, {
      recursive: true,
      withFileTypes: true,
    })
  ).flatMap((dirent) => {
    if (!dirent.isFile()) {
      return [];
    }
    if (dirent.name[0] === ".") {
      return [];
    }
    switch (path.extname(dirent.name).toLowerCase()) {
      case ".nt":
      case ".ttl":
        break;
      default:
        return [];
    }
    return [path.join(dirent.parentPath, dirent.name)];
  });
}

function termToString(term: Term | null): string {
  if (term === null) {
    return "";
  }
  switch (term.termType) {
    case "BlankNode":
    case "Literal":
      return term.value;
    case "NamedNode":
      return prefixMap.shrink(term)?.value ?? term.value;
    default:
      throw new RangeError(term.termType);
  }
}

async function main() {
  let exitCode = 0;

  for (const { dataFilePath, valid } of (
    await getDataFilePaths(validDataDirectoryPath)
  )
    .map((dataFilePath) => ({ dataFilePath, valid: true }))
    .concat(
      (await getDataFilePaths(invalidDataDirectoryPath)).map(
        (dataFilePath) => ({ dataFilePath, valid: false })
      )
    )) {
    const dataGraph = await rdf.dataset().import(rdf.fromFile(dataFilePath));

    console.log("Data file:", dataFilePath);

    const shapesGraph = rdf.dataset();
    // Add shapes progressively, validating on each pass
    for (const shapesFileName of shapesFileOrder) {
      const shapesFilePath = path.join(shapesDirectoryPath, shapesFileName);
      await shapesGraph.import(rdf.fromFile(shapesFilePath));

      const validator = new SHACLValidator(shapesGraph, { factory: rdf });
      const report = validator.validate(dataGraph);

      console.log(
        `${shapesFileName}: ${
          report.conforms ? "conforms" : "does not conform"
        }`
      );
      if (report.conforms) {
        continue;
      }
      if (valid) {
        exitCode++;
      }
      printTable(
        report.results.flatMap((result, resultI) =>
          result.message.map((message) => ({
            "#": resultI,
            shapesFileName,
            message: termToString(message),
            severity: termToString(result.severity),
            path: termToString(result.path),
            focusNode: termToString(result.focusNode),
            sourceConstraintComponent: termToString(
              result.sourceConstraintComponent
            ),
            sourceShape: termToString(result.sourceShape),
          }))
        )
      );
    }
  }
}

await main();
