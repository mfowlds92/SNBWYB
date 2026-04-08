// =========================
// GAME ENGINE (SERVER-SAFE)
// =========================

// ---------- CONSTANTS ----------
const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const ROUND_CONFIG_BY_PLAYER_COUNT = {
  2: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
  3: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
  4: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
  5: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
};

const DECK_BACKS_BY_PLAYER_COUNT = {
  2: ["Red"],
  3: ["Red", "Blue"],
  4: ["Red", "Blue"],
  5: ["Red", "Blue"],
};

const JOKER_BACKS_BY_PLAYER_COUNT = {
  2: ["Red", "Red"],
  3: ["Red", "Red", "Blue"],
  4: ["Red", "Red", "Blue", "Blue"],
  5: ["Red", "Red", "Red", "Blue", "Blue"],
};

// ---------- HELPERS ----------
function createEmptyPlayer(name) {
  return {
    name,
    score: 0,
    hand: [],
    assignments: null,
    nomination: null
  };
}

function createPlayers(playerNames) {
  return playerNames.map(name => createEmptyPlayer(name));
}

// ---------- STATE ----------
export function createInitialState(playerNames) {
  return {
    players: createPlayers(playerNames),
    round: 1,
    dealerIndex: 0,
    deck: [],
    trumpCard: null,
    roundHistory: [],
    currentRoundSummary: null,

brag: {
  started: false,
  communityCards: [],
  currentPlayerIndex: null,
  turnCount: 0,
  turnsTakenByPlayer: playerNames.map(() => 0),
  firstCycleComplete: false,
  guruActive: false,
  knockAvailable: false,
  knock: null,
  finalTurnsRemaining: 0
},

yaniv: {
  started: false,
  drawPile: [],
  discardPile: [],
  currentPlayerIndex: null,
  pendingDiscard: [],
  result: null,
  justDrawnCard: null,
  canSlam: false,
  slamPlayerIndex: null,
  selectedCardIds: [],
  lastDrawAction: null,
  drawEventCounter: 0,
  lastSlamAction: null,
  slamEventCounter: 0
},
    
    whist: {
  started: false,
  currentPlayerIndex: null,
  leadSuit: null,
  currentTrick: [],
  tricksWon: playerNames.map(() => 0),
  lastWonTrickByPlayer: playerNames.map(() => []),
  wonTricksByPlayer: playerNames.map(() => []),
  wonTrickPiles: [],
  robotNoBotPending: false,
  robotNoBotAwaitingContinue: false,
  robotNoBotMode: null,
  robotNoBotResults: playerNames.map(() => null),
  robotNoBotCoinResult: null,
  result: null,
  trickWinnerIndex: null,
  selectionsComplete: false,
  nominationsComplete: false
}
  };
}

// ---------- ROUND ----------
export function getRoundConfig(playerCount) {
  return ROUND_CONFIG_BY_PLAYER_COUNT[playerCount];
}

export function getTotalRounds(playerCount) {
  return getRoundConfig(playerCount).length;
}

export function getTrumpLabel(state) {
  if (!state.trumpCard) return null;
  return state.trumpCard.rank === "Joker" ? "Joker" : state.trumpCard.suit;
}

export function createCurrentRoundSummary(state) {
  return {
    round: state.round,
    trump: getTrumpLabel(state),
    nominations: state.players.map((player, index) => ({
      playerIndex: index,
      playerName: player.name,
      nomination: player.nomination
    })),
    bragResults: [],
    yanivResult: null,
    whistResults: []
  };
}

export function getRoundHandSize(state) {
  const config = getRoundConfig(state.players.length);
  return config[state.round - 1];
}

export function isBlindRound(state) {
  return state.round === 7;
}

