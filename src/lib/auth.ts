import { CliError } from "./errors.js";
import { getBrowserProfileDir } from "./fs.js";
import type { AuthSession, CliOptions, Credentials } from "./types.js";

export interface AmexAuthenticator {
  login(credentials: Credentials, options?: AuthLoginOptions): Promise<AuthSession>;
}

export interface AuthProgressReporter {
  update(step: string, detail?: string): void;
  success(step: string, detail?: string): void;
  fail(step: string, detail?: string): void;
}

export interface AuthLoginOptions extends Pick<CliOptions, "debug"> {
  reporter?: AuthProgressReporter;
}

const LOGIN_URL = "https://www.americanexpress.com/en-us/account/login/";
const OVERVIEW_URL = "https://global.americanexpress.com/overview";
const DEFAULT_TIMEOUT_MS = 45_000;
const runtimeSessions = new Map<string, RuntimeSession>();

interface RuntimeSession {
  context: import("patchright").BrowserContext;
  page: import("patchright").Page;
}

interface LoginNavigationResult {
  mfaRequired: boolean;
  redirectUrl?: string;
}

export class PatchrightAmexAuthenticator implements AmexAuthenticator {
  async login(credentials: Credentials, options: AuthLoginOptions = { debug: false }): Promise<AuthSession> {
    const patchright = await loadPatchright();
    reportProgress(options, "Launching browser");
    logDebug(options, "Launching browser channel: chrome");
    const context = await patchright.chromium.launchPersistentContext(getBrowserProfileDir(), {
      channel: "chrome",
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
    });

    try {
      reportProgress(options, "Opening login page", LOGIN_URL);
      logDebug(options, `Opening login page: ${LOGIN_URL}`);
      const page = await context.newPage();
      page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
      const stopNetworkDebug = attachNetworkDebugging(page, options);
      const loginResponseCapture = createLoginResponseCapture(page);

      try {
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#eliloUserID", { state: "visible", timeout: 15_000 });
        await page.waitForSelector("#eliloPassword", { state: "visible", timeout: 15_000 });
        reportProgress(options, "Login page loaded");
        logDebug(options, `Loaded page: ${page.url()}`);
        await fillLoginForm(page, credentials, options);
        await submitLogin(page, options);
        const loginResult = await loginResponseCapture.waitForResult().catch(() => ({ mfaRequired: false }));
        await waitForAuthenticatedState(page, options, loginResult);
        const capturedResponses = await establishGlobalSession(page, options);

        const storageState = await context.storageState();
        const cookies = await context.cookies();
        const sessionId = crypto.randomUUID();
        runtimeSessions.set(sessionId, { context, page });
        const normalizedCookies = cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          ...(cookie.expires > 0 ? { expiresAt: new Date(cookie.expires * 1000).toISOString() } : {}),
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
        }));

        return {
          createdAt: new Date().toISOString(),
          authMethod: "patchright-password",
          baseUrl: new URL(page.url()).origin,
          cookies: normalizedCookies,
          metadata: {
            finalUrl: page.url(),
            loginUrl: LOGIN_URL,
            overviewUrl: OVERVIEW_URL,
            debug: options.debug,
            runtimeSessionId: sessionId,
            capturedResponses,
          },
          storageState,
        };
      } finally {
        loginResponseCapture.dispose();
        stopNetworkDebug();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.reporter?.fail("Login failed", message);
      await context.close();
      throw normalizeLoginError(error);
    }
  }
}

async function establishGlobalSession(
  page: import("patchright").Page,
  options: AuthLoginOptions,
): Promise<Record<string, unknown>> {
  const captured: Record<string, unknown> = {};
  const onResponse = async (response: import("patchright").Response) => {
    if (response.url() === "https://global.americanexpress.com/api/servicing/v1/member") {
      try {
        captured.member = await response.json();
        logDebug(options, "Captured member response from overview page");
      } catch {
        logDebug(options, "Failed to parse captured member response");
      }
    }
  };

  page.on("response", onResponse);
  reportProgress(options, "Opening account overview");
  logDebug(options, `Opening overview page: ${OVERVIEW_URL}`);
  await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  reportProgress(options, "Overview loaded");
  logDebug(options, `Overview loaded: ${page.url()}`);
  page.off("response", onResponse);
  return captured;
}

async function loadPatchright(): Promise<typeof import("patchright")> {
  try {
    return await import("patchright");
  } catch (error) {
    throw new CliError(`Unable to load Patchright. ${String(error)}`);
  }
}

