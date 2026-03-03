import { CliError } from "./errors.js";
import {
  handleAuthClear,
  handleAuthSet,
  handleAuthStatus,
  handleEnrollAllOffers,
  handleEnrollOffer,
  handleInteractive,
  handleServe,
  handleShow,
  handleSync,
} from "./commands.js";
import type { CliOptions, DataKind } from "./types.js";

const HELP_TEXT = `amex <command> [options]

Commands:
  interactive                                  Open the interactive app shell (default)
  ui [--port <port>]                           Open the local web UI in your browser
  web [--port <port>]                          Alias for ui
  sync [--json] [--debug] [--force-login]     Sync all data from Amex and cache it locally
  show [cards|benefits|offers|all] [--json] [--all|-a]
                                               Read cached data
  enroll offer (--offer-id <id> | --source-id <id>) [--card <last4> ... | --all-cards] [--json] [--debug]
                                               Enroll an Amex offer on one or more cards
  enroll all-offers [--card <last4> ...] [--json] [--debug]
                                               Enroll all eligible cached offers
  auth set                                     Store credentials securely
  auth status [--json]                         Show credential status
  auth clear                                   Delete stored credentials
  help                                         Show this help

Options:
  --json              Output JSON
  --debug             Open a visible browser and print auth debug logs
  --all, -a           Include canceled cards in show cards
  --username <value>  Username for auth set
  --password <value>  Password for auth set
  --status <value>    Filter show offers by enrolled, eligible, or other
  --card <last4>      Filter show offers by card ending
  --offer-id <value>  Offer id for enroll offer
  --source-id <value> Stable source id for enroll offer
  --all-cards         Enroll the offer on every eligible cached card
  --force-login       Skip cached session and force a fresh browser login
  --port <value>      Port for the local web UI server
`;

export async function runCli(argv: string[]): Promise<void> {
  try {
    await dispatch(argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }

    throw error;
  }
}

async function dispatch(argv: string[]): Promise<void> {
  const [command, arg1, arg2, ...rest] = argv;
  const options = parseOptions([arg1, arg2, ...rest]);
  const effectiveCommand = command ?? "interactive";

  switch (effectiveCommand) {
    case "sync":
      if (arg1 && !isOption(arg1)) {
        throw new CliError("`sync` no longer accepts a target. Use `amex sync` to fetch everything.");
      }
      await handleSync(options);
      return;
    case "ui":
    case "web":
    case "serve":
      await handleServe(options);
      return;
    case "show":
      await handleShow(parseTarget(arg1), options);
      return;
    case "enroll":
      await handleEnroll(arg1, options);
      return;
    case "interactive":
      await handleInteractive();
      return;
    case "auth":
      await handleAuth(arg1, options);
      return;
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP_TEXT);
      return;
    default:
      throw new CliError(`Unknown command: ${effectiveCommand}\n\n${HELP_TEXT}`);
  }
}

async function handleAuth(subcommand: string | undefined, options: CliOptions): Promise<void> {
  switch (subcommand) {
    case "set":
      await handleAuthSet(options);
      return;
    case "status":
      await handleAuthStatus(options);
      return;
    case "clear":
      await handleAuthClear();
      return;
    default:
      throw new CliError(`Unknown auth command: ${subcommand ?? "(missing)"}\n\n${HELP_TEXT}`);
  }
}

async function handleEnroll(subcommand: string | undefined, options: CliOptions): Promise<void> {
  switch (subcommand) {
    case "offer":
      await handleEnrollOffer(options);
      return;
    case "all-offers":
      await handleEnrollAllOffers(options);
      return;
    default:
      throw new CliError(`Unknown enroll command: ${subcommand ?? "(missing)"}\n\n${HELP_TEXT}`);
  }
}

function parseTarget(raw: string | undefined): DataKind | "all" {
  switch (raw) {
    case undefined:
      return "all";
    case "cards":
    case "benefits":
    case "offers":
    case "all":
      return raw;
    default:
      if (isOption(raw)) {
        return "all";
      }
      throw new CliError("Expected target: cards, benefits, offers, or all.");
  }
}

function parseOptions(args: Array<string | undefined>): CliOptions {
  const offerStatus = readOptionValue(args, "--status");
  if (offerStatus && !["enrolled", "eligible", "other"].includes(offerStatus)) {
    throw new CliError("Expected --status to be one of: enrolled, eligible, other.");
  }

  return {
    json: args.includes("--json"),
    debug: args.includes("--debug"),
    includeCanceled: args.includes("--all") || args.includes("-a"),
    forceLogin: args.includes("--force-login"),
    port: readPortValue(args, "--port"),
    offerStatus: offerStatus as CliOptions["offerStatus"],
    offerCard: readRawOptionValue(args, "--card"),
    offerCards: readRawOptionValues(args, "--card"),
    offerId: readRawOptionValue(args, "--offer-id"),
    offerSourceId: readRawOptionValue(args, "--source-id"),
    enrollAllCards: args.includes("--all-cards"),
    authUsername: readRawOptionValue(args, "--username"),
    authPassword: readRawOptionValue(args, "--password"),
  };
}

function readPortValue(args: Array<string | undefined>, option: string): number | undefined {
  const value = readRawOptionValue(args, option);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new CliError(`Expected ${option} to be a valid port number.`);
  }

  return parsed;
}

function isOption(value: string): boolean {
  return value.startsWith("-");
}

function readOptionValue(args: Array<string | undefined>, option: string): string | undefined {
  const value = readRawOptionValue(args, option);
  return value?.toLowerCase();
}

function readRawOptionValue(args: Array<string | undefined>, option: string): string | undefined {
  const index = args.findIndex((arg) => arg === option);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || isOption(value)) {
    throw new CliError(`Expected a value after ${option}.`);
  }

  return value;
}

function readRawOptionValues(args: Array<string | undefined>, option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) {
      continue;
    }

    const value = args[index + 1];
    if (!value || isOption(value)) {
      throw new CliError(`Expected a value after ${option}.`);
    }

    values.push(value);
  }

  return values;
}
