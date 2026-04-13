import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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

const LOCK_FILENAME = ".gnd-install.lock";

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockPid(lockPath) {
  try {
    const content = await readFile(lockPath, "utf8");
    const match = content.match(/^pid: (\d+)/m);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function acquireInstallLock(dir) {
  const lockPath = path.join(dir, LOCK_FILENAME);

  try {
    await writeFile(lockPath, `version: 1\npid: ${process.pid}\nstarted: ${new Date().toISOString()}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const lockedPid = await readLockPid(lockPath);
      const staleHint = lockedPid !== null && !isProcessRunning(lockedPid)
        ? ` The lock was left by PID ${lockedPid}, which is no longer running; it is safe to remove.`
        : "";

      throw new Error(`Another install appears to be in progress. If this is stale, remove '${lockPath}' and retry.${staleHint}`);
    }

    throw error;
  }

  return lockPath;
}

async function releaseInstallLock(lockPath) {
  try {
    await unlink(lockPath);
  } catch {
    // Best-effort cleanup; the lock file is transient.
  }
}

const moduleDir = import.meta.dirname;
const TEMPLATE_ROOT = path.resolve(moduleDir, "..", "templates", "workflow");
const packageJsonPath = path.resolve(moduleDir, "..", "package.json");

export async function readPackageVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw).version;
}

export const ADAPTERS = Object.freeze({
  "vscode-github-copilot": { installDir: ".github" }
});

export const DEFAULT_ADAPTER = "vscode-github-copilot";

export const MANAGED_FILES = Object.freeze([
  "agents/gnd-diver.agent.md",
  "agents/gnd-navigator.agent.md",
  "skills/gnd-chart/SKILL.md",
  "skills/gnd-critique/SKILL.md"
]);

/**
 * @typedef {Object} ManagedFileConflict
 * @property {"overwrite"} action
 * @property {string} path
 * @property {string} relativePath
 * @property {string} existingContent
 * @property {string} nextContent
 */

/**
 * @callback ConfirmManagedFileConflict
 * @param {ManagedFileConflict} conflict
 * @returns {boolean|Promise<boolean>}
 */

/**
 * @typedef {Object} InstallOptions
 * @property {string} [projectRoot]
 * @property {boolean} [dryRun]
 * @property {boolean} [force]
 * @property {ConfirmManagedFileConflict} [confirmManagedFileConflict]
 */

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
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function resolveInstallRoot(projectRoot, installDir) {
  await ensureProjectRootCanBeCreated(projectRoot);

  const installRoot = await resolveManagedRoot(projectRoot, installDir, "installDir");

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

async function createInstallPlan(version, adapterName) {
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
      content: injectFrontmatterProvenance(raw.replaceAll("\r\n", "\n"), version, adapterName)
    });
  }

  return files;
}

async function prepareManagedFileWrite(filePath, content, options) {
  const displayPath = toProjectRelativePath(options.projectRoot, filePath);

  await ensureManagedPathWithinProjectRoot(options.projectRoot, filePath, `Refusing to manage ${displayPath}. Managed files must stay within the project root.`);

  const existingContent = await readTextIfExists(filePath, displayPath);

  if (existingContent === content) {
    return { path: filePath, status: "unchanged", content };
  }

  if (existingContent !== null && !options.force) {
    const conflict = {
      action: "overwrite",
      path: filePath,
      relativePath: displayPath,
      existingContent,
      nextContent: content
    };

    if (options.dryRun) {
      return {
        path: filePath,
        status: "updated",
        content,
        conflict
      };
    }

    const confirmed = typeof options.confirmManagedFileConflict === "function"
      ? (await options.confirmManagedFileConflict(conflict)) === true
      : false;

    if (!confirmed) {
      if (typeof options.confirmManagedFileConflict === "function") {
        throw new Error(`Install canceled after declining to overwrite ${displayPath}. No files were changed.`);
      }

      throw new Error(`Refusing to overwrite ${displayPath}. Re-run with --force to replace it.`);
    }
  }

  return {
    path: filePath,
    status: existingContent === null ? "created" : "updated",
    content,
    ...(existingContent !== null ? { previousContent: existingContent } : {})
  };
}

export async function installWorkflow(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const adapterName = options.adapter ?? DEFAULT_ADAPTER;
  const adapter = ADAPTERS[adapterName];

  if (!adapter) {
    throw new Error(`Unknown adapter '${adapterName}'. Available adapters: ${Object.keys(ADAPTERS).join(", ")}`);
  }

  const installRoot = await resolveInstallRoot(projectRoot, adapter.installDir);
  const packageVersion = await readPackageVersion();
  const plan = await createInstallPlan(packageVersion, adapterName);
  const writeOptions = {
    projectRoot,
    dryRun,
    force,
    confirmManagedFileConflict: options.confirmManagedFileConflict
  };

  if (!dryRun) {
    await mkdir(projectRoot, { recursive: true });
  }

  let lockPath = null;

  try {
    if (!dryRun) {
      lockPath = await acquireInstallLock(projectRoot);
    }

    const managedFiles = [];

    for (const entry of plan) {
      const filePath = path.join(installRoot.absolutePath, entry.relativePath);
      managedFiles.push(await prepareManagedFileWrite(filePath, entry.content, writeOptions));
    }

    if (!dryRun) {
      const writtenEntries = [];

      try {
        for (const entry of managedFiles) {
          if (entry.status !== "unchanged") {
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

            writtenEntries.push(entry);
          }
        }
      } catch (writeError) {
        const rollbackErrors = [];

        for (const written of writtenEntries) {
          try {
            if (written.status === "created") {
              await unlink(written.path);
            } else if (written.previousContent !== undefined) {
              await writeFile(written.path, written.previousContent, "utf8");
            }
          } catch (rollbackError) {
            rollbackErrors.push({ path: written.path, status: written.status, cause: rollbackError });
          }
        }

        writeError.rollbackIncomplete = rollbackErrors.length > 0;

        if (rollbackErrors.length > 0) {
          const unremoved = rollbackErrors
            .filter((e) => e.status === "created")
            .map((e) => toProjectRelativePath(projectRoot, e.path));
          const unrestored = rollbackErrors
            .filter((e) => e.status !== "created")
            .map((e) => toProjectRelativePath(projectRoot, e.path));
          const parts = [];
          if (unremoved.length > 0) parts.push(`could not remove newly created: ${unremoved.join(", ")}`);
          if (unrestored.length > 0) parts.push(`could not restore previous content: ${unrestored.join(", ")}`);
          writeError.message += ` Rollback incomplete -- ${parts.join("; ")}.`;
        }

        throw writeError;
      }
    }

    return {
      projectRoot,
      installDir: installRoot.contentPath,
      adapter: adapterName,
      dryRun,
      managedFiles: managedFiles.map(({ path: filePath, status }) => ({ path: filePath, status })),
      conflicts: managedFiles.flatMap((entry) => entry.conflict ? [entry.conflict] : [])
    };
  } finally {
    if (lockPath !== null) {
      await releaseInstallLock(lockPath);
    }
  }
}
