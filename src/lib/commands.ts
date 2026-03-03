import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { HttpAmexApiClient } from "./api.js";
import { createAuthInkReporter, promptForCredentialsInk } from "./auth-ink.js";
import { PatchrightAmexAuthenticator, disposeRuntimeSession } from "./auth.js";
import { runInteractiveAppView } from "./app-ink.js";
import { CacheStore } from "./cache.js";
import { KeytarCredentialStore } from "./credentials.js";
import { CliError } from "./errors.js";
import { colorize, printJson, printText } from "./output.js";
import { startWebServer } from "./web-server.js";
import type {
  AuthSession,
  Benefit,
  CardSummary,
  CliOptions,
  Credentials,
  DataKind,
  Offer,
  OfferEnrollmentResult,
  OfferEnrollmentTarget,
} from "./types.js";

const cacheStore = new CacheStore();
const credentialStore = new KeytarCredentialStore();
const authenticator = new PatchrightAmexAuthenticator();
const apiClient = new HttpAmexApiClient();
const ALL_KINDS: DataKind[] = ["cards", "benefits", "offers"];
const DEFAULT_CLI_OPTIONS: CliOptions = {
  json: false,
  debug: false,
  includeCanceled: false,
  forceLogin: false,
  port: undefined,
  offerStatus: undefined,
  offerCard: undefined,
  offerCards: [],
  offerId: undefined,
  offerSourceId: undefined,
  enrollAllCards: false,
  authUsername: undefined,
  authPassword: undefined,
};

export async function handleSync(options: CliOptions): Promise<void> {
  const credentials = await requireCredentials();
  const session = await getSessionForSync(credentials, options, { forceLogin: options.forceLogin });
  try {
    const results = await runSyncWithSession(session);
    renderSyncResults(results, options);
  } finally {
    await disposeRuntimeSession(session);
  }
}

export async function handleEnrollOffer(options: CliOptions): Promise<void> {
  if (!options.offerId && !options.offerSourceId) {
    throw new CliError("Expected --offer-id or --source-id for `amex enroll offer`.");
  }

  const offers = await requireCachedOffers();
  const targets = resolveOfferEnrollmentTargets(offers, options);
  const credentials = await requireCredentials();
  const session = await getSessionForSync(credentials, { ...options, forceLogin: true }, { forceLogin: true });

  try {
    const results = await apiClient.enrollOffers(session, targets);
    const offersDataset = await apiClient.syncOffers(session);
    await cacheStore.write("offers", offersDataset);
    renderOfferEnrollmentResults(results, options);
  } finally {
    await disposeRuntimeSession(session);
  }
}

export async function handleEnrollAllOffers(options: CliOptions): Promise<void> {
  const offers = await requireCachedOffers();
  const targets = resolveAllOfferEnrollmentTargets(offers, options);
  const credentials = await requireCredentials();
  const session = await getSessionForSync(credentials, { ...options, forceLogin: true }, { forceLogin: true });

  try {
    const results = await apiClient.enrollOffers(session, targets);
    const offersDataset = await apiClient.syncOffers(session);
    await cacheStore.write("offers", offersDataset);
    renderBulkOfferEnrollmentResults(results, options);
  } finally {
    await disposeRuntimeSession(session);
  }
}

export async function handleShow(target: DataKind | "all", options: CliOptions): Promise<void> {
  const kinds = expandTarget(target);
  let entries = await readCacheEntries(kinds);
  const missing = getMissingKinds(entries);
  if (missing.length > 0) {
    const shouldSync = await promptToSyncMissingCache(missing, options);
    if (!shouldSync) {
      throw new CliError(`No cached data for ${missing.join(", ")}.`);
    }

    await handleSync(options);
    entries = await readCacheEntries(kinds);
  }

  const payload = Object.fromEntries(entries);
  if (options.json) {
    printJson(payload);
    return;
  }

  if (target === "cards") {
    const cards = entries[0]?.[1]?.items as CardSummary[] | undefined;
    if (!cards) {
      throw new CliError("No cached data for cards. Run sync first.");
    }

    const syncedAt = entries[0]?.[1]?.syncedAt;
    printText(formatCardsOverview(cards, syncedAt, options));
    return;
  }

  if (target === "benefits") {
    const benefits = entries[0]?.[1]?.items as Benefit[] | undefined;
    if (!benefits) {
      throw new CliError("No cached data for benefits. Run sync first.");
    }

    const syncedAt = entries[0]?.[1]?.syncedAt;
    printText(formatBenefitsOverview(benefits, syncedAt));
    return;
  }

  if (target === "offers") {
    const offers = entries[0]?.[1]?.items as Offer[] | undefined;
    if (!offers) {
      throw new CliError("No cached data for offers. Run sync first.");
    }

    const syncedAt = entries[0]?.[1]?.syncedAt;
    printText(formatOffersOverview(offers, syncedAt, options));
    return;
  }

  const cards = entries.find(([kind]) => kind === "cards")?.[1];
  const benefits = entries.find(([kind]) => kind === "benefits")?.[1];
  const offers = entries.find(([kind]) => kind === "offers")?.[1];

  printText([
    ...formatCardsOverview((cards?.items ?? []) as CardSummary[], cards?.syncedAt, options),
    "",
    ...formatBenefitsOverview((benefits?.items ?? []) as Benefit[], benefits?.syncedAt),
    "",
    ...formatOffersOverview((offers?.items ?? []) as Offer[], offers?.syncedAt, options),
  ]);
}

