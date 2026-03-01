import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const APP_DIR_NAME = "amex-cli";

export function getAppHome(): string {
  const configured = process.env.AMEX_CLI_HOME;
  if (configured) {
    return configured;
  }

  return path.join(os.homedir(), `.${APP_DIR_NAME}`);
}

export function getCacheDir(): string {
  return path.join(getAppHome(), "cache");
}

export function getBrowserProfileDir(): string {
  return path.join(getAppHome(), "browser-profile");
}

export function getCacheFilePath(kind: string): string {
  return path.join(getCacheDir(), `${kind}.json`);
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}
