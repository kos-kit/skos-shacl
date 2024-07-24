import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printTable } from "console-table-printer";
import PrefixMap from "@rdfjs/prefix-map/PrefixMap.js";
import { sh, skos } from "@tpluscode/rdf-ns-builders";
import { Term } from "@rdfjs/types";
import { pino } from "pino";
import { boolean, command, flag, run } from "cmd-ts";

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
    ["unesco", rdf.namedNode("http://vocabularies.unesco.org/")],
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
    if (dirent.name[0] === "." || dirent.name[0] === "_") {
      return [];
    }

    const parentDirectoryName = path.basename(dirent.parentPath);
    if (parentDirectoryName[0] === "." || parentDirectoryName[0] === "_") {
      return [];
    }

    if (!dirent.isFile()) {
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

function termToString(term: Term | null | undefined): string {
  if (term == null) {
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

run(
  command({
    name: "test",
    args: {
      debug: flag({
        long: "debug",
        short: "d",
      }),
    },
    handler: async ({ debug }) => {
      let exitCode = 0;
      const logger = pino(
        {
          level: debug ? "debug" : "info",
        },
        pino.destination(2)
      );

      for (const { dataFilePath, valid } of (
        await getDataFilePaths(validDataDirectoryPath)
      )
        .map((dataFilePath) => ({ dataFilePath, valid: true }))
        .concat(
          (await getDataFilePaths(invalidDataDirectoryPath)).map(
            (dataFilePath) => ({ dataFilePath, valid: false })
          )
        )) {
        const dataFileName = path.basename(dataFilePath);
        const dataGraph = await rdf
          .dataset()
          .import(rdf.fromFile(dataFilePath));

        logger.debug("Data file:", dataFilePath);

        const shapesGraph = rdf.dataset();
        // Add shapes progressively, validating on each pass
        for (const shapesFileName of shapesFileOrder) {
          const shapesFilePath = path.join(shapesDirectoryPath, shapesFileName);
          await shapesGraph.import(rdf.fromFile(shapesFilePath));

          const validator = new SHACLValidator(shapesGraph, { factory: rdf });
          const report = validator.validate(dataGraph);

          if (report.conforms) {
            if (valid) {
              logger.debug(`${shapesFileName}: ${dataFilePath} conforms`);
            } else {
              logger.info(
                `${shapesFileName}: ${dataFilePath} conforms but should not`
              );
              exitCode++;
            }
            continue;
          }

          // Non-conformant

          if (valid) {
            logger.info(
              `${shapesFileName}: ${dataFilePath} does not conform (${report.results.length} results) but should`
            );
            exitCode++;
          } else {
            logger.debug(
              `${shapesFileName}: ${dataFilePath} does not conform (${report.results.length} results) and should not`
            );
          }

          if (logger.isLevelEnabled("debug")) {
            printTable(
              report.results.flatMap((result, resultI) => {
                const resultProperties = {
                  "#": resultI,
                  dataFileName,
                  shapesFileName,
                  severity: termToString(result.severity),
                  focusNode: termToString(result.focusNode),
                  message: "",
                  path: termToString(result.path),
                  sourceConstraintComponent: termToString(
                    result.sourceConstraintComponent
                  ),
                  sourceShape: termToString(result.sourceShape),
                  value: termToString(result.value),
                };
                if (result.message.length === 1) {
                  resultProperties.message = termToString(result.message[0]);
                  return [resultProperties];
                } else {
                  const printableResults: any[] = [resultProperties];
                  for (const message of result.message) {
                    printableResults.push({
                      ...resultProperties,
                      message: termToString(message),
                    });
                  }
                  return printableResults;
                }
              })
            );
            console.log("");
          }
        }
      }

      process.exit(exitCode);
    },
  }),
  process.argv.slice(2)
);
