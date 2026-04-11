import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath ?? null;
const workspaceRoot = import.meta.dirname;

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, cwd) {
  const env = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false"
  };

  delete env.npm_config_dry_run;

  return execFileAsync(command, args, {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
}

async function runNpmCommand(args, cwd) {
  if (npmCliPath) {
    return runCommand(process.execPath, [npmCliPath, ...args], cwd);
  }

  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/c", npmCommand, ...args], cwd);
  }

  return runCommand(npmCommand, args, cwd);
}

async function runInstalledCli(binPath, args, cwd) {
  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/c", binPath, ...args], cwd);
  }

  return runCommand(binPath, args, cwd);
}

test("packed tarball installs and exposes the intended CLI and library surface", { timeout: 120000 }, async (t) => {
  const packRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-pack-"));
  const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "gnd-consumer-"));

  try {
    const { stdout: packStdout } = await runNpmCommand(["pack", "--json", "--pack-destination", packRoot], workspaceRoot);
    const packResult = JSON.parse(packStdout);
    const tarballPath = path.join(packRoot, packResult[0].filename);

    await writeFile(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify({
        name: "gnd-workflow-consumer",
        private: true,
        type: "module"
      }, null, 2)}\n`,
      "utf8"
    );

    await runNpmCommand(["install", "--no-package-lock", tarballPath], consumerRoot);

    const installedPackageRoot = path.join(consumerRoot, "node_modules", "gnd-workflow");
    const installedCliPath = process.platform === "win32"
      ? path.join(consumerRoot, "node_modules", ".bin", "gnd-workflow.cmd")
      : path.join(consumerRoot, "node_modules", ".bin", "gnd-workflow");

    await t.test("tarball contains expected template files", async () => {
      assert.equal(await fileExists(tarballPath), true);
      assert.equal(await fileExists(path.join(installedPackageRoot, "templates", "workflow", "agents", "gnd-diver.agent.md")), true);
      assert.equal(await fileExists(path.join(installedPackageRoot, "templates", "workflow", "skills", "gnd-critique", "SKILL.md")), true);
      assert.equal(await fileExists(installedCliPath), true);
    });

    await t.test("CLI help output describes the workflow", async () => {
      const { stdout: helpStdout } = await runInstalledCli(installedCliPath, ["help"], consumerRoot);

      assert.match(helpStdout, /Writes managed agent files into \.agents/);
    });

    await t.test("CLI install --version works from the install command position", async () => {
      const pkg = JSON.parse(await readFile(path.join(installedPackageRoot, "package.json"), "utf8"));
      const { stdout: versionStdout } = await runInstalledCli(installedCliPath, ["install", "--version"], consumerRoot);

      assert.equal(versionStdout.trim(), pkg.version);
    });

    await t.test("library exports install surface", async () => {
      const libraryScript = [
        'import path from "node:path";',
        'import { access } from "node:fs/promises";',
      'import { DEFAULT_INSTALL_DIR, MANAGED_FILES, VERSION_FILE, installWorkflow } from "gnd-workflow";',
      'const projectRoot = path.join(process.cwd(), "tarball-project");',
      'const result = await installWorkflow({ projectRoot });',
      'await access(path.join(projectRoot, DEFAULT_INSTALL_DIR, MANAGED_FILES[0]));',
      'await access(path.join(projectRoot, DEFAULT_INSTALL_DIR, VERSION_FILE));',
        'console.log(JSON.stringify({ installDir: result.installDir, managedCount: MANAGED_FILES.length }));'
      ].join(" ");

      const { stdout: libraryStdout } = await runCommand(process.execPath, ["--input-type=module", "-e", libraryScript], consumerRoot);
      const libraryResult = JSON.parse(libraryStdout.trim());

      assert.equal(libraryResult.installDir, ".agents");
      assert.equal(libraryResult.managedCount, 4);
    });
  } finally {
    await rm(packRoot, { recursive: true, force: true });
    await rm(consumerRoot, { recursive: true, force: true });
  }
});