async function fillLoginForm(
  page: import("patchright").Page,
  credentials: Credentials,
  options: AuthLoginOptions,
): Promise<void> {
  const username = await findFirstVisible(page, [
    "#eliloUserID",
    'input[name="eliloUserID"]',
    'input[name="userID"]',
    'input[name="userid"]',
    'input[name="username"]',
    'input[id*="user" i]',
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[type="text"]',
  ]);
  const password = await findFirstVisible(page, [
    "#eliloPassword",
    'input[name="eliloPassword"]',
    'input[name="password"]',
    'input[id*="password" i]',
    'input[autocomplete="current-password"]',
    'input[type="password"]',
  ]);

  if (!username || !password) {
    throw new CliError("Unable to find login form fields on the Amex login page.");
  }

  logDebug(options, "Filling username");
  reportProgress(options, "Entering username");
  await username.fill(credentials.username);
  await page.waitForTimeout(150);

  logDebug(options, "Filling password");
  reportProgress(options, "Entering password");
  await password.fill(credentials.password);
  await page.waitForTimeout(300);
}

async function submitLogin(page: import("patchright").Page, options: AuthLoginOptions): Promise<void> {
  const submit = await findFirstVisible(page, [
    "#loginSubmit",
    'button[type="submit"]',
    'input[type="submit"]',
    'button[id*="login" i]',
    'button[name*="login" i]',
    'button:has-text("Log In")',
    'button:has-text("Sign In")',
  ]);

  if (!submit) {
    throw new CliError("Unable to find the submit button on the Amex login page.");
  }

  logDebug(options, "Submitting login form");
  reportProgress(options, "Submitting login form");
  await submit.click();
}

async function waitForAuthenticatedState(
  page: import("patchright").Page,
  options: AuthLoginOptions,
  loginResult: LoginNavigationResult,
): Promise<void> {
  const timeoutMs = loginResult.mfaRequired ? 300_000 : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  let snapshot = await readPageSnapshot(page);
  let lastMfaReminderAt = 0;
  let wasOnMfaVerificationPage = false;
  let addThisDeviceSubmitted = false;
  let overviewNavigationStarted = false;

  while (Date.now() - startedAt < timeoutMs) {
    logDebug(options, `Auth state check: url=${snapshot.url}`);
    const onMfaVerificationPage = isMfaVerificationPage(snapshot);
    if (onMfaVerificationPage) {
      reportProgress(options, "Waiting for MFA approval", snapshot.url);
      if (!addThisDeviceSubmitted) {
        addThisDeviceSubmitted = await maybeAddThisDevice(page, options);
      }
      if (Date.now() - lastMfaReminderAt >= 10_000) {
        notifyMfaWaiting();
        lastMfaReminderAt = Date.now();
      }
      wasOnMfaVerificationPage = true;
    } else if (wasOnMfaVerificationPage) {
      reportProgress(options, "MFA approved");
      notifyMfaApproved();
      wasOnMfaVerificationPage = false;
      if (!overviewNavigationStarted) {
        overviewNavigationStarted = true;
        reportProgress(options, "Opening account overview", OVERVIEW_URL);
        await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        snapshot = await readPageSnapshot(page);
        continue;
      }
    }

    if (!onMfaVerificationPage && (looksLoggedIn(snapshot) || looksFailed(snapshot))) {
      break;
    }

    await page.waitForTimeout(1_000);
    snapshot = await readPageSnapshot(page);
  }

  if (!looksLoggedIn(snapshot) && !looksFailed(snapshot)) {
    if (loginResult.mfaRequired || isMfaVerificationPage(snapshot)) {
      throw new CliError(
        `Amex MFA approval is still pending. Please approve the push notification in the Amex app and retry if the browser does not continue automatically. Final URL: ${snapshot.url}`,
      );
    }
    throw new CliError(
      options.debug
        ? `Amex login did not reach a recognized post-login state. Final URL: ${snapshot.url}`
        : `Amex headless login did not reach MFA or a recognized post-login state. Rerun with \`--debug\` to use a visible browser. Final URL: ${snapshot.url}`,
    );
  }

  logDebug(options, `Auth state resolved: url=${snapshot.url}`);
  reportProgress(options, "Authenticated", snapshot.url);

  if (isCredentialFailure(snapshot)) {
    throw new CliError("Amex login failed: username or password appears to be invalid.");
  }

  if (
    isMfaVerificationPage(snapshot) ||
    snapshot.bodyText.includes("verify it is you") ||
    snapshot.bodyText.includes("approve the notification") ||
    snapshot.bodyText.includes("approve this sign in") ||
    snapshot.bodyText.includes("security code") ||
    snapshot.bodyText.includes("one-time code")
  ) {
    throw new CliError(
      `Amex MFA approval is still pending. Please approve the push notification in the Amex app and wait for the browser to continue. Final URL: ${snapshot.url}`,
    );
  }
}

