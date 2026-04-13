import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ADAPTERS, DEFAULT_ADAPTER, installWorkflow, readPackageVersion } from "./install.js";
import { normalizePathForContent } from "./path-policy.js";

function printHelp(stream) {
  const adapterList = Object.keys(ADAPTERS).join(", ");

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
      `  --adapter <name>              Runtime adapter (default: ${DEFAULT_ADAPTER})`,
      `                                Available: ${adapterList}`,
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
      adapter: {
        type: "string"
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
    adapter: values.adapter,
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

function formatConflictPrompt(conflict) {
  return [
    "Managed file differs from the packaged version:",
    `  ${conflict.relativePath}`,
    "Replace it? [y]es/[n]o/[a]ll: "
  ].join("\n");
}

const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;

const PROMPT_TIMEOUT = Symbol.for("gnd.prompt.timeout");
const PROMPT_INPUT_CLOSED = Symbol.for("gnd.prompt.inputClosed");

function questionWithTtyLifecycle(prompt, input, message, timeoutMs) {
  if (input.readableEnded || input.destroyed) {
    return Promise.resolve(PROMPT_INPUT_CLOSED);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      input.off("end", handleInputEnded);
      input.off("close", handleInputClosed);
      input.off("error", handleInputError);
    };

    const settle = (callback) => (value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback(value);
    };

    const handleInputEnded = settle(() => {
      prompt.close();
      resolve(PROMPT_INPUT_CLOSED);
    });
    const handleInputClosed = settle(() => {
      prompt.close();
      resolve(PROMPT_INPUT_CLOSED);
    });
    const handleInputError = settle(reject);
    const handleTimeout = settle(() => {
      prompt.close();
      resolve(PROMPT_TIMEOUT);
    });

    input.once("end", handleInputEnded);
    input.once("close", handleInputClosed);
    input.once("error", handleInputError);

    if (timeoutMs != null && timeoutMs > 0) {
      timer = setTimeout(handleTimeout, timeoutMs);
    }

    prompt.question(message).then(
      settle(resolve),
      settle(reject)
    );
  });
}

function createInteractiveConflictPrompter(input, output, options = {}) {
  if (!input?.isTTY || !output?.isTTY) {
    return null;
  }

  const promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
  let acceptAll = false;
  let prompt = null;

  return {
    async confirmManagedFileConflict(conflict) {
      if (acceptAll) {
        return true;
      }

      prompt ??= createInterface({
        input,
        output
      });

      while (true) {
        const answer = await questionWithTtyLifecycle(prompt, input, formatConflictPrompt(conflict), promptTimeoutMs);

        if (answer === PROMPT_TIMEOUT) {
          output.write("\nPrompt timed out.\n");
          return false;
        }

        if (answer === PROMPT_INPUT_CLOSED || answer === null) {
          return false;
        }

        const normalizedAnswer = answer.trim().toLowerCase();

        if (normalizedAnswer === "y" || normalizedAnswer === "yes") {
          return true;
        }

        if (normalizedAnswer === "a" || normalizedAnswer === "all") {
          acceptAll = true;
          return true;
        }

        if (normalizedAnswer === "" || normalizedAnswer === "n" || normalizedAnswer === "no") {
          return false;
        }

        output.write("Please answer y, n, or a.\n");
      }
    },
    close() {
      prompt?.close();
    }
  };
}

function printInstallResult(stream, result) {
  stream.write("Great Northern Diver install summary\n\n");
  stream.write(`Project root: ${result.projectRoot}\n`);
  stream.write(`Adapter: ${result.adapter}\n`);
  stream.write(`Install root: ${normalizePathForContent(result.installDir)}\n`);

  if (result.dryRun) {
    stream.write("Mode: dry-run\n");
  }

  stream.write("\n");
  printManagedFiles(stream, result.projectRoot, result.managedFiles);
  printConflicts(stream, result.conflicts ?? []);
}

async function runInstallCommand(rest, io, promptController) {
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

  const result = await runInstallWorkflow(
    promptController !== null && !options.force && !options.dryRun
      ? {
          ...options,
          confirmManagedFileConflict: promptController.confirmManagedFileConflict
        }
      : options
  );

  printInstallResult(stdout, result);
  return 0;
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const [command = "install", ...rest] = argv;
  const promptController = io.confirmManagedFileConflict
    ? {
        confirmManagedFileConflict: io.confirmManagedFileConflict,
        close() {}
      }
    : createInteractiveConflictPrompter(stdin, stderr, { promptTimeoutMs: io.promptTimeoutMs });

  if (command === "version" || command === "--version" || command === "-v") {
    stdout.write(`${await readPackageVersion()}\n`);
    promptController?.close();
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(stdout);
    promptController?.close();
    return 0;
  }

  if (command !== "install") {
    stderr.write(`Unknown command '${command}'.\n\n`);
    printHelp(stderr);
    promptController?.close();
    return 1;
  }

  try {
    return await runInstallCommand(rest, io, promptController);
  } catch (error) {
    stderr.write(`${formatErrorMessage(error)}\n`);
    return 1;
  } finally {
    promptController?.close();
  }
}

