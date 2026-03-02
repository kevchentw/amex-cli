import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { OfferEnrollmentResult, OfferEnrollmentTarget } from "./types.js";

export interface AppCardsItem {
  id: string;
  name: string;
  last4: string;
  status: string;
  member: string;
  kind: string;
  relationship: string;
  createdAt: string;
  balance: string;
  parentLast4: string | undefined;
}

export interface AppOfferItem {
  id: string;
  cardId: string;
  title: string;
  last4: string;
  cardName: string;
  status: string;
  expiresAt: string | undefined;
  description: string | undefined;
  locale: string;
}

interface AppOfferGroup {
  id: string;
  title: string;
  description: string | undefined;
  rows: AppOfferItem[];
}

interface OfferStatusCounts {
  total: number;
  enrolled: number;
  eligible: number;
  other: number;
}

interface OfferActivityItem {
  tone: "info" | "success" | "error";
  text: string;
}

interface OfferActivityScope {
  kind: "offer" | "all";
  offerId?: string;
  title: string;
}

interface OfferEnrollmentProgress {
  sessionMessage?: string;
  actionMessage?: string;
  activity?: OfferActivityItem;
}

export interface BenefitsInkSummary {
  totalBenefits: number;
  completedBenefits: number;
  inProgressBenefits: number;
  notStartedBenefits: number;
}

export interface BenefitsInkRow {
  last4: string;
  cardName: string;
  displayStatus: "Completed" | "In Progress" | "Not Started";
  progress: string;
}

export interface BenefitsInkGroup {
  title: string;
  trackerDuration: string | undefined;
  period: string;
  rows: BenefitsInkRow[];
}

export async function runInteractiveAppView(input: {
  syncedAt: {
    cards?: string;
    benefits?: string;
    offers?: string;
  };
  cards: AppCardsItem[];
  benefits: {
    groups: BenefitsInkGroup[];
    summary: BenefitsInkSummary;
  };
  offers: AppOfferItem[];
  onEnrollOffer?: (
    targets: OfferEnrollmentTarget[],
    onProgress?: (progress: OfferEnrollmentProgress) => void,
  ) => Promise<{
    results: OfferEnrollmentResult[];
    offers: AppOfferItem[];
    syncedAt: string;
    sessionStatus?: string | undefined;
  }>;
  onEnrollAllOffers?: (onProgress?: (progress: OfferEnrollmentProgress) => void) => Promise<{
    results: OfferEnrollmentResult[];
    offers: AppOfferItem[];
    syncedAt: string;
    sessionStatus?: string | undefined;
  }>;
}): Promise<void> {
  const instance = render(<InteractiveApp {...input} />, {
    stdout: process.stdout,
    stdin: process.stdin,
    stderr: process.stderr,
    patchConsole: false,
  });

  await instance.waitUntilExit();
}

type TabId = "members" | "benefits" | "offers";
type BenefitPeriodFilter = "all" | "annual" | "semi-annual" | "quarterly" | "monthly";
type BenefitStatusFilter = "all" | "in-progress" | "not-started" | "completed";
type OfferStatusFilter = "all" | "enrolled" | "eligible" | "other";
type OffersPane = "groups" | "rows";

