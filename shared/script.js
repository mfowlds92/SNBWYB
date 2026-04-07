const socket = io();

const roomId = "test-room";

let state = null;
let playerIndex = null;
let activeTabOverride = null;

// temporary client-side splitter state
let selectedSplitCardIds = [];
let tempAssignments = {};

// temporary client-side brag state
let selectedBragHandCardId = null;
let selectedBragCommunityCardId = null;

// temporary client-side yaniv state
let selectedYanivCardIds = [];

socket.emit("joinRoom", roomId);

socket.on("playerIndex", (index) => {
  playerIndex = index;
  render();
});

socket.on("stateUpdate", (newState) => {
  state = newState;
console.log(state);
  const myPlayer = playerIndex !== null ? state.players[playerIndex] : null;
  const alreadySaved = !!myPlayer?.assignments;

  if (alreadySaved) {
    selectedSplitCardIds = [];
    tempAssignments = {};
  } else if (myPlayer && Object.keys(tempAssignments).length === 0) {
    // first time only: start with all cards unassigned
    tempAssignments = {};
  }

  // clear brag selections whenever fresh server state arrives
  selectedBragHandCardId = null;
  selectedBragCommunityCardId = null;

  // clear yaniv selections whenever fresh server state arrives
  selectedYanivCardIds = [];

  render();
});

socket.on("errorMessage", (message) => {
  alert(message);
});

document.addEventListener("DOMContentLoaded", () => {
    const startBtn = document.getElementById("startGameBtn");
  if (startBtn) {
    startBtn.addEventListener("click", startGameHandler);
  }

  const nextRoundBtn = document.getElementById("nextRoundBtn");
  if (nextRoundBtn) {
    nextRoundBtn.addEventListener("click", nextRoundHandler);
  }

  const showScoreboardBtn = document.getElementById("showScoreboardBtn");
  if (showScoreboardBtn) {
    showScoreboardBtn.addEventListener("click", () => {
      activeTabOverride = 'scoreboard';
      setActiveTab('scoreboard');
    });
  }

  const returnToGameBtn = document.getElementById("returnToGameBtn");
  if (returnToGameBtn) {
    returnToGameBtn.addEventListener("click", () => {
      activeTabOverride = null;
      render();
    });
  }

  const saveNameBtn = document.getElementById("saveNameBtn");
  if (saveNameBtn) {
    saveNameBtn.addEventListener("click", saveNameHandler);
  }

  render();
});

function updatePlayerName(newName) {
  if (playerIndex === null || !state) return;
  socket.emit("updatePlayerName", {
    roomId,
    playerIndex,
    newName
  });
}

function renderMyPlayerInfo() {
  const myPlayerInfoEl = document.getElementById("myPlayerInfo");
  if (!myPlayerInfoEl || playerIndex === null || !state) {
    return;
  }

  const myPlayer = state.players[playerIndex];
  if (!myPlayer) return;

  const whistNomination = state.whist.nominationsComplete ? (myPlayer.nomination ?? "â€”") : "";
  const nominationDisplay = whistNomination ? `<div class="my-nomination-display">Nomination: ${whistNomination}</div>` : "";

  myPlayerInfoEl.innerHTML = `
    <div class="my-player-info-card">
      <div class="my-name-display"><strong>${myPlayer.name}</strong></div>
      ${nominationDisplay}
    </div>
  `;
}

function renderNameInput() {
  const nameInput = document.getElementById("nameInput");
  const saveNameBtn = document.getElementById("saveNameBtn");
  if (!nameInput || !saveNameBtn || playerIndex === null || !state) return;

  const myPlayer = state.players[playerIndex];
  nameInput.value = myPlayer?.name || "";
  const gameStarted = !!state.trumpCard;
  nameInput.disabled = gameStarted;
  saveNameBtn.disabled = gameStarted;
}

function startGameHandler() {
  socket.emit("startGame", roomId);
}

function saveNameHandler() {
  const nameInput = document.getElementById("nameInput");
  if (!nameInput) return;
  const newName = nameInput.value.trim();
  if (!newName) {
    alert("Please enter a name before saving.");
    return;
  }
  updatePlayerName(newName);
}


function getAssignmentTargets() {
  if (!state) return [];

  return [
    { key: "brag", label: "Basketball Brag", required: 3 },
    { key: "yaniv", label: "Yaniv", required: 5 },
    { key: "whist", label: "Nomination Whist", required: getWhistCardCount() }
  ];
}

function getMyPlayer() {
  if (!state || playerIndex === null) return null;
  return state.players[playerIndex] || null;
}

function getSelectedCardsForMe() {
  const me = getMyPlayer();
  if (!me) return [];

  return selectedSplitCardIds
    .map((cardId) => me.hand.find((card) => card.id === cardId))
    .filter(Boolean);
}

function toggleSplitCardSelection(cardId) {
  if (selectedSplitCardIds.includes(cardId)) {
    selectedSplitCardIds = selectedSplitCardIds.filter((id) => id !== cardId);
  } else {
    selectedSplitCardIds = [...selectedSplitCardIds, cardId];
  }

  render();
}

function assignSelectedCards(targetKey) {
  const selectedCards = getSelectedCardsForMe();

  if (!selectedCards.length) {
    return;
  }

  selectedCards.forEach((card) => {
    tempAssignments[card.id] = targetKey;
  });

  selectedSplitCardIds = [];
  render();
}

function unassignSelectedCards() {
  const selectedCards = getSelectedCardsForMe();

  if (!selectedCards.length) {
    return;
  }

  selectedCards.forEach((card) => {
    delete tempAssignments[card.id];
  });

  selectedSplitCardIds = [];
  render();
}

function getCardsInPile(targetKey) {
  const me = getMyPlayer();
  if (!me) return [];

  return me.hand.filter((card) => tempAssignments[card.id] === targetKey);
}

function getUnassignedCards() {
  const me = getMyPlayer();
  if (!me) return [];

  return me.hand.filter((card) => !tempAssignments[card.id]);
}

