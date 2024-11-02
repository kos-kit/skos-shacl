import rdf from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printTable } from "console-table-printer";
import PrefixMap from "@rdfjs/prefix-map/PrefixMap.js";
import { sh, skos } from "@tpluscode/rdf-ns-builders";
import { Term } from "@rdfjs/types";
import { Logger, pino } from "pino";
import { command, flag, oneOf, option, run } from "cmd-ts";
import { execFile } from "node:child_process";
import which from "which";
import { Dataset } from "@zazuko/env/lib/DatasetExt.js";
import * as tmp from "tmp-promise";
import { promisify } from "node:util";

const execFilePromisified = promisify(execFile);
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
const shapesFileOrder = ["skos-reference.shacl.ttl"];
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

type Validator = (kwds: {
  dataFilePath: string;
  logger: Logger;
  shapesFileName: string;
  shapesGraph: Dataset;
}) => Promise<boolean>;

async function jenaValidator(): Promise<readonly Validator[]> {
  const jenaShacl = await which("shacl", { nothrow: true });
  if (jenaShacl === null) {
    return [];
  }

  return [
    async ({ dataFilePath, logger, shapesGraph }) => {
      return await tmp.withFile(
        async ({ path: shapesFilePath }) => {
          await fs.promises.writeFile(
            shapesFilePath,
            await shapesGraph.serialize({ format: "application/n-triples" })
          );

          const args: string[] = [
            "validate",
            "--data",
            dataFilePath,
            "--shapes",
            shapesFilePath,
          ];
          // if (!logger.isLevelEnabled("debug")) {
          //   args.push("-q");
          // }
          const { stdout } = await execFilePromisified(jenaShacl, args);
          if (logger.isLevelEnabled("debug")) {
            process.stdout.write(stdout);
          }
          const coalescedStdout = stdout.replace(/\s+/g, " ").trim();
          if (coalescedStdout.indexOf("sh:conforms true") !== -1) {
            return true;
          } else if (coalescedStdout.indexOf("sh:conforms false") !== -1) {
            return false;
          } else {
            throw new Error("unable to find sh:conforms statement:\n" + stdout);
          }
        },
        { postfix: ".nt" }
      );
    },
  ];
}

const zazukoValidator: Validator = async ({
  dataFilePath,
  logger,
  shapesFileName,
  shapesGraph,
}) => {
  const dataFileName = path.basename(dataFilePath);

  const dataGraph = await rdf.dataset().import(rdf.fromFile(dataFilePath));

  const validator = new SHACLValidator(shapesGraph, { factory: rdf });
  const report = validator.validate(dataGraph);

  if (!report.conforms && logger.isLevelEnabled("debug")) {
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

  return report.conforms;
};

run(
  command({
    name: "test",
    args: {
      data: option({
        defaultValue: () => "",
        long: "data",
        type: oneOf(["invalid", "valid"]),
      }),
      debug: flag({
        long: "debug",
        short: "d",
      }),
      validator: option({
        defaultValue: () => "",
        description: "use a specific validator",
        long: "validator",
        type: oneOf(["jena", "zazuko"]),
      }),
    },
    handler: async ({ data, debug, validator }) => {
      let exitCode = 0;

      const logger = pino(
        {
          level: debug ? "debug" : "info",
        },
        pino.destination(2)
      );

      const validators: Validator[] = [];
      if (validator.length === 0) {
        validators.push(...(await jenaValidator()));
      } else if (validator === "jena") {
        validators.push(...(await jenaValidator()));
        if (validators.length === 0) {
          throw new Error("no Jena shacl command line program found");
        }
      }
      if (validator.length === 0 || validator === "zazuko") {
        validators.push(zazukoValidator);
      }

      const dataFilePaths: { dataFilePath: string; valid: boolean }[] = [];
      if (data.length === 0 || data === "valid") {
        dataFilePaths.push(
          ...(await getDataFilePaths(validDataDirectoryPath)).map(
            (dataFilePath) => ({ dataFilePath, valid: true })
          )
        );
      }
      if (data.length === 0 || data === "invalid") {
        dataFilePaths.push(
          ...(await getDataFilePaths(invalidDataDirectoryPath)).map(
            (dataFilePath) => ({ dataFilePath, valid: false })
          )
        );
      }

      for (const { dataFilePath, valid } of dataFilePaths) {
        logger.debug("Data file: %s", dataFilePath);

        const shapesGraph = rdf.dataset();
        // Add shapes progressively, validating on each pass
        for (const shapesFileName of shapesFileOrder) {
          await shapesGraph.import(
            rdf.fromFile(path.join(shapesDirectoryPath, shapesFileName))
          );

          const validatorResultsArray: boolean[] = [];
          for (const validator of validators) {
            validatorResultsArray.push(
              await validator({
                dataFilePath,
                logger,
                shapesFileName,
                shapesGraph,
              })
            );
          }

          const validatorResultsSet = new Set(validatorResultsArray);
          if (validatorResultsSet.size !== 1) {
            logger.warn(
              "validators disagree on conformance: %s",
              JSON.stringify(validatorResultsArray)
            );
            continue;
          }
          const conforms = [...validatorResultsSet][0]!;

          if (conforms) {
            if (valid) {
              logger.debug(`${shapesFileName}: ${dataFilePath} conforms`);
            } else {
              logger.info(
                `${shapesFileName}: ${dataFilePath} conforms but should not`
              );
              exitCode++;
            }
          } else {
            // Non-conformant
            if (valid) {
              logger.info(
                `${shapesFileName}: ${dataFilePath} does not conform but should`
              );
              exitCode++;
            } else {
              logger.debug(
                `${shapesFileName}: ${dataFilePath} does not conform and should not`
              );
            }
          }
        }
      }

      process.exit(exitCode);
    },
  }),
  process.argv.slice(2)
);