// ---------- DECK ----------
export function createDeck(playerCount) {
  const deck = [];
  const deckBacks = DECK_BACKS_BY_PLAYER_COUNT[playerCount];
  const jokerBacks = JOKER_BACKS_BY_PLAYER_COUNT[playerCount];

  deckBacks.forEach((backColor, deckIndex) => {
    SUITS.forEach((suit) => {
      RANKS.forEach((rank) => {
        deck.push({
          rank,
          suit,
          backColor,
          id: `${rank}-${suit}-${backColor}-D${deckIndex}-${Math.random()}`
        });
      });
    });
  });

  jokerBacks.forEach((backColor, i) => {
    deck.push({
      rank: "Joker",
      suit: "None",
      backColor,
      id: `Joker-${i}-${Math.random()}`
    });
  });

  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function drawTrumpCard(state) {
  while (state.deck.length > 0) {
    const card = state.deck.shift();
    if (card.rank !== "Joker") {
      return card;
    }
  }
  return null;
}

// ---------- DEALING ----------
export function dealCards(state) {
  const newState = structuredClone(state);

  const cardsPerPlayer = getRoundHandSize(newState);

  newState.players.forEach(p => {
    p.hand = [];
    p.assignments = null;
    p.nomination = null;
    p.swapSelection = null;
  });

  if (isBlindRound(newState)) {
    return dealBlindRound(newState, cardsPerPlayer);
  }

  for (let i = 0; i < cardsPerPlayer; i++) {
    newState.players.forEach(player => {
      const card = newState.deck.shift();
      if (card) player.hand.push(card);
    });
  }

  return { state: newState };
}

function autoAssignWhistHands(state) {

  const whistCardCount = 5; // temporary test value

  state.players.forEach(player => {

    player.assignments = {
      brag: [],
      yaniv: [],
      whist: []
    };

    player.assignments.whist = player.hand.slice(0, whistCardCount);

  });

}


function dealBlindRound(state, cardsPerPlayer) {
  const newState = structuredClone(state);

  const pattern = [3, 5, 1];

  newState.players.forEach(player => {
    player.hand = [];
    player.assignments = {
      brag: [],
      yaniv: [],
      whist: []
    };

    pattern.forEach((count, index) => {
      for (let i = 0; i < count; i++) {
        const card = newState.deck.shift();
        if (!card) continue;

        player.hand.push(card);

        if (index === 0) player.assignments.brag.push(card);
        if (index === 1) player.assignments.yaniv.push(card);
        if (index === 2) player.assignments.whist.push(card);
      }
    });
  });

  // Blind rounds skip manual splitter assignment.
  newState.whist.selectionsComplete = true;

  return { state: newState };
}

// ---------- WHIST ----------
function getWhistRankValue(card) {
  if (card.rank === "Joker") return 0;
  if (card.rank === "A") return 13;
  if (card.rank === "K") return 12;
  if (card.rank === "Q") return 11;
  if (card.rank === "J") return 10;
  return Number(card.rank) - 1;
}

function getActualTrumpSuit(state) {
  return state.trumpCard?.suit || null;
}

function compareBackColorStrength(a, b) {
  const tieValues = {
    Red: 1,
    Blue: 2,
    Green: 3
  };

  const aValue = tieValues[a.backColor] ?? 0;
  const bValue = tieValues[b.backColor] ?? 0;

  if (aValue !== bValue) return aValue - bValue;
  return 0;
}

function playerHasSuitForWhist(player, suit) {
  if (!suit) return false;

  return (player.assignments?.whist || []).some((card) => {
    return card.rank !== "Joker" && card.suit === suit;
  });
}

function getLeadSuitFromCurrentTrick(trick) {
  for (const entry of trick) {
    if (entry.card.rank !== "Joker") {
      return entry.card.suit;
    }
  }
  return null;
}

function isValidWhistPlay(player, card, leadSuit) {
  if (!leadSuit) return true;

  // Joker is always legal because it counts as the lowest card of any suit
  if (card.rank === "Joker") return true;

  const hasLeadSuit = playerHasSuitForWhist(player, leadSuit);

  if (!hasLeadSuit) return true;

  return card.suit === leadSuit;
}

function compareWhistCards(aEntry, bEntry, leadSuit, trumpSuit) {
  const a = aEntry.card;
  const b = bEntry.card;

  const aIsJoker = a.rank === "Joker";
  const bIsJoker = b.rank === "Joker";

  if (aIsJoker && bIsJoker) {
    return compareBackColorStrength(a, b);
  }

  if (aIsJoker) return -1;
  if (bIsJoker) return 1;

  const aSuit = a.suit;
  const bSuit = b.suit;

  const aIsTrump = trumpSuit && aSuit === trumpSuit;
  const bIsTrump = trumpSuit && bSuit === trumpSuit;

  if (aIsTrump && !bIsTrump) return 1;
  if (bIsTrump && !aIsTrump) return -1;

  if (aIsTrump && bIsTrump) {
    const aRank = getWhistRankValue(a);
    const bRank = getWhistRankValue(b);
    if (aRank !== bRank) return aRank - bRank;

    return compareBackColorStrength(a, b);
  }

  const aFollowsLead = aSuit === leadSuit;
  const bFollowsLead = bSuit === leadSuit;

  if (aFollowsLead && !bFollowsLead) return 1;
  if (bFollowsLead && !aFollowsLead) return -1;

  if (aFollowsLead && bFollowsLead) {
    const aRank = getWhistRankValue(a);
    const bRank = getWhistRankValue(b);
    if (aRank !== bRank) return aRank - bRank;

    return compareBackColorStrength(a, b);
  }

  return 0;
}

function getWhistTrickWinner(state, trick) {
  if (!trick.length) return null;

  const leadSuit = getLeadSuitFromCurrentTrick(trick);
  const trumpSuit = getActualTrumpSuit(state);

  let winningEntry = trick[0];

  for (let i = 1; i < trick.length; i++) {
    const challenger = trick[i];
    const comparison = compareWhistCards(
      challenger,
      winningEntry,
      leadSuit,
      trumpSuit
    );

    if (comparison > 0) {
      winningEntry = challenger;
    }
  }

  return winningEntry;
}

function isWhistRoundComplete(state) {
  return state.players.every((player) => {
    const whistHand = player.assignments?.whist || [];
    return whistHand.length === 0;
  }) && state.whist.currentTrick.length === 0;
}

function getWhistScoreForPlayer(state, tricksWon, nomination) {
  const totalTricks = getWhistCardCount(state);

  if (tricksWon === nomination) {
    if (nomination === 0) {
      return 15;
    }

    if (totalTricks >= 5 && nomination === totalTricks) {
      return totalTricks * 11;
    }

    return 30 + tricksWon;
  }

  return tricksWon;
}

// ========== BRAG EVALUATION ==========
const BRAG_RANK_VALUES = {
  "Exact Prial": 10,
  "Double Prial": 9,
  "Prial": 8,
  "Straight Flush": 7,
  "Straight": 6,
  "Pair Flush": 5,
  "Flush": 4,
  "Pair Pair": 3,
  "Pair": 2,
  "High Card": 1
};

const BACK_COLOR_TIE_VALUES = {
  "Red": 2,
  "Blue": 1,
  "Green": 0
};

function getBragCardValue(card) {
  const order = {
    "3": 13,
    "2": 12,
    "A": 11,
    "K": 10,
    "Q": 9,
    "J": 8,
    "10": 7,
    "9": 6,
    "8": 5,
    "7": 4,
    "6": 3,
    "5": 2,
    "4": 1,
    "Joker": 0
  };
  return order[card.rank] ?? -1;
}

function sortCardsByBragValueDesc(cards) {
  return [...cards].sort((a, b) => getBragCardValue(b) - getBragCardValue(a));
}

function countRanks(cards) {
  const counts = {};
  cards.forEach((card) => {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  });
  return counts;
}

function isFlush(cards) {
  const nonJokers = cards.filter((card) => card.rank !== "Joker");
  if (nonJokers.length <= 1) return true;
  return nonJokers.every((card) => card.suit === nonJokers[0].suit);
}

function hasPair(cards) {
  const counts = Object.values(countRanks(cards));
  return counts.includes(2);
}

function isPrial(cards) {
  const counts = Object.values(countRanks(cards));
  return counts.includes(3);
}

function countExactCardKeys(cards) {
  const counts = {};
  cards.forEach((card) => {
    const key = `${card.rank}-${card.suit}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function getPrialVariant(cards) {
  if (!isPrial(cards)) return null;

  const exactCounts = Object.values(countExactCardKeys(cards));
  if (exactCounts.includes(3)) return "Exact Prial";
  if (exactCounts.includes(2)) return "Double Prial";
  return "Prial";
}

function isPairPair(cards) {
  if (!hasPair(cards)) return false;

  const rankCounts = countRanks(cards);
  const pairRank = Object.keys(rankCounts).find((rank) => rankCounts[rank] === 2);
  if (!pairRank) return false;

  const pairCards = cards.filter((card) => card.rank === pairRank);
  if (pairCards.some((card) => card.rank === "Joker")) {
    return true;
  }

  return pairCards.length === 2 && pairCards[0].suit === pairCards[1].suit;
}

function getStraightHighValue(cards) {
  if (cards.some((card) => card.rank === "Joker")) return null;

  const ranks = cards.map((card) => card.rank);
  if (new Set(ranks).size !== 3) return null;

  const straightWindows = [
    ["3", "2", "A"],   // best
    ["A", "K", "Q"],
    ["K", "Q", "J"],
    ["Q", "J", "10"],
    ["J", "10", "9"],
    ["10", "9", "8"],
    ["9", "8", "7"],
    ["8", "7", "6"],
    ["7", "6", "5"],
    ["6", "5", "4"],
    ["5", "4", "3"],
    ["4", "3", "2"]    // worst
  ];

  const sortedRanks = [...ranks].sort((a, b) => {
    return getBragCardValue({ rank: b }) - getBragCardValue({ rank: a });
  });

  for (let i = 0; i < straightWindows.length; i++) {
    const window = straightWindows[i];
    const sortedWindow = [...window].sort((a, b) => {
      return getBragCardValue({ rank: b }) - getBragCardValue({ rank: a });
    });

    if (JSON.stringify(sortedRanks) === JSON.stringify(sortedWindow)) {
      // Higher number = stronger straight
      return straightWindows.length - i;
    }
  }

  return null;
}

function isStraight(cards) {
  return getStraightHighValue(cards) !== null;
}

function isStraightFlush(cards) {
  return isStraight(cards) && isFlush(cards);
}

function getBackColorTieBreak(cards) {
  const sortedBackValues = cards
    .map((card) => BACK_COLOR_TIE_VALUES[card.backColor] ?? 0)
    .sort((a, b) => b - a);

  return {
    sortedBackValues
  };
}

function getPrimaryRankValues(cards) {
  const counts = countRanks(cards);
  const entries = Object.entries(counts).map(([rank, count]) => ({
    rank,
    count,
    value: getBragCardValue({ rank })
  }));

  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  return entries.map((entry) => entry.value);
}

function evaluateBragHand(cards) {
  const flush = isFlush(cards);
  const prialVariant = getPrialVariant(cards);
  const straight = isStraight(cards);
  const straightFlush = isStraightFlush(cards);
  const pair = hasPair(cards);
  const pairPair = isPairPair(cards);
  const flushPair = flush && pair;

  let category = "High Card";

  if (prialVariant) category = prialVariant;
  else if (straightFlush) category = "Straight Flush";
  else if (straight) category = "Straight";
  else if (flushPair) category = "Pair Flush";
  else if (flush) category = "Flush";
  else if (pairPair) category = "Pair Pair";
  else if (pair) category = "Pair";

  return {
    category,
    rankValue: BRAG_RANK_VALUES[category],
    straightHighValue: getStraightHighValue(cards) ?? -1,
    rankPatternValues: getPrimaryRankValues(cards),
    highCardValues: sortCardsByBragValueDesc(cards).map(getBragCardValue),
    tieBreak: getBackColorTieBreak(cards)
  };
}

function compareArraysDesc(a, b) {
  const maxLength = Math.max(a.length, b.length);
  for (let i = 0; i < maxLength; i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function getBragRankValue(hand) {
  return evaluateBragHand(hand);
}

function getCardValue(card) {
  const order = ["Joker","4","5","6","7","8","9","10","J","Q","K","A","2","3"];
  return order.indexOf(card.rank);
}

function compareBragHands(a, b) {
  // Compare rank value (higher is better)
  if (a.rankValue !== b.rankValue) return b.rankValue - a.rankValue;

  // For straights, compare straight high value
  if (a.straightHighValue !== b.straightHighValue) {
    return b.straightHighValue - a.straightHighValue;
  }

  // Compare rank pattern values (for pairs, trips, etc)
  const patternCmp = compareArraysDesc(b.rankPatternValues, a.rankPatternValues);
  if (patternCmp !== 0) return patternCmp;

  // Compare high card values
  const highCardCmp = compareArraysDesc(b.highCardValues, a.highCardValues);
  if (highCardCmp !== 0) return highCardCmp;

  // Compare back color tie break
  const backColorCmp = compareArraysDesc(b.tieBreak.sortedBackValues, a.tieBreak.sortedBackValues);
  return backColorCmp;
}

export function resolveBrag(state) {
  const players = state.players;

  const results = players.map((player, index) => {
    const hand = player.assignments?.brag || [];
    return {
      index,
      name: player.name,
      eval: getBragRankValue(hand)
    };
  });

  // sort best → worst
  results.sort((a, b) => compareBragHands(a.eval, b.eval));

  // scoring
  const n = results.length;

  results.forEach((res, position) => {
    let score;

    if (position === 0) score = 30;
    else if (position === n - 1) score = 0;
    else {
      // linear scaling between 30 → 0
      score = Math.round(30 * (1 - position / (n - 1)));
    }

    state.players[res.index].score += score;
    res.score = score;
    res.position = position + 1;
  });

  if (state.currentRoundSummary) {
    state.currentRoundSummary.bragResults = results.map((res) => ({
      playerIndex: res.index,
      playerName: res.name,
      points: res.score,
      place: res.position
    }));
  }

  return results;
}

function buildWhistResults(state) {
  return state.players.map((player, index) => {
    const tricksWon = state.whist.tricksWon[index] || 0;
    const nomination = Number(player.nomination ?? 0);
    const exactMatch = tricksWon === nomination;
    const points = getWhistScoreForPlayer(state, tricksWon, nomination);

    state.players[index].score += points;

    return {
      playerIndex: index,
      playerName: player.name,
      nomination,
      tricksWon,
      exactMatch,
      points
    };
  });
}

function getPlayerOrderFromLeftOfDealer(state) {
  const order = [];
  for (let i = 1; i <= state.players.length; i++) {
    order.push((state.dealerIndex + i) % state.players.length);
  }
  return order;
}

export function advanceBragTurn(state) {
  const order = getPlayerOrderFromLeftOfDealer(state);
  const brag = state.brag;

  if (!brag.started) return;

  const currentPlayerIndex = brag.currentPlayerIndex;
  if (currentPlayerIndex === null || currentPlayerIndex === undefined) return;

  // A swap has just happened
  brag.turnCount += 1;
  brag.guruActive = false;
  brag.knockAvailable = false;

  if (!Array.isArray(brag.turnsTakenByPlayer)) {
    brag.turnsTakenByPlayer = state.players.map(() => 0);
  }
  brag.turnsTakenByPlayer[currentPlayerIndex] += 1;

  // First full cycle complete once everyone has swapped once
  if (!brag.firstCycleComplete && brag.turnCount >= state.players.length) {
    brag.firstCycleComplete = true;
  }

  // FINAL ROUND AFTER A KNOCK:
  // every remaining player gets exactly one more swap, then Brag ends
  if (brag.knock) {
    brag.finalTurnsRemaining -= 1;

    if (brag.finalTurnsRemaining <= 0) {
      brag.started = false;

      const results = resolveBrag(state);
      state.brag.results = results;

      return;
    }

    const currentPos = order.indexOf(currentPlayerIndex);
    const nextPos = (currentPos + 1) % order.length;
    brag.currentPlayerIndex = order[nextPos];
    return;
  }

  // NORMAL FLOW:
  // once the first cycle is complete, the current player gets Knock/Guru
  // immediately after completing their SECOND swap
  if (brag.firstCycleComplete && brag.turnsTakenByPlayer[currentPlayerIndex] >= 2) {
    brag.knockAvailable = true;
    return;
  }

  // Otherwise move to next player
  const currentPos = order.indexOf(currentPlayerIndex);
  const nextPos = (currentPos + 1) % order.length;
  brag.currentPlayerIndex = order[nextPos];
}


export function chooseKnockOrGuru(state, playerIndex, choice) {
  const newState = structuredClone(state);
  const brag = newState.brag;

  if (!brag.started) {
    return { error: "Brag not started" };
  }

  if (brag.knock) {
    return { error: "Someone has already knocked" };
  }

  if (!brag.firstCycleComplete) {
    return { error: "Knock or Guru is only allowed after one full cycle" };
  }

  if (!brag.knockAvailable) {
    return { error: "Knock or Guru is not available right now" };
  }

  if (brag.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your Brag turn" };
  }

  const order = getPlayerOrderFromLeftOfDealer(newState);
  const currentPos = order.indexOf(playerIndex);
  const nextPos = (currentPos + 1) % order.length;
  const nextPlayerIndex = order[nextPos];

  if (choice === "guru") {
    brag.guruActive = false;
    brag.knockAvailable = false;
    brag.currentPlayerIndex = nextPlayerIndex;
    return { state: newState };
  }

  if (choice === "knock") {
    brag.knock = { playerIndex };
    brag.guruActive = false;
    brag.knockAvailable = false;
    brag.finalTurnsRemaining = newState.players.length - 1;
    brag.currentPlayerIndex = nextPlayerIndex;
    return { state: newState };
  }

  return { error: "Invalid choice" };
}

function advanceWhistTurn(state) {
  const order = getPlayerOrderFromLeftOfDealer(state);

  if (state.whist.currentTrick.length === state.players.length) {
    const winner = getWhistTrickWinner(state, state.whist.currentTrick);

    if (winner) {
      state.whist.trickWinnerIndex = winner.playerIndex;
      state.whist.tricksWon[winner.playerIndex] += 1;
      const wonCards = state.whist.currentTrick.map((entry) => entry.card);
      state.whist.lastWonTrickByPlayer[winner.playerIndex] = wonCards;
      state.whist.wonTricksByPlayer[winner.playerIndex] = [
        ...(state.whist.wonTricksByPlayer[winner.playerIndex] || []),
        ...wonCards
      ];
      state.whist.wonTrickPiles = [
        ...(state.whist.wonTrickPiles || []),
        {
          winnerIndex: winner.playerIndex,
          cards: wonCards
        }
      ];
      state.whist.currentPlayerIndex = winner.playerIndex;
    }

    state.whist.currentTrick = [];
    state.whist.leadSuit = null;

    if (isWhistRoundComplete(state)) {
    state.whist.started = false;
    state.whist.result = {
      results: buildWhistResults(state)
    };

    if (state.currentRoundSummary) {
      state.currentRoundSummary.whistResults = state.whist.result.results;
      state.currentRoundSummary.nominations = state.players.map((player, index) => ({
        playerIndex: index,
        playerName: player.name,
        nomination: player.nomination
      }));
      state.roundHistory = Array.isArray(state.roundHistory) ? state.roundHistory : [];
      state.roundHistory.push(state.currentRoundSummary);
      state.currentRoundSummary = null;
    }
  }

    return;
  }

  const currentPos = order.indexOf(state.whist.currentPlayerIndex);
  const nextPos = (currentPos + 1) % order.length;
  state.whist.currentPlayerIndex = order[nextPos];
}

export function swapBragOne(state, playerIndex, handCardId, communityCardId) {
  const newState = structuredClone(state);

  if (!newState.brag?.started) {
    return { error: "Brag has not started yet" };
  }

  if (newState.brag.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your Brag turn" };
  }

  if (newState.brag.knockAvailable && !newState.brag.knock) {
    return { error: "You must choose Knock or Guru before swapping again" };
  }

  const player = newState.players[playerIndex];
  if (!player) {
    return { error: "Player not found" };
  }

  const bragHand = player.assignments?.brag || [];
  const communityCards = newState.brag.communityCards || [];

  const handIndex = bragHand.findIndex((card) => card.id === handCardId);
  if (handIndex === -1) {
    return { error: "Selected Brag hand card not found" };
  }

  const communityIndex = communityCards.findIndex((card) => card.id === communityCardId);
  if (communityIndex === -1) {
    return { error: "Selected community card not found" };
  }

  const outgoing = bragHand[handIndex];
  const incoming = communityCards[communityIndex];

  player.assignments.brag[handIndex] = incoming;
  newState.brag.communityCards[communityIndex] = outgoing;

  advanceBragTurn(newState);

  return { state: newState };
}

export function swapBragThree(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.brag?.started) {
    return { error: "Brag has not started yet" };
  }

   if (newState.brag.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your Brag turn" };
  }

  if (newState.brag.knockAvailable && !newState.brag.knock) {
    return { error: "You must choose Knock or Guru before swapping again" };
  }

  const player = newState.players[playerIndex];
  if (!player) {
    return { error: "Player not found" };
  }

  const bragHand = player.assignments?.brag || [];
  const communityCards = newState.brag.communityCards || [];

  if (bragHand.length !== 3) {
    return { error: "Player does not have exactly 3 Brag cards" };
  }

  if (communityCards.length !== 3) {
    return { error: "Community cards are not available for triple swap" };
  }

  // Swap all 3 cards
  player.assignments.brag = communityCards;
  newState.brag.communityCards = bragHand;

  advanceBragTurn(newState);

  return { state: newState };
}

export function playWhistCard(state, playerIndex, cardId) {
  const newState = structuredClone(state);

  if (!newState.whist.started) {
    return { error: "Whist not started" };
  }

  if (newState.whist.currentPlayerIndex !== playerIndex) {
    return { error: "Not your turn" };
  }

  const player = newState.players[playerIndex];
  const hand = player.assignments?.whist || [];

  const card = hand.find((c) => c.id === cardId);
  if (!card) {
    return { error: "Card not found" };
  }

  const leadSuit = getLeadSuitFromCurrentTrick(newState.whist.currentTrick);

  if (!isValidWhistPlay(player, card, leadSuit)) {
    return { error: "Must follow suit" };
  }

  player.assignments.whist = hand.filter((c) => c.id !== cardId);

  newState.whist.currentTrick.push({
    playerIndex,
    card
  });

  newState.whist.leadSuit = getLeadSuitFromCurrentTrick(
    newState.whist.currentTrick
  );

  advanceWhistTurn(newState);

  return { state: newState };
}

function getWhistCardCount(state) {
  const config = getRoundConfig(state.players.length);
  return config[state.round - 1] - 8;
}

function allPlayersHaveNominations(state) {
  return state.players.every(
    (player) => player.nomination !== null && player.nomination !== ""
  );
}

function getNextNominationPlayerIndex(state) {
  const order = getPlayerOrderFromLeftOfDealer(state);

  for (const playerIndex of order) {
    const nomination = state.players[playerIndex].nomination;
    if (nomination === null || nomination === "") {
      return playerIndex;
    }
  }

  return null;
}

export function saveNomination(state, playerIndex, nominationValue) {
  const newState = structuredClone(state);

    if (!newState.whist.selectionsComplete) {
    return { error: "All players must save their Whist hand first" };
  }

  if (newState.whist.started) {
    return { error: "Cannot nominate after Whist has started" };
  }

  const player = newState.players[playerIndex];
  if (!player) {
    return { error: "Player not found" };
  }

  if (player.nomination !== null && player.nomination !== "") {
    return { error: "You have already nominated" };
  }

  const nextPlayerIndex = getNextNominationPlayerIndex(newState);
  if (nextPlayerIndex !== playerIndex) {
    return { error: "It is not your turn to nominate" };
  }

  const totalTricks = getWhistCardCount(newState);
  const nomination = Number(nominationValue);

  if (!Number.isInteger(nomination) || nomination < 0 || nomination > totalTricks) {
    return { error: `Nomination must be a whole number from 0 to ${totalTricks}` };
  }

  if (playerIndex === newState.dealerIndex) {
    const order = getPlayerOrderFromLeftOfDealer(newState);
    const previousPlayers = order.slice(0, order.indexOf(playerIndex));

    let sumPrevious = 0;
    for (const index of previousPlayers) {
      sumPrevious += Number(newState.players[index].nomination || 0);
    }

    const blockedValue = totalTricks - sumPrevious;
    if (nomination === blockedValue) {
      return {
        error: `Dealer cannot nominate ${blockedValue} because total nominations cannot equal exactly ${totalTricks}`
      };
    }
  }

  player.nomination = nomination;

  if (newState.currentRoundSummary) {
    newState.currentRoundSummary.nominations = newState.players.map((player, index) => ({
      playerIndex: index,
      playerName: player.name,
      nomination: player.nomination
    }));
  }

  if (allPlayersHaveNominations(newState)) {
    newState.whist.nominationsComplete = true;
  }

  return { state: newState };
}

function allPlayersHaveWhistSelections(state) {
  const requiredWhistCards = getWhistCardCount(state);

  const swapMode = getRobotNoBotSwapMode(state);
  if (swapMode) {
    return state.players.every((player) => {
      const split = player.swapSelection;
      return (
        !!split &&
        Array.isArray(split.left) &&
        split.left.length === swapMode.equalCount &&
        Array.isArray(split.right) &&
        split.right.length === swapMode.equalCount &&
        Array.isArray(split.fixed) &&
        split.fixed.length === swapMode.fixedCount
      );
    });
  }

  return state.players.every((player) => {
    const selected = player.assignments?.whist || [];
    return selected.length === requiredWhistCards;
  });
}

function getRobotNoBotSwapMode(state) {
  const whistCount = getWhistCardCount(state);
  if (whistCount === 5) {
    return {
      equalTarget: "yaniv",
      fixedTarget: "brag",
      equalCount: 5,
      fixedCount: 3
    };
  }

  if (whistCount === 3) {
    return {
      equalTarget: "brag",
      fixedTarget: "yaniv",
      equalCount: 3,
      fixedCount: 5
    };
  }

  return null;
}

function applyRobotNoBotAssignmentsForPlayer(state, playerIndex, resultValue) {
  const player = state.players[playerIndex];
  if (!player || !player.swapSelection) return;
  const mode = getRobotNoBotSwapMode(state);
  if (!mode) return;

  const split = player.swapSelection;
  const whistCards = resultValue === "robot" ? split.right : split.left;
  const otherCards = resultValue === "robot" ? split.left : split.right;

  player.assignments = {
    brag: [],
    yaniv: [],
    whist: whistCards
  };

  player.assignments[mode.fixedTarget] = split.fixed;
  player.assignments[mode.equalTarget] = otherCards;
}

export function saveWhistSelection(state, playerIndex, selectedAssignments) {
  const newState = structuredClone(state);

  if (newState.whist.started) {
    return { error: "Cannot change hand split after Whist has started" };
  }

  if (newState.whist.nominationsComplete) {
    return { error: "Cannot change hand split after nominations are complete" };
  }

  const player = newState.players[playerIndex];
  if (!player) {
    return { error: "Player not found" };
  }

  const hand = player.hand || [];
  const requiredWhistCards = getWhistCardCount(newState);
  const swapMode = getRobotNoBotSwapMode(newState);

  if (!selectedAssignments || typeof selectedAssignments !== "object") {
    return { error: "Invalid hand split" };
  }

  if (swapMode) {
    const leftIds = Array.isArray(selectedAssignments.left) ? selectedAssignments.left : [];
    const rightIds = Array.isArray(selectedAssignments.right) ? selectedAssignments.right : [];
    const fixedIds = Array.isArray(selectedAssignments.fixed) ? selectedAssignments.fixed : [];

    const allIds = [...leftIds, ...rightIds, ...fixedIds];
    const uniqueIds = [...new Set(allIds)];

    if (allIds.length !== hand.length) {
      return { error: "You must assign every card" };
    }

    if (uniqueIds.length !== hand.length) {
      return { error: "A card was assigned more than once" };
    }

    if (leftIds.length !== swapMode.equalCount || rightIds.length !== swapMode.equalCount) {
      return { error: `Left and right piles must each have ${swapMode.equalCount} cards` };
    }

    if (fixedIds.length !== swapMode.fixedCount) {
      return { error: `${swapMode.fixedTarget} pile must have exactly ${swapMode.fixedCount} cards` };
    }

    const leftCards = leftIds.map((cardId) => hand.find((card) => card.id === cardId));
    const rightCards = rightIds.map((cardId) => hand.find((card) => card.id === cardId));
    const fixedCards = fixedIds.map((cardId) => hand.find((card) => card.id === cardId));

    if ([...leftCards, ...rightCards, ...fixedCards].some((card) => !card)) {
      return { error: "One or more assigned cards were not found in your hand" };
    }

    player.swapSelection = {
      left: leftCards,
      right: rightCards,
      fixed: fixedCards
    };

    if (allPlayersHaveWhistSelections(newState)) {
      newState.whist.selectionsComplete = true;
      newState.whist.robotNoBotPending = true;
      newState.whist.robotNoBotMode = swapMode;
      newState.whist.robotNoBotResults = newState.players.map(() => null);
    }

    return { state: newState };
  }

  const bragIds = Array.isArray(selectedAssignments.brag) ? selectedAssignments.brag : [];
  const yanivIds = Array.isArray(selectedAssignments.yaniv) ? selectedAssignments.yaniv : [];
  const whistIds = Array.isArray(selectedAssignments.whist) ? selectedAssignments.whist : [];

  const allIds = [...bragIds, ...yanivIds, ...whistIds];
  const uniqueIds = [...new Set(allIds)];

  if (allIds.length !== hand.length) {
    return { error: "You must assign every card" };
  }

  if (uniqueIds.length !== hand.length) {
    return { error: "A card was assigned more than once" };
  }

  if (bragIds.length !== 3) {
    return { error: "Basketball Brag must have exactly 3 cards" };
  }

  if (yanivIds.length !== 5) {
    return { error: "Yaniv must have exactly 5 cards" };
  }

  if (whistIds.length !== requiredWhistCards) {
    return { error: `Nomination Whist must have exactly ${requiredWhistCards} cards` };
  }

  const bragCards = bragIds.map((cardId) => hand.find((card) => card.id === cardId));
  const yanivCards = yanivIds.map((cardId) => hand.find((card) => card.id === cardId));
  const whistCards = whistIds.map((cardId) => hand.find((card) => card.id === cardId));

  if (
    bragCards.some((card) => !card) ||
    yanivCards.some((card) => !card) ||
    whistCards.some((card) => !card)
  ) {
    return { error: "One or more assigned cards were not found in your hand" };
  }

  player.assignments = {
    brag: bragCards,
    yaniv: yanivCards,
    whist: whistCards
  };

  player.swapSelection = null;

  if (allPlayersHaveWhistSelections(newState)) {
  newState.whist.selectionsComplete = true;
}

  return { state: newState };
}

export function resolveRobotNoBot(state) {
  const newState = structuredClone(state);

  if (!newState.whist.selectionsComplete) {
    return { error: "All hand splits must be saved first" };
  }

  if (!newState.whist.robotNoBotPending) {
    return { error: "Robot/No-bot is not active for this round" };
  }

  if (!newState.whist.nominationsComplete) {
    return { error: "All nominations must be complete before flip" };
  }

  const mode = getRobotNoBotSwapMode(newState);
  if (!mode) {
    return { error: "Robot/No-bot mode is not available this round" };
  }

  const coinResult = Math.random() < 0.5 ? "robot" : "nobot";
  newState.whist.robotNoBotCoinResult = coinResult;
  newState.whist.robotNoBotResults = newState.players.map(() => coinResult);

  newState.players.forEach((_, playerIndex) => {
    applyRobotNoBotAssignmentsForPlayer(
      newState,
      playerIndex,
      newState.whist.robotNoBotResults[playerIndex]
    );
  });

  newState.whist.robotNoBotPending = false;
  newState.whist.robotNoBotAwaitingContinue = true;
  newState.whist.robotNoBotMode = mode;

  return { state: newState };
}

export function continueAfterRobotNoBot(state) {
  const newState = structuredClone(state);

  if (!newState.whist.robotNoBotAwaitingContinue) {
    return { error: "Robot/No-bot results are not waiting for continue" };
  }

  newState.whist.robotNoBotAwaitingContinue = false;
  return { state: newState };
}

// ---------- GAME FLOW ----------
export function startGame(state) {
  let newState = structuredClone(state);

  const playerCount = newState.players.length;

  let deck = createDeck(playerCount);
  deck = shuffleDeck(deck);

  newState.deck = deck;
  newState.trumpCard = drawTrumpCard(newState);

  newState.players.forEach((player) => {
    player.hand = [];
    player.assignments = null;
    player.nomination = null;
    player.swapSelection = null;
  });

newState.brag = {
  started: false,
  results: [],
  communityCards: [],
  currentPlayerIndex: null,
  turnCount: 0,
  turnsTakenByPlayer: newState.players.map(() => 0),
  firstCycleComplete: false,
  guruActive: false,
  knockAvailable: false,
  knock: null,
  finalTurnsRemaining: 0
};

  newState.yaniv.started = false;
  newState.yaniv.drawPile = [];
  newState.yaniv.discardPile = [];
  newState.yaniv.currentPlayerIndex = null;
  newState.yaniv.pendingDiscard = [];
  newState.yaniv.result = null;
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.selectedCardIds = [];
  newState.yaniv.lastDrawAction = null;
  newState.yaniv.drawEventCounter = 0;
  newState.yaniv.lastSlamAction = null;
  newState.yaniv.slamEventCounter = 0;

  newState.whist.started = false;
  newState.whist.currentPlayerIndex = null;
  newState.whist.leadSuit = null;
  newState.whist.currentTrick = [];
  newState.whist.tricksWon = newState.players.map(() => 0);
  newState.whist.lastWonTrickByPlayer = newState.players.map(() => []);
  newState.whist.wonTricksByPlayer = newState.players.map(() => []);
  newState.whist.wonTrickPiles = [];
  newState.whist.robotNoBotPending = false;
  newState.whist.robotNoBotAwaitingContinue = false;
  newState.whist.robotNoBotMode = null;
  newState.whist.robotNoBotResults = newState.players.map(() => null);
  newState.whist.robotNoBotCoinResult = null;
  newState.whist.result = null;
  newState.whist.trickWinnerIndex = null;
  newState.whist.selectionsComplete = false;
  newState.whist.nominationsComplete = false;

  newState.roundHistory = [];
  newState.currentRoundSummary = createCurrentRoundSummary(newState);

  const dealResult = dealCards(newState);
  if (dealResult.error) return dealResult;

  newState = dealResult.state;

  return { state: newState };
}

// ---------- YANIV ----------

function getYanivCardNumericValue(card) {
  if (card.rank === "Joker") return 0;
  if (card.rank === "A") return 1;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function countYanivRanks(cards) {
  const counts = {};
  cards.forEach((card) => {
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  });
  return counts;
}

function isYanivSet(cards) {
  if (cards.length < 2) return false;
  const counts = Object.keys(countYanivRanks(cards));
  return counts.length === 1;
}

function isYanivRun(cards) {
  if (cards.length < 3) return false;
  if (cards.some((card) => card.rank === "Joker")) return false;

  const suits = new Set(cards.map((card) => card.suit));
  if (suits.size !== 1) return false;

  const getRunValues = (aceHigh = false) => cards.map((card) => {
    if (card.rank === "A") return aceHigh ? 14 : 1;
    if (card.rank === "J") return 11;
    if (card.rank === "Q") return 12;
    if (card.rank === "K") return 13;
    return Number(card.rank);
  });

  const isConsecutiveRun = (values) => {
    const uniqueSorted = [...new Set(values)].sort((a, b) => a - b);
    if (uniqueSorted.length !== cards.length) return false;

    for (let i = 1; i < uniqueSorted.length; i++) {
      if (uniqueSorted[i] !== uniqueSorted[i - 1] + 1) {
        return false;
      }
    }

    return true;
  };

  return isConsecutiveRun(getRunValues(false)) || isConsecutiveRun(getRunValues(true));
}

function isValidYanivDiscard(cards) {
  if (cards.length === 0) return false;
  if (cards.length === 1) return true;
  if (isYanivSet(cards)) return true;
  if (isYanivRun(cards)) return true;
  return false;
}

function areAllSameRank(cards) {
  if (cards.length === 0) return false;
  return new Set(cards.map((card) => card.rank)).size === 1;
}

function canCardBeSlammedOntoDiscard(discardedCards, drawnCard) {
  if (!discardedCards.length || !drawnCard) return false;

  const combined = [...discardedCards, drawnCard];

  if (discardedCards.length === 1) {
    return drawnCard.rank === discardedCards[0].rank;
  }

  if (areAllSameRank(discardedCards)) {
    return areAllSameRank(combined);
  }

  if (isYanivRun(discardedCards)) {
    return isYanivRun(combined);
  }

  return false;
}

function getYanivHandTotal(cards) {
  return cards.reduce((sum, card) => sum + getYanivCardNumericValue(card), 0);
}

function canCallYaniv(player) {
  return getYanivHandTotal(player.assignments?.yaniv || []) <= 5;
}

function buildYanivDeck(state) {
  const yanivHandIds = new Set();
  const bragIds = new Set();
  const communityIds = new Set();

  state.players.forEach((player) => {
    (player.assignments?.yaniv || []).forEach((card) => {
      yanivHandIds.add(card.id);
    });

    (player.assignments?.brag || []).forEach((card) => {
      bragIds.add(card.id);
    });
  });

  (state.brag.communityCards || []).forEach((card) => {
    communityIds.add(card.id);
  });

  const remainingDeck = state.deck.filter((card) => {
    return !yanivHandIds.has(card.id) && !bragIds.has(card.id) && !communityIds.has(card.id);
  });

  const bragAndCommunityCards = [
    ...state.players.flatMap((player) => player.assignments?.brag || []),
    ...(state.brag.communityCards || [])
  ];

  return shuffleDeck([...remainingDeck, ...bragAndCommunityCards]);
}

export function startYaniv(state) {
  const newState = structuredClone(state);

  if (!newState.brag.results || newState.brag.results.length === 0) {
    return { error: "Finish Basketball Brag before starting Yaniv" };
  }

  const yanivDeck = buildYanivDeck(newState);

  if (yanivDeck.length === 0) {
    return { error: "Could not build Yaniv deck" };
  }

  const firstDiscard = yanivDeck.shift();

  newState.yaniv.started = true;
  newState.yaniv.result = null;
  newState.yaniv.pendingDiscard = [];
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.drawPile = yanivDeck;
  newState.yaniv.discardPile = firstDiscard ? [firstDiscard] : [];
  newState.yaniv.currentPlayerIndex = getPlayerOrderFromLeftOfDealer(newState)[0] ?? 0;
  newState.yaniv.selectedCardIds = [];

  return { state: newState };
}

export function startWhist(state) {
  const newState = structuredClone(state);

  if (!newState.yaniv.result) {
    return { error: "Finish Yaniv before starting Whist" };
  }

  newState.whist.started = true;

  return { state: newState };
}

export function discardYanivCards(state, playerIndex, cardIds) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  if (newState.yaniv.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your turn" };
  }

  // Slam opportunity expires once the next player starts their turn.
  if (newState.yaniv.canSlam) {
    newState.yaniv.canSlam = false;
    newState.yaniv.justDrawnCard = null;
    newState.yaniv.slamPlayerIndex = null;
  }

  if (newState.yaniv.pendingDiscard.length > 0) {
    return { error: "You have already discarded cards" };
  }

  const player = newState.players[playerIndex];
  const yanivHand = player.assignments?.yaniv || [];

  const selectedCards = cardIds.map((cardId) => yanivHand.find((card) => card.id === cardId)).filter(Boolean);

  if (selectedCards.length !== cardIds.length) {
    return { error: "Some selected cards not found in hand" };
  }

  if (!isValidYanivDiscard(selectedCards)) {
    return { error: "That is not a valid Yaniv discard" };
  }

  const selectedIds = new Set(selectedCards.map((card) => card.id));
  player.assignments.yaniv = yanivHand.filter((card) => !selectedIds.has(card.id));

  newState.yaniv.pendingDiscard = selectedCards;
  newState.yaniv.selectedCardIds = [];

  return { state: newState };
}

export function drawFromYanivDeck(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  if (newState.yaniv.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your turn" };
  }

  if (newState.yaniv.pendingDiscard.length === 0) {
    return { error: "Discard cards first" };
  }

  const drawnCard = newState.yaniv.drawPile.shift();
  if (!drawnCard) {
    return { error: "The draw pile is empty" };
  }

  const player = newState.players[playerIndex];
  player.assignments.yaniv.push(drawnCard);

  const canSlamNow = canCardBeSlammedOntoDiscard(newState.yaniv.pendingDiscard, drawnCard);

  // Show the just-discarded cards immediately on the table.
  newState.yaniv.discardPile.push(...newState.yaniv.pendingDiscard);
  newState.yaniv.pendingDiscard = [];

  if (canSlamNow) {
    newState.yaniv.justDrawnCard = drawnCard;
    newState.yaniv.canSlam = true;
    newState.yaniv.slamPlayerIndex = playerIndex;
    // Turn moves on while slam option remains available.
    advanceYanivTurn(newState, { preserveSlamWindow: true });
  } else {
    newState.yaniv.justDrawnCard = null;
    newState.yaniv.canSlam = false;
    newState.yaniv.slamPlayerIndex = null;
    advanceYanivTurn(newState);
  }

  newState.yaniv.drawEventCounter = (newState.yaniv.drawEventCounter || 0) + 1;
  newState.yaniv.lastDrawAction = {
    source: "deck",
    playerIndex,
    eventId: newState.yaniv.drawEventCounter
  };

  return { state: newState };
}

export function drawFromYanivDiscard(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  if (newState.yaniv.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your turn" };
  }

  if (newState.yaniv.pendingDiscard.length === 0) {
    return { error: "Discard cards first" };
  }

  const topDiscard = newState.yaniv.discardPile.pop();
  if (!topDiscard) {
    return { error: "There is no discard card to draw" };
  }

  const player = newState.players[playerIndex];
  player.assignments.yaniv.push(topDiscard);

  newState.yaniv.discardPile.push(...newState.yaniv.pendingDiscard);
  newState.yaniv.pendingDiscard = [];
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.drawEventCounter = (newState.yaniv.drawEventCounter || 0) + 1;
  newState.yaniv.lastDrawAction = {
    source: "discard",
    playerIndex,
    eventId: newState.yaniv.drawEventCounter
  };

  advanceYanivTurn(newState);

  return { state: newState };
}

export function slamYanivCard(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  if (!newState.yaniv.canSlam || !newState.yaniv.justDrawnCard) {
    return { error: "Cannot slam this card" };
  }

  if (newState.yaniv.slamPlayerIndex !== playerIndex) {
    return { error: "Only the slam owner can slam" };
  }

  const player = newState.players[playerIndex];

  // remove card from hand
  player.assignments.yaniv = player.assignments.yaniv.filter(
    card => card.id !== newState.yaniv.justDrawnCard.id
  );

  // add slam card to discard pile (discarded cards are already on pile)
  newState.yaniv.discardPile.push(newState.yaniv.justDrawnCard);

  newState.yaniv.pendingDiscard = [];
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.slamEventCounter = (newState.yaniv.slamEventCounter || 0) + 1;
  newState.yaniv.lastSlamAction = {
    playerIndex,
    eventId: newState.yaniv.slamEventCounter
  };

  return { state: newState };
}

export function continueWithoutSlam(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  if (newState.yaniv.currentPlayerIndex !== playerIndex) {
    return { error: "It is not your turn" };
  }

  if (!newState.yaniv.pendingDiscard.length && !newState.yaniv.canSlam) {
    return { error: "No pending action to continue" };
  }

  newState.yaniv.discardPile.push(...newState.yaniv.pendingDiscard);

  newState.yaniv.pendingDiscard = [];
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;

  advanceYanivTurn(newState);

  return { state: newState };
}

function advanceYanivTurn(state, options = {}) {
  state.yaniv.pendingDiscard = [];
  if (!options.preserveSlamWindow) {
    state.yaniv.justDrawnCard = null;
    state.yaniv.canSlam = false;
    state.yaniv.slamPlayerIndex = null;
  }
  state.yaniv.selectedCardIds = [];

  const order = getPlayerOrderFromLeftOfDealer(state);
  const currentPos = order.indexOf(state.yaniv.currentPlayerIndex);
  const nextPos = (currentPos + 1) % order.length;
  state.yaniv.currentPlayerIndex = order[nextPos];
}

function scoreYanivRound(state, callerIndex) {
  const caller = state.players[callerIndex];
  const callerCards = caller.assignments?.yaniv || [];
  const callerTotal = getYanivHandTotal(callerCards);

  const challengers = state.players
    .map((player, index) => ({
      index,
      name: player.name,
      total: getYanivHandTotal(player.assignments?.yaniv || [])
    }))
    .filter((entry) => entry.index !== callerIndex && entry.total <= callerTotal);

  const pointsByPlayer = state.players.map((player, index) => {
    let points = 0;

    if (index === callerIndex) {
      if (challengers.length === 0) {
        points = 50;
      } else if (challengers.length === 1) {
        points = 0;
      } else if (challengers.length === 2) {
        points = -30;
      } else {
        points = -60;
      }
    } else {
      const challenger = challengers.find((entry) => entry.index === index);
      if (challenger) {
        points = 30;
      } else {
        const total = getYanivHandTotal(state.players[index].assignments?.yaniv || []);
        points = 30 - total;
      }
    }

    return {
      playerIndex: index,
      playerName: player.name,
      points
    };
  });

  if (challengers.length === 0) {
    caller.score += 50;

    state.players.forEach((player, index) => {
      if (index === callerIndex) return;
      const total = getYanivHandTotal(player.assignments?.yaniv || []);
      player.score += (30 - total);
    });

    if (state.currentRoundSummary) {
      state.currentRoundSummary.yanivResult = {
        caller: caller.name,
        callerTotal,
        success: true,
        falseyCount: 0,
        challengers: [],
        pointsByPlayer
      };
    }

    return {
      caller: caller.name,
      callerTotal,
      success: true,
      falseyCount: 0,
      challengers: [],
      pointsByPlayer
    };
  }

  challengers.forEach((entry) => {
    state.players[entry.index].score += 30;
  });

  if (challengers.length === 1) {
    caller.score += 0;
  } else if (challengers.length === 2) {
    caller.score += -30;
  } else if (challengers.length >= 3) {
    caller.score += -60;
  }

  state.players.forEach((player, index) => {
    if (index === callerIndex) return;
    if (challengers.some((entry) => entry.index === index)) return;

    const total = getYanivHandTotal(player.assignments?.yaniv || []);
    player.score += (30 - total);
  });

  if (state.currentRoundSummary) {
    state.currentRoundSummary.yanivResult = {
      caller: caller.name,
      callerTotal,
      success: challengers.length === 0,
      falseyCount: challengers.length,
      challengers,
      pointsByPlayer
    };
  }

  return {
    caller: caller.name,
    callerTotal,
    success: false,
    falseyCount: challengers.length,
    challengers,
    pointsByPlayer
  };
}

export function callYaniv(state, playerIndex) {
  const newState = structuredClone(state);

  if (!newState.yaniv.started) {
    return { error: "Yaniv has not started" };
  }

  const isCallerTurn = newState.yaniv.currentPlayerIndex === playerIndex;
  const isSlamOwner =
    newState.yaniv.canSlam && newState.yaniv.slamPlayerIndex === playerIndex;

  if (!isCallerTurn && !isSlamOwner) {
    return { error: "It is not your turn" };
  }

  if (newState.yaniv.pendingDiscard.length > 0) {
    return { error: "Finish your turn before calling Yaniv" };
  }

  const player = newState.players[playerIndex];

  if (!canCallYaniv(player)) {
    return { error: "You can only call Yaniv when your hand total is 5 or less" };
  }

  const result = scoreYanivRound(newState, playerIndex);

  newState.yaniv.started = false;
  newState.yaniv.result = result;

  if (newState.currentRoundSummary) {
    newState.currentRoundSummary.yanivResult = result;
  }

  newState.whist.currentPlayerIndex = getPlayerOrderFromLeftOfDealer(newState)[0] ?? 0;
  newState.whist.leadSuit = null;
  newState.whist.currentTrick = [];
  newState.whist.trickWinnerIndex = null;

  return { state: newState };
}

export function nextRound(state) {
  let newState = structuredClone(state);

  const playerCount = newState.players.length;
  const totalRounds = getTotalRounds(playerCount);

  if (newState.round >= totalRounds) {
    return { error: "No more rounds left" };
  }

  newState.round += 1;
  newState.dealerIndex = (newState.dealerIndex + 1) % playerCount;

  let deck = createDeck(playerCount);
  deck = shuffleDeck(deck);

  newState.deck = deck;
  newState.trumpCard = drawTrumpCard(newState);

  newState.players.forEach((player) => {
    player.hand = [];
    player.assignments = null;
    player.nomination = null;
    player.swapSelection = null;
  });

newState.brag = {
  started: false,
  results: [],
  communityCards: [],
  currentPlayerIndex: null,
  turnCount: 0,
  turnsTakenByPlayer: newState.players.map(() => 0),
  firstCycleComplete: false,
  guruActive: false,
  knockAvailable: false,
  knock: null,
  finalTurnsRemaining: 0
};

  newState.yaniv.started = false;
  newState.yaniv.drawPile = [];
  newState.yaniv.discardPile = [];
  newState.yaniv.currentPlayerIndex = null;
  newState.yaniv.pendingDiscard = [];
  newState.yaniv.result = null;
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.selectedCardIds = [];
  newState.yaniv.lastDrawAction = null;
  newState.yaniv.drawEventCounter = 0;
  newState.yaniv.lastSlamAction = null;
  newState.yaniv.slamEventCounter = 0;

  newState.whist.started = false;
  newState.whist.currentPlayerIndex = null;
  newState.whist.leadSuit = null;
  newState.whist.currentTrick = [];
  newState.whist.tricksWon = newState.players.map(() => 0);
  newState.whist.lastWonTrickByPlayer = newState.players.map(() => []);
  newState.whist.wonTricksByPlayer = newState.players.map(() => []);
  newState.whist.wonTrickPiles = [];
  newState.whist.robotNoBotPending = false;
  newState.whist.robotNoBotAwaitingContinue = false;
  newState.whist.robotNoBotMode = null;
  newState.whist.robotNoBotResults = newState.players.map(() => null);
  newState.whist.robotNoBotCoinResult = null;
  newState.whist.result = null;
  newState.whist.trickWinnerIndex = null;
  newState.whist.selectionsComplete = false;
  newState.whist.nominationsComplete = false;

  newState.currentRoundSummary = createCurrentRoundSummary(newState);

  const dealResult = dealCards(newState);
  if (dealResult.error) return dealResult;

  newState = dealResult.state;

  return { state: newState };
}

export function jumpToRound(state, targetRound) {
  let newState = structuredClone(state);

  const playerCount = newState.players.length;
  const totalRounds = getTotalRounds(playerCount);
  const roundNumber = Number(targetRound);

  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > totalRounds) {
    return { error: `Round must be between 1 and ${totalRounds}` };
  }

  newState.round = roundNumber;
  newState.dealerIndex = (roundNumber - 1) % playerCount;

  let deck = createDeck(playerCount);
  deck = shuffleDeck(deck);

  newState.deck = deck;
  newState.trumpCard = drawTrumpCard(newState);

  newState.players.forEach((player) => {
    player.hand = [];
    player.assignments = null;
    player.nomination = null;
    player.swapSelection = null;
  });

  newState.brag = {
    started: false,
    results: [],
    communityCards: [],
    currentPlayerIndex: null,
    turnCount: 0,
    turnsTakenByPlayer: newState.players.map(() => 0),
    firstCycleComplete: false,
    guruActive: false,
    knockAvailable: false,
    knock: null,
    finalTurnsRemaining: 0
  };

  newState.yaniv.started = false;
  newState.yaniv.drawPile = [];
  newState.yaniv.discardPile = [];
  newState.yaniv.currentPlayerIndex = null;
  newState.yaniv.pendingDiscard = [];
  newState.yaniv.result = null;
  newState.yaniv.justDrawnCard = null;
  newState.yaniv.canSlam = false;
  newState.yaniv.slamPlayerIndex = null;
  newState.yaniv.selectedCardIds = [];
  newState.yaniv.lastDrawAction = null;
  newState.yaniv.drawEventCounter = 0;
  newState.yaniv.lastSlamAction = null;
  newState.yaniv.slamEventCounter = 0;

  newState.whist.started = false;
  newState.whist.currentPlayerIndex = null;
  newState.whist.leadSuit = null;
  newState.whist.currentTrick = [];
  newState.whist.tricksWon = newState.players.map(() => 0);
  newState.whist.lastWonTrickByPlayer = newState.players.map(() => []);
  newState.whist.wonTricksByPlayer = newState.players.map(() => []);
  newState.whist.wonTrickPiles = [];
  newState.whist.robotNoBotPending = false;
  newState.whist.robotNoBotAwaitingContinue = false;
  newState.whist.robotNoBotMode = null;
  newState.whist.robotNoBotResults = newState.players.map(() => null);
  newState.whist.robotNoBotCoinResult = null;
  newState.whist.result = null;
  newState.whist.trickWinnerIndex = null;
  newState.whist.selectionsComplete = false;
  newState.whist.nominationsComplete = false;

  newState.currentRoundSummary = createCurrentRoundSummary(newState);

  const dealResult = dealCards(newState);
  if (dealResult.error) return dealResult;

  newState = dealResult.state;

  return { state: newState };
}
