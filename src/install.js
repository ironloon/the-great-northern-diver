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

const moduleDir = import.meta.dirname;
const TEMPLATE_ROOT = path.resolve(moduleDir, "..", "templates", "workflow");
const packageJsonPath = path.resolve(moduleDir, "..", "package.json");

export async function readPackageVersion() {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw).version;
}

export const DEFAULT_INSTALL_DIR = ".agents";

export const VERSION_FILE = ".gnd-version.json";

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

async function resolveInstallRoot(projectRoot) {
  await ensureProjectRootCanBeCreated(projectRoot);

  const installRoot = await resolveManagedRoot(projectRoot, DEFAULT_INSTALL_DIR, "installDir");

  return {
    absolutePath: installRoot,
    contentPath: toProjectRelativePath(projectRoot, installRoot)
  };
}

async function createInstallPlan() {
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
      content: raw.replaceAll("\r\n", "\n")
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

  const installRoot = await resolveInstallRoot(projectRoot);
  const plan = await createInstallPlan();
  const writeOptions = {
    projectRoot,
    dryRun,
    force,
    confirmManagedFileConflict: options.confirmManagedFileConflict
  };

  const managedFiles = [];

  for (const entry of plan) {
    const filePath = path.join(installRoot.absolutePath, entry.relativePath);
    managedFiles.push(await prepareManagedFileWrite(filePath, entry.content, writeOptions));
  }

  const packageVersion = await readPackageVersion();
  const versionFilePath = path.join(installRoot.absolutePath, VERSION_FILE);
  const versionDisplayPath = toProjectRelativePath(projectRoot, versionFilePath);
  const versionContent = JSON.stringify({ installedFrom: packageVersion }, null, 2) + "\n";
  const existingVersionContent = await readTextIfExists(versionFilePath, versionDisplayPath);

  managedFiles.push({
    path: versionFilePath,
    status: existingVersionContent === versionContent ? "unchanged"
      : existingVersionContent === null ? "created" : "updated",
    content: versionContent,
    ...(existingVersionContent !== null && existingVersionContent !== versionContent
      ? { previousContent: existingVersionContent } : {})
  });

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
        writeError.message += ` Rollback incomplete \u2014 ${parts.join("; ")}.`;
      }

      throw writeError;
    }
  }

  return {
    projectRoot,
    installDir: installRoot.contentPath,
    dryRun,
    managedFiles: managedFiles.map(({ path: filePath, status }) => ({ path: filePath, status })),
    conflicts: managedFiles.flatMap((entry) => entry.conflict ? [entry.conflict] : [])
  };
}
