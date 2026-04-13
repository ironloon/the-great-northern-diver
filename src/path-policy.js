import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

export function normalizePathForContent(inputPath) {
  return inputPath.replaceAll("\\", "/");
}

function isWithinProjectRoot(projectRoot, candidatePath) {
  const relativePath = path.relative(projectRoot, candidatePath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function getPathKindFromStats(stats) {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }

  if (stats.isDirectory()) {
    return "directory";
  }

  if (stats.isFile()) {
    return "file";
  }

  return "other";
}

export function describePathKind(kind) {
  if (kind === "file") {
    return "a file";
  }

  if (kind === "symlink") {
    return "a symlink or junction";
  }

  if (kind === "directory") {
    return "a directory";
  }

  return "a special filesystem entry";
}

async function tryLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }

    throw error;
  }
}

async function tryRealpath(filePath) {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function hasSymbolicLinkAncestor(filePath) {
  let currentPath = path.resolve(filePath);

  while (true) {
    const stats = await tryLstat(currentPath);

    if (stats !== null && stats.isSymbolicLink()) {
      return true;
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return false;
    }

    currentPath = parentPath;
  }
}

export async function getExistingPathKind(filePath) {
  const stats = await tryLstat(filePath);

  return stats === null ? null : getPathKindFromStats(stats);
}

async function findNearestExistingAncestor(filePath) {
  let currentPath = filePath;

  while (true) {
    const stats = await tryLstat(currentPath);

    if (stats !== null) {
      return {
        path: currentPath,
        realpath: await realpath(currentPath),
        kind: getPathKindFromStats(stats)
      };
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

export async function ensureManagedPathWithinProjectRoot(projectRoot, candidatePath, errorMessage) {
  if (!isWithinProjectRoot(projectRoot, candidatePath)) {
    throw new Error(errorMessage);
  }

  const realProjectRoot = await tryRealpath(projectRoot);

  if (realProjectRoot === null) {
    return;
  }

  const nearestExistingAncestor = await findNearestExistingAncestor(candidatePath);

  if (nearestExistingAncestor !== null) {
    if (nearestExistingAncestor.path !== candidatePath && nearestExistingAncestor.kind === "symlink") {
      throw new Error(errorMessage);
    }

    if (!isWithinProjectRoot(realProjectRoot, nearestExistingAncestor.realpath)) {
      throw new Error(errorMessage);
    }
  }
}

export async function ensureProjectRootCanBeCreated(projectRoot) {
  const projectRootKind = await getExistingPathKind(projectRoot);

  if (projectRootKind !== null) {
    if (projectRootKind === "symlink") {
      throw new Error(`Project root '${projectRoot}' cannot be a symlinked or junctioned directory. Use its real path.`);
    }

    if (projectRootKind !== "directory") {
      throw new Error(`Project root '${projectRoot}' must be a directory, not ${describePathKind(projectRootKind)}.`);
    }

    if (await hasSymbolicLinkAncestor(projectRoot)) {
      throw new Error(`Project root '${projectRoot}' cannot be a symlinked or junctioned directory. Use its real path.`);
    }

    return;
  }

  const nearestExistingAncestor = await findNearestExistingAncestor(projectRoot);

  if (nearestExistingAncestor !== null && await hasSymbolicLinkAncestor(nearestExistingAncestor.path)) {
    throw new Error(`Project root '${projectRoot}' cannot be created through a symlinked or junctioned ancestor. Create the directory first or use its real path.`);
  }
}

export async function resolveManagedRoot(projectRoot, requestedPath, label) {
  const managedRoot = path.resolve(projectRoot, requestedPath);

  await ensureManagedPathWithinProjectRoot(projectRoot, managedRoot, `${label} path '${requestedPath}' must stay within the project root.`);

  const managedRootKind = await getExistingPathKind(managedRoot);

  if (managedRootKind === "symlink") {
    throw new Error(`${label} path '${requestedPath}' cannot be a symlinked or junctioned directory. Use a real directory within the project root.`);
  }

  if (managedRootKind !== null && managedRootKind !== "directory") {
    throw new Error(`${label} path '${requestedPath}' must point to a directory within the project root.`);
  }

  return managedRoot;
}

export function toProjectRelativePath(projectRoot, targetPath) {
  return normalizePathForContent(path.relative(projectRoot, targetPath) || ".");
}