function InteractiveApp({
  syncedAt,
  cards,
  benefits,
  offers,
  onEnrollOffer,
  onEnrollAllOffers,
}: {
  syncedAt: {
    cards?: string;
    benefits?: string;
    offers?: string;
  };
  cards: AppCardsItem[];
  benefits: {
    groups: BenefitsInkGroup[];
    summary: BenefitsInkSummary;
  };
  offers: AppOfferItem[];
  onEnrollOffer?: (
    targets: OfferEnrollmentTarget[],
    onProgress?: (progress: OfferEnrollmentProgress) => void,
  ) => Promise<{
    results: OfferEnrollmentResult[];
    offers: AppOfferItem[];
    syncedAt: string;
    sessionStatus?: string | undefined;
  }>;
  onEnrollAllOffers?: (onProgress?: (progress: OfferEnrollmentProgress) => void) => Promise<{
    results: OfferEnrollmentResult[];
    offers: AppOfferItem[];
    syncedAt: string;
    sessionStatus?: string | undefined;
  }>;
}) {
  const { exit } = useApp();
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "members", label: "Members" },
    { id: "benefits", label: "Benefits" },
    { id: "offers", label: "Offers" },
  ];

  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [selectedBenefitIndex, setSelectedBenefitIndex] = useState(0);
  const [selectedOfferIndex, setSelectedOfferIndex] = useState(0);
  const [selectedOfferId, setSelectedOfferId] = useState<string | undefined>();
  const [selectedOfferRowIndex, setSelectedOfferRowIndex] = useState(0);
  const [activeOffersPane, setActiveOffersPane] = useState<OffersPane>("groups");
  const [showCanceledCards, setShowCanceledCards] = useState(false);
  const [benefitPeriodFilter, setBenefitPeriodFilter] = useState<BenefitPeriodFilter>("all");
  const [benefitStatusFilter, setBenefitStatusFilter] = useState<BenefitStatusFilter>("all");
  const [offerStatusFilter, setOfferStatusFilter] = useState<OfferStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [offersState, setOffersState] = useState(offers);
  const [syncedAtState, setSyncedAtState] = useState(syncedAt);
  const [offerActionMessage, setOfferActionMessage] = useState<string | undefined>();
  const [offerSessionMessage, setOfferSessionMessage] = useState<string | undefined>();
  const [offerActionPending, setOfferActionPending] = useState(false);
  const [selectedOfferRows, setSelectedOfferRows] = useState<Set<string>>(new Set());
  const [offerActivity, setOfferActivity] = useState<OfferActivityItem[]>([]);
  const [offerActivityScope, setOfferActivityScope] = useState<OfferActivityScope | undefined>();

  const selectedTab = tabs[selectedTabIndex]?.id ?? "members";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const appendOfferActivity = (tone: OfferActivityItem["tone"], text: string) => {
    setOfferActivity((current) => [...current, { tone, text }].slice(-8));
  };
  const applyOfferProgress = (progress: OfferEnrollmentProgress) => {
    if (progress.sessionMessage !== undefined) {
      setOfferSessionMessage(progress.sessionMessage);
    }
    if (progress.actionMessage !== undefined) {
      setOfferActionMessage(progress.actionMessage);
    }
    if (progress.activity) {
      appendOfferActivity(progress.activity.tone, progress.activity.text);
    }
  };
  const visibleCards = useMemo(
    () =>
      cards.filter((card) => {
        if (!showCanceledCards && card.status.toLowerCase().includes("canceled")) {
          return false;
        }

        if (!normalizedSearchQuery) {
          return true;
        }

        return [
          card.last4,
          card.name,
          card.member,
          card.kind,
          card.relationship,
          card.status,
          card.parentLast4,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedSearchQuery));
      }),
    [cards, normalizedSearchQuery, showCanceledCards],
  );
  const visibleBenefitGroups = useMemo(() => {
    return benefits.groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) =>
          benefitStatusFilter === "all" ? true : normalizeBenefitStatus(row.displayStatus) === benefitStatusFilter,
        ),
      }))
      .filter((group) => group.rows.length > 0)
      .filter((group) =>
        (benefitPeriodFilter === "all"
          ? true
          : normalizeBenefitPeriod(group.trackerDuration) === benefitPeriodFilter) &&
        (normalizedSearchQuery
          ? [
              group.title,
              group.trackerDuration,
              group.period,
              ...group.rows.flatMap((row) => [row.last4, row.cardName, row.displayStatus, row.progress]),
            ]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(normalizedSearchQuery))
          : true),
      );
  }, [benefitPeriodFilter, benefitStatusFilter, benefits.groups, normalizedSearchQuery]);
  const visibleBenefitSummary = useMemo(() => {
    const rows = visibleBenefitGroups.flatMap((group) => group.rows);
    return {
      totalBenefits: rows.length,
      completedBenefits: rows.filter((row) => row.displayStatus === "Completed").length,
      inProgressBenefits: rows.filter((row) => row.displayStatus === "In Progress").length,
      notStartedBenefits: rows.filter((row) => row.displayStatus === "Not Started").length,
    };
  }, [visibleBenefitGroups]);
  const visibleOffers = useMemo(
    () =>
      offersState.filter((offer) => {
        if (offerStatusFilter !== "all" && normalizeOfferStatus(offer.status) !== offerStatusFilter) {
          return false;
        }

        if (!normalizedSearchQuery) {
          return true;
        }

        return [offer.title, offer.last4, offer.cardName, offer.status, offer.expiresAt, offer.description]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedSearchQuery));
      }),
    [normalizedSearchQuery, offerStatusFilter, offersState],
  );
  const visibleOfferGroups = useMemo(() => groupOffers(visibleOffers), [visibleOffers]);

  useEffect(() => {
    if (visibleCards.length === 0) {
      setSelectedCardIndex(0);
      return;
    }

    if (selectedCardIndex >= visibleCards.length) {
      setSelectedCardIndex(visibleCards.length - 1);
    }
  }, [selectedCardIndex, visibleCards]);

  useEffect(() => {
    if (visibleBenefitGroups.length === 0) {
      setSelectedBenefitIndex(0);
      return;
    }

    if (selectedBenefitIndex >= visibleBenefitGroups.length) {
      setSelectedBenefitIndex(visibleBenefitGroups.length - 1);
    }
  }, [selectedBenefitIndex, visibleBenefitGroups]);

  useEffect(() => {
    if (visibleOfferGroups.length === 0) {
      setSelectedOfferId(undefined);
      setSelectedOfferIndex(0);
      return;
    }

    if (selectedOfferId) {
      const preservedIndex = visibleOfferGroups.findIndex((group) => group.id === selectedOfferId);
      if (preservedIndex !== -1 && preservedIndex !== selectedOfferIndex) {
        setSelectedOfferIndex(preservedIndex);
        return;
      }
    }

    if (selectedOfferIndex >= visibleOfferGroups.length) {
      setSelectedOfferIndex(visibleOfferGroups.length - 1);
    }
  }, [selectedOfferId, selectedOfferIndex, visibleOfferGroups]);

  const selectedOfferGroup = visibleOfferGroups[selectedOfferIndex];
  const selectedOfferGroupRows = selectedOfferGroup?.rows ?? [];
  const visibleOfferActivity =
    offerActivityScope &&
    (offerActivityScope.kind === "all" || offerActivityScope.offerId === selectedOfferGroup?.id)
      ? offerActivity
      : [];
  const visibleOfferActionMessage =
    offerActivityScope &&
    (offerActivityScope.kind === "all" || offerActivityScope.offerId === selectedOfferGroup?.id)
      ? offerActionMessage
      : undefined;
  const visibleOfferSessionMessage =
    offerActivityScope &&
    (offerActivityScope.kind === "all" || offerActivityScope.offerId === selectedOfferGroup?.id)
      ? offerSessionMessage
      : undefined;

  useEffect(() => {
    if (selectedOfferGroupRows.length === 0) {
      setSelectedOfferRowIndex(0);
      return;
    }

    if (selectedOfferRowIndex >= selectedOfferGroupRows.length) {
      setSelectedOfferRowIndex(selectedOfferGroupRows.length - 1);
    }
  }, [selectedOfferGroupRows, selectedOfferRowIndex]);

  useInput((inputKey, key) => {
    if (isSearching) {
      if (key.escape || key.return) {
        setIsSearching(false);
        return;
      }

      if (key.backspace || key.delete) {
        setSearchQuery((current) => current.slice(0, -1));
        return;
      }

      if (!key.ctrl && !key.meta && inputKey.length === 1) {
        setSearchQuery((current) => current + inputKey);
      }
      return;
    }

    if (inputKey === "q" || (key.ctrl && inputKey === "c")) {
      exit();
      return;
    }

    if (inputKey === "/") {
      setIsSearching(true);
      return;
    }

    if (inputKey === "x") {
      setSearchQuery("");
      return;
    }

    if (selectedTab === "offers" && key.leftArrow) {
      setActiveOffersPane("groups");
      return;
    }

    if (selectedTab === "offers" && key.rightArrow) {
      setActiveOffersPane("rows");
      return;
    }

    if (key.leftArrow) {
      setSelectedTabIndex((current) => (current === 0 ? tabs.length - 1 : current - 1));
      return;
    }

    if (key.tab) {
      setSelectedTabIndex((current) => (current === tabs.length - 1 ? 0 : current + 1));
      return;
    }

    if (key.upArrow) {
      if (selectedTab === "members") {
        setSelectedCardIndex((current) => (current === 0 ? Math.max(visibleCards.length - 1, 0) : current - 1));
      } else if (selectedTab === "benefits") {
        setSelectedBenefitIndex((current) => (current === 0 ? Math.max(visibleBenefitGroups.length - 1, 0) : current - 1));
      } else if (activeOffersPane === "groups") {
        setSelectedOfferIndex((current) => {
          const next = current === 0 ? Math.max(visibleOfferGroups.length - 1, 0) : current - 1;
          setSelectedOfferId(visibleOfferGroups[next]?.id);
          return next;
        });
      } else {
        setSelectedOfferRowIndex((current) =>
          current === 0 ? Math.max(selectedOfferGroupRows.length - 1, 0) : current - 1,
        );
      }
      return;
    }

    if (key.downArrow) {
      if (selectedTab === "members") {
        setSelectedCardIndex((current) => (current === visibleCards.length - 1 ? 0 : current + 1));
      } else if (selectedTab === "benefits") {
        setSelectedBenefitIndex((current) =>
          current === visibleBenefitGroups.length - 1 ? 0 : current + 1,
        );
      } else if (activeOffersPane === "groups") {
        setSelectedOfferIndex((current) => {
          const next = current === visibleOfferGroups.length - 1 ? 0 : current + 1;
          setSelectedOfferId(visibleOfferGroups[next]?.id);
          return next;
        });
      } else {
        setSelectedOfferRowIndex((current) =>
          current === selectedOfferGroupRows.length - 1 ? 0 : current + 1,
        );
      }
      return;
    }

    if (selectedTab === "members" && inputKey === "a") {
      setShowCanceledCards((current) => !current);
      return;
    }

    if (selectedTab === "benefits") {
      if (inputKey === "1") {
        setBenefitPeriodFilter("all");
        return;
      }

      if (inputKey === "2") {
        setBenefitPeriodFilter("annual");
        return;
      }

      if (inputKey === "3") {
        setBenefitPeriodFilter("monthly");
        return;
      }

      if (inputKey === "4") {
        setBenefitPeriodFilter("quarterly");
        return;
      }

      if (inputKey === "5") {
        setBenefitPeriodFilter("semi-annual");
        return;
      }

      if (inputKey === "0") {
        setBenefitStatusFilter("all");
        return;
      }

      if (inputKey === "i") {
        setBenefitStatusFilter("in-progress");
        return;
      }

      if (inputKey === "n") {
        setBenefitStatusFilter("not-started");
        return;
      }

      if (inputKey === "c") {
        setBenefitStatusFilter("completed");
        return;
      }
    }

    if (selectedTab === "offers") {
      if (inputKey === "c") {
        setSelectedOfferRows(new Set());
        setOfferActionMessage("Cleared selected cards.");
        appendOfferActivity("info", "Cleared selected cards.");
        return;
      }

      if (inputKey === " ") {
        const selectedRow = selectedOfferGroupRows[selectedOfferRowIndex];
        if (!selectedRow || normalizeOfferStatus(selectedRow.status) !== "eligible") {
          setOfferActionMessage("Only eligible cards can be selected for enrollment.");
          appendOfferActivity("error", "Only eligible cards can be selected for enrollment.");
          return;
        }

        const key = offerRowKey(selectedRow);
        setSelectedOfferRows((current) => {
          const next = new Set(current);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        return;
      }

      if (key.return && !offerActionPending && onEnrollOffer) {
        const selectedTargets = selectedOfferGroupRows
          .filter((row) => selectedOfferRows.has(offerRowKey(row)))
          .filter((row) => normalizeOfferStatus(row.status) === "eligible");

        if (selectedTargets.length === 0) {
          setOfferActionMessage("No eligible cards selected. Use [ ] to move and Space to toggle cards.");
          appendOfferActivity("error", "No eligible cards selected. Use [ ] to move and Space to toggle cards.");
          return;
        }

        setOfferActionPending(true);
        setOfferSessionMessage("Checking existing browser session...");
        setOfferActionMessage(`Enrolling ${selectedTargets.length} selected card(s) for ${selectedOfferGroup?.title ?? "offer"}...`);
        setOfferActivity([]);
        setOfferActivityScope({
          kind: "offer",
          title: selectedOfferGroup?.title ?? "offer",
          ...(selectedOfferGroup?.id ? { offerId: selectedOfferGroup.id } : {}),
        });
        appendOfferActivity(
          "info",
          `Starting ${selectedOfferGroup?.title ?? "offer"} on ${selectedTargets.length} selected card(s)...`,
        );
        void onEnrollOffer(
          selectedTargets.map((row) => ({
            offerId: row.id,
            accountNumberProxy: row.cardId,
            last4: row.last4,
            cardName: row.cardName,
            locale: row.locale,
          })),
          applyOfferProgress,
        )
          .then((result) => {
            const succeeded = result.results.filter((entry) => entry.statusPurpose === "SUCCESS");
            const failed = result.results.filter((entry) => entry.statusPurpose !== "SUCCESS");
            if (result.sessionStatus === "reused") {
              setOfferSessionMessage("Session: reused saved browser session.");
              appendOfferActivity("info", "Reused existing browser session.");
            } else if (result.sessionStatus === "reused-live") {
              setOfferSessionMessage("Session: reused active interactive session.");
              appendOfferActivity("info", "Reused active interactive session.");
            } else if (result.sessionStatus === "fallback-fresh") {
              setOfferSessionMessage("Session: saved session invalid, used fresh login.");
              appendOfferActivity("info", "Existing session was invalid. Fell back to a fresh login.");
            } else if (result.sessionStatus === "fresh") {
              setOfferSessionMessage("Session: used fresh browser login.");
              appendOfferActivity("info", "Used a fresh browser login.");
            } else {
              setOfferSessionMessage(undefined);
            }
            setOffersState(result.offers);
            setSyncedAtState((current) => ({ ...current, offers: result.syncedAt }));
            setSelectedOfferRows(new Set());
            setSelectedOfferId(selectedOfferGroup?.id);
            setOfferActionMessage(
              `${selectedOfferGroup?.title ?? "offer"}: ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            appendOfferActivity(
              "success",
              `Completed ${selectedOfferGroup?.title ?? "offer"}: ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            for (const enrollment of result.results) {
              appendOfferActivity(
                enrollment.statusPurpose === "SUCCESS" ? "success" : "error",
                `${enrollment.last4} | ${enrollment.cardName} | ${enrollment.statusMessage}`,
              );
            }
          })
          .catch((error: unknown) => {
            setOfferActionMessage(error instanceof Error ? error.message : String(error));
            appendOfferActivity("error", error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setOfferActionPending(false);
          });
        return;
      }

      if (inputKey === "f" && !offerActionPending && onEnrollOffer) {
        const selectedGroup = visibleOfferGroups[selectedOfferIndex];
        if (!selectedGroup) {
          return;
        }

        const eligibleRows = selectedGroup.rows.filter((row) => normalizeOfferStatus(row.status) === "eligible");
        if (eligibleRows.length === 0) {
          setOfferActionMessage("Selected offer has no eligible cards to enroll.");
          appendOfferActivity("error", "Selected offer has no eligible cards to enroll.");
          return;
        }

        setOfferActionPending(true);
        setOfferSessionMessage("Checking existing browser session...");
        setOfferActionMessage(`Enrolling ${selectedGroup.title} on ${eligibleRows.length} eligible card(s)...`);
        setOfferActivity([]);
        setOfferActivityScope({
          kind: "offer",
          offerId: selectedGroup.id,
          title: selectedGroup.title,
        });
        appendOfferActivity("info", `Starting ${selectedGroup.title} on ${eligibleRows.length} eligible card(s)...`);
        void onEnrollOffer(
          eligibleRows.map((row) => ({
            offerId: row.id,
            accountNumberProxy: row.cardId,
            last4: row.last4,
            cardName: row.cardName,
            locale: row.locale,
          })),
          applyOfferProgress,
        )
          .then((result) => {
            const succeeded = result.results.filter((entry) => entry.statusPurpose === "SUCCESS");
            const failed = result.results.filter((entry) => entry.statusPurpose !== "SUCCESS");
            if (result.sessionStatus === "reused") {
              setOfferSessionMessage("Session: reused saved browser session.");
              appendOfferActivity("info", "Reused existing browser session.");
            } else if (result.sessionStatus === "reused-live") {
              setOfferSessionMessage("Session: reused active interactive session.");
              appendOfferActivity("info", "Reused active interactive session.");
            } else if (result.sessionStatus === "fallback-fresh") {
              setOfferSessionMessage("Session: saved session invalid, used fresh login.");
              appendOfferActivity("info", "Existing session was invalid. Fell back to a fresh login.");
            } else if (result.sessionStatus === "fresh") {
              setOfferSessionMessage("Session: used fresh browser login.");
              appendOfferActivity("info", "Used a fresh browser login.");
            } else {
              setOfferSessionMessage(undefined);
            }
            setOffersState(result.offers);
            setSyncedAtState((current) => ({ ...current, offers: result.syncedAt }));
            setSelectedOfferRows(new Set());
            setSelectedOfferId(selectedGroup.id);
            setOfferActionMessage(
              `${selectedGroup.title}: ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            appendOfferActivity(
              "success",
              `Completed ${selectedGroup.title}: ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            for (const enrollment of result.results) {
              appendOfferActivity(
                enrollment.statusPurpose === "SUCCESS" ? "success" : "error",
                `${enrollment.last4} | ${enrollment.cardName} | ${enrollment.statusMessage}`,
              );
            }
          })
          .catch((error: unknown) => {
            setOfferActionMessage(error instanceof Error ? error.message : String(error));
            appendOfferActivity("error", error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setOfferActionPending(false);
          });
        return;
      }

      if (inputKey === "a" && !offerActionPending && onEnrollAllOffers) {
        setOfferActionPending(true);
        setOfferSessionMessage("Checking existing browser session...");
        setOfferActionMessage("Enrolling all eligible offers...");
        setOfferActivity([]);
        setOfferActivityScope({
          kind: "all",
          title: "All eligible offers",
        });
        appendOfferActivity("info", "Starting all eligible offers enrollment...");
        void onEnrollAllOffers(applyOfferProgress)
          .then((result) => {
            const succeeded = result.results.filter((entry) => entry.statusPurpose === "SUCCESS");
            const failed = result.results.filter((entry) => entry.statusPurpose !== "SUCCESS");
            if (result.sessionStatus === "reused") {
              setOfferSessionMessage("Session: reused saved browser session.");
              appendOfferActivity("info", "Reused existing browser session.");
            } else if (result.sessionStatus === "reused-live") {
              setOfferSessionMessage("Session: reused active interactive session.");
              appendOfferActivity("info", "Reused active interactive session.");
            } else if (result.sessionStatus === "fallback-fresh") {
              setOfferSessionMessage("Session: saved session invalid, used fresh login.");
              appendOfferActivity("info", "Existing session was invalid. Fell back to a fresh login.");
            } else if (result.sessionStatus === "fresh") {
              setOfferSessionMessage("Session: used fresh browser login.");
              appendOfferActivity("info", "Used a fresh browser login.");
            } else {
              setOfferSessionMessage(undefined);
            }
            setOffersState(result.offers);
            setSyncedAtState((current) => ({ ...current, offers: result.syncedAt }));
            setSelectedOfferRows(new Set());
            setOfferActionMessage(
              `${new Set(result.results.map((row) => row.offerId)).size} offer(s): ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            appendOfferActivity(
              "success",
              `Completed ${new Set(result.results.map((row) => row.offerId)).size} offer(s): ${succeeded.length} succeeded, ${failed.length} failed.`,
            );
            for (const enrollment of result.results) {
              appendOfferActivity(
                enrollment.statusPurpose === "SUCCESS" ? "success" : "error",
                `${enrollment.offerId} | ${enrollment.last4} | ${enrollment.statusMessage}`,
              );
            }
          })
          .catch((error: unknown) => {
            setOfferActionMessage(error instanceof Error ? error.message : String(error));
            appendOfferActivity("error", error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            setOfferActionPending(false);
          });
        return;
      }

      if (inputKey === "0") {
        setOfferStatusFilter("all");
        return;
      }

      if (inputKey === "e") {
        setOfferStatusFilter("enrolled");
        return;
      }

      if (inputKey === "g") {
        setOfferStatusFilter("eligible");
        return;
      }

      if (inputKey === "o") {
        setOfferStatusFilter("other");
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Amex CLI
      </Text>
      <Text color="gray">
        Keys: [Tab] switch tab  [↑/↓] move  [/] search  [x] clear  [q] quit
      </Text>
      {selectedTab === "members" ? <Text color="gray">Members: [a] toggle canceled</Text> : null}
      {selectedTab === "benefits" ? (
        <>
          <Text color="gray">Benefits period: [1] all  [2] annual  [3] monthly  [4] quarterly  [5] semi-annual</Text>
          <Text color="gray">Benefits status: [0] all  [i] in-progress  [n] not-started  [c] completed</Text>
        </>
      ) : null}
      {selectedTab === "offers" ? (
        <>
          <Text color="gray">Offers nav: [←/→] switch pane  [↑/↓] move in focused pane  [Space] toggle card  [Enter] add selected</Text>
          <Text color="gray">Offers actions: [a] add all offers  [f] add focused offer to all cards  [c] clear selected</Text>
          <Text color="gray">Offers filters: [0] all  [e] enrolled  [g] eligible  [o] other</Text>
        </>
      ) : null}
      <Text color={isSearching ? "cyan" : "gray"}>
        Search: {searchQuery || "(none)"} {isSearching ? "| typing... Enter/Esc done" : ""}
      </Text>
      <Box marginTop={1} marginBottom={1}>
        {tabs.map((tab, index) => (
          <Box key={tab.id} marginRight={2}>
            <Text color={index === selectedTabIndex ? "cyan" : "gray"} bold={index === selectedTabIndex}>
              {index === selectedTabIndex ? `[${tab.label}]` : tab.label}
            </Text>
          </Box>
        ))}
      </Box>

      {selectedTab === "members" ? (
        <MembersTab
          cards={visibleCards}
          syncedAt={syncedAt.cards}
          selectedIndex={selectedCardIndex}
          showCanceledCards={showCanceledCards}
        />
      ) : null}
      {selectedTab === "benefits" ? (
        <BenefitsTab
          visibleGroups={visibleBenefitGroups}
          summary={visibleBenefitSummary}
          syncedAt={syncedAt.benefits}
          selectedIndex={selectedBenefitIndex}
          filter={benefitPeriodFilter}
          statusFilter={benefitStatusFilter}
        />
      ) : null}
      {selectedTab === "offers" ? (
        <OffersTab
          groups={visibleOfferGroups}
          syncedAt={syncedAtState.offers}
          selectedIndex={selectedOfferIndex}
          statusFilter={offerStatusFilter}
          activity={visibleOfferActivity}
          actionPending={offerActionPending}
          selectedRowIndex={selectedOfferRowIndex}
          selectedRows={selectedOfferRows}
          activePane={activeOffersPane}
          {...(visibleOfferSessionMessage ? { sessionMessage: visibleOfferSessionMessage } : {})}
          {...(offerActivityScope ? { activityScope: offerActivityScope } : {})}
          {...(visibleOfferActionMessage ? { actionMessage: visibleOfferActionMessage } : {})}
        />
      ) : null}
    </Box>
  );
}

function MembersTab({
  cards,
  syncedAt,
  selectedIndex,
  showCanceledCards,
}: {
  cards: AppCardsItem[];
  syncedAt: string | undefined;
  selectedIndex: number;
  showCanceledCards: boolean;
}) {
  const selected = cards[selectedIndex];
  const { visibleItems, startIndex, hiddenAbove, hiddenBelow } = getVisibleWindow(cards, selectedIndex, 18);

  if (!selected) {
    return <Text>No members matched the current filters.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="gray">
        Members synced: {syncedAt ?? "unknown"} | {showCanceledCards ? "showing all cards" : "showing active cards"}
      </Text>
      <Box marginTop={1}>
        <Box flexDirection="column" width={46} marginRight={2}>
          {hiddenAbove > 0 ? <Text color="gray">... {hiddenAbove} above</Text> : null}
          {visibleItems.map((card, index) => {
            const actualIndex = startIndex + index;
            const selectedRow = actualIndex === selectedIndex;
            return (
              <Text key={card.id} {...(selectedRow ? { color: "cyan" as const } : {})} bold={selectedRow}>
                {selectedRow ? "> " : "  "}
                {formatMemberListLabel(card)}
              </Text>
            );
          })}
          {hiddenBelow > 0 ? <Text color="gray">... {hiddenBelow} below</Text> : null}
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Text bold>
            {selected.name} ending {selected.last4}
          </Text>
          <Text color="gray">Member: {selected.member}</Text>
          {selected.relationship === "SUPP" && selected.parentLast4 ? (
            <Text color="gray">Primary Card: {selected.parentLast4}</Text>
          ) : null}
          <Text color="gray">Kind: {selected.kind}</Text>
          <Text color="gray">Created: {selected.createdAt}</Text>
          <Text color="gray">Balance: {selected.balance}</Text>
          <Text color={selected.status.toLowerCase().includes("active") ? "green" : "yellow"}>
            Status: {selected.status} ({selected.relationship})
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function BenefitsTab({
  visibleGroups,
  summary,
  syncedAt,
  selectedIndex,
  filter,
  statusFilter,
}: {
  visibleGroups: BenefitsInkGroup[];
  summary: BenefitsInkSummary;
  syncedAt: string | undefined;
  selectedIndex: number;
  filter: BenefitPeriodFilter;
  statusFilter: BenefitStatusFilter;
}) {
  const selected = visibleGroups[selectedIndex];
  const { visibleItems, startIndex, hiddenAbove, hiddenBelow } = getVisibleWindow(visibleGroups, selectedIndex, 18);

  if (!selected) {
    return <Text>No benefits matched the current filters.</Text>;
  }

  const selectedCounts = summarizeStatusCounts(selected.rows);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">Benefits synced: {syncedAt ?? "unknown"}</Text>
        <Text>  </Text>
        <Text color="gray">Filter: {formatBenefitFilterLabel(filter)}</Text>
        <Text>  </Text>
        <Text color="gray">Status: {formatBenefitStatusFilterLabel(statusFilter)}</Text>
      </Box>
      <Box>
        <Text color="gray">Overall:</Text>
        <Text> </Text>
        <Text color="cyan">Total {summary.totalBenefits}</Text>
        <Text>  </Text>
        <Text color="green">Completed {summary.completedBenefits}</Text>
        <Text>  </Text>
        <Text color="blue">In Progress {summary.inProgressBenefits}</Text>
        <Text>  </Text>
        <Text color="yellow">Not Started {summary.notStartedBenefits}</Text>
      </Box>
      <Box marginTop={1}>
        <Box flexDirection="column" width={52} marginRight={2}>
          {hiddenAbove > 0 ? <Text color="gray">... {hiddenAbove} above</Text> : null}
          {visibleItems.map((group, index) => {
            const actualIndex = startIndex + index;
            const selectedRow = actualIndex === selectedIndex;
            const counts = summarizeStatusCounts(group.rows);
            return (
              <Box key={group.title}>
                <Text {...(selectedRow ? { color: "cyan" as const } : {})} bold={selectedRow}>
                  {selectedRow ? "> " : "  "}
                  {group.title}
                </Text>
                <Text> </Text>
                <Text color="green">{counts.completed}</Text>
                <Text> </Text>
                <Text color="blue">{counts.inProgress}</Text>
                <Text> </Text>
                <Text color="yellow">{counts.notStarted}</Text>
              </Box>
            );
          })}
          {hiddenBelow > 0 ? <Text color="gray">... {hiddenBelow} below</Text> : null}
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Text bold>{selected.title}</Text>
          <Text color="gray">
            Schedule: {[selected.trackerDuration, selected.period].filter(Boolean).join(" | ")}
          </Text>
          <Text color="gray">
            Summary: {summarizeStatuses(selected.rows)}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {selected.rows.map((row) => (
              <Text key={`${selected.title}:${row.last4}`}>
                <Text color="cyan">{row.last4}</Text>
                <Text> | </Text>
                <Text>{row.cardName}</Text>
                <Text> | </Text>
                <Text color={statusColor(row.displayStatus)}>{row.displayStatus}</Text>
                <Text> | </Text>
                <Text>{row.progress}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function OffersTab({
  groups,
  syncedAt,
  selectedIndex,
  statusFilter,
  activity,
  sessionMessage,
  activityScope,
  actionMessage,
  actionPending,
  selectedRowIndex,
  selectedRows,
  activePane,
}: {
  groups: AppOfferGroup[];
  syncedAt: string | undefined;
  selectedIndex: number;
  statusFilter: OfferStatusFilter;
  activity: OfferActivityItem[];
  sessionMessage?: string;
  activityScope?: OfferActivityScope;
  actionMessage?: string;
  actionPending: boolean;
  selectedRowIndex: number;
  selectedRows: Set<string>;
  activePane: OffersPane;
}) {
  const selected = groups[selectedIndex];
  const { visibleItems, startIndex, hiddenAbove, hiddenBelow } = getVisibleWindow(groups, selectedIndex, 18);
  const overallCounts = summarizeOfferGroupStatusCounts(groups);
  const selectedCounts = selected ? summarizeOfferStatusCounts(selected.rows) : emptyOfferStatusCounts();

  if (!selected) {
    return <Text>No offers matched the current filters.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">Offers synced: {syncedAt ?? "unknown"}</Text>
        <Text>  </Text>
        <Text color="gray">Status: {formatOfferStatusFilterLabel(statusFilter)}</Text>
      </Box>
      <Box>
        <Text color="gray">Overall:</Text>
        <Text> </Text>
        <Text color="cyan">Total {overallCounts.total}</Text>
        <Text>  </Text>
        <Text color="green">Enrolled {overallCounts.enrolled}</Text>
        <Text>  </Text>
        <Text color="yellow">Eligible {overallCounts.eligible}</Text>
        {overallCounts.other > 0 ? (
          <>
            <Text>  </Text>
            <Text color="gray">Other {overallCounts.other}</Text>
          </>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Box flexDirection="column" width={54} marginRight={2}>
          {hiddenAbove > 0 ? <Text color="gray">... {hiddenAbove} above</Text> : null}
          {visibleItems.map((group, index) => {
            const actualIndex = startIndex + index;
            const selectedRow = actualIndex === selectedIndex;
            const counts = summarizeOfferStatusCounts(group.rows);
            const color = selectedRow ? (activePane === "groups" ? "cyan" : "white") : undefined;
            return (
              <Text key={group.id} {...(color ? { color } : {})} bold={selectedRow}>
                {selectedRow ? "> " : "  "}
                {group.title}{" "}
                <Text color="green">{counts.enrolled}</Text>
                <Text> </Text>
                <Text color="yellow">{counts.eligible}</Text>
                {counts.other > 0 ? (
                  <>
                    <Text> </Text>
                    <Text color="gray">{counts.other}</Text>
                  </>
                ) : null}
              </Text>
            );
          })}
          {hiddenBelow > 0 ? <Text color="gray">... {hiddenBelow} below</Text> : null}
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="column" flexGrow={1}>
            <Text bold>{selected.title}</Text>
            <Text color="gray">Offer ID: {selected.id}</Text>
            <Text color="gray">
              Summary: Enrolled {selectedCounts.enrolled}, Eligible {selectedCounts.eligible}
              {selectedCounts.other > 0 ? `, Other ${selectedCounts.other}` : ""}
            </Text>
            {selected.description ? (
              <Box marginTop={1}>
                <Text>{selected.description}</Text>
              </Box>
            ) : null}
            <Box flexDirection="column" marginTop={1}>
              {selected.rows.map((row, index) => (
                <Text key={`${selected.title}:${row.id}:${row.last4}`}>
                  <Text color={index === selectedRowIndex ? (activePane === "rows" ? "cyan" : "white") : "gray"}>
                    {index === selectedRowIndex ? "> " : "  "}
                  </Text>
                  <Text color={selectedRows.has(offerRowKey(row)) ? "green" : "gray"}>
                    {normalizeOfferStatus(row.status) === "eligible" ? (selectedRows.has(offerRowKey(row)) ? "[x]" : "[ ]") : " - "}
                  </Text>
                  <Text> </Text>
                  <Text color="cyan">{row.last4}</Text>
                  <Text> | </Text>
                  <Text>{row.cardName}</Text>
                  <Text> | </Text>
                  <Text color={offerStatusColor(row.status)}>{row.status}</Text>
                  {row.expiresAt ? (
                    <>
                      <Text> | </Text>
                      <Text color="yellow">{row.expiresAt}</Text>
                    </>
                  ) : null}
                </Text>
              ))}
            </Box>
          </Box>

          {actionMessage || activity.length > 0 ? (
            <Box flexDirection="column" borderStyle="round" borderColor={actionPending ? "yellow" : "gray"} paddingX={1} marginTop={1}>
              <Text color="gray">
                Enrollment
                {activityScope ? ` · ${activityScope.kind === "all" ? activityScope.title : activityScope.title}` : ""}
              </Text>
              {sessionMessage ? <Text color="gray">{sessionMessage}</Text> : null}
              {actionMessage ? (
                <Text color={actionPending ? "yellow" : "green"}>{actionMessage}</Text>
              ) : null}
              {activity.length > 0
                ? activity.slice(-4).map((item, index) => (
                    <Text key={`${index}:${item.text}`} color={offerActivityColor(item.tone)}>
                      {item.tone === "info" ? "·" : item.tone === "success" ? "+" : "!"} {item.text}
                    </Text>
                  ))
                : null}
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

function summarizeStatuses(rows: BenefitsInkRow[]): string {
  const { completed, inProgress, notStarted } = summarizeStatusCounts(rows);

  return [
    completed > 0 ? `Completed ${completed}` : undefined,
    inProgress > 0 ? `In Progress ${inProgress}` : undefined,
    notStarted > 0 ? `Not Started ${notStarted}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function summarizeStatusCounts(rows: BenefitsInkRow[]): {
  completed: number;
  inProgress: number;
  notStarted: number;
} {
  return {
    completed: rows.filter((row) => row.displayStatus === "Completed").length,
    inProgress: rows.filter((row) => row.displayStatus === "In Progress").length,
    notStarted: rows.filter((row) => row.displayStatus === "Not Started").length,
  };
}

function statusColor(status: BenefitsInkRow["displayStatus"]): "green" | "blue" | "yellow" {
  switch (status) {
    case "Completed":
      return "green";
    case "In Progress":
      return "blue";
    case "Not Started":
      return "yellow";
  }

  return "yellow";
}

function offerActivityColor(tone: OfferActivityItem["tone"]): "gray" | "green" | "red" {
  switch (tone) {
    case "info":
      return "gray";
    case "success":
      return "green";
    case "error":
      return "red";
  }
}

function formatMemberListLabel(card: AppCardsItem): string {
  if (card.relationship === "SUPP") {
    return `  -> ${card.last4} ${card.member}`;
  }

  return `${card.last4} ${card.name}`;
}

function groupOffers(offers: AppOfferItem[]): AppOfferGroup[] {
  const groups = new Map<string, AppOfferGroup>();

  for (const offer of offers) {
    const key = offer.id;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(offer);
      continue;
    }

    groups.set(key, {
      id: offer.id,
      title: offer.title,
      description: offer.description,
      rows: [offer],
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (right.rows.length !== left.rows.length) {
      return right.rows.length - left.rows.length;
    }

    return left.title.localeCompare(right.title);
  });
}

function offerRowKey(row: AppOfferItem): string {
  return `${row.id}:${row.cardId}:${row.last4}`;
}

function summarizeOfferStatusCounts(offers: AppOfferItem[]): OfferStatusCounts {
  return offers.reduce(
    (counts, offer) => {
      const status = offer.status.toUpperCase();
      counts.total += 1;

      if (status === "ENROLLED") {
        counts.enrolled += 1;
      } else if (status === "ELIGIBLE") {
        counts.eligible += 1;
      } else {
        counts.other += 1;
      }

      return counts;
    },
    emptyOfferStatusCounts(),
  );
}

function summarizeOfferGroupStatusCounts(groups: AppOfferGroup[]): OfferStatusCounts {
  return groups.reduce(
    (counts, group) => {
      const groupCounts = summarizeOfferStatusCounts(group.rows);
      counts.total += 1;

      if (groupCounts.enrolled > 0) {
        counts.enrolled += 1;
      } else if (groupCounts.eligible > 0) {
        counts.eligible += 1;
      } else {
        counts.other += 1;
      }

      return counts;
    },
    emptyOfferStatusCounts(),
  );
}

function emptyOfferStatusCounts(): OfferStatusCounts {
  return {
    total: 0,
    enrolled: 0,
    eligible: 0,
    other: 0,
  };
}

function offerStatusColor(status: string): "green" | "yellow" | "gray" {
  switch (status.toUpperCase()) {
    case "ENROLLED":
      return "green";
    case "ELIGIBLE":
      return "yellow";
    default:
      return "gray";
  }
}

function getVisibleWindow<T>(items: T[], selectedIndex: number, size: number): {
  visibleItems: T[];
  startIndex: number;
  hiddenAbove: number;
  hiddenBelow: number;
} {
  if (items.length <= size) {
    return {
      visibleItems: items,
      startIndex: 0,
      hiddenAbove: 0,
      hiddenBelow: 0,
    };
  }

  const half = Math.floor(size / 2);
  const maxStart = Math.max(0, items.length - size);
  const startIndex = Math.min(Math.max(0, selectedIndex - half), maxStart);
  const endIndex = startIndex + size;

  return {
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    hiddenAbove: startIndex,
    hiddenBelow: Math.max(0, items.length - endIndex),
  };
}

function normalizeBenefitPeriod(value: string | undefined): BenefitPeriodFilter {
  switch ((value ?? "").toLowerCase()) {
    case "annual":
      return "annual";
    case "semi-annual":
      return "semi-annual";
    case "quarterly":
      return "quarterly";
    case "monthly":
      return "monthly";
    default:
      return "all";
  }
}

function normalizeBenefitStatus(value: BenefitsInkRow["displayStatus"]): BenefitStatusFilter {
  switch (value) {
    case "In Progress":
      return "in-progress";
    case "Not Started":
      return "not-started";
    case "Completed":
      return "completed";
  }
}

function normalizeOfferStatus(value: string): OfferStatusFilter {
  switch (value.toUpperCase()) {
    case "ENROLLED":
      return "enrolled";
    case "ELIGIBLE":
      return "eligible";
    default:
      return "other";
  }
}

function formatBenefitFilterLabel(filter: BenefitPeriodFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "annual":
      return "Annual";
    case "semi-annual":
      return "Semi-Annual";
    case "quarterly":
      return "Quarterly";
    case "monthly":
      return "Monthly";
  }
}

function formatBenefitStatusFilterLabel(filter: BenefitStatusFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "in-progress":
      return "In Progress";
    case "not-started":
      return "Not Started";
    case "completed":
      return "Completed";
  }
}

function formatOfferStatusFilterLabel(filter: OfferStatusFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "enrolled":
      return "Enrolled";
    case "eligible":
      return "Eligible";
    case "other":
      return "Other";
  }
}