function getMyAssignmentCounts() {
  const counts = {};
  const targets = getAssignmentTargets();

  targets.forEach((target) => {
    counts[target.key] = 0;
  });

  Object.values(tempAssignments).forEach((targetKey) => {
    if (counts[targetKey] !== undefined) {
      counts[targetKey] += 1;
    }
  });

  return counts;
}
function sortCards(sortby) {
  const me = getMyPlayer();
  if (!me) return;

  // Define rank order
  const rankOrder = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'Joker': 14
  };

  // Define suit order
  const suitOrder = {
    'Clubs': 1, 'Diamonds': 2, 'Hearts': 3, 'Spades': 4, 'Joker': 5 // Joker gets a dummy suit
  };

  const sortFunction = (a, b) => {
    const aRank = rankOrder[a.rank];
    const bRank = rankOrder[b.rank];
    const aSuit = suitOrder[a.suit] || suitOrder['Joker']; // For Joker, use dummy
    const bSuit = suitOrder[b.suit] || suitOrder['Joker'];

    if (sortby === 1) {
      // Sort by suit then number
      if (aSuit !== bSuit) {
        return aSuit - bSuit;
      }
      return aRank - bRank;
    } else if (sortby === 2) {
      // Sort by number then suit
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return aSuit - bSuit;
    }
    return 0;
  };

  // Determine what to sort based on current phase
  if (state && state.brag && state.brag.started && me.assignments?.brag) {
    // Sort brag hand during brag phase
    me.assignments.brag.sort(sortFunction);
  } else if (state && state.yaniv && state.yaniv.started && me.assignments?.yaniv) {
    // Sort yaniv hand during yaniv phase
    me.assignments.yaniv.sort(sortFunction);
  } else if (state && state.whist && me.assignments?.whist && (state.whist.started || !state.whist.nominationsComplete)) {
    // Sort whist hand during nominations and whist play phases
    me.assignments.whist.sort(sortFunction);
  } else {
    // Sort main hand during splitting phase
    me.hand.sort(sortFunction);
  }

  render(); // Re-render to display the sorted cards
}
function saveAssignmentsHandler() {
  const me = getMyPlayer();
  if (!me) return;

  const targets = getAssignmentTargets();
  const counts = getMyAssignmentCounts();

  for (const card of me.hand) {
    const assignedTo = tempAssignments[card.id];
    if (!assignedTo) {
      alert("Every card must be assigned.");
      return;
    }
  }

  for (const target of targets) {
    if (counts[target.key] !== target.required) {
      alert(`${target.label} must have exactly ${target.required} cards.`);
      return;
    }
  }

  const assignments = {
  brag: getCardsInPile("brag").map(c => c.id),
  yaniv: getCardsInPile("yaniv").map(c => c.id),
  whist: getCardsInPile("whist").map(c => c.id)
};

socket.emit("saveWhistSelection", {
  roomId,
  playerIndex,
  selectedAssignments: assignments
});
}

function nextRoundHandler() {
  socket.emit("nextRound", roomId);
}

function getWhistCardCount() {
  if (!state) return 0;
  const roundConfigByPlayerCount = {
    2: [15, 14, 13, 12, 11, 10, 9, 9, 10, 11, 12, 13, 14, 15],
    3: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    4: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    5: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    6: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    7: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    8: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    9: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    10: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15]
  };

  const config = roundConfigByPlayerCount[state.players.length];
  return config[state.round - 1] - 8;
}

function getPlayerOrderFromLeftOfDealer() {
  if (!state) return [];
  const order = [];
  for (let i = 1; i <= state.players.length; i++) {
    order.push((state.dealerIndex + i) % state.players.length);
  }
  return order;
}

function getNextNominationPlayerIndex() {
  const order = getPlayerOrderFromLeftOfDealer();

  for (const playerIndex of order) {
    const nomination = state.players[playerIndex].nomination;
    if (nomination === null || nomination === "") {
      return playerIndex;
    }
  }

  return null;
}

function saveNominationHandler() {
  if (!state || playerIndex === null) return;

  const input = document.getElementById("nominationInput");
  if (!input) return;

  socket.emit("saveNomination", {
    roomId,
    playerIndex,
    nomination: input.value
  });
}

function toggleBragHandSelection(cardId) {
  selectedBragHandCardId =
    selectedBragHandCardId === cardId ? null : cardId;
  render();
}

function toggleBragCommunitySelection(cardId) {
  selectedBragCommunityCardId =
    selectedBragCommunityCardId === cardId ? null : cardId;
  render();
}

function swapBragOneHandler() {
  if (playerIndex === null) return;

  if (!selectedBragHandCardId || !selectedBragCommunityCardId) {
    alert("Select 1 Brag hand card and 1 community card first.");
    return;
  }

  socket.emit("swapBragOne", {
    roomId,
    playerIndex,
    handCardId: selectedBragHandCardId,
    communityCardId: selectedBragCommunityCardId
  });
}

function swapBragThreeHandler() {
  if (playerIndex === null) return;

  socket.emit("swapBragThree", {
    roomId,
    playerIndex,
   
  });
}

function shouldShowKnockGuru() {
  const brag = state?.brag;
  if (!brag) return false;

  if (!brag.started) return false;
  if (!brag.knockAvailable) return false;
  if (brag.knock) return false;
  if (playerIndex !== brag.currentPlayerIndex) return false;

  return true;
}

function chooseKnockOrGuruHandler(choice) {
  socket.emit("chooseKnockOrGuru", {
    roomId,
    choice
  });
}

function startYanivHandler() {
  socket.emit("startYaniv", roomId);
}

function continueToYanivHandler() {
  console.log("continueToYanivHandler called", roomId);
  socket.emit("startYaniv", roomId);
}

function continueToWhistHandler() {
  socket.emit("startWhist", roomId);
}

function toggleYanivCardSelection(cardId) {
  if (state.yaniv.pendingDiscard.length > 0) return;

  const index = selectedYanivCardIds.indexOf(cardId);
  if (index > -1) {
    selectedYanivCardIds.splice(index, 1);
  } else {
    selectedYanivCardIds.push(cardId);
  }
  render();
}

function discardAndDrawFromYanivDeckHandler() {
  if (playerIndex === null) return;

  if (selectedYanivCardIds.length === 0) {
    alert("Select cards to discard first.");
    return;
  }

  socket.emit("discardYanivCards", {
    roomId,
    cardIds: selectedYanivCardIds
  });

  // Draw from deck after discard is processed
  setTimeout(() => {
    socket.emit("drawFromYanivDeck", roomId);
  }, 50);
}

function discardAndDrawFromYanivDiscardHandler() {
  if (playerIndex === null) return;

  if (selectedYanivCardIds.length === 0) {
    alert("Select cards to discard first.");
    return;
  }

  socket.emit("discardYanivCards", {
    roomId,
    cardIds: selectedYanivCardIds
  });

  // Draw from discard after discard is processed
  setTimeout(() => {
    socket.emit("drawFromYanivDiscard", roomId);
  }, 50);
}

function slamYanivCardHandler() {
  if (playerIndex === null) return;

  socket.emit("slamYanivCard", roomId);
}

function continueWithoutSlamHandler() {
  if (playerIndex === null) return;

  socket.emit("continueWithoutSlam", roomId);
}

function callYanivHandler() {
  if (playerIndex === null) return;

  socket.emit("callYaniv", roomId);
}

function playCardHandler(cardId) {
  if (playerIndex === null) {
    alert("You are not connected as a player yet.");
    return;
  }

  socket.emit("playCard", {
    roomId,
    playerIndex,
    cardId
  });
}