async function readPageSnapshot(page: import("patchright").Page): Promise<{
  url: string;
  title: string;
  bodyText: string;
}> {
  const bodyText = ((await page.locator("body").textContent().catch(() => "")) ?? "").toLowerCase();

  return {
    url: page.url().toLowerCase(),
    title: (await page.title().catch(() => "")).toLowerCase(),
    bodyText,
  };
}

function looksLoggedIn(snapshot: { url: string; title: string; bodyText: string }): boolean {
  return (
    !snapshot.url.includes("/account/login") &&
    (snapshot.url.includes("/account") ||
    snapshot.url.includes("/dashboard") ||
    snapshot.title.includes("account") ||
    snapshot.bodyText.includes("log out") ||
    snapshot.bodyText.includes("sign out"))
  );
}

function looksFailed(snapshot: { url: string; title: string; bodyText: string }): boolean {
  if (isMfaVerificationPage(snapshot)) {
    return false;
  }

  return (
    isCredentialFailure(snapshot) ||
    snapshot.bodyText.includes("create your new password") ||
    snapshot.bodyText.includes("sorry, we are unable to complete your request at this time")
  );
}

function isMfaVerificationPage(snapshot: { url: string; title: string; bodyText: string }): boolean {
  return snapshot.url.includes("/account/two-step-verification/verify");
}

function isCredentialFailure(snapshot: { url: string; title: string; bodyText: string }): boolean {
  const stillOnLoginSurface = snapshot.url.includes("/account/login") || snapshot.title.includes("login");
  if (!stillOnLoginSurface) {
    return false;
  }

  return (
    snapshot.bodyText.includes("incorrect") ||
    snapshot.bodyText.includes("invalid password") ||
    snapshot.bodyText.includes("invalid user id") ||
    snapshot.bodyText.includes("try again")
  );
}

function notifyMfaWaiting(): void {
  process.stderr.write("Waiting for Amex push approval on the two-step verification page.\n");
}

function notifyMfaApproved(): void {
  process.stderr.write("Amex MFA page completed. Continuing login.\n");
}

async function maybeAddThisDevice(
  page: import("patchright").Page,
  options: AuthLoginOptions,
): Promise<boolean> {
  const addDeviceButton = page.getByRole("button", { name: /add this device/i }).first();
  if (!(await addDeviceButton.isVisible().catch(() => false))) {
    return false;
  }

  logDebug(options, "Detected Add This Device prompt. Selecting Add This Device.");
  await addDeviceButton.click();
  return true;
}

async function findFirstVisible(
  page: import("patchright").Page,
  selectors: string[],
): Promise<import("patchright").Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return undefined;
}

function normalizeLoginError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  return new CliError(`Amex login via headless browser failed. ${String(error)}`);
}

function logDebug(options: Pick<CliOptions, "debug">, message: string): void {
  if (!options.debug) {
    return;
  }

  process.stderr.write(`[debug] ${message}\n`);
}

function reportProgress(options: AuthLoginOptions, step: string, detail?: string): void {
  options.reporter?.update(step, detail);
}

