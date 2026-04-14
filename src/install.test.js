import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { MANAGED_FILES, SUPPLEMENTARY_FILES, installWorkflow } from "./install.js";
import { fileExists, normalizePath } from "./install-test-helpers.js";

const INSTALL_DIR = ".github";

test("installWorkflow writes and reuses managed files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    const firstInstall = await installWorkflow({
      projectRoot: tempRoot
    });

    assert.equal(firstInstall.installDir, normalizePath(INSTALL_DIR));
    assert.equal(firstInstall.managedFiles.length, MANAGED_FILES.length);

    for (const relativeFile of MANAGED_FILES) {
      const managedText = await readFile(path.join(tempRoot, INSTALL_DIR, relativeFile), "utf8");

      assert.ok(managedText.startsWith("---\n"), `${relativeFile} should include frontmatter`);
      assert.match(managedText, /gnd-version: "\d+\.\d+\.\d+/, `${relativeFile} should have gnd-version in frontmatter`);
      assert.match(managedText, /gnd-adapter: "vscode-github-copilot"/, `${relativeFile} should have gnd-adapter in frontmatter`);
    }

    const critiqueText = await readFile(path.join(tempRoot, INSTALL_DIR, "skills", "gnd-critique", "SKILL.md"), "utf8");

    assert.ok(critiqueText.includes(`.github/skills/gnd-chart/SKILL.md`));
    assert.ok(critiqueText.includes(`.github/agents/gnd-navigator.agent.md`));

    const secondInstall = await installWorkflow({
      projectRoot: tempRoot
    });

    assert.equal(secondInstall.managedFiles.length, MANAGED_FILES.length);
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
    assert.equal(await fileExists(path.join(projectRoot, INSTALL_DIR, MANAGED_FILES[0])), true);
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
    assert.equal(await fileExists(path.join(projectRoot, INSTALL_DIR)), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow rejects managed file paths that are directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await mkdir(path.join(tempRoot, INSTALL_DIR, "agents", "gnd-diver.agent.md"), { recursive: true });

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

test("installWorkflow refuses to overwrite differing files without --force", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    const critiquePath = path.join(tempRoot, INSTALL_DIR, "skills", "gnd-critique", "SKILL.md");
    await writeFile(critiquePath, "user edit\n", "utf8");

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot }),
      /Re-run with --force to replace it\./
    );

    assert.equal(await readFile(critiquePath, "utf8"), "user edit\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow --force overwrites differing managed files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    const critiquePath = path.join(tempRoot, INSTALL_DIR, "skills", "gnd-critique", "SKILL.md");
    await writeFile(critiquePath, "user edit\n", "utf8");

    await installWorkflow({ projectRoot: tempRoot, force: true });

    assert.notEqual(await readFile(critiquePath, "utf8"), "user edit\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow dry-run reports conflicts without writing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    const critiquePath = path.join(tempRoot, INSTALL_DIR, "skills", "gnd-critique", "SKILL.md");
    await writeFile(critiquePath, "user edit\n", "utf8");

    const result = await installWorkflow({ projectRoot: tempRoot, dryRun: true });

    assert.ok(result.conflicts.length > 0);
    assert.equal(await readFile(critiquePath, "utf8"), "user edit\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow reports write failures with permission details", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));
  const chartSkillPath = path.join(tempRoot, INSTALL_DIR, "skills", "gnd-chart", "SKILL.md");

  try {
    await installWorkflow({ projectRoot: tempRoot });

    await writeFile(chartSkillPath, "user edit\n", "utf8");
    await chmod(chartSkillPath, 0o444);

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot, force: true }),
      (error) => {
        assert.match(error.message, /Failed to write/);
        return true;
      }
    );
  } finally {
    try { await chmod(chartSkillPath, 0o666); } catch { /* allow cleanup */ }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow reports directory creation failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    const diverPath = path.join(tempRoot, INSTALL_DIR, "agents", "gnd-diver.agent.md");
    await writeFile(diverPath, "user edit\n", "utf8");

    const chartDir = path.join(tempRoot, INSTALL_DIR, "skills", "gnd-chart");
    await rm(chartDir, { recursive: true, force: true });
    await writeFile(chartDir, "blocker", "utf8");

    await assert.rejects(
      installWorkflow({ projectRoot: tempRoot, force: true }),
      (error) => {
        assert.match(error.message, /Failed to create directory/);
        return true;
      }
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("installWorkflow --force preserves supplementary local files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-workflow-"));

  try {
    await installWorkflow({ projectRoot: tempRoot });

    for (const supplementaryPath of Object.values(SUPPLEMENTARY_FILES)) {
      const fullPath = path.join(tempRoot, INSTALL_DIR, supplementaryPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, "project-local overrides\n", "utf8");
    }

    await installWorkflow({ projectRoot: tempRoot, force: true });

    for (const supplementaryPath of Object.values(SUPPLEMENTARY_FILES)) {
      const fullPath = path.join(tempRoot, INSTALL_DIR, supplementaryPath);
      const content = await readFile(fullPath, "utf8");

      assert.equal(content, "project-local overrides\n",
        `${supplementaryPath} should survive install --force`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