export async function handleInteractive(): Promise<void> {
  let bundle = await cacheStore.readBundle();
  if (!bundle.cards || !bundle.benefits || !bundle.offers) {
    const missing = [
      !bundle.cards ? "cards" : undefined,
      !bundle.benefits ? "benefits" : undefined,
      !bundle.offers ? "offers" : undefined,
    ].filter(Boolean) as DataKind[];
    const shouldSync = await promptToSyncMissingCache(missing, DEFAULT_CLI_OPTIONS);
    if (!shouldSync) {
      throw new CliError(`No cached data for ${missing.join(", ")}.`);
    }

    await handleSync(DEFAULT_CLI_OPTIONS);
    bundle = await cacheStore.readBundle();
  }

  if (!bundle.cards || !bundle.benefits || !bundle.offers) {
    const missing = [
      !bundle.cards ? "cards" : undefined,
      !bundle.benefits ? "benefits" : undefined,
      !bundle.offers ? "offers" : undefined,
    ].filter(Boolean);
    throw new CliError(`No cached data for ${missing.join(", ")}.`);
  }

  const cards = (bundle.cards.items as CardSummary[]).map((card) => {
    const metadata = card.metadata ?? {};
    const primary = {
      id: card.id,
      name: card.name,
      last4: card.last4 ?? "N/A",
      status: card.status ?? "Unknown",
      member: readMemberName(card, metadata) ?? "Unknown",
      kind: readCardKind(card, metadata) ?? card.name,
      relationship: asString(metadata.relationship) ?? "BASIC",
      createdAt: formatShortDate(asString(metadata.accountSetupDate)) ?? "N/A",
      balance: "N/A",
      parentLast4: undefined,
    };

    const supplementaryAccounts = Array.isArray(metadata.supplementaryAccounts)
      ? (metadata.supplementaryAccounts as Array<Record<string, unknown>>)
      : [];

    const supplementary = supplementaryAccounts.map((account) => ({
      id: asString(account.id) ?? crypto.randomUUID(),
      name: asString(account.name) ?? "Supplementary Card",
      last4: asString(account.last4) ?? "N/A",
      status: readSupplementaryStatus(account) ?? "Unknown",
      member: readSupplementaryMemberName(account) ?? "Unknown",
      kind: asString(account.name) ?? "Supplementary Card",
      relationship: "SUPP",
      createdAt: formatShortDate(asString(metadata.accountSetupDate)) ?? "N/A",
      balance: "N/A",
      parentLast4: card.last4,
    }));

    return [primary, ...supplementary];
  }).flat();

  const benefitRows = (bundle.benefits.items as Benefit[]).map((benefit) => buildBenefitTableRow(benefit));
  const benefitGroups = groupBenefitRows(benefitRows).map((group) => ({
    title: group.title,
    trackerDuration: group.trackerDuration,
    period: group.period,
    rows: group.rows.map((row) => ({
      last4: row.last4,
      cardName: row.cardName,
      displayStatus: row.displayStatus,
      progress: row.progress,
    })),
  }));
  const offers = (bundle.offers.items as Offer[]).map((offer) => ({
    id: offer.id,
    cardId: offer.cardId,
    title: offer.title,
    last4: asString(offer.metadata?.last4) ?? "N/A",
    cardName: asString(offer.metadata?.cardName) ?? "Unknown Card",
    status: asString(offer.metadata?.status) ?? "Unknown",
    expiresAt: offer.expiresAt,
    description: offer.description,
    locale: asString(offer.metadata?.locale) ?? "en-US",
  }));
  let cachedOffers = bundle.offers.items as Offer[];
  let interactiveSession: AuthSession | undefined;

  const mapOffersForInteractive = (offersDataset: Offer[]) =>
    offersDataset.map((offer) => ({
      id: offer.id,
      cardId: offer.cardId,
      title: offer.title,
      last4: asString(offer.metadata?.last4) ?? "N/A",
      cardName: asString(offer.metadata?.cardName) ?? "Unknown Card",
      status: asString(offer.metadata?.status) ?? "Unknown",
      expiresAt: offer.expiresAt,
      description: offer.description,
      locale: asString(offer.metadata?.locale) ?? "en-US",
    }));

  const getInteractiveEnrollSession = async (
    onProgress?: (progress: {
      sessionMessage?: string;
      actionMessage?: string;
      activity?: { tone: "info" | "success" | "error"; text: string };
    }) => void,
  ) => {
    const credentials = await requireCredentials();
    onProgress?.({
      sessionMessage: "Session: checking existing browser session...",
      activity: { tone: "info", text: "Checking existing browser session." },
    });

    if (interactiveSession) {
      try {
        onProgress?.({
          actionMessage: "Validating active interactive session...",
        });
        await apiClient.syncCards(interactiveSession);
        interactiveSession.metadata = {
          ...(interactiveSession.metadata ?? {}),
          sessionStatus: "reused-live",
        };
        onProgress?.({
          sessionMessage: "Session: reused active interactive session.",
          activity: { tone: "success", text: "Reused active interactive session." },
        });
        return interactiveSession;
      } catch (error) {
        await disposeRuntimeSession(interactiveSession);
        interactiveSession = undefined;
        if (!isReusableSessionError(error)) {
          throw error;
        }
        onProgress?.({
          sessionMessage: "Session: active session expired, falling back to saved profile.",
          activity: { tone: "info", text: "Active session was invalid. Checking saved browser profile." },
        });
      }
    }

    onProgress?.({
      actionMessage: "Validating saved browser session...",
    });
    interactiveSession = await getSessionForSync(credentials, DEFAULT_CLI_OPTIONS, { silent: true });
    const sessionStatus = asString(interactiveSession.metadata?.sessionStatus);
    if (sessionStatus === "reused") {
      onProgress?.({
        sessionMessage: "Session: reused saved browser session.",
        activity: { tone: "success", text: "Reused saved browser session." },
      });
    } else if (sessionStatus === "fallback-fresh") {
      onProgress?.({
        sessionMessage: "Session: saved session invalid, used fresh login.",
        activity: { tone: "info", text: "Saved session was invalid. Used a fresh browser login." },
      });
    } else if (sessionStatus === "fresh") {
      onProgress?.({
        sessionMessage: "Session: used fresh browser login.",
        activity: { tone: "info", text: "Used a fresh browser login." },
      });
    }
    return interactiveSession;
  };

  await runInteractiveAppView({
    syncedAt: {
      cards: bundle.cards.syncedAt,
      benefits: bundle.benefits.syncedAt,
      offers: bundle.offers.syncedAt,
    },
    cards,
    benefits: {
      groups: benefitGroups,
      summary: summarizeBenefits(benefitRows),
    },
    offers,
    onEnrollOffer: async (selection, onProgress) => {
      const session = await getInteractiveEnrollSession(onProgress);
      const results = await apiClient.enrollOffers(session, selection);
      const offersDataset = await apiClient.syncOffers(session);
      await cacheStore.write("offers", offersDataset);
      cachedOffers = offersDataset.items as Offer[];

      return {
        results,
        offers: mapOffersForInteractive(offersDataset.items as Offer[]),
        syncedAt: offersDataset.syncedAt,
        ...(asString(session.metadata?.sessionStatus)
          ? { sessionStatus: asString(session.metadata?.sessionStatus) }
          : {}),
      };
    },
    onEnrollAllOffers: async (onProgress) => {
      const session = await getInteractiveEnrollSession(onProgress);
      const results = await apiClient.enrollOffers(
        session,
        resolveAllOfferEnrollmentTargets(cachedOffers, DEFAULT_CLI_OPTIONS),
      );
      const offersDataset = await apiClient.syncOffers(session);
      await cacheStore.write("offers", offersDataset);
      cachedOffers = offersDataset.items as Offer[];

      return {
        results,
        offers: mapOffersForInteractive(offersDataset.items as Offer[]),
        syncedAt: offersDataset.syncedAt,
        ...(asString(session.metadata?.sessionStatus)
          ? { sessionStatus: asString(session.metadata?.sessionStatus) }
          : {}),
      };
    },
  });

  if (interactiveSession) {
    await disposeRuntimeSession(interactiveSession);
  }
}

