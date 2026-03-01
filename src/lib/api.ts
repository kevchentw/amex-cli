import { getRuntimeSession } from "./auth.js";
import { CliError } from "./errors.js";
import type {
  AuthSession,
  Benefit,
  CachedDataset,
  CardSummary,
  Offer,
} from "./types.js";

const MEMBER_URL = "https://global.americanexpress.com/api/servicing/v1/member";
const BENEFITS_URL = "https://functions.americanexpress.com/ReadBestLoyaltyBenefitsTrackers.v1";
const OFFERS_URL = "https://functions.americanexpress.com/ReadCardAccountOffersList.v1";

export interface AmexApiClient {
  syncCards(session: AuthSession): Promise<CachedDataset<CardSummary>>;
  syncBenefits(session: AuthSession): Promise<CachedDataset<Benefit>>;
  syncOffers(session: AuthSession): Promise<CachedDataset<Offer>>;
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
      const response = await requestContext.api.get(url);
      return parseJsonResponse<T>(response, url, options.debugLabel);
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
      const response = await requestContext.api.post(url, {
        data: body,
      });
      return parseJsonResponse<T>(response, url, options.debugLabel, body);
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
): Promise<T> {
  if (!response.ok()) {
    const responseText = await response.text().catch(() => "");
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

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new CliError(`Amex API response was not valid JSON for ${url}. ${String(error)}`);
  }
}

function truncateForError(value: string, maxLength = 500): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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
