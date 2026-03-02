import { getRuntimeSession } from "./auth.js";
import { CliError } from "./errors.js";
import type {
  AuthSession,
  Benefit,
  CachedDataset,
  CardSummary,
  OfferEnrollmentResult,
  OfferEnrollmentTarget,
  Offer,
} from "./types.js";

const MEMBER_URL = "https://global.americanexpress.com/api/servicing/v1/member";
const BENEFITS_URL = "https://functions.americanexpress.com/ReadBestLoyaltyBenefitsTrackers.v1";
const OFFERS_URL = "https://functions.americanexpress.com/ReadCardAccountOffersList.v1";
const OFFER_ENROLL_URL = "https://functions.americanexpress.com/CreateOffersHubEnrollment.web.v1";

export interface AmexApiClient {
  syncCards(session: AuthSession): Promise<CachedDataset<CardSummary>>;
  syncBenefits(session: AuthSession): Promise<CachedDataset<Benefit>>;
  syncOffers(session: AuthSession): Promise<CachedDataset<Offer>>;
  enrollOffer(session: AuthSession, target: OfferEnrollmentTarget): Promise<OfferEnrollmentResult>;
  enrollOffers(session: AuthSession, targets: OfferEnrollmentTarget[]): Promise<OfferEnrollmentResult[]>;
}

export class HttpAmexApiClient implements AmexApiClient {
  async syncCards(session: AuthSession): Promise<CachedDataset<CardSummary>> {
    const member = await this.fetchMember(session);

    return {
      syncedAt: new Date().toISOString(),
      source: MEMBER_URL,
      items: member.accounts.map(normalizeCard),
      raw: member,
    };
  }

  async syncBenefits(session: AuthSession): Promise<CachedDataset<Benefit>> {
    const member = await this.fetchMember(session);
    const primaryAccounts = member.accounts.filter((account) => Boolean(account.account_token));
    const benefitResponses = await Promise.all(
      primaryAccounts.map(async (account) => ({
        account,
        response: await this.postJson<BenefitsResponse[]>(
          session,
          BENEFITS_URL,
          [
            {
              accountToken: account.account_token,
              locale: account.profile?.locale_preference ?? "en-US",
              limit: "ALL",
            },
          ],
          {
            referer: "https://global.americanexpress.com/overview",
            debugLabel: `benefits:${account.account_token}`,
          },
        ),
      })),
    );

    const cardIndex = new Map(
      member.accounts
        .filter((account) => account.account_token)
        .map((account) => [account.account_token as string, account]),
    );

    return {
      syncedAt: new Date().toISOString(),
      source: BENEFITS_URL,
      items: benefitResponses.flatMap(({ response }) =>
        response.flatMap((entry) =>
          entry.trackers.map((tracker) => normalizeBenefit(tracker, cardIndex.get(entry.accountToken))),
        ),
      ),
      raw: {
        requests: primaryAccounts.map((account) => account.account_token),
        responses: benefitResponses,
      },
    };
  }

