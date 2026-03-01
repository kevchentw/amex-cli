import { CliError } from "./errors.js";
import type { Credentials } from "./types.js";

const SERVICE_NAME = "amex-cli";
const ACCOUNT_NAME = "primary";

export interface CredentialStore {
  get(): Promise<Credentials | undefined>;
  set(credentials: Credentials): Promise<void>;
  clear(): Promise<void>;
}

type KeytarModule = typeof import("keytar");
type KeytarApi = Pick<KeytarModule, "getPassword"> & {
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

async function loadKeytar(): Promise<KeytarApi> {
  try {
    const imported = await import("keytar");
    return (imported.default ?? imported) as KeytarApi;
  } catch (error) {
    throw new CliError(
      `Unable to load secure credential storage via keytar. Install its native prerequisites or replace the credential provider. ${String(error)}`,
    );
  }
}

export class KeytarCredentialStore implements CredentialStore {
  async get(): Promise<Credentials | undefined> {
    try {
      const keytar = await loadKeytar();
      const payload = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (!payload) {
        return undefined;
      }

      return JSON.parse(payload) as Credentials;
    } catch (error) {
      throw new CliError(`Unable to read credentials from the system credential manager. ${String(error)}`);
    }
  }

  async set(credentials: Credentials): Promise<void> {
    try {
      const keytar = await loadKeytar();
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(credentials));
    } catch (error) {
      throw new CliError(`Unable to store credentials in the system credential manager. ${String(error)}`);
    }
  }

  async clear(): Promise<void> {
    try {
      const keytar = await loadKeytar();
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch (error) {
      throw new CliError(`Unable to clear credentials from the system credential manager. ${String(error)}`);
    }
  }
}