export async function handleServe(options: CliOptions): Promise<void> {
  await startWebServer(options);
}

export async function handleAuthSet(options: CliOptions): Promise<void> {
  const credentials =
    options.authUsername || options.authPassword
      ? readCredentialsFromCli(options)
      : await promptForCredentials();
  await credentialStore.set(credentials);
  printText(["Credentials stored in the system credential manager."]);
}

export async function handleAuthStatus(options: CliOptions): Promise<void> {
  const credentials = await credentialStore.get();
  const payload = {
    configured: Boolean(credentials),
    username: credentials?.username,
    provider: "keytar",
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  printText([
    credentials ? `Credentials configured for ${credentials.username}.` : "Credentials not configured.",
    "Provider: keytar",
  ]);
}

export async function handleAuthClear(): Promise<void> {
  await credentialStore.clear();
  printText(["Credentials removed from the system credential manager."]);
}

async function syncSingle(kind: DataKind, session: AuthSession) {
  switch (kind) {
    case "cards":
      return apiClient.syncCards(session);
    case "benefits":
      return apiClient.syncBenefits(session);
    case "offers":
      return apiClient.syncOffers(session);
  }
}

async function runSyncWithSession(session: AuthSession) {
  return Promise.all(
    ALL_KINDS.map(async (kind) => {
      const dataset = await syncSingle(kind, session);
      await cacheStore.write(kind, dataset);
      return [kind, dataset] as const;
    }),
  );
}

function renderSyncResults(
  results: Awaited<ReturnType<typeof runSyncWithSession>>,
  options: CliOptions,
): void {
  const payload = Object.fromEntries(results);
  if (options.json) {
    printJson(payload);
    return;
  }

  printText([
    `Synced ${ALL_KINDS.join(", ")}.`,
    ...results.map(([kind, dataset]) => `${kind}: ${dataset.items.length} item(s), synced at ${dataset.syncedAt}`),
  ]);
}

function renderOfferEnrollmentResults(results: OfferEnrollmentResult[], options: CliOptions): void {
  const succeeded = results.filter((result) => result.statusPurpose.toUpperCase() === "SUCCESS");
  const failed = results.filter((result) => result.statusPurpose.toUpperCase() !== "SUCCESS");
  const payload = {
    enrolledCount: succeeded.length,
    failedCount: failed.length,
    results: results.map((result) => ({
      offerId: result.offerId,
      accountNumberProxy: result.accountNumberProxy,
      last4: result.last4,
      cardName: result.cardName,
      statusPurpose: result.statusPurpose,
      statusMessage: result.statusMessage,
    })),
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  printText([
    `Offer ${results[0]?.offerId ?? ""}: ${succeeded.length} succeeded, ${failed.length} failed.`,
    ...results.map(
      (result) =>
        `${result.statusPurpose.toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED "} | ${result.last4 ?? result.accountNumberProxy} | ${result.cardName ?? "Unknown Card"} | ${result.statusMessage}`,
    ),
    "Offers cache refreshed.",
  ]);
}

function renderBulkOfferEnrollmentResults(results: OfferEnrollmentResult[], options: CliOptions): void {
  const succeeded = results.filter((result) => result.statusPurpose.toUpperCase() === "SUCCESS");
  const failed = results.filter((result) => result.statusPurpose.toUpperCase() !== "SUCCESS");
  const payload = {
    enrolledCount: succeeded.length,
    failedCount: failed.length,
    uniqueOffers: new Set(results.map((result) => result.offerId)).size,
    results: results.map((result) => ({
      offerId: result.offerId,
      accountNumberProxy: result.accountNumberProxy,
      last4: result.last4,
      cardName: result.cardName,
      statusPurpose: result.statusPurpose,
      statusMessage: result.statusMessage,
    })),
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  printText([
    `Processed ${payload.uniqueOffers} offer(s): ${succeeded.length} succeeded, ${failed.length} failed.`,
    ...results.map(
      (result) =>
        `${result.statusPurpose.toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED "} | ${result.offerId} | ${result.last4 ?? result.accountNumberProxy} | ${result.cardName ?? "Unknown Card"} | ${result.statusMessage}`,
    ),
    "Offers cache refreshed.",
  ]);
}

async function readCacheEntries(kinds: DataKind[]) {
  return Promise.all(kinds.map(async (kind) => [kind, await cacheStore.read(kind)] as const));
}

function getMissingKinds(entries: Array<readonly [DataKind, Awaited<ReturnType<typeof cacheStore.read>>]>) {
  return entries.filter(([, dataset]) => !dataset).map(([kind]) => kind);
}

async function promptToSyncMissingCache(missing: DataKind[], options: Pick<CliOptions, "json" | "debug">): Promise<boolean> {
  if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(`No cached data for ${missing.join(", ")}. Run sync first.`);
  }

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(
      `No cached data for ${missing.join(", ")}. Sync now? [Y/n] `,
    )).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function requireCachedOffers(): Promise<Offer[]> {
  const dataset = await cacheStore.read("offers");
  if (!dataset) {
    throw new CliError("No cached data for offers. Run sync first.");
  }

  return dataset.items as Offer[];
}

async function requireCredentials(): Promise<Credentials> {
  const credentials = await credentialStore.get();
  if (!credentials) {
    throw new CliError("Credentials are not configured. Run `amex auth set` first.");
  }

  return credentials;
}

async function getSessionForSync(
  credentials: Credentials,
  options: CliOptions,
  config: { forceLogin?: boolean; silent?: boolean } = {},
): Promise<AuthSession> {
  if (!config.forceLogin) {
    let restored: AuthSession | undefined;
    try {
      restored = await restoreProfileSession(options, config);
      await apiClient.syncCards(restored);
      restored.metadata = {
        ...(restored.metadata ?? {}),
        sessionStatus: "reused",
      };
      return restored;
    } catch (error) {
      if (restored) {
        await disposeRuntimeSession(restored);
      }
      if (!isReusableSessionError(error)) {
        throw error;
      }
    }
  }

  const fresh = await forceLoginSession(credentials, options, config);
  fresh.metadata = {
    ...(fresh.metadata ?? {}),
    sessionStatus: config.forceLogin ? "fresh" : "fallback-fresh",
  };
  return fresh;
}

async function restoreProfileSession(
  options: CliOptions,
  config: { forceLogin?: boolean; silent?: boolean } = {},
): Promise<AuthSession> {
  if (!(authenticator instanceof PatchrightAmexAuthenticator)) {
    throw new CliError("Authenticator does not support restoring an existing browser profile session.");
  }

  const silent = config.silent ?? false;
  const reporter = createAuthInkReporter(!silent && !options.json && !options.debug);
  try {
    return await authenticator.restore(
      reporter ? { debug: options.debug, reporter, quiet: silent } : { debug: options.debug, quiet: silent },
    );
  } finally {
    reporter?.dispose();
  }
}

function resolveOfferEnrollmentTargets(offers: Offer[], options: CliOptions): OfferEnrollmentTarget[] {
  const matchingOffers = offers.filter((offer) =>
    options.offerId
      ? offer.id === options.offerId
      : asString(offer.metadata?.sourceId) === options.offerSourceId,
  );
  const requestedLabel = options.offerId
    ? `id ${options.offerId}`
    : `source id ${options.offerSourceId}`;
  if (matchingOffers.length === 0) {
    throw new CliError(`No cached offer matched ${requestedLabel}. Run sync first or check the offer id.`);
  }

  const candidateOffers = matchingOffers.filter((offer) => normalizeOfferEnrollmentStatus(offer) !== "ENROLLED");
  if (candidateOffers.length === 0) {
    throw new CliError(`Offer ${requestedLabel} is already enrolled on every cached card.`);
  }

  if (options.enrollAllCards) {
    return candidateOffers.map(toOfferEnrollmentTarget);
  }

  if (options.offerCards.length > 0) {
    const requested = new Set(options.offerCards);
    const selected = candidateOffers.filter((offer) => requested.has(asString(offer.metadata?.last4) ?? ""));
    const missingCards = options.offerCards.filter(
      (last4) => !selected.some((offer) => (asString(offer.metadata?.last4) ?? "") === last4),
    );
    if (missingCards.length > 0) {
      throw new CliError(
        `Offer ${requestedLabel} is not eligible on card(s): ${missingCards.join(", ")}.`,
      );
    }

    return selected.map(toOfferEnrollmentTarget);
  }

  if (candidateOffers.length === 1) {
    return candidateOffers.map(toOfferEnrollmentTarget);
  }

  throw new CliError(
    `Offer ${requestedLabel} is available on ${candidateOffers.length} cards. Pass --card <last4> one or more times, or use --all-cards.`,
  );
}

function resolveAllOfferEnrollmentTargets(offers: Offer[], options: CliOptions): OfferEnrollmentTarget[] {
  const candidateOffers = offers.filter((offer) => normalizeOfferEnrollmentStatus(offer) === "ELIGIBLE");

  if (candidateOffers.length === 0) {
    throw new CliError("No eligible cached offers were found.");
  }

  if (options.offerCards.length === 0) {
    return candidateOffers.map(toOfferEnrollmentTarget);
  }

  const requested = new Set(options.offerCards);
  const selected = candidateOffers.filter((offer) => requested.has(asString(offer.metadata?.last4) ?? ""));
  const missingCards = options.offerCards.filter(
    (last4) => !selected.some((offer) => (asString(offer.metadata?.last4) ?? "") === last4),
  );

  if (missingCards.length > 0) {
    throw new CliError(`No eligible cached offers were found for card(s): ${missingCards.join(", ")}.`);
  }

  return selected.map(toOfferEnrollmentTarget);
}

function toOfferEnrollmentTarget(offer: Offer): OfferEnrollmentTarget {
  const last4 = asString(offer.metadata?.last4) ?? undefined;
  const cardName = asString(offer.metadata?.cardName) ?? undefined;
  return {
    offerId: offer.id,
    accountNumberProxy: offer.cardId,
    locale: asString(offer.metadata?.locale) ?? "en-US",
    ...(last4 ? { last4 } : {}),
    ...(cardName ? { cardName } : {}),
  };
}

function normalizeOfferEnrollmentStatus(offer: Offer): string {
  return asString(offer.metadata?.status)?.toUpperCase() ?? "UNKNOWN";
}

async function forceLoginSession(
  credentials: Credentials,
  options: CliOptions,
  config: { forceLogin?: boolean; silent?: boolean } = {},
): Promise<AuthSession> {
  const silent = config.silent ?? false;
  const reporter = createAuthInkReporter(!silent && !options.json && !options.debug);
  try {
    const session = await authenticator.login(
      credentials,
      reporter ? { debug: options.debug, reporter, quiet: silent } : { debug: options.debug, quiet: silent },
    );
    reporter?.update("Validating fresh session");
    logSyncStep(options, "Validating fresh Amex session.", silent);
    try {
      await apiClient.syncCards(session);
    } catch (error) {
      if (isReusableSessionError(error)) {
        reporter?.fail("Fresh session invalid", error instanceof Error ? error.message : String(error));
        throw new CliError(
          "Fresh Amex login did not produce a valid session. Rerun with `--debug` to inspect the browser login flow.",
        );
      }

      reporter?.fail("Fresh session validation failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
    reporter?.success("Fresh session validated");
    logSyncStep(options, "Fresh Amex session validated.", silent);
    return session;
  } catch (error) {
    reporter?.fail("Login failed", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    reporter?.dispose();
  }
}

function logSyncStep(options: CliOptions, message: string, silent = false): void {
  if (options.json || silent) {
    return;
  }

  process.stderr.write(`${message}\n`);
}

async function promptForCredentials(): Promise<Credentials> {
  const inkCredentials = await promptForCredentialsInk(process.stdin.isTTY && process.stdout.isTTY);
  if (inkCredentials) {
    return inkCredentials;
  }

  const rl = createInterface({ input, output });
  try {
    const username = (await rl.question("Amex username: ")).trim();
    const password = (await rl.question("Amex password: ")).trim();
    if (!username || !password) {
      throw new CliError("Username and password are required.");
    }

    return { username, password };
  } finally {
    rl.close();
  }
}

function readCredentialsFromCli(options: CliOptions): Credentials {
  const username = options.authUsername?.trim();
  const password = options.authPassword;

  if (!username || !password) {
    throw new CliError("Both --username and --password are required for non-interactive auth set.");
  }

  return { username, password };
}

function expandTarget(target: DataKind | "all"): DataKind[] {
  if (target === "all") {
    return ALL_KINDS;
  }

  return [target];
}

function isReusableSessionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("expired_session") ||
    message.includes("cupcake session expired") ||
    message.includes("invalid_authentication_token") ||
    message.includes("must provide user jwt") ||
    message.includes("no browser storage state") ||
    message.includes("not authenticated") ||
    message.includes("saved browser profile is not currently authenticated")
  );
}

function formatCardSummaryLine(card: CardSummary): string {
  const metadata = card.metadata ?? {};
  const relationship = asString(metadata.relationship);
  const memberSince = readProfileValue(metadata, "member_since_date");
  const paymentType = asString(metadata.paymentType);
  const rewardsProgram = readNestedString(metadata, ["loyalty", "legal_program_name"]);

  return [
    card.name,
    card.last4 ? `ending ${card.last4}` : undefined,
    card.status,
    relationship,
    memberSince ? `Member since ${memberSince}` : undefined,
    paymentType,
    rewardsProgram,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatCardsOverview(cards: CardSummary[], syncedAt: string | undefined, options: CliOptions): string[] {
  const rows = buildCardTableRows(cards);
  const activeRows = rows.filter((row) => !isCanceledStatus(row.status));
  const visibleRows = options.includeCanceled ? rows : activeRows;
  const summary = summarizeCards(activeRows);
  const canceledSummary = summarizeCards(rows.filter((row) => isCanceledStatus(row.status)));

  return [
    "Members",
    ...(syncedAt ? [`Last updated: ${formatTimestamp(syncedAt)}`] : []),
    "",
    formatMetricLine([
      { label: "Total Cards", value: formatMetricValue(summary.totalCards, canceledSummary.totalCards) },
      { label: "Active Cards", value: String(summary.activeCards) },
      { label: "Basic Cards", value: formatMetricValue(summary.basicCards, canceledSummary.basicCards) },
      { label: "Supp Cards", value: formatMetricValue(summary.suppCards, canceledSummary.suppCards) },
    ]),
    "",
    ...(!options.includeCanceled && canceledSummary.totalCards > 0
      ? ["Showing active cards only. Use `show cards --all` or `show cards -a` to include canceled card details.", ""]
      : []),
    formatCardTable(visibleRows),
  ];
}

function formatBenefitsOverview(benefits: Benefit[], syncedAt?: string): string[] {
  const rows = benefits
    .map((benefit) => buildBenefitTableRow(benefit))
    .sort((left, right) => {
      if (left.groupStatusRank !== right.groupStatusRank) {
        return left.groupStatusRank - right.groupStatusRank;
      }

      if (left.title !== right.title) {
        return left.title.localeCompare(right.title);
      }

      return left.last4.localeCompare(right.last4);
    });
  const summary = summarizeBenefits(rows);
  const groups = groupBenefitRows(rows);

  return [
    colorize("Benefits", "\u001b[1m"),
    ...(syncedAt ? [`${colorize("Last updated:", "\u001b[2m")} ${formatTimestamp(syncedAt)}`] : []),
    "",
    formatMetricLine([
      { label: colorize("Total Benefits", "\u001b[36m"), value: String(summary.totalBenefits) },
      { label: colorize("Completed", "\u001b[32m"), value: String(summary.completedBenefits) },
      { label: colorize("In Progress", "\u001b[34m"), value: String(summary.inProgressBenefits) },
      { label: colorize("Not Started", "\u001b[33m"), value: String(summary.notStartedBenefits) },
      { label: colorize("Remaining", "\u001b[33m"), value: summary.remainingValue },
      { label: colorize("Earned", "\u001b[36m"), value: summary.earnedValue },
    ]),
    "",
    ...formatBenefitGroups(groups),
  ];
}

function formatOffersOverview(offers: Offer[], syncedAt: string | undefined, options: CliOptions): string[] {
  const filteredOffers = filterOffers(offers, options);
  const groups = groupOfferRows(filteredOffers);
  const summary = summarizeOffers(groups);
  const filterLine = formatOfferFilters(options);

  return [
    colorize("Offers", "\u001b[1m"),
    ...(syncedAt ? [`${colorize("Last updated:", "\u001b[2m")} ${formatTimestamp(syncedAt)}`] : []),
    ...(filterLine ? [`${colorize("Filters:", "\u001b[2m")} ${filterLine}`] : []),
    "",
    formatMetricLine([
      { label: colorize("Total Offers", "\u001b[36m"), value: String(summary.totalOffers) },
      { label: colorize("Enrolled", "\u001b[32m"), value: String(summary.enrolledOffers) },
      { label: colorize("Eligible", "\u001b[33m"), value: String(summary.eligibleOffers) },
      ...(summary.otherOffers > 0
        ? [{ label: colorize("Other", "\u001b[2m"), value: String(summary.otherOffers) }]
        : []),
    ]),
    "",
    ...formatOfferGroups(groups),
  ];
}

function buildCardTableRows(cards: CardSummary[]): CardTableRow[] {
  return cards.flatMap((card, index) => {
    const metadata = card.metadata ?? {};
    const opened = asString(metadata.accountSetupDate);
    const primaryRow: CardTableRow = {
      index: String(index + 1),
      ending: card.last4 ?? "N/A",
      member: readMemberName(card, metadata) ?? "Unknown",
      kind: readCardKind(card, metadata) ?? card.name,
      type: asString(metadata.relationship) ?? "UNKNOWN",
      opened: formatShortDate(opened) ?? "N/A",
      status: card.status ?? "Unknown",
    };

    const supplementaryAccounts = Array.isArray(metadata.supplementaryAccounts)
      ? (metadata.supplementaryAccounts as Array<Record<string, unknown>>)
      : [];

    const supplementaryRows = supplementaryAccounts.map((account, supplementaryIndex) => {
      const row: CardTableRow = {
        index: `${index + 1}-${supplementaryIndex + 1}`,
        ending: asString(account.last4) ?? "N/A",
        member: readSupplementaryMemberName(account) ?? "Unknown",
        kind: asString(account.name) ?? (readCardKind(card, metadata) ?? card.name),
        type: "SUPP",
        opened: formatShortDate(opened) ?? "N/A",
        status: readSupplementaryStatus(account) ?? (card.status ?? "Unknown"),
      };

      if (card.last4) {
        row.parentEnding = card.last4;
      }

      return row;
    });

    return [primaryRow, ...supplementaryRows];
  });
}

function buildBenefitTableRow(benefit: Benefit): BenefitTableRow {
  const metadata = benefit.metadata ?? {};
  const tracker = readRecord(metadata.tracker);
  const progress = readRecord(metadata.progress);
  const spentAmount = asString(tracker?.spentAmount);
  const targetAmount = asString(tracker?.targetAmount);
  const remainingAmount = asString(tracker?.remainingAmount);
  const currencySymbol = asString(tracker?.targetCurrencySymbol) ?? "$";
  const status = asString(metadata.status) ?? "UNKNOWN";
  const displayStatus = getBenefitDisplayStatus(status, spentAmount, remainingAmount);

  return {
    title: readBenefitTitle(benefit),
    cardName: asString(metadata.cardName) ?? "Unknown Card",
    last4: asString(metadata.last4) ?? "N/A",
    status,
    displayStatus,
    groupStatusRank: getBenefitDisplayStatusRank(displayStatus),
    trackerDuration: formatTrackerDuration(asString(metadata.trackerDuration)),
    period: formatBenefitPeriod(asString(metadata.periodStartDate), asString(metadata.periodEndDate)),
    progress: formatBenefitProgress({
      spentAmount,
      targetAmount,
      remainingAmount,
      currencySymbol,
      targetUnit: asString(tracker?.targetUnit),
    }),
    description:
      asString(progress?.message) ??
      benefit.description ??
      "",
    targetAmount,
    spentAmount,
    remainingAmount,
    currencySymbol,
  };
}

function summarizeCards(rows: CardTableRow[]): CardSummaryMetrics {
  return {
    totalCards: rows.length,
    activeCards: rows.filter((row) => row.status.toLowerCase() === "active").length,
    basicCards: rows.filter((row) => row.type.toUpperCase() === "BASIC").length,
    suppCards: rows.filter((row) => row.type.toUpperCase() === "SUPP").length,
  };
}

function summarizeBenefits(rows: BenefitTableRow[]): BenefitSummaryMetrics {
  const completedRows = rows.filter((row) => row.displayStatus === "Completed");
  const inProgressRows = rows.filter((row) => row.displayStatus === "In Progress");
  const notStartedRows = rows.filter((row) => row.displayStatus === "Not Started");

  return {
    totalBenefits: rows.length,
    completedBenefits: completedRows.length,
    inProgressBenefits: inProgressRows.length,
    notStartedBenefits: notStartedRows.length,
    remainingValue: formatCurrencyTotal(rows, "remainingAmount"),
    earnedValue: formatCurrencyTotal(rows, "spentAmount"),
  };
}

function summarizeOffers(groups: OfferGroup[]): OfferSummaryMetrics {
  return groups.reduce(
    (summary, group) => {
      summary.totalOffers += 1;
      const statuses = new Set(group.rows.map((row) => row.status.toUpperCase()));

      if (statuses.has("ENROLLED")) {
        summary.enrolledOffers += 1;
      } else if (statuses.has("ELIGIBLE")) {
        summary.eligibleOffers += 1;
      } else {
        summary.otherOffers += 1;
      }

      return summary;
    },
    {
      totalOffers: 0,
      enrolledOffers: 0,
      eligibleOffers: 0,
      otherOffers: 0,
    },
  );
}

function formatMetricLine(metrics: Array<{ label: string; value: string }>): string {
  return metrics
    .map((metric) => `${metric.label}: ${metric.value}`)
    .join("  |  ");
}

function formatMetricValue(value: number, canceledCount: number): string {
  if (canceledCount <= 0) {
    return String(value);
  }

  return `${value} (canceled: ${canceledCount})`;
}

function formatCardTable(rows: CardTableRow[]): string {
  const headers = ["Index", "Ending", "User Name", "Kind", "Type", "Opened", "Status"];
  const body = rows.map((row) => [
    row.index,
    row.ending,
    row.parentEnding ? `${row.member} (${row.parentEnding})` : row.member,
    row.kind,
    row.type,
    row.opened,
    row.status,
  ]);

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...body.map((row) => row[columnIndex]?.length ?? 0)),
  );

  const headerLine = headers.map((header, index) => header.padEnd(widths[index] ?? header.length)).join("  ");
  const dividerLine = widths.map((width) => "-".repeat(width)).join("  ");
  const bodyLines = body.map((row) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  "),
  );

  return [headerLine, dividerLine, ...bodyLines].join("\n");
}

function formatBenefitGroups(groups: BenefitGroup[]): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    const statusSummary = summarizeBenefitGroupStatuses(group.rows);
    lines.push(colorize(group.title, "\u001b[1m"));
    lines.push(`  ${colorize("Schedule:", "\u001b[2m")} ${[group.trackerDuration, group.period].filter(Boolean).join(" | ")}`);
    lines.push(`  ${colorize("Summary:", "\u001b[2m")} ${statusSummary}`);
    lines.push(`  ${colorize("Cards:", "\u001b[2m")}`);
    lines.push(...group.rows.map((row) => `    - ${formatBenefitCardStatus(row)}`));
    lines.push("");
  }

  return lines.length > 0 ? lines.slice(0, -1) : ["No benefit data available."];
}

function formatOfferGroups(groups: OfferGroup[]): string[] {
  const lines: string[] = [];

  for (const group of groups) {
    const sourceId = asString(group.rows[0]?.sourceId);
    lines.push(colorize(group.title, "\u001b[1m"));
    lines.push(`  ${colorize("Offer ID:", "\u001b[2m")} ${group.id}`);
    if (sourceId) {
      lines.push(`  ${colorize("Source ID:", "\u001b[2m")} ${sourceId}`);
    }
    lines.push(`  ${colorize("Summary:", "\u001b[2m")} ${summarizeOfferGroupStatuses(group.rows)}`);
    if (group.description) {
      lines.push(`  ${colorize("Description:", "\u001b[2m")} ${group.description}`);
    }
    lines.push(`  ${colorize("Cards:", "\u001b[2m")}`);
    lines.push(...group.rows.map((row) => `    - ${formatOfferCardStatus(row)}`));
    lines.push("");
  }

  return lines.length > 0 ? lines.slice(0, -1) : ["No offer data available."];
}

function filterOffers(offers: Offer[], options: CliOptions): Offer[] {
  return offers.filter((offer) => {
    const status = asString(offer.metadata?.status)?.toUpperCase() ?? "UNKNOWN";
    const last4 = asString(offer.metadata?.last4) ?? "";

    if (options.offerStatus) {
      if (options.offerStatus === "enrolled" && status !== "ENROLLED") {
        return false;
      }

      if (options.offerStatus === "eligible" && status !== "ELIGIBLE") {
        return false;
      }

      if (options.offerStatus === "other" && (status === "ELIGIBLE" || status === "ENROLLED")) {
        return false;
      }
    }

    if (options.offerCard && last4 !== options.offerCard) {
      return false;
    }

    return true;
  });
}

function formatOfferFilters(options: CliOptions): string | undefined {
  const filters = [
    options.offerStatus ? `status=${options.offerStatus}` : undefined,
    options.offerCard ? `card=${options.offerCard}` : undefined,
  ].filter(Boolean);

  return filters.length > 0 ? filters.join(" | ") : undefined;
}

function formatCardDetail(card: CardSummary): string[] {
  const metadata = card.metadata ?? {};
  const supplementaryAccounts = Array.isArray(metadata.supplementaryAccounts)
    ? (metadata.supplementaryAccounts as Array<Record<string, unknown>>)
    : [];

  return [
    `${card.name}${card.last4 ? ` ending ${card.last4}` : ""}`,
    `id: ${card.id}`,
    ...(card.status ? [`status: ${card.status}`] : []),
    ...formatDetailLine("relationship", metadata.relationship),
    ...formatDetailLine("member since", readProfileValue(metadata, "member_since_date")),
    ...formatDetailLine("payment type", metadata.paymentType),
    ...formatDetailLine("rewards program", readNestedString(metadata, ["loyalty", "legal_program_name"])),
    ...formatDetailLine("account setup date", metadata.accountSetupDate),
    ...formatDetailLine("days past due", metadata.daysPastDue),
    ...formatDetailLine("line of business", metadata.lineOfBusinessType),
    ...formatDetailLine("account types", joinArray(metadata.accountTypes)),
    ...formatDetailLine("card types", joinArray(metadata.cardTypes)),
    ...formatDetailLine("market", readNestedString(metadata, ["platform", "market_name"])),
    ...formatDetailLine("region", readNestedString(metadata, ["platform", "amex_region"])),
    ...formatDetailLine("embossed name", readNestedString(metadata, ["profile", "embossed_name"])),
    supplementaryAccounts.length > 0
      ? `supplementary cards: ${supplementaryAccounts.map(formatSupplementaryAccount).join("; ")}`
      : "supplementary cards: none",
  ];
}

function formatDetailLine(label: string, value: unknown): string[] {
  const rendered = asString(value);
  return rendered ? [`${label}: ${rendered}`] : [];
}

function formatSupplementaryAccount(account: Record<string, unknown>): string {
  const name = asString(account.name) ?? "Unknown";
  const last4 = asString(account.last4);
  const status = asString(account.status);
  return [name, last4 ? `ending ${last4}` : undefined, status].filter(Boolean).join(" | ");
}

function readProfileValue(metadata: Record<string, unknown>, key: string): string | undefined {
  return readNestedString(metadata, ["profile", key]);
}

function readNestedString(source: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return asString(current);
}

function joinArray(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(asString).filter(Boolean).join(", ") : undefined;
}

function readMemberName(card: CardSummary, metadata: Record<string, unknown>): string | undefined {
  return (
    readNestedString(metadata, ["profile", "embossed_name"]) ??
    joinDefinedStrings([
      readNestedString(metadata, ["profile", "first_name"]),
      readNestedString(metadata, ["profile", "last_name"]),
    ]) ??
    card.name
  );
}

function readCardKind(card: CardSummary, metadata: Record<string, unknown>): string | undefined {
  return (
    joinArray(metadata.cardTypes) ??
    joinArray(metadata.accountTypes) ??
    card.name
  );
}

function readSupplementaryMemberName(account: Record<string, unknown>): string | undefined {
  return asString(account.embossedName) ?? asString(account.name);
}

function readSupplementaryStatus(account: Record<string, unknown>): string | undefined {
  const direct = asString(account.status);
  if (direct) {
    return direct;
  }

  if (Array.isArray(account.status)) {
    return account.status.map(asString).find(Boolean);
  }

  return undefined;
}

function joinDefinedStrings(values: Array<string | undefined>): string | undefined {
  const rendered = values.filter((value): value is string => Boolean(value));
  return rendered.length > 0 ? rendered.join(" ") : undefined;
}

function formatShortDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    if (!year || !month || !day) {
      return value;
    }

    return `${month}-${day}-${year.slice(-2)}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const year = `${date.getUTCFullYear()}`.slice(-2);
  return `${month}-${day}-${year}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US");
}

