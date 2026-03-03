export type DataKind = "cards" | "benefits" | "offers";

export interface CardSummary {
  id: string;
  name: string;
  last4?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface Benefit {
  id: string;
  cardId: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface Offer {
  id: string;
  cardId: string;
  title: string;
  description?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CachedDataset<T> {
  syncedAt: string;
  source: string;
  items: T[];
  raw?: unknown;
}

export interface CacheBundle {
  cards: CachedDataset<CardSummary> | undefined;
  benefits: CachedDataset<Benefit> | undefined;
  offers: CachedDataset<Offer> | undefined;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface CliOptions {
  json: boolean;
  debug: boolean;
  includeCanceled: boolean;
  forceLogin: boolean;
  port: number | undefined;
  offerStatus: "enrolled" | "eligible" | "other" | undefined;
  offerCard: string | undefined;
  offerCards: string[];
  offerId: string | undefined;
  offerSourceId: string | undefined;
  enrollAllCards: boolean;
  authUsername: string | undefined;
  authPassword: string | undefined;
}

export interface OfferEnrollmentTarget {
  offerId: string;
  accountNumberProxy: string;
  last4?: string;
  cardName?: string;
  locale?: string;
}

export interface OfferEnrollmentResult {
  offerId: string;
  accountNumberProxy: string;
  last4?: string;
  cardName?: string;
  statusPurpose: string;
  statusMessage: string;
  raw: unknown;
}

export interface AuthSession {
  createdAt: string;
  authMethod: "patchright-password";
  baseUrl?: string;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expiresAt?: string;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  storageState?: {
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None";
    }>;
    origins: Array<{
      origin: string;
      localStorage: Array<{
        name: string;
        value: string;
      }>;
    }>;
  };
}