function setActiveTab(tabName, manual = false) {
  if (manual) {
    activeTabOverride = tabName;
  }

  document.querySelectorAll('.panel[data-tab]').forEach(panel => panel.classList.remove('active'));
  const activePanel = document.querySelector(`.panel[data-tab="${tabName}"]`);
  if (activePanel) activePanel.classList.add('active');
}

function render() {
  // Determine which tab to show
  let activeTab = activeTabOverride || 'waiting';
  if (!activeTabOverride && state && state.trumpCard) {
    if (state.whist.result && !state.whist.started) {
      // Whist phase complete - show results
      activeTab = 'whist';
    } else if (!state.whist.selectionsComplete) {
      activeTab = 'splitter';
    } else if (!state.whist.nominationsComplete) {
      activeTab = 'whist';
    } else if (state.whist.started) {
      activeTab = 'whist';
    } else if (state.yaniv.result && !state.yaniv.started) {
      // Yaniv phase complete - show results
      activeTab = 'yaniv';
    } else if (state.yaniv.started) {
      activeTab = 'yaniv';
    } else if (state.brag.results && state.brag.results.length > 0 && !state.yaniv.started) {
      // Brag phase complete - show results
      activeTab = 'brag-results';
    } else if (state.brag.started) {
      activeTab = 'brag';
    }
  }
  setActiveTab(activeTab);

  renderStatus();
  renderMyPlayerInfo();
  renderNameInput();
  renderPlayerStatusBoxes();
  renderPlayers();
  renderSplitter();
  renderBrag();
  renderBragResults();
  renderYaniv();
  renderScoreboard();
  renderWhist();
}



function renderStatus() {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;

  if (!state) {
    statusEl.textContent = "Connecting to server...";
    return;
  }

  const roundValue = state.round ?? "â€”";
  const dealerValue = state.players[state.dealerIndex]?.name || "Unknown";
  const trumpCardHtml = state.trumpCard ? cardToText(state.trumpCard) : "Not set";
  let phaseValue = "Waiting";
  let detailValue = "";

  if (state.brag.started && !state.brag.results) {
    const currentPlayer = state.players[state.brag.currentPlayerIndex];
    phaseValue = "Basketball Brag";
    detailValue = `${currentPlayer?.name || "Unknown player"}'s turn.`;
  } else if (state.yaniv.started && !state.yaniv.result) {
    const currentPlayer = state.players[state.yaniv.currentPlayerIndex];
    phaseValue = "Yaniv";
    detailValue = `${currentPlayer?.name || "Unknown player"}'s turn.`;
  } else if (!state.whist.nominationsComplete) {
    const nextNominationPlayerIndex = getNextNominationPlayerIndex();
    const nextPlayerName =
      nextNominationPlayerIndex !== null
        ? state.players[nextNominationPlayerIndex]?.name || "Unknown"
        : "Unknown";

    phaseValue = "Nominations";
    detailValue = `Waiting for nominations. Next: ${nextPlayerName}`;
  } else if (!state.whist.started && state.whist.result) {
    phaseValue = "Whist complete";
    detailValue = "Waiting for next round.";
  } else if (!state.whist.started) {
    phaseValue = "Nominations complete";
    detailValue = "Waiting to start Whist.";
  } else {
    const currentPlayer = state.players[state.whist.currentPlayerIndex];
    phaseValue = "Whist";
    detailValue = `${currentPlayer?.name || "Unknown player"}'s turn.`;
  }

  statusEl.innerHTML = `
    <table class="status-table">
      <tbody>
        <tr>
          <td>Round</td>
          <td>${roundValue}</td>
        </tr>
        <tr>
          <td>Dealer</td>
          <td>${dealerValue}</td>
        </tr>
        <tr>
          <td>Phase</td>
          <td>${phaseValue}</td>
        </tr>
        <tr>
          <td>Detail</td>
          <td>${detailValue}</td>
        </tr>
        <tr>
          <td>Trump</td>
          <td class="status-trump-cell">${trumpCardHtml}</td>
        </tr>
      </tbody>
    </table>
  `;
}