function isCanceledStatus(status: string): boolean {
  return status.trim().toLowerCase() === "canceled";
}

function readBenefitTitle(benefit: Benefit): string {
  const metadata = benefit.metadata ?? {};
  const progressTitle = readNestedString(metadata, ["progress", "title"]);
  if (progressTitle && progressTitle.toLowerCase() !== "congratulations!") {
    return progressTitle;
  }

  const terms = Array.isArray(metadata.terms) ? metadata.terms : [];
  const termsTitle = terms
    .map((term) => asString(term))
    .filter((term): term is string => Boolean(term))
    .map((term) => extractBoldTitle(term))
    .find((term): term is string => Boolean(term));
  if (termsTitle) {
    return termsTitle;
  }

  return benefit.title;
}

function formatBenefitPeriod(start: string | undefined, end: string | undefined): string {
  const startDate = formatShortDate(start);
  const endDate = formatShortDate(end);
  if (startDate && endDate) {
    return `${startDate} -> ${endDate}`;
  }

  return startDate ?? endDate ?? "N/A";
}

function formatBenefitProgress(input: {
  spentAmount: string | undefined;
  targetAmount: string | undefined;
  remainingAmount: string | undefined;
  currencySymbol: string;
  targetUnit: string | undefined;
}): string {
  const targetUnit = input.targetUnit?.toUpperCase();
  if (targetUnit === "MONETARY") {
    const spent = formatCurrency(input.spentAmount, input.currencySymbol);
    const target = formatCurrency(input.targetAmount, input.currencySymbol);
    const remaining = formatCurrency(input.remainingAmount, input.currencySymbol);
    if (spent && target && remaining) {
      return `${spent} / ${target} (${remaining} left)`;
    }
  }

  const spent = input.spentAmount ?? "?";
  const target = input.targetAmount ?? "?";
  const remaining = input.remainingAmount ?? "?";
  return `${spent} / ${target} (${remaining} left)`;
}

