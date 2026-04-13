import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { main } from "./cli.js";

function createBufferedStream() {
  let output = "";

  return {
    stream: {
      write(chunk) {
        output += chunk;
      }
    },
    read() {
      return output;
    }
  };
}

test("main --version prints the package version", async () => {
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();
  const pkg = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));

  const exitCode = await main(["--version"], {
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), "");
  assert.equal(stdout.read(), `${pkg.version}\n`);
});

test("main install --version prints the package version without running install", async () => {
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();
  const pkg = JSON.parse(await readFile(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"));
  let installCalled = false;

  const exitCode = await main(["install", "--version"], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    installWorkflow: async () => {
      installCalled = true;
      throw new Error("install should not run for install --version");
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(installCalled, false);
  assert.equal(stderr.read(), "");
  assert.equal(stdout.read(), `${pkg.version}\n`);
});

test("main prints help output", async () => {
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  const exitCode = await main(["help"], {
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), "");
  assert.match(stdout.read(), /Writes managed agent and skill files/);
  assert.equal(stdout.read().includes("--adapter"), false);
});

test("main resolves relative --cwd against the provided current working directory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const cliCwd = path.join(tempRoot, "workspace");
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    await mkdir(cliCwd, { recursive: true });

    const exitCode = await main(["install", "-C", "inner", "--dry-run"], {
      cwd: cliCwd,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.match(stdout.read(), new RegExp(`Project root: ${path.join(cliCwd, "inner").replaceAll("\\", "\\\\")}`));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main forwards install options through to installWorkflow", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();
  let receivedOptions = null;

  try {
    const exitCode = await main(["install", "repo", "--dry-run"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      installWorkflow: async (options) => {
        receivedOptions = options;

        return {
          projectRoot: options.projectRoot,
          installDir: ".github",
          dryRun: options.dryRun,
          managedFiles: [],
          conflicts: []
        };
      }
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.deepEqual(receivedOptions, {
      projectRoot: path.resolve(tempRoot, "repo"),
      dryRun: true,
      force: false,
      version: false,
      help: false
    });
    assert.match(stdout.read(), /Install root: \.github/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main forwards --force through to installWorkflow", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();
  let receivedOptions = null;

  try {
    const exitCode = await main(["install", "repo", "--force"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      installWorkflow: async (options) => {
        receivedOptions = options;

        return {
          projectRoot: options.projectRoot,
          installDir: ".github",
          dryRun: false,
          managedFiles: [],
          conflicts: []
        };
      }
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.deepEqual(receivedOptions, {
      projectRoot: path.resolve(tempRoot, "repo"),
      dryRun: false,
      force: true,
      version: false,
      help: false
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main reports dry-run conflicts in the install summary", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    const exitCode = await main(["install", "--dry-run"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      installWorkflow: async () => ({
        projectRoot: tempRoot,
        installDir: ".github",
        dryRun: true,
        managedFiles: [
          path.join(tempRoot, ".github", "skills", "gnd-critique", "SKILL.md")
        ],
        conflicts: [
          {
            action: "overwrite",
            relativePath: ".github/skills/gnd-critique/SKILL.md"
          }
        ]
      })
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.read(), "");
    assert.match(stdout.read(), /Conflicts requiring --force to overwrite:\n\s+\.github\/skills\/gnd-critique\/SKILL\.md/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main reports installer failures without assuming Error instances", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    const exitCode = await main(["install", "--dry-run"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      installWorkflow: async () => {
        throw null;
      }
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.read(), "");
    assert.equal(stderr.read(), "null\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main refuses conflicting installs without --force", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    const critiquePath = path.join(tempRoot, ".github", "skills", "gnd-critique", "SKILL.md");
    await writeFile(critiquePath, "user improvement\n", "utf8");

    const retryStdout = createBufferedStream();
    const retryStderr = createBufferedStream();

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: retryStdout.stream,
      stderr: retryStderr.stream
    });

    assert.equal(exitCode, 1);
    assert.equal(retryStdout.read(), "");
    assert.match(retryStderr.read(), /Re-run with --force to replace it\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main --force overwrites conflicting managed files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    const critiquePath = path.join(tempRoot, ".github", "skills", "gnd-critique", "SKILL.md");
    await writeFile(critiquePath, "user improvement\n", "utf8");

    const retryStdout = createBufferedStream();
    const retryStderr = createBufferedStream();

    const exitCode = await main(["install", "--force"], {
      cwd: tempRoot,
      stdout: retryStdout.stream,
      stderr: retryStderr.stream
    });

    assert.equal(exitCode, 0);
    assert.notEqual(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
