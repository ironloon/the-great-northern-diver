import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { main } from "./cli.js";
import {
  createBufferedStream,
  createTtyInputStream,
  createTtyOutputStream
} from "./cli-test-helpers.js";

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

test("main prints help output with adapter info", async () => {
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  const exitCode = await main(["help"], {
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), "");
  assert.match(stdout.read(), /Writes managed agent and skill files/);
  assert.match(stdout.read(), /--adapter/);
  assert.equal(stdout.read().includes("--tool"), false);
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
          adapter: "vscode-github-copilot",
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
      adapter: undefined,
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
          adapter: "vscode-github-copilot",
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
      adapter: undefined,
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
        adapter: "vscode-github-copilot",
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

async function installWithManagedConflict(tempRoot, stdout, stderr) {
  const critiquePath = path.join(tempRoot, ".github", "skills", "gnd-critique", "SKILL.md");

  await main(["install"], {
    cwd: tempRoot,
    stdout,
    stderr
  });

  await writeFile(critiquePath, "user improvement\n", "utf8");
  return critiquePath;
}

test("main can confirm overwrites through the CLI io hook", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();
  const conflicts = [];

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, stderr.stream);

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      confirmManagedFileConflict: async (conflict) => {
        conflicts.push(conflict);
        return true;
      }
    });

    assert.equal(exitCode, 0);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].action, "overwrite");
    assert.equal(conflicts[0].relativePath, ".github/skills/gnd-critique/SKILL.md");
    assert.match(stdout.read(), /\.github\/skills\/gnd-critique\/SKILL\.md/);
    assert.notEqual(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main aborts cleanly when a conflict confirmation is declined", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, stderr.stream);

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      confirmManagedFileConflict: async () => false
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.read(), /Install canceled after declining to overwrite .*SKILL\.md\. No files were changed\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main refuses conflicting installs in non-interactive mode without --force", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const installStdout = createBufferedStream();
  const installStderr = createBufferedStream();
  const syncStdout = createBufferedStream();
  const syncStderr = createBufferedStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, installStdout.stream, installStderr.stream);

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: syncStdout.stream,
      stderr: syncStderr.stream
    });

    assert.equal(exitCode, 1);
    assert.equal(syncStdout.read(), "");
    assert.match(syncStderr.read(), /Re-run with --force to replace it\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main accepts overwrite confirmations through an interactive TTY prompt", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const installStderr = createBufferedStream();
  const stderr = createTtyOutputStream();
  const stdin = createTtyInputStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, installStderr.stream);

    const exitCodePromise = main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: stdin.stream
    });

    await stderr.waitFor(/Replace it\? \[y\]es\/\[n\]o\/\[a\]ll:/);
    stdin.write("y\n");

    const exitCode = await exitCodePromise;

    assert.equal(exitCode, 0);
    assert.match(stderr.read(), /Replace it\? \[y\]es\/\[n\]o\/\[a\]ll:/);
    assert.notEqual(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    stdin.close();
    stderr.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main declines overwrite confirmations through an interactive TTY prompt", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const installStderr = createBufferedStream();
  const stderr = createTtyOutputStream();
  const stdin = createTtyInputStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, installStderr.stream);

    const exitCodePromise = main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: stdin.stream
    });

    await stderr.waitFor(/Replace it\? \[y\]es\/\[n\]o\/\[a\]ll:/);
    stdin.write("n\n");

    const exitCode = await exitCodePromise;

    assert.equal(exitCode, 1);
    assert.match(stderr.read(), /Replace it\? \[y\]es\/\[n\]o\/\[a\]ll:/);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    stdin.close();
    stderr.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main fails closed when an interactive TTY stdin ends before answering", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const installStderr = createBufferedStream();
  const stderr = createTtyOutputStream();
  const stdin = createTtyInputStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, installStderr.stream);

    const exitCodePromise = main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: stdin.stream
    });

    await stderr.waitFor(/Replace it\? \[y\]es\/\[n\]o\/\[a\]ll:/);
    stdin.end();

    const exitCode = await exitCodePromise;

    assert.equal(exitCode, 1);
    assert.match(stderr.read(), /Install canceled after declining to overwrite .*SKILL\.md\. No files were changed\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    stdin.close();
    stderr.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main fails closed when an interactive TTY prompt times out", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const installStderr = createBufferedStream();
  const stderr = createTtyOutputStream();
  const stdin = createTtyInputStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, installStderr.stream);

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      stdin: stdin.stream,
      promptTimeoutMs: 50
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.read(), /Install canceled after declining to overwrite .*SKILL\.md\. No files were changed\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    stdin.close();
    stderr.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("main rejects truthy non-boolean confirmation as a decline", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-cli-"));
  const stdout = createBufferedStream();
  const stderr = createBufferedStream();

  try {
    const critiquePath = await installWithManagedConflict(tempRoot, stdout.stream, stderr.stream);

    const exitCode = await main(["install"], {
      cwd: tempRoot,
      stdout: stdout.stream,
      stderr: stderr.stream,
      confirmManagedFileConflict: async () => "yes"
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.read(), /Install canceled after declining to overwrite .*SKILL\.md\. No files were changed\./);
    assert.equal(await readFile(critiquePath, "utf8"), "user improvement\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