function formatCurrencyTotal(rows: BenefitTableRow[], field: "spentAmount" | "remainingAmount"): string {
  let total = 0;
  let found = false;

  for (const row of rows) {
    const value = row[field];
    if (!value || row.currencySymbol !== "$" || isLargeBenefitTracker(row.targetAmount)) {
      continue;
    }

    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      continue;
    }

    found = true;
    total += amount;
  }

  return found ? formatCurrency(total.toFixed(2), "$") ?? "$0.00" : "N/A";
}

function isLargeBenefitTracker(targetAmount: string | undefined): boolean {
  if (!targetAmount) {
    return false;
  }

  const amount = Number(targetAmount);
  return Number.isFinite(amount) && amount > 2000;
}

function formatCurrency(value: string | undefined, currencySymbol: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  return `${currencySymbol}${amount.toFixed(2)}`;
}

function getBenefitStatusRank(status: string): number {
  switch (status.toUpperCase()) {
    case "IN_PROGRESS":
      return 0;
    case "ACHIEVED":
      return 1;
    default:
      return 2;
  }
}

function getBenefitDisplayStatus(
  status: string,
  spentAmount: string | undefined,
  remainingAmount: string | undefined,
): BenefitDisplayStatus {
  if (status.toUpperCase() === "ACHIEVED") {
    return "Completed";
  }

  const spent = Number(spentAmount ?? "0");
  const remaining = Number(remainingAmount ?? "0");
  if (Number.isFinite(spent) && spent > 0) {
    return "In Progress";
  }

  if (Number.isFinite(remaining) && remaining > 0) {
    return "Not Started";
  }

  return "In Progress";
}