  async syncOffers(session: AuthSession): Promise<CachedDataset<Offer>> {
    const member = await this.fetchMember(session);
    const primaryAccounts = member.accounts.filter((account) => Boolean(account.account_token));

    const responses = await Promise.all(
      primaryAccounts.map(async (account) => {
        try {
          const response = await this.postJson<OffersResponse>(
            session,
            OFFERS_URL,
            {
              accountNumberProxy: account.account_token,
              locale: account.profile?.locale_preference ?? "en-US",
              offerRequestType: "LIST",
              source: "STANDARD",
              status: ["ELIGIBLE", "ENROLLED"],
              typeOf: "MERCHANT",
              userOffset: currentUtcOffset(),
            },
            {
              referer: "https://global.americanexpress.com/overview",
              debugLabel: `offers:${account.account_token}`,
            },
          );

          return {
            account,
            response,
          };
        } catch (error) {
          if (isIneligibleOffersError(error)) {
            return {
              account,
              response: { offers: [] },
            };
          }

          return {
            account,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const successfulResponses = responses.filter(
      (entry): entry is { account: MemberAccount; response: OffersResponse } => "response" in entry,
    );

    if (successfulResponses.length === 0) {
      const failures = responses
        .filter((entry): entry is { account: MemberAccount; error: string } => "error" in entry)
        .map((entry) => `${entry.account.account_token}: ${entry.error}`);
      throw new CliError(`Amex offers sync failed for all accounts. ${failures.join(" | ")}`);
    }

    return {
      syncedAt: new Date().toISOString(),
      source: OFFERS_URL,
      items: successfulResponses.flatMap(({ account, response }) =>
        (response.offers ?? []).map((offer) => normalizeOffer(offer, account)),
      ),
      raw: responses,
    };
  }

  async enrollOffer(session: AuthSession, target: OfferEnrollmentTarget): Promise<OfferEnrollmentResult> {
    const requestContext = await createRequestContext(
      session,
      this.buildHeaders({ referer: "https://global.americanexpress.com/offers" }),
    );
    try {
      return await this.enrollOfferWithApi(session, requestContext.api, target);
    } finally {
      await requestContext.dispose();
    }
  }

  async enrollOffers(session: AuthSession, targets: OfferEnrollmentTarget[]): Promise<OfferEnrollmentResult[]> {
    const requestContext = await createRequestContext(
      session,
      this.buildHeaders({ referer: "https://global.americanexpress.com/offers" }),
    );

    try {
      debugApi(session, `dispatching ${targets.length} offer enrollment request(s) concurrently`);
      const requests = targets.map((target) => this.enrollOfferWithApi(session, requestContext.api, target));
      return await Promise.all(requests);
    } finally {
      await requestContext.dispose();
    }
  }

  private async enrollOfferWithApi(
    session: AuthSession,
    api: import("patchright").APIRequestContext,
    target: OfferEnrollmentTarget,
  ): Promise<OfferEnrollmentResult> {
    const requestBody = {
      accountNumberProxy: target.accountNumberProxy,
      enrollmentTrigger: "OFFERSHUB_TILE",
      locale: target.locale ?? "en-US",
      offerId: target.offerId,
      offerUnencrypted: false,
      requestType: "OFFERSHUB_ENROLLMENT",
      synchronizeOnly: false,
    };
    const debugLabel = `offer-enroll:${target.offerId}:${target.accountNumberProxy}`;

    try {
      debugApi(
        session,
        `POST ${OFFER_ENROLL_URL} (${debugLabel}) request=${truncateForError(JSON.stringify(requestBody))}`,
      );
      const response = await api.post(OFFER_ENROLL_URL, {
        data: requestBody,
      });
      const payload = await parseJsonResponse<OfferEnrollmentResponse>(
        response,
        OFFER_ENROLL_URL,
        debugLabel,
        requestBody,
        session,
      );

      return {
        offerId: target.offerId,
        accountNumberProxy: target.accountNumberProxy,
        ...(target.last4 ? { last4: target.last4 } : {}),
        ...(target.cardName ? { cardName: target.cardName } : {}),
        statusPurpose: payload.status?.purpose ?? "UNKNOWN",
        statusMessage: summarizeOfferEnrollmentMessage(payload),
        raw: payload,
      };
    } catch (error) {
      return {
        offerId: target.offerId,
        accountNumberProxy: target.accountNumberProxy,
        ...(target.last4 ? { last4: target.last4 } : {}),
        ...(target.cardName ? { cardName: target.cardName } : {}),
        statusPurpose: "FAILURE",
        statusMessage: error instanceof Error ? error.message : String(error),
        raw: {
          request: requestBody,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async fetchMember(session: AuthSession): Promise<MemberResponse> {
    try {
      return await this.getJson<MemberResponse>(session, MEMBER_URL, {
        referer: "https://global.americanexpress.com/overview",
      });
    } catch (error) {
      const captured = session.metadata?.capturedResponses;
      if (captured && typeof captured === "object" && "member" in captured) {
        return (captured as { member: MemberResponse }).member;
      }

      throw error;
    }
  }

  private async getJson<T>(
    session: AuthSession,
    url: string,
    options: { referer?: string; debugLabel?: string } = {},
  ): Promise<T> {
    const requestContext = await createRequestContext(session, this.buildHeaders(options));
    try {
      debugApi(session, `GET ${url}${options.debugLabel ? ` (${options.debugLabel})` : ""}`);
      const response = await requestContext.api.get(url);
      return parseJsonResponse<T>(response, url, options.debugLabel, undefined, session);
    } finally {
      await requestContext.dispose();
    }
  }

  private async postJson<T>(
    session: AuthSession,
    url: string,
    body: unknown,
    options: { referer?: string; debugLabel?: string } = {},
  ): Promise<T> {
    const requestContext = await createRequestContext(session, this.buildHeaders(options));
    try {
      debugApi(
        session,
        `POST ${url}${options.debugLabel ? ` (${options.debugLabel})` : ""} request=${truncateForError(JSON.stringify(body))}`,
      );
      const response = await requestContext.api.post(url, {
        data: body,
      });
      return parseJsonResponse<T>(response, url, options.debugLabel, body, session);
    } finally {
      await requestContext.dispose();
    }
  }

  private buildHeaders(options: { referer?: string }): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
    };
    if (options.referer) {
      headers.referer = options.referer;
    }

    return headers;
  }
}

interface MemberResponse {
  accounts: MemberAccount[];
}

interface MemberAccount {
  account?: {
    display_account_number?: string;
    relationship?: string;
    supplementary_index?: string;
  };
  account_token?: string;
  status?: {
    account_status?: string[];
    account_setup_date?: string;
    days_past_due?: number;
  };
  product?: {
    description?: string;
    payment_type?: string;
    digital_asset_id?: string;
    large_card_art?: string;
    small_card_art?: string;
    account_types?: string[];
    card_types?: string[];
    line_of_business_type?: string;
    account_features?: {
      loyalty?: {
        legal_program_name?: string;
        tier_code?: string;
      };
    };
  };
  platform?: {
    market_name?: string;
    amex_region?: string;
  };
  profile?: {
    locale_preference?: string;
    first_name?: string;
    last_name?: string;
    embossed_name?: string;
    member_since_date?: string;
    country?: string;
    language?: string;
  };
  supplementary_accounts?: MemberAccount[];
}

interface BenefitsResponse {
  accountToken: string;
  trackers: BenefitTracker[];
}

interface BenefitTracker {
  benefitId: string;
  benefitName?: string;
  status?: string;
  category?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  trackerDuration?: string;
  terms?: string[];
  tracker?: Record<string, unknown>;
  progress?: Record<string, unknown>;
}

interface OffersResponse {
  offers?: RawOffer[];
}

interface OfferEnrollmentResponse {
  accountNumberProxy?: string;
  status?: {
    purpose?: string;
    message?: string;
  };
  responseType?: string;
  addedToCard?: {
    title?: string;
  };
  recommendedOffers?: {
    userNotification?: {
      title?: string;
    };
  };
}

interface RawOffer {
  id: string;
  name?: string;
  short_description?: string;
  long_description?: string;
  expiry_date?: string;
  status?: string;
  category?: string;
  type?: string;
  source_id?: string;
  logo_url?: string;
  terms?: string;
  cta?: {
    url?: string;
  };
}

function normalizeCard(account: MemberAccount): CardSummary {
  return {
    id: account.account_token ?? account.account?.display_account_number ?? crypto.randomUUID(),
    name: account.product?.description ?? "Unknown Card",
    ...(account.account?.display_account_number ? { last4: account.account.display_account_number } : {}),
    ...(account.status?.account_status?.length ? { status: account.status.account_status.join(", ") } : {}),
    metadata: {
      relationship: account.account?.relationship,
      supplementaryIndex: account.account?.supplementary_index,
      accountSetupDate: account.status?.account_setup_date,
      daysPastDue: account.status?.days_past_due,
      paymentType: account.product?.payment_type,
      digitalAssetId: account.product?.digital_asset_id,
      largeCardArt: account.product?.large_card_art,
      smallCardArt: account.product?.small_card_art,
      accountTypes: account.product?.account_types,
      cardTypes: account.product?.card_types,
      lineOfBusinessType: account.product?.line_of_business_type,
      loyalty: account.product?.account_features?.loyalty,
      platform: account.platform,
      profile: account.profile,
      supplementaryAccounts: (account.supplementary_accounts ?? []).map((supplementary) => ({
        id: supplementary.account_token,
        last4: supplementary.account?.display_account_number,
        name: supplementary.product?.description,
        status: supplementary.status?.account_status,
        embossedName: supplementary.profile?.embossed_name,
      })),
    },
  };
}

function normalizeBenefit(tracker: BenefitTracker, account: MemberAccount | undefined): Benefit {
  const description = stripHtml(firstNonEmpty(readProgressMessage(tracker.progress), tracker.terms?.[0]));

  return {
    id: tracker.benefitId,
    cardId: account?.account_token ?? "unknown",
    title: tracker.benefitName ?? tracker.benefitId,
    ...(description ? { description } : {}),
    metadata: {
      cardName: account?.product?.description,
      last4: account?.account?.display_account_number,
      status: tracker.status,
      category: tracker.category,
      periodStartDate: tracker.periodStartDate,
      periodEndDate: tracker.periodEndDate,
      trackerDuration: tracker.trackerDuration,
      tracker: tracker.tracker,
      progress: tracker.progress,
      terms: tracker.terms,
    },
  };
}

function normalizeOffer(offer: RawOffer, account: MemberAccount): Offer {
  const description = stripHtml(firstNonEmpty(offer.short_description, offer.long_description, offer.terms));

  return {
    id: offer.id,
    cardId: account.account_token ?? "unknown",
    title: offer.name ?? offer.id,
    ...(description ? { description } : {}),
    ...(offer.expiry_date ? { expiresAt: offer.expiry_date } : {}),
    metadata: {
      cardName: account.product?.description,
      last4: account.account?.display_account_number,
      status: offer.status,
      category: offer.category,
      type: offer.type,
      sourceId: offer.source_id,
      logoUrl: offer.logo_url,
      terms: offer.terms,
      ctaUrl: offer.cta?.url,
      longDescription: offer.long_description,
      locale: account.profile?.locale_preference,
    },
  };
}

async function parseJsonResponse<T>(
  response: {
    ok(): boolean;
    status(): number;
    statusText(): string;
    json(): Promise<unknown>;
    text(): Promise<string>;
  },
  url: string,
  debugLabel?: string,
  requestBody?: unknown,
  session?: AuthSession,
): Promise<T> {
  if (!response.ok()) {
    const responseText = await response.text().catch(() => "");
    debugApi(
      session,
      `response ${response.status()} ${response.statusText()} ${url}${debugLabel ? ` (${debugLabel})` : ""}${responseText ? ` body=${truncateForError(responseText)}` : ""}`,
    );
    if (url === OFFERS_URL && response.status() === 400 && responseText.includes("INELIGIBLE")) {
      return { offers: [] } as T;
    }
    const bodyDetails = responseText ? ` response=${truncateForError(responseText)}` : "";
    const requestDetails =
      requestBody !== undefined ? ` request=${truncateForError(JSON.stringify(requestBody))}` : "";
    const label = debugLabel ? ` (${debugLabel})` : "";
    throw new CliError(
      `Amex API request failed for ${url}${label}: ${response.status()} ${response.statusText()}${requestDetails}${bodyDetails}`,
    );
  }

  if (url === OFFER_ENROLL_URL) {
    const payload = (await response.json().catch(() => ({}))) as OfferEnrollmentResponse;
    debugApi(
      session,
      `response ${response.status()} ${response.statusText()} ${url}${debugLabel ? ` (${debugLabel})` : ""} body=${truncateForError(JSON.stringify(payload))}`,
    );
    return payload as T;
  }

  try {
    const payload = (await response.json()) as T;
    debugApi(
      session,
      `response ${response.status()} ${response.statusText()} ${url}${debugLabel ? ` (${debugLabel})` : ""}`,
    );
    return payload;
  } catch (error) {
    throw new CliError(`Amex API response was not valid JSON for ${url}. ${String(error)}`);
  }
}

function debugApi(session: AuthSession | undefined, message: string): void {
  if (!session?.metadata || session.metadata.debug !== true) {
    return;
  }

  process.stderr.write(`[api-debug] ${message}\n`);
}

function truncateForError(value: string, maxLength = 500): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeOfferEnrollmentMessage(payload: OfferEnrollmentResponse): string {
  const statusMessage = payload.status?.message?.trim();
  const notificationTitle =
    payload.recommendedOffers?.userNotification?.title?.trim() ??
    payload.addedToCard?.title?.trim();

  if (statusMessage && notificationTitle && !statusMessage.includes(notificationTitle)) {
    return `${statusMessage} (${notificationTitle})`;
  }

  return statusMessage || notificationTitle || "Unknown response from Amex offer enrollment API.";
}

function isIneligibleOffersError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("ReadCardAccountOffersList.v1") && error.message.includes("INELIGIBLE");
}

async function createRequestContext(
  session: AuthSession,
  extraHTTPHeaders: Record<string, string>,
): Promise<{
  api: import("patchright").APIRequestContext;
  dispose(): Promise<void>;
}> {
  const runtime = getRuntimeSession(session);
  if (runtime) {
    await runtime.context.setExtraHTTPHeaders(extraHTTPHeaders);
    return {
      api: runtime.context.request,
      async dispose() {},
    };
  }

  if (!session.storageState) {
    throw new CliError("No browser storage state is available for authenticated API requests.");
  }

  const patchright = await loadPatchright();
  const api = await patchright.request.newContext({
    storageState: session.storageState,
    extraHTTPHeaders,
  });

  return {
    api,
    async dispose() {
      await api.dispose();
    },
  };
}

async function loadPatchright(): Promise<typeof import("patchright")> {
  try {
    return await import("patchright");
  } catch (error) {
    throw new CliError(`Unable to load Patchright for authenticated API requests. ${String(error)}`);
  }
}

function stripHtml(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNonEmpty(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function readProgressMessage(progress: Record<string, unknown> | undefined): string | undefined {
  const value = progress?.message;
  return typeof value === "string" ? value : undefined;
}

function currentUtcOffset(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
