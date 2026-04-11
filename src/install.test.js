import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { DEFAULT_INSTALL_DIR, MANAGED_FILES, VERSION_FILE, installWorkflow } from "./install.js";
import { fileExists, normalizePath } from "./install-test-helpers.js";

test("installWorkflow writes and reuses managed files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const normalizedInstallDir = normalizePath(DEFAULT_INSTALL_DIR);

  try {
    const firstInstall = await installWorkflow({
      projectRoot: tempRoot
    });

    assert.equal(firstInstall.installDir, normalizedInstallDir);
    assert.equal(firstInstall.managedFiles.length, MANAGED_FILES.length + 1);

    for (const relativeFile of MANAGED_FILES) {
      const managedText = await readFile(path.join(tempRoot, DEFAULT_INSTALL_DIR, relativeFile), "utf8");

      assert.ok(managedText.startsWith("---\n"), `${relativeFile} should include frontmatter`);
    }

    const versionContent = JSON.parse(await readFile(path.join(tempRoot, DEFAULT_INSTALL_DIR, VERSION_FILE), "utf8"));

    assert.equal(typeof versionContent.installedFrom, "string");
    assert.match(versionContent.installedFrom, /^\d+\.\d+\.\d+/);

    const critiqueText = await readFile(path.join(tempRoot, DEFAULT_INSTALL_DIR, "skills", "gnd-critique", "SKILL.md"), "utf8");

    assert.ok(critiqueText.includes(`.agents/skills/gnd-chart/SKILL.md`));
    assert.ok(critiqueText.includes(`.agents/agents/gnd-navigator.agent.md`));

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
    assert.equal(await fileExists(path.join(projectRoot, DEFAULT_INSTALL_DIR, MANAGED_FILES[0])), true);
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
    assert.equal(await fileExists(path.join(projectRoot, DEFAULT_INSTALL_DIR)), false);
    assert.equal(await fileExists(path.join(projectRoot, DEFAULT_INSTALL_DIR, VERSION_FILE)), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed file paths that are directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await mkdir(path.join(tempRoot, DEFAULT_INSTALL_DIR, "agents", "gnd-diver.agent.md"), { recursive: true });

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
