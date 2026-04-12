import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { ADAPTERS, DEFAULT_ADAPTER, MANAGED_FILES, installWorkflow } from "./install.js";
import { createDirectoryLink } from "./install-test-helpers.js";

const execFileAsync = promisify(execFile);
const DEFAULT_INSTALL_DIR = ADAPTERS[DEFAULT_ADAPTER].installDir;

async function tryGetWindowsShortPath(filePath) {
  const { stdout } = await execFileAsync("cmd.exe", [
    "/d",
    "/c",
    `for %I in (${filePath}) do @echo %~sI`
  ]);
  const shortPath = stdout.trim();

  if (shortPath === "" || shortPath.toLowerCase() === filePath.toLowerCase()) {
    return null;
  }

  return shortPath;
}

test("installWorkflow rejects installDir paths that point to regular files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await writeFile(path.join(tempRoot, DEFAULT_INSTALL_DIR), "blocked\n", "utf8");

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /installDir path '.github' must point to a directory within the project root\./
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed roots that resolve through a symlink outside the project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-outside-"));

  try {
    await createDirectoryLink(outsideRoot, path.join(tempRoot, DEFAULT_INSTALL_DIR));

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /installDir path '.github' must stay within the project root\./
    );

    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("installWorkflow dry-run rejects managed roots that resolve through a symlink outside the project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-outside-"));

  try {
    await createDirectoryLink(outsideRoot, path.join(tempRoot, DEFAULT_INSTALL_DIR));

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot,
        dryRun: true
      }),
      /installDir path '.github' must stay within the project root\./
    );

    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed roots that are symlinked or junctioned directories inside the project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const linkedRoot = path.join(tempRoot, DEFAULT_INSTALL_DIR);
  const targetRoot = path.join(tempRoot, "real-root");

  try {
    await mkdir(targetRoot, { recursive: true });
    await createDirectoryLink(targetRoot, linkedRoot);

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /installDir path '.github' cannot be a symlinked or junctioned directory\./
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects creating a project root through a symlinked ancestor", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-outside-"));

  try {
    await createDirectoryLink(outsideRoot, path.join(tempRoot, "escape"));

    await assert.rejects(
      installWorkflow({
        projectRoot: path.join(tempRoot, "escape", "project")
      }),
      /cannot be created through a symlinked or junctioned ancestor\./
    );

    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects an existing symlinked project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-outside-"));
  const linkedProjectRoot = path.join(tempRoot, "linked-project");

  try {
    await createDirectoryLink(outsideRoot, linkedProjectRoot);

    await assert.rejects(
      installWorkflow({
        projectRoot: linkedProjectRoot
      }),
      /cannot be a symlinked or junctioned directory\./
    );

    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects project roots that are regular files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const fileProjectRoot = path.join(tempRoot, "project.txt");

  try {
    await writeFile(fileProjectRoot, "not a directory\n", "utf8");

    await assert.rejects(
      installWorkflow({
        projectRoot: fileProjectRoot
      }),
      /Project root '.*project\.txt' must be a directory, not a file\./
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow accepts Windows short-path spellings for regular project roots", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only regression.");
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const longProjectRoot = path.join(tempRoot, "directorywithaverylongname", "projectrootdirectory");

  try {
    await mkdir(longProjectRoot, { recursive: true });

    const shortProjectRoot = await tryGetWindowsShortPath(longProjectRoot);

    if (shortProjectRoot === null) {
      t.skip("Current filesystem does not expose a distinct 8.3 short-path alias.");
      return;
    }

    assert.equal(await realpath(shortProjectRoot), await realpath(longProjectRoot));

    await assert.doesNotReject(
      installWorkflow({
        projectRoot: shortProjectRoot
      })
    );

    await access(path.join(longProjectRoot, DEFAULT_INSTALL_DIR, MANAGED_FILES[0]));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects symlinked descendants inside managed directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-outside-"));

  try {
    await mkdir(path.join(tempRoot, DEFAULT_INSTALL_DIR), { recursive: true });
    await createDirectoryLink(outsideRoot, path.join(tempRoot, DEFAULT_INSTALL_DIR, "agents"));

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /Managed files must stay within the project root\./
    );

    assert.deepEqual(await readdir(outsideRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed file paths that are symlinked or junctioned directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const managedPath = path.join(tempRoot, DEFAULT_INSTALL_DIR, "agents", "gnd-diver.agent.md");
  const targetRoot = path.join(tempRoot, "linked-target");

  try {
    await mkdir(targetRoot, { recursive: true });
    await mkdir(path.dirname(managedPath), { recursive: true });
    await createDirectoryLink(targetRoot, managedPath);

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /Managed file paths must be regular files, not a symlink or junction\./
    );

    assert.deepEqual(await readdir(targetRoot), []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
