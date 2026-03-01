import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";

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
  title: string;
  last4: string;
  cardName: string;
  status: string;
  expiresAt: string | undefined;
  description: string | undefined;
}

interface AppOfferGroup {
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

function InteractiveApp({
  syncedAt,
  cards,
  benefits,
  offers,
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
  const [showCanceledCards, setShowCanceledCards] = useState(false);
  const [benefitPeriodFilter, setBenefitPeriodFilter] = useState<BenefitPeriodFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const selectedTab = tabs[selectedTabIndex]?.id ?? "members";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
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
  const visibleBenefitGroups = useMemo(
    () =>
      benefits.groups.filter((group) =>
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
      ),
    [benefitPeriodFilter, benefits.groups, normalizedSearchQuery],
  );
  const visibleOffers = useMemo(
    () =>
      offers.filter((offer) =>
        normalizedSearchQuery
          ? [offer.title, offer.last4, offer.cardName, offer.status, offer.expiresAt, offer.description]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(normalizedSearchQuery))
          : true,
      ),
    [normalizedSearchQuery, offers],
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
      setSelectedOfferIndex(0);
      return;
    }

    if (selectedOfferIndex >= visibleOfferGroups.length) {
      setSelectedOfferIndex(visibleOfferGroups.length - 1);
    }
  }, [selectedOfferIndex, visibleOfferGroups]);

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

    if (key.leftArrow) {
      setSelectedTabIndex((current) => (current === 0 ? tabs.length - 1 : current - 1));
      return;
    }

    if (key.rightArrow || key.tab) {
      setSelectedTabIndex((current) => (current === tabs.length - 1 ? 0 : current + 1));
      return;
    }

    if (key.upArrow) {
      if (selectedTab === "members") {
        setSelectedCardIndex((current) => (current === 0 ? Math.max(visibleCards.length - 1, 0) : current - 1));
      } else if (selectedTab === "benefits") {
        setSelectedBenefitIndex((current) => (current === 0 ? Math.max(visibleBenefitGroups.length - 1, 0) : current - 1));
      } else {
        setSelectedOfferIndex((current) =>
          current === 0 ? Math.max(visibleOfferGroups.length - 1, 0) : current - 1,
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
      } else {
        setSelectedOfferIndex((current) => (current === visibleOfferGroups.length - 1 ? 0 : current + 1));
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
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Amex CLI
      </Text>
      <Text color="gray">
        Keys: ←/→ switch tab  ↑/↓ move  {selectedTab === "members" ? "a toggle canceled  " : ""}
        {selectedTab === "benefits" ? "1 all 2 annual 3 monthly 4 quarterly 5 semi-annual  " : ""}
        / search  x clear  q quit
      </Text>
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
          groups={benefits.groups}
          visibleGroups={visibleBenefitGroups}
          summary={benefits.summary}
          syncedAt={syncedAt.benefits}
          selectedIndex={selectedBenefitIndex}
          filter={benefitPeriodFilter}
        />
      ) : null}
      {selectedTab === "offers" ? (
        <OffersTab groups={visibleOfferGroups} syncedAt={syncedAt.offers} selectedIndex={selectedOfferIndex} />
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
  groups,
  visibleGroups,
  summary,
  syncedAt,
  selectedIndex,
  filter,
}: {
  groups: BenefitsInkGroup[];
  visibleGroups: BenefitsInkGroup[];
  summary: BenefitsInkSummary;
  syncedAt: string | undefined;
  selectedIndex: number;
  filter: BenefitPeriodFilter;
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
}: {
  groups: AppOfferGroup[];
  syncedAt: string | undefined;
  selectedIndex: number;
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
      <Text color="gray">Offers synced: {syncedAt ?? "unknown"}</Text>
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
            return (
              <Text key={group.title} {...(selectedRow ? { color: "cyan" as const } : {})} bold={selectedRow}>
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
          <Text bold>{selected.title}</Text>
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
            {selected.rows.map((row) => (
              <Text key={`${selected.title}:${row.id}:${row.last4}`}>
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

function formatMemberListLabel(card: AppCardsItem): string {
  if (card.relationship === "SUPP") {
    return `  -> ${card.last4} ${card.member}`;
  }

  return `${card.last4} ${card.name}`;
}

function groupOffers(offers: AppOfferItem[]): AppOfferGroup[] {
  const groups = new Map<string, AppOfferGroup>();

  for (const offer of offers) {
    const key = offer.title;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(offer);
      continue;
    }

    groups.set(key, {
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