function getBenefitDisplayStatusRank(status: BenefitDisplayStatus): number {
  switch (status) {
    case "In Progress":
      return 0;
    case "Not Started":
      return 1;
    case "Completed":
      return 2;
  }
}

function formatTrackerDuration(value: string | undefined): string | undefined {
  switch ((value ?? "").toLowerCase()) {
    case "calenderyear":
      return "Annual";
    case "halfyear":
      return "Semi-Annual";
    case "quarteryear":
      return "Quarterly";
    case "monthly":
      return "Monthly";
    default:
      return value;
  }
}

function groupBenefitRows(rows: BenefitTableRow[]): BenefitGroup[] {
  const groups = new Map<string, BenefitGroup>();

  for (const row of rows) {
    const existing = groups.get(row.title);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(row.title, {
      title: row.title,
      trackerDuration: row.trackerDuration,
      period: row.period,
      rows: [row],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort((left, right) => left.last4.localeCompare(right.last4)),
    }))
    .sort((left, right) => {
      const leftRank = Math.min(...left.rows.map((row) => row.groupStatusRank));
      const rightRank = Math.min(...right.rows.map((row) => row.groupStatusRank));
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.title.localeCompare(right.title);
    });
}

function groupOfferRows(offers: Offer[]): OfferGroup[] {
  const groups = new Map<string, OfferGroup>();

  for (const offer of offers) {
    const row = buildOfferTableRow(offer);
    const existing = groups.get(row.id);
    if (existing) {
      existing.rows.push(row);
      continue;
    }

    groups.set(row.id, {
      id: row.id,
      title: row.title,
      description: row.description,
      rows: [row],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort((left, right) => left.last4.localeCompare(right.last4)),
    }))
    .sort((left, right) => {
      const leftExpiry = earliestOfferExpiry(groupExpiryCandidates(left.rows));
      const rightExpiry = earliestOfferExpiry(groupExpiryCandidates(right.rows));
      if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry;
      }

      return left.title.localeCompare(right.title);
    });
}