function attachNetworkDebugging(
  page: import("patchright").Page,
  options: Pick<CliOptions, "debug">,
): () => void {
  if (!options.debug) {
    return () => {};
  }

  const isInteresting = (request: import("patchright").Request) => {
    const url = request.url();
    return (
      url === "https://global.americanexpress.com/myca/logon/us/action/login" ||
      url === "https://global.americanexpress.com/api/servicing/v1/member" ||
      url.includes("functions.americanexpress.com/ReadUserSession.v1") ||
      url.includes("functions.americanexpress.com/UpdateUserSession.v1") ||
      url.includes("functions.americanexpress.com/DeleteUserSession.v1")
    );
  };

  const onRequest = (request: import("patchright").Request) => {
    const url = request.url();
    if (!isInteresting(request)) {
      return;
    }

    logDebug(options, `request ${request.method()} ${url}`);
    const headers = request.headers();
    const summarizedHeaders = {
      referer: headers.referer,
      origin: headers.origin,
      accept: headers.accept,
      "accept-language": headers["accept-language"],
      contentType: headers["content-type"],
      cookie: headers.cookie ? "[present]" : undefined,
    };
    logDebug(options, `request headers ${JSON.stringify(summarizedHeaders)}`);
    const postData = request.postData();
    if (postData) {
      logDebug(options, `request body ${truncateForDebug(redactSensitiveRequestBody(url, postData))}`);
    }
  };

  const onResponse = async (response: import("patchright").Response) => {
    const url = response.url();
    if (!isInteresting(response.request())) {
      return;
    }

    logDebug(options, `response ${response.status()} ${response.request().method()} ${url}`);
    const text = await response.text().catch(() => "");
    if (text) {
      logDebug(options, `response body ${truncateForDebug(text)}`);
    }
  };

  const onRequestFailed = (request: import("patchright").Request) => {
    if (!isInteresting(request)) {
      return;
    }

    logDebug(
      options,
      `request failed ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    );
  };

  const onConsole = (message: import("patchright").ConsoleMessage) => {
    const text = message.text();
    if (
      text.includes("Failed to fetch") ||
      text.includes("CORS") ||
      text.includes("login") ||
      message.type() === "error"
    ) {
      logDebug(options, `console ${message.type()} ${truncateForDebug(text)}`);
    }
  };

  const onPageError = (error: Error) => {
    logDebug(options, `pageerror ${truncateForDebug(error.stack ?? error.message)}`);
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return () => {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  };
}

function truncateForDebug(value: string, maxLength = 600): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function redactSensitiveRequestBody(url: string, body: string): string {
  if (url === "https://global.americanexpress.com/myca/logon/us/action/login") {
    const params = new URLSearchParams(body);
    for (const key of ["UserID", "Password", "encryptedData", "signature"]) {
      if (params.has(key)) {
        params.set(key, "[redacted]");
      }
    }

    return params.toString();
  }

  return body;
}

function describeCookieDelta(
  before: Array<{ name: string; value: string }>,
  after: Array<{ name: string; value: string }>,
): {
  added: string[];
  changed: string[];
  removed: string[];
} {
  const beforeMap = new Map(before.map((cookie) => [cookie.name, cookie.value]));
  const afterMap = new Map(after.map((cookie) => [cookie.name, cookie.value]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [name, value] of afterMap) {
    if (!beforeMap.has(name)) {
      added.push(name);
      continue;
    }

    if (beforeMap.get(name) !== value) {
      changed.push(name);
    }
  }

  for (const name of beforeMap.keys()) {
    if (!afterMap.has(name)) {
      removed.push(name);
    }
  }

  return { added, changed, removed };
}

function createLoginResponseCapture(page: import("patchright").Page): {
  waitForResult(): Promise<LoginNavigationResult>;
  dispose(): void;
} {
  let resolveResult: ((value: LoginNavigationResult) => void) | undefined;
  let rejectResult: ((reason?: unknown) => void) | undefined;

  const resultPromise = new Promise<LoginNavigationResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const timeout = setTimeout(() => {
    rejectResult?.(new CliError("Timed out waiting for the Amex login response."));
  }, 15_000);

  const onResponse = async (response: import("patchright").Response) => {
    const request = response.request();
    if (
      request.method() === "POST" &&
      request.url() === "https://global.americanexpress.com/myca/logon/us/action/login"
    ) {
      clearTimeout(timeout);
      const responseText = await response.text().catch(() => "");
      resolveResult?.(parseLoginNavigationResponse(responseText) ?? { mfaRequired: false });
    }
  };

  page.on("response", onResponse);

  return {
    async waitForResult() {
      return resultPromise;
    },
    dispose() {
      clearTimeout(timeout);
      page.off("response", onResponse);
    },
  };
}

function parseLoginNavigationResponse(responseText: string): LoginNavigationResult | undefined {
  if (!responseText.trim().startsWith("{")) {
    return undefined;
  }

  try {
    const payload = JSON.parse(responseText) as {
      redirectUrl?: string;
      reauth?: {
        actionId?: string;
      };
    };
    return {
      mfaRequired: payload.reauth?.actionId?.startsWith("MFA") ?? false,
      ...(payload.redirectUrl ? { redirectUrl: payload.redirectUrl } : {}),
    };
  } catch {
    return undefined;
  }
}

function notifyMfaPrompt(options: Pick<CliOptions, "debug">, redirectUrl?: string): void {
  const lines = [
    "Amex MFA is required. Please approve the push notification in the Amex app.",
    redirectUrl ? `After approval, the session should continue to ${redirectUrl}.` : undefined,
  ].filter(Boolean);

  process.stderr.write(`${lines.join("\n")}\n`);
  logDebug(options, `Detected MFA requirement${redirectUrl ? ` redirectUrl=${redirectUrl}` : ""}`);
}


export function getRuntimeSession(session: AuthSession): RuntimeSession | undefined {
  const runtimeSessionId = session.metadata?.runtimeSessionId;
  if (typeof runtimeSessionId !== "string") {
    return undefined;
  }

  return runtimeSessions.get(runtimeSessionId);
}

export async function disposeRuntimeSession(session: AuthSession): Promise<void> {
  const runtimeSessionId = session.metadata?.runtimeSessionId;
  if (typeof runtimeSessionId !== "string") {
    return;
  }

  const runtime = runtimeSessions.get(runtimeSessionId);
  runtimeSessions.delete(runtimeSessionId);
  if (!runtime) {
    return;
  }

  await runtime.context.close();
}
