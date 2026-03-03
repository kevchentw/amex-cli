import http from "node:http";
import { spawn } from "node:child_process";
import { CliError } from "./errors.js";
import { PatchrightAmexAuthenticator, disposeRuntimeSession } from "./auth.js";
import { CacheStore } from "./cache.js";
import { KeytarCredentialStore } from "./credentials.js";
import { HttpAmexApiClient } from "./api.js";
import { renderWebAppHtml } from "./web-ui.js";
import type { AuthSession, CliOptions, Credentials, Offer } from "./types.js";

const cacheStore = new CacheStore();
const credentialStore = new KeytarCredentialStore();
const authenticator = new PatchrightAmexAuthenticator();
const apiClient = new HttpAmexApiClient();
const DEFAULT_PORT = 43110;

let liveSession: AuthSession | undefined;

export async function startWebServer(options: CliOptions): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, renderWebAppHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bundle") {
        sendJson(res, 200, { bundle: await cacheStore.readBundle() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sync") {
        const credentials = await requireCredentials();
        const session = await getWebSession(credentials);
        const results = await runSyncWithSession(session);
        sendJson(res, 200, {
          message: `Synced cards, benefits, offers with ${sessionStatusLabel(session)}.`,
          results,
          bundle: await cacheStore.readBundle(),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/enroll/offer") {
        const body = await readJsonBody(req);
        const offers = await requireCachedOffers();
        const requestInput: {
          offerId?: string;
          offerSourceId?: string;
          cardLast4s: string[];
          allCards: boolean;
        } = {
          cardLast4s: readStringArray(body.cardLast4s),
          allCards: body.allCards === true,
        };
        const offerId = asString(body.offerId);
        const offerSourceId = asString(body.sourceId);
        if (offerId) {
          requestInput.offerId = offerId;
        }
        if (offerSourceId) {
          requestInput.offerSourceId = offerSourceId;
        }
        const targets = resolveOfferEnrollmentTargets(offers, requestInput);
        const credentials = await requireCredentials();
        const session = await getWebSession(credentials);
        const results = await apiClient.enrollOffers(session, targets);
        const offersDataset = await apiClient.syncOffers(session);
        await cacheStore.write("offers", offersDataset);
        sendJson(res, 200, {
          message: formatOfferEnrollmentSummary(results, session),
          results,
          bundle: await cacheStore.readBundle(),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/enroll/all-offers") {
        const body = await readJsonBody(req);
        const offers = await requireCachedOffers();
        const targets = resolveAllOfferEnrollmentTargets(offers, {
          cardLast4s: readStringArray(body.cardLast4s),
        });
        const credentials = await requireCredentials();
        const session = await getWebSession(credentials);
        const results = await apiClient.enrollOffers(session, targets);
        const offersDataset = await apiClient.syncOffers(session);
        await cacheStore.write("offers", offersDataset);
        sendJson(res, 200, {
          message: formatBulkEnrollmentSummary(results, session),
          results,
          bundle: await cacheStore.readBundle(),
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof CliError ? error.exitCode === 1 ? 400 : 500 : 500;
      sendJson(res, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  openBrowser(url);
  process.stdout.write(`Amex Tools web UI running at ${url}\n`);
  process.stdout.write("Opened your default browser.\n");
  process.stdout.write("Press Ctrl+C to stop the server.\n");

  const shutdown = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (liveSession) {
      await disposeRuntimeSession(liveSession);
      liveSession = undefined;
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  const child = spawn(command[0]!, command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function getWebSession(credentials: Credentials): Promise<AuthSession> {
  if (liveSession) {
    try {
      await apiClient.syncCards(liveSession);
      liveSession.metadata = {
        ...(liveSession.metadata ?? {}),
        sessionStatus: "reused-live",
      };
      return liveSession;
    } catch (error) {
      await disposeRuntimeSession(liveSession);
      liveSession = undefined;
      if (!isReusableSessionError(error)) {
        throw error;
      }
    }
  }

  let restored: AuthSession | undefined;
  try {
    restored = await authenticator.restore({ debug: false, quiet: true });
    await apiClient.syncCards(restored);
    restored.metadata = {
      ...(restored.metadata ?? {}),
      sessionStatus: "reused",
    };
    liveSession = restored;
    return restored;
  } catch (error) {
    if (restored) {
      await disposeRuntimeSession(restored);
    }
    if (!isReusableSessionError(error)) {
      throw error;
    }
  }

  const fresh = await authenticator.login(credentials, { debug: false, quiet: true });
  await apiClient.syncCards(fresh);
  fresh.metadata = {
    ...(fresh.metadata ?? {}),
    sessionStatus: "fresh",
  };
  liveSession = fresh;
  return fresh;
}

async function runSyncWithSession(session: AuthSession) {
  const [cards, benefits, offers] = await Promise.all([
    apiClient.syncCards(session),
    apiClient.syncBenefits(session),
    apiClient.syncOffers(session),
  ]);
  await Promise.all([
    cacheStore.write("cards", cards),
    cacheStore.write("benefits", benefits),
    cacheStore.write("offers", offers),
  ]);
  return {
    cards: cards.items.length,
    benefits: benefits.items.length,
    offers: offers.items.length,
  };
}

async function requireCredentials(): Promise<Credentials> {
  const credentials = await credentialStore.get();
  if (!credentials) {
    throw new CliError("Credentials are not configured. Run `amex auth set` first.");
  }
  return credentials;
}

async function requireCachedOffers(): Promise<Offer[]> {
  const dataset = await cacheStore.read("offers");
  if (!dataset) {
    throw new CliError("No cached offers found. Run sync first.");
  }
  return dataset.items as Offer[];
}

function resolveOfferEnrollmentTargets(
  offers: Offer[],
  input: {
    offerId?: string;
    offerSourceId?: string;
    cardLast4s: string[];
    allCards: boolean;
  },
) {
  if (!input.offerId && !input.offerSourceId) {
    throw new CliError("Expected offerId or sourceId.");
  }

  const matching = offers.filter((offer) =>
    input.offerId ? offer.id === input.offerId : asString(offer.metadata?.sourceId) === input.offerSourceId,
  );
  if (matching.length === 0) {
    throw new CliError("No cached offer matched the requested id.");
  }

  const candidates = matching.filter((offer) => normalizeOfferStatus(offer) !== "ENROLLED");
  if (candidates.length === 0) {
    throw new CliError("That offer is already enrolled on every cached card.");
  }

  if (input.allCards) {
    return candidates.map(toOfferEnrollmentTarget);
  }

  if (input.cardLast4s.length > 0) {
    const requested = new Set(input.cardLast4s);
    const selected = candidates.filter((offer) => requested.has(asString(offer.metadata?.last4) ?? ""));
    if (selected.length === 0) {
      throw new CliError("That offer is not eligible on the selected cards.");
    }
    return selected.map(toOfferEnrollmentTarget);
  }

  if (candidates.length === 1) {
    return candidates.map(toOfferEnrollmentTarget);
  }

  throw new CliError("Offer is available on multiple cards. Select cards or use allCards.");
}

function resolveAllOfferEnrollmentTargets(
  offers: Offer[],
  input: {
    cardLast4s: string[];
  },
) {
  const candidates = offers.filter((offer) => normalizeOfferStatus(offer) === "ELIGIBLE");
  if (candidates.length === 0) {
    throw new CliError("No eligible cached offers were found.");
  }

  if (input.cardLast4s.length === 0) {
    return candidates.map(toOfferEnrollmentTarget);
  }

  const requested = new Set(input.cardLast4s);
  const selected = candidates.filter((offer) => requested.has(asString(offer.metadata?.last4) ?? ""));
  if (selected.length === 0) {
    throw new CliError("No eligible cached offers were found for those cards.");
  }
  return selected.map(toOfferEnrollmentTarget);
}

function toOfferEnrollmentTarget(offer: Offer) {
  const target = {
    offerId: offer.id,
    accountNumberProxy: offer.cardId,
    locale: asString(offer.metadata?.locale) ?? "en-US",
  };
  const last4 = asString(offer.metadata?.last4);
  const cardName = asString(offer.metadata?.cardName);
  return {
    ...target,
    ...(last4 ? { last4 } : {}),
    ...(cardName ? { cardName } : {}),
  };
}

function normalizeOfferStatus(offer: Offer): string {
  return asString(offer.metadata?.status)?.toUpperCase() ?? "UNKNOWN";
}

function sessionStatusLabel(session: AuthSession): string {
  switch (asString(session.metadata?.sessionStatus)) {
    case "reused-live":
      return "an active browser session";
    case "reused":
      return "a saved browser session";
    case "fresh":
      return "a fresh browser login";
    default:
      return "browser authentication";
  }
}

function formatOfferEnrollmentSummary(results: Array<{ statusPurpose: string }>, session: AuthSession): string {
  const succeeded = results.filter((result) => result.statusPurpose.toUpperCase() === "SUCCESS").length;
  const failed = results.length - succeeded;
  return `Offer enrollment finished with ${succeeded} succeeded and ${failed} failed using ${sessionStatusLabel(session)}.`;
}

function formatBulkEnrollmentSummary(
  results: Array<{ statusPurpose: string; offerId: string }>,
  session: AuthSession,
): string {
  const succeeded = results.filter((result) => result.statusPurpose.toUpperCase() === "SUCCESS").length;
  const failed = results.length - succeeded;
  const offers = new Set(results.map((result) => result.offerId)).size;
  return `Processed ${offers} offer(s) with ${succeeded} succeeded and ${failed} failed using ${sessionStatusLabel(session)}.`;
}

function isReusableSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("expired_session") ||
    message.includes("cupcake session expired") ||
    message.includes("401") ||
    message.includes("saved browser profile is not currently authenticated")
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new CliError(`Request body was not valid JSON. ${String(error)}`);
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
