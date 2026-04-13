import path from "node:path";
import { parseArgs } from "node:util";
import { installWorkflow, readPackageVersion } from "./install.js";
import { normalizePathForContent } from "./path-policy.js";

function printHelp(stream) {
  stream.write(
    [
      "Great Northern Diver",
      "",
      "Usage:",
      "  gnd-workflow install [project-root] [options]",
      "  gnd-workflow help",
      "",
      "Writes managed agent and skill files into the target project.",
      "",
      "Options:",
      "  --force                       Replace differing managed files without prompting",
      "  --dry-run                     Print the install plan without writing files",
      "  -C, --cwd <path>              Resolve paths from a specific working directory",
      "  --version                     Show version number",
      "  --help                        Show this help text",
      ""
    ].join("\n")
  );
}

function formatPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replaceAll("\\", "/") || ".";
}

function printManagedFiles(stream, projectRoot, filePaths) {
  if (filePaths.length === 0) {
    return;
  }

  stream.write("Managed files:\n");

  for (const filePath of filePaths) {
    stream.write(`  ${formatPath(projectRoot, filePath)}\n`);
  }
}

function printConflicts(stream, conflicts) {
  if (conflicts.length === 0) {
    return;
  }

  stream.write("Conflicts requiring --force to overwrite:\n");

  for (const conflict of conflicts) {
    stream.write(`  ${conflict.relativePath}\n`);
  }
}

function parseInstallArgs(argv, cwd) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "dry-run": {
        type: "boolean"
      },
      force: {
        type: "boolean"
      },
      cwd: {
        type: "string",
        short: "C"
      },
      help: {
        type: "boolean"
      },
      version: {
        type: "boolean"
      },
    }
  });

  if (positionals.length > 1) {
    throw new Error(`Unexpected positional argument '${positionals[1]}'.`);
  }

  const baseProjectRoot = values.cwd ? path.resolve(cwd, values.cwd) : cwd;
  const options = {
    projectRoot: baseProjectRoot,
    dryRun: values["dry-run"] ?? false,
    force: values.force ?? false,
    version: values.version ?? false,
    help: values.help ?? false
  };

  if (positionals.length === 1) {
    options.projectRoot = path.resolve(baseProjectRoot, positionals[0]);
  }

  return options;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printInstallResult(stream, result) {
  stream.write("Great Northern Diver install summary\n\n");
  stream.write(`Project root: ${result.projectRoot}\n`);
  stream.write(`Install root: ${normalizePathForContent(result.installDir)}\n`);

  if (result.dryRun) {
    stream.write("Mode: dry-run\n");
  }

  stream.write("\n");
  printManagedFiles(stream, result.projectRoot, result.managedFiles);
  printConflicts(stream, result.conflicts ?? []);
}

async function runInstallCommand(rest, io) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();
  const runInstallWorkflow = io.installWorkflow ?? installWorkflow;

  let options;

  try {
    options = parseInstallArgs(rest, cwd);
  } catch (error) {
    stderr.write(`${formatErrorMessage(error)}\n\n`);
    printHelp(stderr);
    return 1;
  }

  if (options.help) {
    printHelp(stdout);
    return 0;
  }

  if (options.version) {
    stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }

  if (options.dryRun && options.force) {
    stderr.write("Warning: --force has no effect in --dry-run mode.\n");
  }

  const result = await runInstallWorkflow(options);

  printInstallResult(stdout, result);
  return 0;
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const [command = "install", ...rest] = argv;

  if (command === "version" || command === "--version" || command === "-v") {
    stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(stdout);
    return 0;
  }

  if (command !== "install") {
    stderr.write(`Unknown command '${command}'.\n\n`);
    printHelp(stderr);
    return 1;
  }

  try {
    return await runInstallCommand(rest, io);
  } catch (error) {
    stderr.write(`${formatErrorMessage(error)}\n`);
    return 1;
  }
}