function buildOfferTableRow(offer: Offer): OfferTableRow {
  const metadata = offer.metadata ?? {};

  return {
    id: offer.id,
    sourceId: asString(metadata.sourceId) ?? "",
    title: offer.title,
    last4: asString(metadata.last4) ?? "N/A",
    cardName: asString(metadata.cardName) ?? "Unknown Card",
    status: asString(metadata.status) ?? "Unknown",
    expiresAt: formatShortDate(offer.expiresAt) ?? "N/A",
    description: offer.description ?? "",
  };
}

function groupExpiryCandidates(rows: OfferTableRow[]): string[] {
  return rows.map((row) => row.expiresAt);
}

function earliestOfferExpiry(values: string[]): number {
  const timestamps = values
    .map(parseShortDateToTimestamp)
    .filter((value): value is number => Number.isFinite(value));

  return timestamps.length > 0 ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
}

function parseShortDateToTimestamp(value: string): number | undefined {
  if (!value || value === "N/A") {
    return undefined;
  }

  const match = value.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(`20${match[3]}`);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function summarizeOfferGroupStatuses(rows: OfferTableRow[]): string {
  const enrolled = rows.filter((row) => row.status.toUpperCase() === "ENROLLED").length;
  const eligible = rows.filter((row) => row.status.toUpperCase() === "ELIGIBLE").length;
  const other = rows.length - enrolled - eligible;

  return [
    enrolled > 0 ? `${colorize("Enrolled", "\u001b[32m")} ${enrolled}` : undefined,
    eligible > 0 ? `${colorize("Eligible", "\u001b[33m")} ${eligible}` : undefined,
    other > 0 ? `${colorize("Other", "\u001b[2m")} ${other}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatOfferCardStatus(row: OfferTableRow): string {
  return [
    colorize(row.last4, "\u001b[36m"),
    row.cardName,
    colorOfferStatus(row.status),
    row.expiresAt !== "N/A" ? `expires ${row.expiresAt}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

function colorOfferStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "ENROLLED":
      return colorize(status, "\u001b[32m");
    case "ELIGIBLE":
      return colorize(status, "\u001b[33m");
    default:
      return colorize(status, "\u001b[2m");
  }
}

function summarizeBenefitGroupStatuses(rows: BenefitTableRow[]): string {
  const completed = rows.filter((row) => row.displayStatus === "Completed").length;
  const inProgress = rows.filter((row) => row.displayStatus === "In Progress").length;
  const notStarted = rows.filter((row) => row.displayStatus === "Not Started").length;

  return [
    completed > 0 ? `${colorize("Completed", "\u001b[32m")} ${completed}` : undefined,
    inProgress > 0 ? `${colorize("In Progress", "\u001b[34m")} ${inProgress}` : undefined,
    notStarted > 0 ? `${colorize("Not Started", "\u001b[33m")} ${notStarted}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatBenefitCardStatus(row: BenefitTableRow): string {
  return `${colorize(row.last4, "\u001b[36m")} | ${row.cardName} | ${colorBenefitStatus(row.displayStatus)} | ${row.progress}`;
}

function colorBenefitStatus(status: BenefitDisplayStatus): string {
  switch (status) {
    case "Completed":
      return colorize(status, "\u001b[32m");
    case "In Progress":
      return colorize(status, "\u001b[34m");
    case "Not Started":
      return colorize(status, "\u001b[33m");
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function extractBoldTitle(value: string): string | undefined {
  const match = value.match(/<b>(.*?)<\/b>/i);
  return match?.[1] ? stripMarkup(match[1]) : undefined;
}

function stripMarkup(value: string): string {
  return decodeBasicHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return decodeBasicHtmlEntities(value.trim());
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function decodeBasicHtmlEntities(value: string): string {
  return value.replaceAll("&reg;", "®").replaceAll("&amp;", "&");
}

interface CardTableRow {
  index: string;
  ending: string;
  member: string;
  kind: string;
  type: string;
  opened: string;
  status: string;
  parentEnding?: string;
}

interface CardSummaryMetrics {
  totalCards: number;
  activeCards: number;
  basicCards: number;
  suppCards: number;
}

interface BenefitTableRow {
  title: string;
  cardName: string;
  last4: string;
  status: string;
  displayStatus: BenefitDisplayStatus;
  groupStatusRank: number;
  trackerDuration: string | undefined;
  period: string;
  progress: string;
  description: string;
  targetAmount: string | undefined;
  spentAmount: string | undefined;
  remainingAmount: string | undefined;
  currencySymbol: string;
}

interface BenefitSummaryMetrics {
  totalBenefits: number;
  completedBenefits: number;
  inProgressBenefits: number;
  notStartedBenefits: number;
  remainingValue: string;
  earnedValue: string;
}

interface OfferSummaryMetrics {
  totalOffers: number;
  enrolledOffers: number;
  eligibleOffers: number;
  otherOffers: number;
}

interface BenefitGroup {
  title: string;
  trackerDuration: string | undefined;
  period: string;
  rows: BenefitTableRow[];
}

interface OfferTableRow {
  id: string;
  sourceId: string;
  title: string;
  last4: string;
  cardName: string;
  status: string;
  expiresAt: string;
  description: string;
}

interface OfferGroup {
  id: string;
  title: string;
  description: string;
  rows: OfferTableRow[];
}

type BenefitDisplayStatus = "Completed" | "In Progress" | "Not Started";
