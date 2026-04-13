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

export async function getExistingPathKind(filePath) {
  const stats = await tryLstat(filePath);

  return stats === null ? null : getPathKindFromStats(stats);
}

export async function ensureManagedPathWithinProjectRoot(projectRoot, candidatePath, errorMessage) {
  if (!isWithinProjectRoot(projectRoot, candidatePath)) {
    throw new Error(errorMessage);
  }

  const realProjectRoot = await tryRealpath(projectRoot);

  if (realProjectRoot === null) {
    return;
  }

  const candidateKind = await getExistingPathKind(candidatePath);

  if (candidateKind === "symlink") {
    throw new Error(errorMessage);
  }

  if (candidateKind !== null) {
    const realCandidate = await tryRealpath(candidatePath);

    if (realCandidate !== null && !isWithinProjectRoot(realProjectRoot, realCandidate)) {
      throw new Error(errorMessage);
    }

    return;
  }

  // Candidate doesn't exist yet — walk up to find the nearest existing ancestor
  // and verify it resolves within the project root.
  let current = candidatePath;

  while (true) {
    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;

    const parentKind = await getExistingPathKind(current);

    if (parentKind === "symlink") {
      throw new Error(errorMessage);
    }

    if (parentKind !== null) {
      const realParent = await tryRealpath(current);

      if (realParent !== null && !isWithinProjectRoot(realProjectRoot, realParent)) {
        throw new Error(errorMessage);
      }

      break;
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

    // Verify realpath resolves to the same location (catches symlink ancestors
    // and Windows 8.3 short-path spellings are tolerated since both resolve
    // to the same realpath).
    const realProjectRoot = await realpath(projectRoot);
    const resolvedProjectRoot = await realpath(path.resolve(projectRoot));

    if (realProjectRoot !== resolvedProjectRoot) {
      throw new Error(`Project root '${projectRoot}' cannot be a symlinked or junctioned directory. Use its real path.`);
    }

    return;
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