function renderPlayerStatusBoxes() {
  const boxesEl = document.getElementById("playerStatusBoxes");
  if (!boxesEl || !state) {
    return;
  }

  // Determine who has the turn in various games/phases
  let currentTurnPlayerIndex = null;
  const isDuringSplit = !state.whist.selectionsComplete;

  if (!isDuringSplit) {
    // Turn-based phases
    if (!state.whist.nominationsComplete) {
      currentTurnPlayerIndex = getNextNominationPlayerIndex();
    } else if (state.brag.started) {
      currentTurnPlayerIndex = state.brag.currentPlayerIndex;
    } else if (state.yaniv.started) {
      currentTurnPlayerIndex = state.yaniv.currentPlayerIndex;
    } else if (state.whist.started) {
      currentTurnPlayerIndex = state.whist.currentPlayerIndex;
    }
  }

  const sortedPlayers = state.players
    .map((player, index) => ({ ...player, index }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  boxesEl.innerHTML = sortedPlayers.map((player) => {
    const isCurrentTurn = player.index === currentTurnPlayerIndex;
    let statusClass = "";

    if (isDuringSplit && !!player.assignments) {
      statusClass = "player-deck-submitted";
    } else if (isCurrentTurn) {
      statusClass = "player-turn-active";
    }

    const nominationText = player.nomination !== null && player.nomination !== undefined ? player.nomination : "-";

    return `
      <div class="player-status-box ${statusClass}">
        <div class="player-status-label">${player.name}${player.index === playerIndex ? " (You)" : ""}</div>
        <div class="player-status-sub">Nom: ${nominationText}</div>
        <div class="player-status-score">${player.score} pts</div>
      </div>
    `;
  }).join("");
}

function renderPlayers() {
  const playersEl = document.getElementById("players");
  if (!playersEl || !state) return;

  const sortedPlayers = [...state.players]
    .map((player, index) => ({ ...player, index }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const rows = sortedPlayers.map((player) => {
    const isMe = player.index === playerIndex ? " (You)" : "";
    return `
    <tr>
      <td>${player.name}${isMe}</td>
      <td>${player.score}</td>
    </tr>
  `;
  }).join("");

  playersEl.innerHTML = `
    <table class="leaderboard-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function renderScoreboard() {
  const scoreboardEl = document.getElementById("scoreboard");
  if (!scoreboardEl || !state) return;

  const history = Array.isArray(state.roundHistory) ? state.roundHistory : [];
  const currentSummary = state.currentRoundSummary || null;

  const allRounds = [...history];
  if (currentSummary) {
    allRounds.push(currentSummary);
  }

  if (!allRounds.length) {
    scoreboardEl.innerHTML = "<p>No rounds completed yet.</p>";
    return;
  }

  const cumulativeByPlayer = state.players.map(() => ({
    nomination: 0,
    brag: 0,
    yaniv: 0,
    whist: 0,
    total: 0
  }));

  allRounds.forEach((roundSummary) => {
    state.players.forEach((player, pIdx) => {
      const nominationRaw = roundSummary.nominations?.find((n) => n.playerIndex === pIdx)?.nomination;
      const nomination = Number.isFinite(Number(nominationRaw)) ? Number(nominationRaw) : 0;
      const bragPoints = roundSummary.bragResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
      const yanivPoints = roundSummary.yanivResult?.pointsByPlayer?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
      const whistPoints = roundSummary.whistResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;

      cumulativeByPlayer[pIdx].nomination += nomination;
      cumulativeByPlayer[pIdx].brag += bragPoints;
      cumulativeByPlayer[pIdx].yaniv += yanivPoints;
      cumulativeByPlayer[pIdx].whist += whistPoints;
      cumulativeByPlayer[pIdx].total += bragPoints + yanivPoints + whistPoints;
    });
  });

  const playerColCount = 5; // N, B, Y, W, T
  const headerPlayerCells = state.players
    .map((player, idx) => `<th colspan="${playerColCount}">${player.name}${idx === playerIndex ? " (You)" : ""}</th>`)
    .join("");

  const headerSubCells = state.players
    .map(() => `<th class="scoreboard-footer-nomination">N</th><th class="scoreboard-footer-brag">B</th><th class="scoreboard-footer-yaniv">Y</th><th class="scoreboard-footer-whist">W</th><th class="scoreboard-col-total">T</th>`)
    .join("");

  const bodyRows = allRounds
    .map((roundSummary, idx) => {
      const isInProgress = idx === allRounds.length - 1 && currentSummary;
      let playerCells = "";

      state.players.forEach((player, pIdx) => {
        const nomination = roundSummary.nominations?.find((n) => n.playerIndex === pIdx)?.nomination ?? "-";
        const bragPoints = roundSummary.bragResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const yanivPoints = roundSummary.yanivResult?.pointsByPlayer?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const whistPoints = roundSummary.whistResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const roundTotal = bragPoints + yanivPoints + whistPoints;

        playerCells += `<td class="scoreboard-col-nomination">${nomination}</td><td class="scoreboard-col-brag">${bragPoints}</td><td class="scoreboard-col-yaniv">${yanivPoints}</td><td class="scoreboard-col-whist">${whistPoints}</td><td class="scoreboard-col-total">${roundTotal}</td>`;
      });

      const rowClass = isInProgress ? 'class="scoreboard-row-inprogress"' : "";
      return `<tr ${rowClass}><td class="scoreboard-col-meta">${roundSummary.round}</td><td class="scoreboard-col-meta">${roundSummary.trump || "-"}</td>${playerCells}</tr>`;
    })
    .join("");

  let footerPlayerCells = "";
  state.players.forEach((player, pIdx) => {
    const totals = cumulativeByPlayer[pIdx];
    footerPlayerCells += `
      <td class="scoreboard-footer-nomination">${totals.nomination}</td>
      <td class="scoreboard-footer-brag">${totals.brag}</td>
      <td class="scoreboard-footer-yaniv">${totals.yaniv}</td>
      <td class="scoreboard-footer-whist">${totals.whist}</td>
      <td class="scoreboard-footer-total">${totals.total}</td>
    `;
  });

  scoreboardEl.innerHTML = `
    <div class="scoreboard-table-wrapper">
      <table class="scoreboard-table">
        <thead>
          <tr>
            <th>Round</th>
            <th>Trump</th>
            ${headerPlayerCells}
          </tr>
          <tr class="header-subrow">
            <th colspan="2"></th>
            ${headerSubCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
        <tfoot>
          <tr class="scoreboard-footer-row">
            <td colspan="2"><strong>Totals</strong></td>
            ${footerPlayerCells}
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function renderMyHand(hand) {
  if (!hand.length) {
    return "<p>No cards</p>";
  }

  return `
    <div class="action-row">
      ${hand
        .map(
          (card) => `
            <button onclick="window.playCard('${card.id}')">
              ${cardToText(card)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSplitter() {
  const splitterEl = document.getElementById("splitter");
  const splitInstructionsEl = document.getElementById("splitInstructions");

  if (!splitterEl || !splitInstructionsEl) return;

  if (!state || playerIndex === null) {
    splitInstructionsEl.textContent = "Waiting for server...";
    splitterEl.innerHTML = "";
    return;
  }

  const me = getMyPlayer();
  if (!me) {
    splitInstructionsEl.textContent = "Waiting for player...";
    splitterEl.innerHTML = "";
    return;
  }

  if (me.assignments) {
    splitInstructionsEl.textContent = "You have already saved your hand split. Waiting for other players...";
    splitterEl.innerHTML = `
      <div class="split-player">
        <strong>Your split is saved.</strong>
      </div>
    `;
    return;
  }

  if (state.whist.selectionsComplete) {
    splitInstructionsEl.textContent = "All players have saved their hand splits.";
    splitterEl.innerHTML = `
      <div class="split-player">
        <strong>All hand splits complete.</strong>
      </div>
    `;
    return;
  }

  const targets = getAssignmentTargets();
  const counts = getMyAssignmentCounts();
  const unassignedCards = getUnassignedCards();

  splitInstructionsEl.textContent =
    "Select cards and move them into Brag, Yaniv, and Whist.";

  const countsHtml = targets
    .map((target) => {
      const current = counts[target.key] || 0;
      const goodClass = current === target.required ? "good" : "";
      return `<div class="${goodClass}">${target.label}: ${current} / ${target.required}</div>`;
    })
    .join("");

  const unassignedHtml = unassignedCards.length
    ? unassignedCards
        .map((card, index) => {
          const isSelected = selectedSplitCardIds.includes(card.id);
          return `
            <button
              type="button"
              class="split-card-button ${isSelected ? "selected-card" : ""}"
              style="z-index:${index + 1};"
              onclick="window.toggleSplitCardSelection('${card.id}')"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : `<div class="small-note">No unassigned cards left.</div>`;

  const pilesHtml = targets
    .map((target, idx) => {
      const pileColors = ["#FF8888", "#6BA8D0", "#C896E0"];
      const pileColor = pileColors[idx] || "#999";
      const cardsInPile = getCardsInPile(target.key);
      const current = counts[target.key] || 0;
      const isFull = current === target.required;

      const pileCardsHtml = cardsInPile.length
        ? cardsInPile
            .map((card, index) => {
              const isSelected = selectedSplitCardIds.includes(card.id);
              return `
                <button
                  type="button"
                  class="split-card-button ${isSelected ? "selected-card" : ""}"
                  style="z-index:${index + 1};"
                  onclick="window.toggleSplitCardSelection('${card.id}')"
                >
                  ${cardToText(card)}
                </button>
              `;
            })
            .join("")
        : `<div class="small-note">No cards here yet.</div>`;

      return `
        <div 
          class="split-pile split-pile-clickable" 
          style="background-color: rgba(${parseInt(pileColor.slice(1,3), 16)}, ${parseInt(pileColor.slice(3,5), 16)}, ${parseInt(pileColor.slice(5,7), 16)}, 0.85);" 
        >
          <div class="split-pile-header-clickable" onclick="window.assignSelectedCards('${target.key}')">
            <strong>${target.label}</strong>
            <div class="split-pile-count">${current} / ${target.required}</div>
          </div>
          <div class="split-stack">
            ${pileCardsHtml}
          </div>
        </div>
      `;
    })
    .join("");

  // Update header with sort buttons and tooltip
  const panelHeaderEl = document.querySelector('.panel[data-tab="splitter"] .panel-header-with-tooltip');
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      <div class="sort-buttons-group">
        <button type="button" onclick="window.sortCards(1)">Sort Suit</button>
        <button type="button" onclick="window.sortCards(2)">Sort Number</button>
      </div>
      <h2 style="display:none;">Hand Splitter</h2>
      <div class="tooltip-icon" title="Split your hand into Basketball Brag, Yaniv, and Nomination Whist piles">?</div>
    `;
  }

  splitterEl.innerHTML = `
    <div class="split-player">
      <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr; margin-bottom: 20px;">
        <div 
          class="split-pile split-pile-clickable" 
          style="background-color: rgba(118, 184, 118, 0.85);"
        >
          <div class="split-pile-header-clickable" onclick="window.unassignSelectedCards()">
            <strong>Unassigned cards</strong>
          </div>
          <div class="split-stack">
            ${unassignedHtml}
          </div>
        </div>
      </div>

      <div class="split-piles-area normal-layout">
        ${pilesHtml}
      </div>
    </div>
    <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
      <button
        type="button"
        onclick="window.saveAssignmentsHandler()"
        style="padding: 12px 24px; font-size: 16px;"
        ${targets.every(t => (counts[t.key] || 0) === t.required) ? "" : "disabled"}
      >
        Save Hand Split
      </button>
    </div>
  `;
}

function renderBrag() {
  const bragStatusEl = document.getElementById("bragStatus");
  const bragControlsEl = document.getElementById("bragControls");
  const bragTableEl = document.getElementById("bragTable");

  if (!bragStatusEl || !bragControlsEl || !bragTableEl) return;

  // Hide status and clear table
  bragStatusEl.style.display = "none";
  bragTableEl.innerHTML = ``;

  if (!state || !state.brag) {
    bragControlsEl.innerHTML = "";
    return;
  }

  if (!state.brag.started) {
    bragControlsEl.innerHTML = "";
    return;
  }

  // Update header with sort buttons
  const panelHeaderEl = document.querySelector('.panel[data-tab="brag"] .panel-header-with-tooltip');
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      <div class="sort-buttons-group">
        <button type="button" onclick="window.sortCards(1)">Sort Suit</button>
        <button type="button" onclick="window.sortCards(2)">Sort Number</button>
      </div>
      <h2 style="display:none;">Basketball Brag</h2>
      <div class="tooltip-icon" title="Players compete to have the best 3-card hand">?</div>
    `;
  }

  const me = getMyPlayer();
  const myBragHand = me?.assignments?.brag || [];
  const currentPlayerIndex = state.brag.currentPlayerIndex;
  const isMyTurn = currentPlayerIndex === playerIndex;
  const isDecisionPendingForMe =
    isMyTurn &&
    state.brag.knockAvailable &&
    !state.brag.knock;

  const myHandHtml = myBragHand.length
    ? myBragHand
        .map((card) => {
          const selected = selectedBragHandCardId === card.id;
          return `
            <button
              type="button"
              class="split-card-button ${selected ? "selected-card" : ""}"
              style="margin: 0;"
              onclick="window.toggleBragHandSelection('${card.id}')"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : `<div class="small-note">No Brag cards assigned</div>`;

  const communityHtml = (state.brag.communityCards || []).length
    ? state.brag.communityCards
        .map((card) => {
          const selected = selectedBragCommunityCardId === card.id;
          return `
            <button
              type="button"
              class="split-card-button ${selected ? "selected-card" : ""}"
              style="margin: 0;"
              onclick="window.toggleBragCommunitySelection('${card.id}')"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : `<div class="small-note">No community cards</div>`;

  const knockGuruButtons = shouldShowKnockGuru()
    ? `
      <button type="button" onclick="window.chooseKnockOrGuruHandler('knock')">Knock</button>
      <button type="button" onclick="window.chooseKnockOrGuruHandler('guru')">Guru</button>
    `
    : "";

  bragControlsEl.innerHTML = `
    <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr; margin-top: 20px;">
      <div 
        class="split-pile split-pile-clickable" 
        style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px;"
      >
        <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
          ${communityHtml}
        </div>
      </div>
    </div>

    <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr; margin-top: 20px;">
      <div 
        class="split-pile split-pile-clickable" 
        style="background-color: rgba(255, 136, 136, 0.85); justify-content: flex-start; padding: 12px;"
      >
        <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
          <strong>Your Brag Hand</strong>
        </div>
        <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
          ${myHandHtml}
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 12px; margin-top: 20px; justify-content: center;">
      <button
        type="button"
        onclick="window.swapBragOneHandler()"
        ${isMyTurn && !isDecisionPendingForMe ? "" : "disabled"}
      >
        Swap
      </button>

      <button
        type="button"
        onclick="window.swapBragThreeHandler()"
        ${isMyTurn && !isDecisionPendingForMe ? "" : "disabled"}
      >
        All
      </button>

      ${knockGuruButtons}
    </div>
  `;
}

function renderBragResults() {
  const bragResultsEl = document.getElementById("bragResultsContent");
  if (!bragResultsEl || !state) return;

  if (!state.brag.results || state.brag.results.length === 0) {
    bragResultsEl.innerHTML = "";
    return;
  }

  const resultsHtml = state.players
    .map((player, idx) => {
      const result = state.brag.results.find((r) => r.index === idx);
      if (!result) return "";
      
      const bragHand = player.assignments?.brag || [];
      const cardsHtml = bragHand
        .map(card => `<button class="split-card-button" style="margin: 0;">${cardToText(card)}</button>`)
        .join("");

      return `
        <div class="split-pile split-pile-clickable" 
          style="background-color: rgba(255, 136, 136, 0.85); justify-content: flex-start; padding: 12px; margin-bottom: 16px;">
          <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
            <strong>${player.name}${idx === playerIndex ? " (You)" : ""}</strong>
          </div>
          <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
            ${cardsHtml || `<div class="small-note">No cards</div>`}
          </div>
          <div style="margin-top: 12px; text-align: center; font-weight: bold;">
            Place: ${result.position || "â€”"}, Points: ${result.score || 0}
          </div>
        </div>
      `;
    })
    .filter(html => html !== "")
    .join("");

  bragResultsEl.innerHTML = `<div class="phase-results">${resultsHtml}</div>`;
}

function renderYaniv() {
  const yanivControlsEl = document.getElementById("yanivControls");
  const yanivTableEl = document.getElementById("yanivTable");

  if (!yanivControlsEl || !yanivTableEl) return;

  if (!state || !state.yaniv) {
    yanivControlsEl.innerHTML = "";
    yanivTableEl.innerHTML = "";
    return;
  }

  const me = getMyPlayer();
  const myYanivHand = me?.assignments?.yaniv || [];
  const currentPlayerIndex = state.yaniv.currentPlayerIndex;
  const currentPlayerName =
    currentPlayerIndex !== null
      ? state.players[currentPlayerIndex]?.name || "Unknown"
      : "Unknown";

  // Update header with sort buttons and tooltip
  const panelHeaderEl = document.querySelector('.panel[data-tab="yaniv"] .panel-header-with-tooltip');
  const isYanivResultsView = !state.yaniv.started && !!state.yaniv.result;
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      <div class="sort-buttons-group">
        <button type="button" ${isYanivResultsView ? "disabled" : ""} onclick="window.sortCards(1)">Sort Suit</button>
        <button type="button" ${isYanivResultsView ? "disabled" : ""} onclick="window.sortCards(2)">Sort Number</button>
      </div>
      <h2 style="display:none;">Yaniv</h2>
      <div class="tooltip-icon" title="Draw and discard cards to get your hand total to 5 or less">?</div>
    `;
  }

  if (!state.brag.results || state.brag.results.length === 0) {
    yanivControlsEl.innerHTML = "";
    yanivTableEl.innerHTML = "";
    return;
  }

  if (!state.yaniv.started && !state.yaniv.result) {
    yanivControlsEl.innerHTML = `
      <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
        <button onclick="window.startYanivHandler()">Start Yaniv</button>
      </div>
    `;
    yanivTableEl.innerHTML = "";
    return;
  }

  if (!state.yaniv.started && state.yaniv.result) {
    const result = state.yaniv.result;
    yanivControlsEl.innerHTML = "";

    const resultsHtml = state.players
      .map((player, idx) => {
        const yanivHand = player.assignments?.yaniv || [];
        const pointResult = result.pointsByPlayer?.find((p) => p.playerIndex === idx);
        const cardsHtml = yanivHand
          .map(card => `<button class="split-card-button" style="margin: 0;">${cardToText(card)}</button>`)
          .join("");

        return `
          <div class="split-pile split-pile-clickable" 
            style="background-color: rgba(107, 168, 208, 0.85); justify-content: flex-start; padding: 12px; margin-bottom: 16px;">
            <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
              <strong>${player.name}${idx === playerIndex ? " (You)" : ""}</strong>
            </div>
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${cardsHtml || `<div class="small-note">No cards</div>`}
            </div>
            <div style="margin-top: 12px; text-align: center; font-weight: bold;">
              Points: ${pointResult?.points || 0}
            </div>
          </div>
        `;
      })
      .join("");

    yanivTableEl.innerHTML = `
      <div class="phase-results">${resultsHtml}</div>
      <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
        <button id="continueToWhistBtn" onclick="window.continueToWhistHandler()">Continue to Whist</button>
      </div>
    `;
    return;
  }

  if (!state.yaniv.started) {
    yanivControlsEl.innerHTML = "";
    yanivTableEl.innerHTML = "";
    return;
  }

  const isMyTurn = currentPlayerIndex === playerIndex;
  const hasPendingDiscard = state.yaniv.pendingDiscard.length > 0;
  const selectedCount = selectedYanivCardIds.length;
  const canDraw = selectedCount > 0;
  const canUsePileActions = isMyTurn && !hasPendingDiscard && canDraw;
  const canCallYaniv = myYanivHand.length > 0 && myYanivHand.reduce((sum, card) => sum + getYanivCardNumericValue(card), 0) <= 5;

  yanivControlsEl.innerHTML = `
    ${canCallYaniv && isMyTurn && !hasPendingDiscard && selectedCount === 0
      ? `<div style="display: flex; justify-content: center; margin-top: 10px;"><button onclick="window.callYanivHandler()">Call Yaniv</button></div>`
      : ""}
    ${hasPendingDiscard && isMyTurn && state.yaniv.canSlam
      ? `<div class="action-row" style="justify-content: center; margin-top: 14px;">
          <button onclick="window.slamYanivCardHandler()">Slam Card</button>
          <button onclick="window.continueWithoutSlamHandler()">Continue Without Slam</button>
        </div>`
      : ""}
    ${!isMyTurn
      ? `<div class="small-note" style="text-align: center; margin-top: 12px;">${currentPlayerName}'s turn</div>`
      : ""}
  `;

  // Render the table with hands and discard pile
  const discardTop = state.yaniv.discardPile.length > 0 ? state.yaniv.discardPile[state.yaniv.discardPile.length - 1] : null;
  const drawPileTop = Array.isArray(state.yaniv.drawPile) && state.yaniv.drawPile.length > 0 ? state.yaniv.drawPile[0] : null;
  const drawPileBackClass = drawPileTop ? getCardBackClass(drawPileTop.backColor) : "";
  const discardPileAction = canUsePileActions ? `onclick="window.discardAndDrawFromYanivDiscardHandler()"` : "";
  const drawPileAction = canUsePileActions ? `onclick="window.discardAndDrawFromYanivDeckHandler()"` : "";
  const pileActionStyle = canUsePileActions ? "cursor: pointer; opacity: 1;" : "cursor: not-allowed; opacity: 0.7;";

  const myHandHtml = myYanivHand.length > 0
    ? myYanivHand
        .map((card) => {
          const isSelected = selectedYanivCardIds.includes(card.id);
          return `
            <button
              type="button"
              class="split-card-button ${isSelected ? "selected-card" : ""}"
              onclick="window.toggleYanivCardSelection('${card.id}')"
              style="margin: 0; ${state.yaniv.pendingDiscard.length > 0 ? "pointer-events: none; opacity: 0.5;" : ""}"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : "<div class=\"small-note\">No cards in hand.</div>";

  const otherPlayersBacksHtml = state.players
    .filter((_, idx) => idx !== playerIndex)
    .map((player) => {
      const hiddenYanivCards = player.assignments?.yaniv || [];
      const backCardsHtml = hiddenYanivCards.length > 0
        ? hiddenYanivCards
            .map((card) => `
              <div class="card card-back-only ${getCardBackClass(card.backColor)}">
                <div class="card-back-pattern"></div>
              </div>
            `)
            .join("")
        : `<div class="small-note">0 cards</div>`;

      return `
        <div class="yaniv-other-player-item">
          <div class="yaniv-other-player-name">${player.name}</div>
          <div class="yaniv-other-player-stack">
            ${backCardsHtml}
          </div>
        </div>
      `;
    })
    .join("");

  yanivTableEl.innerHTML = `
    <div class="yaniv-area">
      <div class="yaniv-other-players-box">
        ${otherPlayersBacksHtml}
      </div>
      <div class="yaniv-info-box">
        <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr 1fr; margin-top: 0;">
          <div
            class="split-pile split-pile-clickable"
            style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px; ${pileActionStyle}"
            ${discardPileAction}
          >
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${discardTop ? cardToText(discardTop) : `<div class="small-note">Empty</div>`}
            </div>
          </div>
          <div
            class="split-pile split-pile-clickable"
            style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px; ${pileActionStyle}"
            ${drawPileAction}
          >
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${drawPileTop ? `<div class="card card-back-only ${drawPileBackClass}"><div class="card-back-pattern"></div></div>` : `<div class="small-note">Empty</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="yaniv-info-box">
        <div
          class="split-pile split-pile-clickable"
          style="background-color: rgba(107, 168, 208, 0.85); justify-content: flex-start; padding: 12px;"
        >
          <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
            <strong>Your Yaniv Hand (${myYanivHand.length} cards)</strong>
          </div>
          <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
            ${myHandHtml}
          </div>
        </div>
      </div>
    </div>
    ${isMyTurn && !hasPendingDiscard ? `<div class="small-note" style="text-align: center; margin-top: 8px;">Select card(s), then click a pile to draw.</div>` : ""}
  `;
}

function renderWhist() {
  const whistTableEl = document.getElementById("whistTable");
  if (!whistTableEl) return;

  const isWhistResultsView = !!state?.whist?.result && !state?.whist?.started;
  const panelHeaderEl = document.querySelector('.panel[data-tab="whist"] .panel-header-with-tooltip');
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      <div class="sort-buttons-group">
        <button type="button" ${isWhistResultsView ? "disabled" : ""} onclick="window.sortCards(1)">Sort Suit</button>
        <button type="button" ${isWhistResultsView ? "disabled" : ""} onclick="window.sortCards(2)">Sort Number</button>
      </div>
      <h2 style="display:none;">Nomination Whist</h2>
      <div class="tooltip-icon" title="Nominate tricks and win exactly that many">?</div>
    `;
  }

  const whistPanelH2 = document.querySelector('.panel[data-tab="whist"] h2');
  if (whistPanelH2) {
    whistPanelH2.textContent = !state || !state.whist.nominationsComplete ? "Nominations" : "Nomination Whist";
  }

  if (!state) {
    whistTableEl.innerHTML = "";
    return;
  }

  const me = playerIndex !== null ? state.players[playerIndex] : null;
  const mySavedWhist = me?.assignments?.whist || [];

  if (!state.whist.selectionsComplete) {
    whistTableEl.innerHTML = `
      <div class="whist-info-box">
        Hand splitting is happening in the Hand Splitter panel above.
      </div>
    `;
    return;
  }

  if (!state.whist.nominationsComplete) {
    const nextNominationPlayerIndex = getNextNominationPlayerIndex();
    const isMyTurnToNominate = nextNominationPlayerIndex === playerIndex;
    const totalTricks = getWhistCardCount();
    const cardsHtml = mySavedWhist.length > 0
      ? mySavedWhist.map((card) => `<button class="split-card-button" disabled style="opacity: 1; margin: 0;">${cardToText(card)}</button>`).join("")
      : `<div class="small-note">No Whist cards saved.</div>`;

    const nominationSection = isMyTurnToNominate
      ? `
        <div style="margin-top: 16px; padding: 16px; background: rgba(255, 255, 255, 0.5); border-radius: 8px;">
          <strong>Your Nomination</strong>
          <div class="action-row" style="margin-top: 8px;">
            <input id="nominationInput" type="number" min="0" max="${totalTricks}" value="0" style="width: 100px; padding: 8px; font-size: 14px;" />
            <button onclick="window.saveNomination()">Save Nomination</button>
          </div>
        </div>
      `
      : `<div style="margin-top: 16px; padding: 16px; background: rgba(255, 255, 255, 0.5); border-radius: 8px; text-align: center; font-style: italic;">Waiting for another player to nominate.</div>`;

    whistTableEl.innerHTML = `
      <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr; margin-top: 20px;">
        <div class="split-pile split-pile-clickable" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
          <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
            <strong>Your Whist Hand</strong>
          </div>
          <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
            ${cardsHtml}
          </div>
        </div>
      </div>
      ${nominationSection}
    `;
    return;
  }

  if (!state.whist.started && state.whist.result) {
    const resultsHtml = state.whist.result.results
      .map((result) => {
        return `
          <div class="split-pile split-pile-clickable" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
            <div><strong>${result.playerName}${result.playerIndex === playerIndex ? " (You)" : ""}</strong></div>
            <table class="whist-result-table">
              <tbody>
                <tr><td>Nomination</td><td><strong>${result.nomination}</strong></td></tr>
                <tr><td>Tricks Won</td><td><strong>${result.tricksWon}</strong></td></tr>
                <tr><td>Score</td><td><strong>${result.points}</strong></td></tr>
              </tbody>
            </table>
          </div>
        `;
      })
      .join("");

    whistTableEl.innerHTML = `
      <div class="phase-results">${resultsHtml}</div>
      <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
        <button id="continueToNextRoundBtn" onclick="window.nextRoundHandler()">Next Round</button>
      </div>
    `;
    return;
  }

  if (!state.whist.started) {
    whistTableEl.innerHTML = "";
    return;
  }

  const currentPlayerName =
    state.whist.currentPlayerIndex !== null
      ? state.players[state.whist.currentPlayerIndex]?.name || "Unknown"
      : "Unknown";
  const isMyTurn = state.whist.currentPlayerIndex === playerIndex;
  const myWhistHand = me?.assignments?.whist || [];

  const myHandHtml = myWhistHand.length
    ? myWhistHand
        .map((card) => {
          return `
            <button
              type="button"
              class="split-card-button"
              onclick="window.playCard('${card.id}')"
              ${isMyTurn ? "" : "disabled"}
              style="margin: 0; ${isMyTurn ? "" : "opacity: 1;"}"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : `<div class="small-note">No Whist cards left</div>`;

  const currentTrickCardsHtml =
    state.whist.currentTrick.length > 0
      ? state.whist.currentTrick
          .map((entry) => {
            const trickPlayerName = state.players[entry.playerIndex]?.name || `Player ${entry.playerIndex + 1}`;
            return `
              <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
                <div class="small-note">${trickPlayerName}</div>
                <button class="split-card-button" disabled style="margin: 0; opacity: 1;">${cardToText(entry.card)}</button>
              </div>
            `;
          })
          .join("")
      : `<div class="small-note">No cards played yet.</div>`;

  const playerProgressHtml = state.players
    .map((player, idx) => {
      const nomination = player.nomination ?? "—";
      const tricksWon = state.whist.tricksWon?.[idx] ?? 0;
      const isTurn = idx === state.whist.currentPlayerIndex;
      return `
        <div class="player-status-box ${isTurn ? "player-turn-active" : ""}">
          <div class="player-status-label">${player.name}${idx === playerIndex ? " (You)" : ""}</div>
          <div class="player-status-sub">Nom: ${nomination}</div>
          <div class="player-status-score">${tricksWon}/${nomination}</div>
        </div>
      `;
    })
    .join("");

  whistTableEl.innerHTML = `
    <div class="whist-info-box">
      <div class="split-pile split-pile-clickable" style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px;">
        <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 16px; justify-content: flex-start;">
          ${currentTrickCardsHtml}
        </div>
      </div>
    </div>

    <div class="whist-info-box" style="margin-top: 12px;">
      <div class="split-pile split-pile-clickable" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
        <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
          <strong>Your Whist Hand</strong>
        </div>
        <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
          ${myHandHtml}
        </div>
      </div>
    </div>

    <div class="player-status-boxes" style="margin-top: 12px;">
      ${playerProgressHtml}
    </div>

    <div class="small-note" style="margin-top: 8px; text-align: center;">
      ${isMyTurn ? "Your turn - click a card to play." : `Waiting for ${currentPlayerName} to play.`}
    </div>
  `;
}

function cardToText(card) {
  if (!card) return "";

  if (card.rank === "Joker") {
    const backClass = getCardBackClass(card.backColor);

    return `
      <div class="card joker-card ${backClass}">
        <div class="joker-image-wrapper">
          <img src="images/cards/Joker.png" class="joker-image" />
        </div>
      </div>
    `;
  }

  if (card.rank === "Hidden") {
    const backClass = getCardBackClass(card.backColor);
    return `
      <div class="card card-back-only ${backClass}">
        <div class="card-back-pattern"></div>
      </div>
    `;
  }

  const suitSymbols = {
    Hearts: "&hearts;",
    Diamonds: "&diams;",
    Clubs: "&clubs;",
    Spades: "&spades;"
  };

  const colorClass =
    card.suit === "Hearts" || card.suit === "Diamonds" ? "red" : "black";

  const backClass = getCardBackClass(card.backColor);

  const suitSymbol = suitSymbols[card.suit];

  const pipLayouts = {
    "A": ["center"],
    "2": ["top", "bottom"],
    "3": ["top", "center", "bottom"],
    "4": ["top-left", "top-right", "bottom-left", "bottom-right"],
    "5": ["top-left", "top-right", "center", "bottom-left", "bottom-right"],
    "6": ["top-left", "top-right", "mid-left", "mid-right", "bottom-left", "bottom-right"],
    "7": ["top-left", "top-right", "mid-left", "mid-right", "center-top", "bottom-left", "bottom-right"],
    "8": ["top-left", "top-right", "mid-left", "mid-right", "center-top", "center-bottom", "bottom-left", "bottom-right"],
    "9": ["top-left", "top-right", "mid-left", "mid-right", "center-top", "center", "center-bottom", "bottom-left", "bottom-right"],
    "10": ["top-left", "top-right", "mid-left", "mid-right", "center-top-left", "center-top-right", "center-bottom-left", "center-bottom-right", "bottom-left", "bottom-right"]
  };

  let centerHtml = "";

  if (["J", "Q", "K"].includes(card.rank)) {
    const imagePath = `images/cards/${card.rank}-${card.suit}.png`;

    centerHtml = `
      <div class="face-image-wrapper">
        <img src="${imagePath}" class="face-image" />
      </div>
    `;
  } else {
    const pipPositions = pipLayouts[card.rank] || ["center"];
    centerHtml = `
      <div class="pip-grid">
        ${pipPositions.map((pos) => `<div class="pip pip-${pos}">${suitSymbol}</div>`).join("")}
      </div>
    `;
  }

  return `
    <div class="card ${colorClass} ${backClass}">
      <div class="corner top-left">${card.rank}<br>${suitSymbol}</div>
      <div class="corner top-right">${card.rank}<br>${suitSymbol}</div>
      <div class="corner bottom-left">${card.rank}<br>${suitSymbol}</div>
      <div class="corner bottom-right">${card.rank}<br>${suitSymbol}</div>
      ${centerHtml}
    </div>
  `;
}

function getCardBackClass(backColor) {
  if (backColor === "Green") return "green-back";
  if (backColor === "Blue") return "blue-back";
  return "red-back";
}

function getYanivCardNumericValue(card) {
  if (card.rank === "Joker") return 0;
  if (card.rank === "A") return 1;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function getTrumpSuitText() {
  if (!state || !state.trumpCard) {
    return "Not set";
  }

  if (state.trumpCard.rank === "Joker") {
    return "Joker";
  }

  return state.trumpCard.suit;
}

window.playCard = playCardHandler;
window.saveNomination = saveNominationHandler;

window.toggleSplitCardSelection = toggleSplitCardSelection;
window.assignSelectedCards = assignSelectedCards;
window.unassignSelectedCards = unassignSelectedCards;
window.saveAssignmentsHandler = saveAssignmentsHandler;
window.sortCards = sortCards;

window.toggleBragHandSelection = toggleBragHandSelection;
window.toggleBragCommunitySelection = toggleBragCommunitySelection;
window.swapBragOneHandler = swapBragOneHandler;
window.swapBragThreeHandler = swapBragThreeHandler;
window.chooseKnockOrGuruHandler = chooseKnockOrGuruHandler;

window.startYanivHandler = startYanivHandler;
window.toggleYanivCardSelection = toggleYanivCardSelection;
window.discardAndDrawFromYanivDeckHandler = discardAndDrawFromYanivDeckHandler;
window.discardAndDrawFromYanivDiscardHandler = discardAndDrawFromYanivDiscardHandler;
window.slamYanivCardHandler = slamYanivCardHandler;
window.continueWithoutSlamHandler = continueWithoutSlamHandler;
window.callYanivHandler = callYanivHandler;
window.continueToWhistHandler = continueToWhistHandler;
window.nextRoundHandler = nextRoundHandler; 
window.shouldShowKnockGuru = shouldShowKnockGuru;
window.continueToYanivHandler = continueToYanivHandler;




