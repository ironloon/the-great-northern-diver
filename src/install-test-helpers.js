import { access, symlink } from "node:fs/promises";

export function normalizePath(inputPath) {
  return inputPath.replaceAll("\\", "/");
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createDirectoryLink(targetPath, linkPath) {
  await symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}
