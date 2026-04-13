import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  describePathKind,
  ensureManagedPathWithinProjectRoot,
  ensureProjectRootCanBeCreated,
  getExistingPathKind,
  resolveManagedRoot,
  toProjectRelativePath
} from "./path-policy.js";

function isPermissionError(error) {
  return error && (error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS");
}

const moduleDir = import.meta.dirname;
const TEMPLATE_ROOT = path.resolve(moduleDir, "..", "templates", "workflow");
const packageJsonPath = path.resolve(moduleDir, "..", "package.json");

const INSTALL_DIR = ".github";
const ADAPTER_NAME = "vscode-github-copilot";

export async function readPackageVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw).version;
}

export const MANAGED_FILES = Object.freeze([
  "agents/gnd-diver.agent.md",
  "agents/gnd-navigator.agent.md",
  "skills/gnd-chart/SKILL.md",
  "skills/gnd-critique/SKILL.md"
]);

async function ensureRegularFileOrMissing(filePath, displayPath) {
  const kind = await getExistingPathKind(filePath);

  if (kind !== null && kind !== "file") {
    throw new Error(`Refusing to manage ${displayPath}. Managed file paths must be regular files, not ${describePathKind(kind)}.`);
  }
}

async function readTextIfExists(filePath, displayPath) {
  await ensureRegularFileOrMissing(filePath, displayPath);

  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }

    throw error;
  }
}

async function resolveInstallRoot(projectRoot) {
  await ensureProjectRootCanBeCreated(projectRoot);

  const installRoot = await resolveManagedRoot(projectRoot, INSTALL_DIR, "installDir");

  return {
    absolutePath: installRoot,
    contentPath: toProjectRelativePath(projectRoot, installRoot)
  };
}

function assertSafeFrontmatterValue(value, label) {
  if (typeof value !== "string" || /[\n\r"]/.test(value) || value.includes("---")) {
    throw new Error(`${label} contains characters unsafe for YAML frontmatter.`);
  }
}

function injectFrontmatterProvenance(content, version, adapterName) {
  assertSafeFrontmatterValue(version, "Package version");
  assertSafeFrontmatterValue(adapterName, "Adapter name");

  const provenanceLine = `gnd-version: "${version}"\ngnd-adapter: "${adapterName}"`;

  if (content.startsWith("---\n")) {
    return content.replace("---\n", `---\n${provenanceLine}\n`);
  }

  return `---\n${provenanceLine}\n---\n${content}`;
}

async function createInstallPlan(version) {
  const files = [];

  for (const relativePath of MANAGED_FILES) {
    const templatePath = path.join(TEMPLATE_ROOT, relativePath);
    let raw;

    try {
      raw = await readFile(templatePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new Error(`Missing template '${relativePath}'. The gnd-workflow package may be corrupted; try reinstalling.`);
      }

      throw error;
    }

    files.push({
      relativePath,
      content: injectFrontmatterProvenance(raw.replaceAll("\r\n", "\n"), version, ADAPTER_NAME)
    });
  }

  return files;
}

async function prepareManagedFileWrite(filePath, content, options) {
  const displayPath = toProjectRelativePath(options.projectRoot, filePath);

  await ensureManagedPathWithinProjectRoot(options.projectRoot, filePath, `Refusing to manage ${displayPath}. Managed files must stay within the project root.`);

  const existingContent = await readTextIfExists(filePath, displayPath);

  if (existingContent === content) {
    return { path: filePath, content, needsWrite: false };
  }

  if (existingContent !== null && !options.force) {
    const conflict = {
      action: "overwrite",
      relativePath: displayPath,
    };

    if (options.dryRun) {
      return { path: filePath, content, needsWrite: true, conflict };
    }

    throw new Error(`Refusing to overwrite ${displayPath}. Re-run with --force to replace it.`);
  }

  return { path: filePath, content, needsWrite: true };
}

export async function installWorkflow(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;

  const installRoot = await resolveInstallRoot(projectRoot);
  const packageVersion = await readPackageVersion();
  const plan = await createInstallPlan(packageVersion);
  const writeOptions = { projectRoot, dryRun, force };

  if (!dryRun) {
    await mkdir(projectRoot, { recursive: true });
  }

  const managedFiles = [];

  for (const entry of plan) {
    const filePath = path.join(installRoot.absolutePath, entry.relativePath);
    managedFiles.push(await prepareManagedFileWrite(filePath, entry.content, writeOptions));
  }

  if (!dryRun) {
    for (const entry of managedFiles) {
      if (!entry.needsWrite) continue;

      const dir = path.dirname(entry.path);

      try {
        await mkdir(dir, { recursive: true });
      } catch (cause) {
        const hint = isPermissionError(cause) ? " Check that you have write access to the project directory." : "";
        throw new Error(`Failed to create directory '${toProjectRelativePath(projectRoot, dir)}': ${cause?.message ?? cause}${hint}`);
      }

      try {
        await writeFile(entry.path, entry.content, "utf8");
      } catch (cause) {
        const hint = isPermissionError(cause) ? " Check that you have write access to the project directory." : "";
        throw new Error(`Failed to write '${toProjectRelativePath(projectRoot, entry.path)}': ${cause?.message ?? cause}${hint}`);
      }
    }
  }

  return {
    projectRoot,
    installDir: installRoot.contentPath,
    dryRun,
    managedFiles: managedFiles.map(({ path: filePath }) => filePath),
    conflicts: managedFiles.flatMap((entry) => entry.conflict ? [entry.conflict] : [])
  };
}
