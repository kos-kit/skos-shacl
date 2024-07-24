import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printTable } from "console-table-printer";

const rootDirectoryPath = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
);
const dataDirectoryPath = path.join(rootDirectoryPath, "data");
const invalidDataDirectoryPath = path.join(dataDirectoryPath, "invalid");
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
        report.results.map((result) => ({
          shapesFileName,
          severity: result.severity,
          message: result.message,
          path: result.path,
          focusNode: result.focusNode,
          sourceConstraintComponent: result.sourceConstraintComponent,
          sourceShape: result.sourceShape,
        }))
      );
    }
  }
}

await main();
