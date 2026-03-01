import { getCacheFilePath, readJsonFile, writeJsonFile } from "./fs.js";
import type { CacheBundle, CachedDataset, DataKind } from "./types.js";

export class CacheStore {
  async read(kind: DataKind): Promise<CachedDataset<unknown> | undefined> {
    return readJsonFile<CachedDataset<unknown>>(getCacheFilePath(kind));
  }

  async write(kind: DataKind, dataset: CachedDataset<unknown>): Promise<void> {
    await writeJsonFile(getCacheFilePath(kind), dataset);
  }

  async readBundle(): Promise<CacheBundle> {
    const [cards, benefits, offers] = await Promise.all([
      this.read("cards"),
      this.read("benefits"),
      this.read("offers"),
    ]);

    return {
      cards: cards as CacheBundle["cards"],
      benefits: benefits as CacheBundle["benefits"],
      offers: offers as CacheBundle["offers"],
    };
  }
}
