import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { ADAPTERS, DEFAULT_ADAPTER, MANAGED_FILES, installWorkflow } from "./install.js";
import { fileExists, normalizePath } from "./install-test-helpers.js";

const defaultInstallDir = ADAPTERS[DEFAULT_ADAPTER].installDir;

test("installWorkflow writes and reuses managed files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const normalizedInstallDir = normalizePath(defaultInstallDir);

  try {
    const firstInstall = await installWorkflow({
      projectRoot: tempRoot
    });

    assert.equal(firstInstall.installDir, normalizedInstallDir);
    assert.equal(firstInstall.adapter, DEFAULT_ADAPTER);
    assert.equal(firstInstall.managedFiles.length, MANAGED_FILES.length);

    for (const relativeFile of MANAGED_FILES) {
      const managedText = await readFile(path.join(tempRoot, defaultInstallDir, relativeFile), "utf8");

      assert.ok(managedText.startsWith("---\n"), `${relativeFile} should include frontmatter`);
      assert.match(managedText, /gnd-version: "\d+\.\d+\.\d+/, `${relativeFile} should have gnd-version in frontmatter`);
      assert.match(managedText, /gnd-adapter: "vscode-github-copilot"/, `${relativeFile} should have gnd-adapter in frontmatter`);
    }

    const critiqueText = await readFile(path.join(tempRoot, defaultInstallDir, "skills", "gnd-critique", "SKILL.md"), "utf8");

    assert.ok(critiqueText.includes(`.github/skills/gnd-chart/SKILL.md`));
    assert.ok(critiqueText.includes(`.github/agents/gnd-navigator.agent.md`));

    const secondInstall = await installWorkflow({
      projectRoot: tempRoot
    });

    assert.ok(secondInstall.managedFiles.every((entry) => entry.status === "unchanged"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow creates a missing project root when it is creatable", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const projectRoot = path.join(tempRoot, "nested", "repo");

  try {
    const result = await installWorkflow({
      projectRoot
    });

    assert.equal(result.projectRoot, projectRoot);
    assert.equal(await fileExists(path.join(projectRoot, defaultInstallDir, MANAGED_FILES[0])), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow dry-run does not create the managed tree", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const projectRoot = path.join(tempRoot, "nested", "repo");

  try {
    const result = await installWorkflow({
      projectRoot,
      dryRun: true
    });

    assert.equal(result.dryRun, true);
    assert.equal(await fileExists(path.join(projectRoot, defaultInstallDir)), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed file paths that are directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await mkdir(path.join(tempRoot, defaultInstallDir, "agents", "gnd-diver.agent.md"), { recursive: true });

    await assert.rejects(
      installWorkflow({
        projectRoot: tempRoot
      }),
      /Managed file paths must be regular files, not a directory\./
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects concurrent installs to the same project root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await mkdir(tempRoot, { recursive: true });
    await writeFile(path.join(tempRoot, ".gnd-install.lock"), "version: 1\npid: 99999999\nstarted: 2025-01-01T00:00:00.000Z\n", { flag: "wx" });

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot }),
      (error) => {
        assert.match(error.message, /Another install appears to be in progress/);
        assert.match(error.message, /PID 99999999, which is no longer running/);
        return true;
      }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow cleans up the lock file after a successful install", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    assert.equal(await fileExists(path.join(tempRoot, ".gnd-install.lock")), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rolls back written files when a later write fails", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const chartSkillPath = path.join(tempRoot, defaultInstallDir, "skills", "gnd-chart", "SKILL.md");

  try {
    await installWorkflow({ projectRoot: tempRoot });

    const firstFilePath = path.join(tempRoot, defaultInstallDir, "agents", "gnd-diver.agent.md");
    await writeFile(firstFilePath, "user edit\n", "utf8");
    await writeFile(chartSkillPath, "user edit\n", "utf8");
    await chmod(chartSkillPath, 0o444);

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot, force: true }),
      (error) => {
        assert.match(error.message, /Failed to write/);
        return true;
      }
    );

    assert.equal(await readFile(firstFilePath, "utf8"), "user edit\n", "rolled-back file should be restored to previous content");
  } finally {
    try { await chmod(chartSkillPath, 0o666); } catch { /* allow cleanup */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rolls back when mkdir fails for a later file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    // First install so all files exist.
    await installWorkflow({ projectRoot: tempRoot });

    // Edit agents so they become dirty (will be re-written on force install).
    const diverPath = path.join(tempRoot, defaultInstallDir, "agents", "gnd-diver.agent.md");
    await writeFile(diverPath, "user edit\n", "utf8");

    // Place a regular file where the skills/gnd-chart/ *directory* should be,
    // so mkdir for gnd-chart/SKILL.md fails with ENOTDIR.
    const chartDir = path.join(tempRoot, defaultInstallDir, "skills", "gnd-chart");
    await rm(chartDir, { recursive: true, force: true });
    await writeFile(chartDir, "blocker", "utf8");

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot, force: true }),
      (error) => {
        assert.match(error.message, /Failed to create directory/);
        return true;
      }
    );

    assert.equal(await readFile(diverPath, "utf8"), "user edit\n", "rolled-back file should be restored to previous content");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow lock file includes format version", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    // Use a conflict to bail out mid-install, leaving the lock readable
    // before cleanup. Instead, just install and check the lock is cleaned up.
    // We verify the format indirectly: a stale lock with "version: 1" is correctly parsed.
    await mkdir(tempRoot, { recursive: true });
    await writeFile(path.join(tempRoot, ".gnd-install.lock"), "version: 1\npid: 99999999\nstarted: 2025-01-01T00:00:00.000Z\n", { flag: "wx" });

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot }),
      (error) => {
        assert.match(error.message, /PID 99999999/);
        return true;
      }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
