const socket = io();

let roomId = localStorage.getItem("nsybwb_room_id") || null;
let playerId = localStorage.getItem("nsybwb_player_id") || null;
let lobbyRooms = [];
let roomMeta = null;

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
let activeSortMode = 2; // 1 = suit, 2 = number
let robotFlipAnimating = false;
let robotFlipFaces = {};
let activeYanivDrawHighlightSource = null;
let activeYanivDrawHighlightTimer = null;
let activeYanivSlamFlash = false;
let activeYanivSlamFlashTimer = null;
let lastSeenYanivDrawEventId = 0;
let lastSeenYanivSlamEventId = 0;
let activeBragKnockFlash = false;
let activeBragKnockFlashTimer = null;
let lastSeenBragKnockEventId = 0;
let activeWhistTrickReveal = false;
let activeWhistTrickRevealTimer = null;
let lastSeenWhistTrickRevealEventId = 0;
let nameInputDirty = false;
let lastLobbySyncAt = 0;
let lobbySyncIntervalId = null;
let activeSidebarTab = "details";
let chatMessages = [];

function requestLobbyRoomsIfNeeded(force = false) {
  const now = Date.now();
  const canLobbySync = !state?.trumpCard;
  if (!canLobbySync) return;
  if (!force && now - lastLobbySyncAt <= 1200) return;
  lastLobbySyncAt = now;
  socket.emit("requestLobbyRooms");
}

function ensureLobbySyncInterval() {
  if (lobbySyncIntervalId) return;
  lobbySyncIntervalId = setInterval(() => {
    const shouldSync = !state?.trumpCard && (!!roomId || !roomId);
    if (!shouldSync) return;
    requestLobbyRoomsIfNeeded(false);
  }, 2000);
}

function getRoomPastelColor(roomKey) {
  const key = String(roomKey || "ROOM");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 65%, 85%, 0.85)`;
}

function getCardSortFunction(sortby) {
  // Define rank order
  const rankOrder = {
    A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    J: 11, Q: 12, K: 13, Joker: 14, Hidden: 15
  };

  // Define suit order
  const suitOrder = {
    Clubs: 1, Diamonds: 2, Hearts: 3, Spades: 4, Joker: 5, Hidden: 6
  };

  return (a, b) => {
    const aRank = rankOrder[a.rank] ?? 99;
    const bRank = rankOrder[b.rank] ?? 99;
    const aSuit = suitOrder[a.suit] ?? (a.rank === "Joker" ? suitOrder.Joker : 99);
    const bSuit = suitOrder[b.suit] ?? (b.rank === "Joker" ? suitOrder.Joker : 99);

    if (sortby === 1) {
      if (aSuit !== bSuit) return aSuit - bSuit;
      return aRank - bRank;
    }

    if (sortby === 2) {
      if (aRank !== bRank) return aRank - bRank;
      return aSuit - bSuit;
    }

    return 0;
  };
}

function applyActiveSortToCurrentPhase() {
  if (!state || playerIndex === null || !activeSortMode) return;
  const me = getMyPlayer();
  if (!me) return;

  const sortFunction = getCardSortFunction(activeSortMode);

  if (state.brag?.started && me.assignments?.brag) {
    me.assignments.brag.sort(sortFunction);
    return;
  }

  if (state.yaniv?.started && me.assignments?.yaniv) {
    me.assignments.yaniv.sort(sortFunction);
    return;
  }

  if (state.whist && me.assignments?.whist && (state.whist.started || !state.whist.nominationsComplete)) {
    me.assignments.whist.sort(sortFunction);
    return;
  }

  if (Array.isArray(me.hand)) {
    me.hand.sort(sortFunction);
  }
}

socket.emit("initSession", {
  playerId,
  playerName: localStorage.getItem("nsybwb_player_name") || "",
  currentRoomId: roomId
});

socket.on("sessionReady", (payload) => {
  playerId = payload.playerId;
  localStorage.setItem("nsybwb_player_id", playerId);
  lobbyRooms = payload.rooms || [];

  if (payload.currentRoomId) {
    roomId = payload.currentRoomId;
    localStorage.setItem("nsybwb_room_id", roomId);
    if (typeof payload.playerIndex === "number") {
      playerIndex = payload.playerIndex;
    }
  } else {
    roomId = null;
    playerIndex = null;
    state = null;
    roomMeta = null;
    localStorage.removeItem("nsybwb_room_id");
  }

  requestLobbyRoomsIfNeeded(true);
  render();
});

socket.on("lobbyUpdate", ({ rooms }) => {
  lobbyRooms = rooms || [];
  render();
});

socket.on("roomJoined", ({ roomId: joinedRoomId, playerIndex: joinedPlayerIndex, ...meta }) => {
  roomId = joinedRoomId;
  playerIndex = joinedPlayerIndex;
  roomMeta = { roomId: joinedRoomId, ...meta };
  chatMessages = [];
  localStorage.setItem("nsybwb_room_id", roomId);
  requestLobbyRoomsIfNeeded(true);
  renderChat();
  render();
});

socket.on("roomMeta", (meta) => {
  roomMeta = meta;
  requestLobbyRoomsIfNeeded(true);
  render();
});

socket.on("gameEnded", () => {
  roomId = null;
  playerIndex = null;
  state = null;
  roomMeta = null;
  activeTabOverride = null;
  chatMessages = [];
  localStorage.removeItem("nsybwb_room_id");
  render();
});

socket.on("roomLeft", () => {
  roomId = null;
  playerIndex = null;
  state = null;
  roomMeta = null;
  activeTabOverride = null;
  chatMessages = [];
  localStorage.removeItem("nsybwb_room_id");
  requestLobbyRoomsIfNeeded(true);
  render();
});

socket.on("chatHistory", ({ roomId: incomingRoomId, messages }) => {
  if (!roomId || incomingRoomId !== roomId) return;
  chatMessages = Array.isArray(messages) ? messages : [];
  renderChat();
});

socket.on("chatMessage", ({ roomId: incomingRoomId, message }) => {
  if (!roomId || incomingRoomId !== roomId || !message) return;
  chatMessages = [...chatMessages, message];
  setSidebarTab("chat");
  renderChat();
});

socket.on("stateUpdate", (newState) => {
  state = newState;
  applyActiveSortToCurrentPhase();
  const myPlayer = playerIndex !== null ? state.players[playerIndex] : null;
  const alreadySaved = !!myPlayer?.assignments || !!myPlayer?.swapSelection;

  if (alreadySaved) {
    selectedSplitCardIds = [];
    tempAssignments = {};
  } else if (myPlayer && Object.keys(tempAssignments).length === 0) {
    // first time only: start with all cards unassigned
    tempAssignments = {};
  }

  // Preserve selections if cards still exist in current state.
  const myBragHand = myPlayer?.assignments?.brag || [];
  const communityCards = state?.brag?.communityCards || [];
  const myYanivHand = myPlayer?.assignments?.yaniv || [];

  selectedBragHandCardId = myBragHand.some((card) => card.id === selectedBragHandCardId)
    ? selectedBragHandCardId
    : null;
  selectedBragCommunityCardId = communityCards.some((card) => card.id === selectedBragCommunityCardId)
    ? selectedBragCommunityCardId
    : null;
  selectedYanivCardIds = selectedYanivCardIds.filter((cardId) =>
    myYanivHand.some((card) => card.id === cardId)
  );

  if (!alreadySaved && myPlayer?.hand) {
    selectedSplitCardIds = selectedSplitCardIds.filter((cardId) =>
      myPlayer.hand.some((card) => card.id === cardId)
    );
  }

  if (!state?.whist?.robotNoBotPending) {
    robotFlipAnimating = false;
    robotFlipFaces = {};
  }

  const drawEventId = state?.yaniv?.lastDrawAction?.eventId || 0;
  if (drawEventId < lastSeenYanivDrawEventId) {
    lastSeenYanivDrawEventId = 0;
  }
  if (drawEventId > lastSeenYanivDrawEventId) {
    lastSeenYanivDrawEventId = drawEventId;
    activeYanivDrawHighlightSource = state.yaniv.lastDrawAction?.source || null;
    if (activeYanivDrawHighlightTimer) {
      clearTimeout(activeYanivDrawHighlightTimer);
    }
    activeYanivDrawHighlightTimer = setTimeout(() => {
      activeYanivDrawHighlightSource = null;
      activeYanivDrawHighlightTimer = null;
      render();
    }, 1000);
  }

  const slamEventId = state?.yaniv?.lastSlamAction?.eventId || 0;
  if (slamEventId < lastSeenYanivSlamEventId) {
    lastSeenYanivSlamEventId = 0;
  }
  if (slamEventId > lastSeenYanivSlamEventId) {
    lastSeenYanivSlamEventId = slamEventId;
    activeYanivSlamFlash = true;
    if (activeYanivSlamFlashTimer) {
      clearTimeout(activeYanivSlamFlashTimer);
    }
    activeYanivSlamFlashTimer = setTimeout(() => {
      activeYanivSlamFlash = false;
      activeYanivSlamFlashTimer = null;
      render();
    }, 2000);
  }

  const bragKnockEventId = state?.brag?.lastKnockAction?.eventId || 0;
  if (bragKnockEventId < lastSeenBragKnockEventId) {
    lastSeenBragKnockEventId = 0;
  }
  if (bragKnockEventId > lastSeenBragKnockEventId) {
    lastSeenBragKnockEventId = bragKnockEventId;
    activeBragKnockFlash = true;
    if (activeBragKnockFlashTimer) {
      clearTimeout(activeBragKnockFlashTimer);
    }
    activeBragKnockFlashTimer = setTimeout(() => {
      activeBragKnockFlash = false;
      activeBragKnockFlashTimer = null;
      render();
    }, 2000);
  }

  const whistTrickRevealEventId = state?.whist?.lastCompletedTrickEventId || 0;
  if (whistTrickRevealEventId < lastSeenWhistTrickRevealEventId) {
    lastSeenWhistTrickRevealEventId = 0;
  }
  if (whistTrickRevealEventId > lastSeenWhistTrickRevealEventId) {
    lastSeenWhistTrickRevealEventId = whistTrickRevealEventId;
    activeWhistTrickReveal = true;
    if (activeWhistTrickRevealTimer) {
      clearTimeout(activeWhistTrickRevealTimer);
    }
    activeWhistTrickRevealTimer = setTimeout(() => {
      activeWhistTrickReveal = false;
      activeWhistTrickRevealTimer = null;
      render();
    }, 2000);
  }

  render();
});

socket.on("errorMessage", (message) => {
  const ignoredMessages = new Set([
    "Cannot slam this card",
    "Only the slam owner can slam",
    "Robot/No-bot is not active for this round"
  ]);
  if (ignoredMessages.has(message)) return;
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
      setSidebarTab("leaderboard");
      activeTabOverride = 'scoreboard';
      setActiveTab('scoreboard');
    });
  }

  const sidebarTabDetailsBtn = document.getElementById("sidebarTabDetailsBtn");
  if (sidebarTabDetailsBtn) {
    sidebarTabDetailsBtn.addEventListener("click", () => setSidebarTab("details"));
  }
  const sidebarTabLeaderboardBtn = document.getElementById("sidebarTabLeaderboardBtn");
  if (sidebarTabLeaderboardBtn) {
    sidebarTabLeaderboardBtn.addEventListener("click", () => setSidebarTab("leaderboard"));
  }
  const sidebarTabChatBtn = document.getElementById("sidebarTabChatBtn");
  if (sidebarTabChatBtn) {
    sidebarTabChatBtn.addEventListener("click", () => setSidebarTab("chat"));
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

  const endGameBtn = document.getElementById("endGameBtn");
  if (endGameBtn) {
    endGameBtn.addEventListener("click", endGameHandler);
  }

  const nameInput = document.getElementById("nameInput");
  if (nameInput) {
    nameInput.addEventListener("input", () => {
      nameInputDirty = true;
    });
  }

  const jumpRoundBtn = document.getElementById("jumpRoundBtn");
  if (jumpRoundBtn) {
    jumpRoundBtn.addEventListener("click", jumpToRoundHandler);
  }

  const sendChatBtn = document.getElementById("sendChatBtn");
  if (sendChatBtn) {
    sendChatBtn.addEventListener("click", sendChatMessageHandler);
  }
  const chatInput = document.getElementById("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendChatMessageHandler();
      }
    });
  }

  window.addEventListener("resize", () => {
    autoFitAllCardStacks();
  });

  ensureLobbySyncInterval();
  requestLobbyRoomsIfNeeded(true);
  render();
});

function autoFitSingleStack(stackEl) {
  if (!stackEl) return;

  const cardButtons = Array.from(stackEl.children).filter((el) =>
    el.classList.contains("split-card-button")
  );

  if (!cardButtons.length) return;

  cardButtons.forEach((btn) => {
    btn.style.setProperty("margin-left", "0px", "important");
  });

  const isMobileWhistHandStack =
    window.innerWidth <= 640 &&
    !!stackEl.closest(".whist-hand-pile");

  if (isMobileWhistHandStack) {
    stackEl.style.justifyContent = "flex-start";
    stackEl.style.flexWrap = "wrap";
    stackEl.style.overflow = "visible";
    return;
  }

  if (cardButtons.length === 1) return;

  const firstButton = cardButtons[0];
  const cardWidth = firstButton.offsetWidth;
  const availableWidth = stackEl.clientWidth;

  if (!cardWidth || !availableWidth) return;

  const cardCount = cardButtons.length;
  const gaps = cardCount - 1;
  const isWonTrickStack = stackEl.classList.contains("whist-won-trick-stack");
  const maxGap = isWonTrickStack ? -Math.floor(cardWidth * 0.18) : 8;
  const minVisibleWidth = isWonTrickStack
    ? Math.max(10, Math.floor(cardWidth * 0.16))
    : Math.max(16, Math.floor(cardWidth * 0.2));
  const minGap = -(cardWidth - minVisibleWidth);
  const fittedGap = Math.floor((availableWidth - (cardCount * cardWidth)) / gaps);
  const marginLeftValue = Math.max(minGap, Math.min(maxGap, fittedGap));

  // Keep stacks aligned to the left so the visible width stays stable as counts change.
  stackEl.style.justifyContent = "flex-start";
  stackEl.style.flexWrap = "nowrap";
  stackEl.style.overflow = "hidden";

  for (let i = 1; i < cardButtons.length; i += 1) {
    cardButtons[i].style.setProperty(
      "margin-left",
      `${marginLeftValue}px`,
      "important"
    );
  }
}

function autoFitAllCardStacks() {
  const stacks = document.querySelectorAll(".split-stack");
  stacks.forEach((stack) => autoFitSingleStack(stack));
}

function updatePlayerName(newName) {
  if (roomId && playerIndex !== null && state) {
    socket.emit("updatePlayerName", {
      roomId,
      playerIndex,
      newName
    });
  }
  localStorage.setItem("nsybwb_player_name", newName);
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
  if (!nameInput || !saveNameBtn) return;

  const myPlayer = state && playerIndex !== null ? state.players[playerIndex] : null;
  const serverName = myPlayer?.name || localStorage.getItem("nsybwb_player_name") || "";
  const isFocused = document.activeElement === nameInput;
  if (!nameInputDirty && !isFocused && nameInput.value !== serverName) {
    nameInput.value = serverName;
  }
  const gameStarted = !!state?.trumpCard;
  nameInput.disabled = false;
  saveNameBtn.disabled = gameStarted;
}

function startGameHandler() {
  if (!roomId) {
    alert("Create or join a room first.");
    return;
  }
  socket.emit("startGame", roomId);
}

function leaveRoomHandler() {
  if (!roomId) return;
  activeTabOverride = null;
  socket.emit("leaveRoom", roomId);
}

function endRoomHandler() {
  if (!roomId) return;
  activeTabOverride = null;
  socket.emit("endGame", roomId);
}

function saveNameHandler() {
  const nameInput = document.getElementById("nameInput");
  if (!nameInput) return;
  const newName = nameInput.value.trim();
  if (!newName) {
    alert("Please enter a name before saving.");
    return;
  }
  nameInputDirty = false;
  updatePlayerName(newName);
  render();
}

function jumpToRoundHandler() {
  if (!state) return;
  const maxRound = getTotalRoundsForCurrentGame();
  const answer = prompt(`Jump to round (1-${maxRound})`, String(state.round || 1));
  if (answer === null) return;
  const target = Number(answer);
  if (!Number.isInteger(target) || target < 1 || target > maxRound) {
    alert(`Round must be between 1 and ${maxRound}`);
    return;
  }

  socket.emit("jumpToRound", { roomId, round: target });
}

function createRoomHandler() {
  const name = localStorage.getItem("nsybwb_player_name") || "";
  if (!hasRealPlayerName(name)) {
    alert("Save your name first.");
    return;
  }
  const roomName = prompt("Enter room name", "Game Room");
  if (roomName === null) return;
  socket.emit("createRoom", { roomName: roomName.trim() || "Game Room", playerName: name });
}

function joinRoomHandler(targetRoomId) {
  const name = localStorage.getItem("nsybwb_player_name") || "";
  if (!hasRealPlayerName(name)) {
    alert("Save your name first.");
    return;
  }
  socket.emit("joinRoom", { roomId: targetRoomId, playerName: name });
}

function renderWaitingLobby() {
  const waitingContent = document.getElementById("waitingContent");
  const startBtn = document.getElementById("startGameBtn");
  if (!waitingContent || !startBtn) return;

  requestLobbyRoomsIfNeeded(false);

  const savedName = localStorage.getItem("nsybwb_player_name") || "";
  const hasName = hasRealPlayerName(savedName);

  if (!hasName) {
    waitingContent.innerHTML = `<div>Please enter and save your name to access the lobby.</div>`;
    startBtn.style.display = "none";
    return;
  }

  const stateNames = (state?.players || []).map((p) => p.name).filter(Boolean);
  const metaNamesRaw = Array.isArray(roomMeta?.playerNames) ? roomMeta.playerNames.filter(Boolean) : [];
  const metaNames = metaNamesRaw.length ? metaNamesRaw : (hasRealPlayerName(savedName) ? [savedName] : []);
  const currentNames = stateNames.length ? stateNames : metaNames;
  const currentCount = Math.max(
    currentNames.length,
    Number(roomMeta?.playersConnected || 0),
    roomId ? 1 : 0
  );

  const currentRoomSummary = roomId && roomMeta
    ? {
        roomId: roomMeta.roomId || roomId,
        roomName: roomMeta.roomName || roomId,
        ownerPlayerId: roomMeta.ownerPlayerId,
        playersConnected: currentCount,
        playerCount: Math.max(currentCount, currentNames.length),
        gameStarted: !!roomMeta.gameStarted,
        playerNames: currentNames
      }
    : null;

  const byRoom = new Map((lobbyRooms || []).map((room) => [room.roomId, room]));
  if (currentRoomSummary) {
    byRoom.set(currentRoomSummary.roomId, currentRoomSummary);
  }
  const allRooms = Array.from(byRoom.values());

  const rows = allRooms
    .map((room) => {
      const roomColor = getRoomPastelColor(room.roomId);
      const isCurrent = !!roomId && room.roomId === roomId;
      const isOwner = isCurrent && room.ownerPlayerId === playerId;
      const everyoneNamed = state ? state.players.every((player) => hasRealPlayerName(player.name)) : false;
      const roomNamesSource = Array.isArray(room.playersList) ? room.playersList : room.playerNames;
      const roomNames = Array.isArray(roomNamesSource) ? roomNamesSource.filter(Boolean) : [];
      const resolvedRoomNames = roomNames.length
        ? roomNames
        : (room.ownerName ? [room.ownerName] : []);
      const roomCount = Math.max(resolvedRoomNames.length, Number(room.playerCount || 0), isCurrent ? 1 : 0);
      const enoughPlayers = roomCount >= 2;
      const canStart = isCurrent && isOwner && everyoneNamed && enoughPlayers && !room.gameStarted;
      const joinDisabled = !!roomId || !!room.gameStarted;
      const actionButtons = isCurrent
        ? (isOwner
          ? `<button onclick="window.startGameHandler()" ${canStart ? "" : "disabled"}>Start</button><button onclick="window.endRoomHandler()">End</button>`
          : `<button onclick="window.leaveRoomHandler()">Leave</button>`)
        : `<button onclick="window.joinRoomHandler('${room.roomId}')" ${joinDisabled ? "disabled" : ""}>Join</button>`;

      return `
      <div class="split-pile lobby-room-card ${isCurrent ? "lobby-room-current" : ""}" style="background:${roomColor};">
        <div class="lobby-room-header">
          <div class="lobby-room-title"><strong>${room.roomName}</strong></div>
          <div class="lobby-room-code"><strong>${room.roomId}</strong></div>
        </div>
        <div>Players: ${Math.max(roomCount, resolvedRoomNames.length)}</div>
        <div class="lobby-room-names">${resolvedRoomNames.join(", ") || "-"}</div>
        <div class="lobby-room-actions">${actionButtons}</div>
      </div>
    `;
    })
    .join("");

  waitingContent.innerHTML = `
    <div style="margin-bottom:10px;">
      <button onclick="window.createRoomHandler()">Create Room</button>
    </div>
    <div class="lobby-rooms-grid">${rows || "<div>No rooms yet.</div>"}</div>
  `;
  startBtn.style.display = "none";
}

function getTotalRoundsForCurrentGame() {
  if (!state) return 1;
  const roundConfigByPlayerCount = {
    2: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    3: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    4: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    5: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    6: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    7: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    8: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    9: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
    10: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15]
  };
  return (roundConfigByPlayerCount[state.players.length] || [1]).length;
}

function endGameHandler() {
  if (!roomId) return;
  socket.emit("endGame", roomId);
}


function getAssignmentTargets() {
  if (!state) return [];

  return [
    { key: "brag", label: "Brag", required: 3 },
    { key: "yaniv", label: "Yaniv", required: 5 },
    { key: "whist", label: "Whist", required: getWhistCardCount() }
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
  const cardsToAssign = selectedCards.length ? selectedCards : getUnassignedCards();

  if (!cardsToAssign.length) {
    return;
  }

  cardsToAssign.forEach((card) => {
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
  const swapMode = getRobotNoBotSwapModeClient();
  const targets = swapMode
    ? [
        { key: "left", label: "Left Pile", required: swapMode.equalCount, color: "#D1D5DB" },
        { key: "fixed", label: swapMode.fixedTarget === "brag" ? "Brag (Fixed)" : "Yaniv (Fixed)", required: swapMode.fixedCount, color: swapMode.fixedTarget === "brag" ? "#FF8888" : "#6BA8D0" },
        { key: "right", label: "Right Pile", required: swapMode.equalCount, color: "#D1D5DB" }
      ]
    : getAssignmentTargets();

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
  activeSortMode = sortby;

  applyActiveSortToCurrentPhase();

  render(); // Re-render to display the sorted cards
}

function renderSortToggle(disabled = false) {
  const currentMode = activeSortMode === 2 ? 2 : 1;
  const sliderClass = [
    "sort-toggle",
    currentMode === 2 ? "sort-toggle-number" : "sort-toggle-suit",
    disabled ? "sort-toggle-disabled" : ""
  ].filter(Boolean).join(" ");

  const suitAction = disabled ? "" : `onclick="window.sortCards(1)"`;
  const numberAction = disabled ? "" : `onclick="window.sortCards(2)"`;

  return `
    <div class="${sliderClass}" aria-disabled="${disabled ? "true" : "false"}">
      <div class="sort-toggle-thumb"></div>
      <button type="button" class="sort-toggle-option ${currentMode === 1 ? "active" : ""}" ${disabled ? "disabled" : ""} ${suitAction}>Suit</button>
      <button type="button" class="sort-toggle-option ${currentMode === 2 ? "active" : ""}" ${disabled ? "disabled" : ""} ${numberAction}>Number</button>
    </div>
  `;
}
function saveAssignmentsHandler() {
  const me = getMyPlayer();
  if (!me) return;

  const swapMode = getRobotNoBotSwapModeClient();
  const targets = swapMode
    ? [
        { key: "left", label: "Left Pile", required: swapMode.equalCount },
        { key: "fixed", label: swapMode.fixedTarget === "brag" ? "Brag (Fixed)" : "Yaniv (Fixed)", required: swapMode.fixedCount },
        { key: "right", label: "Right Pile", required: swapMode.equalCount }
      ]
    : getAssignmentTargets();
  const counts = {};
  targets.forEach((target) => {
    counts[target.key] = me.hand.filter((card) => tempAssignments[card.id] === target.key).length;
  });

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

  const assignments = swapMode
    ? {
        left: me.hand.filter((card) => tempAssignments[card.id] === "left").map((c) => c.id),
        right: me.hand.filter((card) => tempAssignments[card.id] === "right").map((c) => c.id),
        fixed: me.hand.filter((card) => tempAssignments[card.id] === "fixed").map((c) => c.id)
      }
    : {
        brag: getCardsInPile("brag").map((c) => c.id),
        yaniv: getCardsInPile("yaniv").map((c) => c.id),
        whist: getCardsInPile("whist").map((c) => c.id)
      };

socket.emit("saveWhistSelection", {
  roomId,
  playerIndex,
  selectedAssignments: assignments
});
}

function nextRoundHandler() {
  if (state) {
    const totalRounds = getTotalRoundsForCurrentGame();
    const isFinalRound = (state.round || 0) >= totalRounds;
    if (isFinalRound) {
      activeTabOverride = "scoreboard";
      setActiveTab("scoreboard");
      render();
      return;
    }
  }

  activeTabOverride = null;
  socket.emit("nextRound", roomId);
}

function getWhistCardCount() {
  if (!state || !Array.isArray(state.players)) return 0;
  const roundConfigByPlayerCount = {
    2: [15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15],
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
  if (!config || !config.length) {
    return 0;
  }

  const roundIndex = Math.max(0, Math.min((state.round || 1) - 1, config.length - 1));
  return (config[roundIndex] || 0) - 8;
}

function isBlindRoundClient() {
  if (!state) return false;
  return state.round === 7;
}

function getRobotNoBotSwapModeClient() {
  if (!state) return null;
  const whistCount = getWhistCardCount();
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

function setSidebarTab(tabName) {
  activeSidebarTab = tabName;
  const detailsBtn = document.getElementById("sidebarTabDetailsBtn");
  const leaderboardBtn = document.getElementById("sidebarTabLeaderboardBtn");
  const chatBtn = document.getElementById("sidebarTabChatBtn");
  const detailsTab = document.getElementById("sidebarDetailsTab");
  const leaderboardTab = document.getElementById("sidebarLeaderboardTab");
  const chatTab = document.getElementById("sidebarChatTab");

  if (detailsBtn) detailsBtn.classList.toggle("active", tabName === "details");
  if (leaderboardBtn) leaderboardBtn.classList.toggle("active", tabName === "leaderboard");
  if (chatBtn) chatBtn.classList.toggle("active", tabName === "chat");
  if (detailsTab) detailsTab.classList.toggle("active", tabName === "details");
  if (leaderboardTab) leaderboardTab.classList.toggle("active", tabName === "leaderboard");
  if (chatTab) chatTab.classList.toggle("active", tabName === "chat");
}

function renderChat() {
  const chatLog = document.getElementById("chatLog");
  if (!chatLog) return;
  chatLog.innerHTML = (chatMessages || [])
    .map((msg) => `
      <div class="chat-message">
        <div class="chat-meta"><strong>${msg.playerName || "Player"}</strong> • ${new Date(msg.timestamp || Date.now()).toLocaleTimeString()}</div>
        <div class="chat-text">${String(msg.text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
      </div>
    `)
    .join("");

  chatLog.scrollTop = chatLog.scrollHeight;
}

function sendChatMessageHandler() {
  if (!roomId) return;
  const chatInput = document.getElementById("chatInput");
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("sendChatMessage", { roomId, text });
  chatInput.value = "";
}

function updateSidebarVisibility() {
  const gameLayoutEl = document.querySelector(".game-layout");
  const sidebarEl = document.querySelector(".game-sidebar");
  const playerStatusBoxesEl = document.getElementById("playerStatusBoxes");
  const sidebarButtons = document.querySelector(".compact-status-buttons");
  const showScoreboardBtn = document.getElementById("showScoreboardBtn");
  const jumpRoundBtn = document.getElementById("jumpRoundBtn");
  const endGameBtn = document.getElementById("endGameBtn");
  const statusInfo = document.querySelector(".status-info");
  const gameStarted = !!state?.trumpCard;
  const inLobby = !gameStarted;
  const canControlGame = !!roomMeta && roomMeta.ownerPlayerId === playerId;

  if (gameLayoutEl) {
    gameLayoutEl.classList.toggle("lobby-wide", inLobby);
  }
  if (sidebarEl) sidebarEl.style.display = inLobby ? "none" : "";
  if (playerStatusBoxesEl) playerStatusBoxesEl.style.display = inLobby ? "none" : "";
  if (sidebarButtons) sidebarButtons.style.display = inLobby ? "none" : "";
  if (statusInfo) statusInfo.style.display = inLobby ? "none" : "";

  if (showScoreboardBtn) {
    showScoreboardBtn.style.display = !inLobby ? "" : "none";
  }

  if (jumpRoundBtn) {
    jumpRoundBtn.style.display = !inLobby && canControlGame ? "" : "none";
    jumpRoundBtn.disabled = !canControlGame;
  }

  if (endGameBtn) {
    endGameBtn.style.display = !inLobby && canControlGame ? "" : "none";
    endGameBtn.disabled = !canControlGame;
  }
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
    } else if (state.whist.robotNoBotPending) {
      activeTab = 'whist';
    } else if (state.whist.robotNoBotAwaitingContinue) {
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
  setSidebarTab(activeSidebarTab);
  updateSidebarVisibility();

  renderStatus();
  updateStartGameButtonState();
  renderMyPlayerInfo();
  renderNameInput();
  renderWaitingLobby();
  renderPlayerStatusBoxes();
  renderPlayers();
  renderSplitter();
  renderBrag();
  renderBragResults();
  renderYaniv();
  renderScoreboard();
  renderChat();
  renderWhist();

  requestAnimationFrame(() => {
    autoFitAllCardStacks();
  });
}

function resolveRobotNoBotHandler() {
  if (!state?.whist?.robotNoBotPending) return;
  if (robotFlipAnimating) return;

  const playerCount = state.players.length;
  robotFlipAnimating = true;

  const interval = setInterval(() => {
    for (let i = 0; i < playerCount; i += 1) {
      robotFlipFaces[i] = Math.random() < 0.5 ? "robot" : "nobot";
    }
    render();
  }, 120);

  setTimeout(() => {
    clearInterval(interval);
    robotFlipAnimating = false;
    socket.emit("resolveRobotNoBot", roomId);
  }, 2400);
}

function continueAfterRobotNoBotHandler() {
  socket.emit("continueAfterRobotNoBot", roomId);
}

function hasRealPlayerName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  return !/^Player\s+\d+$/i.test(trimmed);
}

function updateStartGameButtonState() {
  const startBtn = document.getElementById("startGameBtn");
  if (!startBtn) return;
  if (!roomId || !roomMeta) {
    startBtn.disabled = true;
    return;
  }

  const everyoneNamed = state ? state.players.every((player) => hasRealPlayerName(player.name)) : false;
  const gameStarted = !!state?.trumpCard || !!roomMeta.gameStarted;
  const isOwner = roomMeta.ownerPlayerId === playerId;
  startBtn.disabled = gameStarted || !everyoneNamed || !isOwner;
}

function buildTrumpCardHtml() {
  if (!state?.trumpCard) {
    return "Not set";
  }

  const suitSymbols = {
    Hearts: "&hearts;",
    Diamonds: "&diams;",
    Clubs: "&clubs;",
    Spades: "&spades;"
  };
  const isJoker = state.trumpCard.rank === "Joker";
  const suit = state.trumpCard.suit;
  const symbol = isJoker ? "J" : (suitSymbols[suit] || "J");
  const colorClass = isJoker
    ? "joker"
    : (suit === "Hearts" || suit === "Diamonds" ? "red" : "black");
  const backClass = getCardBackClass(state.trumpCard.backColor);
  const rankText = isJoker ? 'J<span class="joker-suffix">o</span>' : state.trumpCard.rank;
  const suitText = isJoker ? "" : symbol;

  return `
    <div class="card trump-mini-card ${backClass}">
      <div class="trump-mini-content trump-display-face ${colorClass}">
        <span class="simple-card-rank">${rankText}</span>
        ${suitText ? `<span class="simple-card-suit">${suitText}</span>` : ""}
      </div>
    </div>
  `;
}

function buildPanelHeaderMetaHtml(tooltipText) {
  const mobileTrumpHtml = state?.trumpCard
    ? `<div class="panel-mobile-trump">${buildTrumpCardHtml()}</div>`
    : "";

  return `
    <div class="panel-header-meta">
      <div class="tooltip-icon" title="${tooltipText}">?</div>
      ${mobileTrumpHtml}
    </div>
  `;
}

function getRoundSummaryForCurrentWhistResults() {
  const history = Array.isArray(state?.roundHistory) ? state.roundHistory : [];
  if (!history.length) return null;
  return history[history.length - 1] || null;
}

function renderWhistTrickHistory(roundSummary) {
  if (!roundSummary || !Array.isArray(roundSummary.whistTrickHistory) || !roundSummary.whistTrickHistory.length) {
    return "";
  }

  const suitIconMap = {
    Hearts: "&hearts;",
    Diamonds: "&diams;",
    Clubs: "&clubs;",
    Spades: "&spades;"
  };

  const trickRowsHtml = roundSummary.whistTrickHistory
    .map((trick) => {
      const trumpDisplay = trick.trump ? (suitIconMap[trick.trump] || trick.trump) : "-";
      const leadDisplay = trick.leadSuit ? (suitIconMap[trick.leadSuit] || trick.leadSuit) : "-";
      const cardsDisplay = (trick.cards || [])
        .map((entry) => {
          const suit = suitIconMap[entry.suit] || entry.suit || "";
          return `<span class="whist-trick-history-card">${entry.playerName}: ${entry.rank}${suit}</span>`;
        })
        .join("");

      return `
        <div class="whist-trick-history-row">
          <div class="whist-trick-history-meta">
            <strong>Trick ${trick.trickNumber}</strong>
            <span>Trump ${trumpDisplay}</span>
            <span>Lead ${leadDisplay}</span>
            <span>Winner ${trick.winnerPlayerName}</span>
          </div>
          <div class="whist-trick-history-cards">${cardsDisplay}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="whist-trick-history">
      <div class="whist-trick-history-title">Whist Trick Log</div>
      ${trickRowsHtml}
    </div>
  `;
}



function renderStatus() {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;

  if (!state) {
    statusEl.textContent = "Connecting to server...";
    return;
  }

  const roomValue = roomMeta?.roomName || roomMeta?.roomId || "â€”";
  const roundValue = state.round ?? "â€”";
  const cardCountValue = (getWhistCardCount() || 0) + 8;
  const dealerValue = state.players[state.dealerIndex]?.name || "Unknown";
  let phaseValue = "Waiting";
  let detailValue = "";

  if (state.brag.started && !state.brag.results) {
    const currentPlayer = state.players[state.brag.currentPlayerIndex];
    phaseValue = "Brag";
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
          <td>Room</td>
          <td>${roomValue}</td>
        </tr>
        <tr>
          <td>Round</td>
          <td>${roundValue}</td>
        </tr>
        <tr>
          <td>Cards</td>
          <td>${cardCountValue}</td>
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
      </tbody>
    </table>
  `;
}

function renderPlayerStatusBoxes() {
  const boxesEl = document.getElementById("playerStatusBoxes");
  if (!boxesEl || !state || !state.trumpCard) {
    if (boxesEl) boxesEl.innerHTML = "";
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

  const orderedPlayerIndexes = getPlayerOrderFromLeftOfDealer();
  const sortedPlayers = orderedPlayerIndexes
    .map((index) => ({ ...state.players[index], index }));
  const topScore = Math.max(...state.players.map((player) => Number(player.score) || 0));

  boxesEl.innerHTML = sortedPlayers.map((player) => {
    const isCurrentTurn = player.index === currentTurnPlayerIndex;
    let statusClass = "";

    if (isDuringSplit && !!player.assignments) {
      statusClass = "player-deck-submitted";
    } else if (isCurrentTurn) {
      statusClass = "player-turn-active";
    }

    const nominationText = player.nomination !== null && player.nomination !== undefined ? player.nomination : "-";
    const tricksWon = state.whist?.tricksWon?.[player.index] ?? 0;
    const isWhistLive = !!state.whist?.started;
    const phaseNomText = isWhistLive ? `${tricksWon}/${nominationText}` : `Nom: ${nominationText}`;
    const isLeader = (Number(player.score) || 0) === topScore;
    const isDealer = player.index === state.dealerIndex;
    const isBragKnocker = state.brag?.started && state.brag?.knock?.playerIndex === player.index;
    const youIcon = player.index === playerIndex
      ? `<span class="you-icon player-status-badge" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>`
      : "";
    const leaderIcon = isLeader
      ? `<span class="leader-crown-icon player-status-badge" title="Leader" aria-label="Leader"><i class="fa-solid fa-crown"></i></span>`
      : "";
    const dealerIcon = isDealer
      ? `<span class="dealer-card-icon player-status-badge" title="Dealer" aria-label="Dealer"><i class="fa-solid fa-cube"></i></span>`
      : "";
    const knockIcon = isBragKnocker
      ? `<span class="player-knock-icon player-status-badge" title="Knocked" aria-label="Knocked"><i class="fa-solid fa-hand-fist"></i></span>`
      : "";

    let cardsForPhase = [];
    if (state.brag?.started) {
      cardsForPhase = player.assignments?.brag || [];
    } else if (state.yaniv?.started) {
      cardsForPhase = player.assignments?.yaniv || [];
    } else if (state.whist?.started) {
      cardsForPhase = player.assignments?.whist || [];
    }

    const showMiniBacks = cardsForPhase.length > 0 && player.index !== playerIndex;
    const miniBacksHtml = showMiniBacks
      ? cardsForPhase
          .map((card) => `<div class="status-mini-back ${getCardBackClass(card.backColor)}"></div>`)
          .join("")
      : "";
    const statusIconsHtml = [youIcon, leaderIcon, dealerIcon, knockIcon].join("");
    const boxClasses = ["player-status-box", statusClass, isBragKnocker ? "player-knocked" : ""]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="${boxClasses}">
        <div class="player-status-label">${player.name}</div>
        <div class="player-status-score"><strong>${player.score}</strong></div>
        ${statusIconsHtml ? `
          <div class="player-status-icons-row">
            <div class="player-status-icons">${statusIconsHtml}</div>
          </div>
        ` : ""}
        <div class="player-status-sub">${phaseNomText}</div>
        ${showMiniBacks ? `<div class="player-status-mini-backs">${miniBacksHtml}</div>` : ""}
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
    const isMe = player.index === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : "";
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
  const suitIconMap = {
    Hearts: '<span class="scoreboard-suit suit-hearts">&hearts;</span>',
    Diamonds: '<span class="scoreboard-suit suit-diamonds">&diams;</span>',
    Clubs: '<span class="scoreboard-suit suit-clubs">&clubs;</span>',
    Spades: '<span class="scoreboard-suit suit-spades">&spades;</span>',
    Joker: '<span class="scoreboard-suit suit-joker">🃏</span>'
  };
  const headerPlayerCells = state.players
    .map((player, idx) => `<th colspan="${playerColCount}">${player.name}${idx === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : ""}</th>`)
    .join("");

  const headerSubCells = state.players
    .map(() => `<th class="scoreboard-footer-nomination">N</th><th class="scoreboard-footer-brag">B</th><th class="scoreboard-footer-yaniv">Y</th><th class="scoreboard-footer-whist">W</th><th class="scoreboard-col-total">T</th>`)
    .join("");

  const bodyRows = allRounds
    .map((roundSummary, idx) => {
      const isInProgress = idx === allRounds.length - 1 && currentSummary;
      let playerCells = "";
      const trumpRaw = roundSummary.trump || "-";
      const trumpDisplay = suitIconMap[trumpRaw] || trumpRaw;

      state.players.forEach((player, pIdx) => {
        const nomination = roundSummary.nominations?.find((n) => n.playerIndex === pIdx)?.nomination ?? "-";
        const bragPoints = roundSummary.bragResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const yanivPoints = roundSummary.yanivResult?.pointsByPlayer?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const whistPoints = roundSummary.whistResults?.find((result) => result.playerIndex === pIdx)?.points ?? 0;
        const roundTotal = bragPoints + yanivPoints + whistPoints;

        playerCells += `<td class="scoreboard-col-nomination">${nomination}</td><td class="scoreboard-col-brag">${bragPoints}</td><td class="scoreboard-col-yaniv">${yanivPoints}</td><td class="scoreboard-col-whist">${whistPoints}</td><td class="scoreboard-col-total">${roundTotal}</td>`;
      });

      const rowClass = isInProgress ? 'class="scoreboard-row-inprogress"' : "";
      return `<tr ${rowClass}><td class="scoreboard-col-meta">${roundSummary.round}</td><td class="scoreboard-col-meta">${trumpDisplay}</td>${playerCells}</tr>`;
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

  const scoreboardHtml = `
    <div class="scoreboard-table-wrapper">
      <table class="scoreboard-table">
        <thead>
          <tr>
            <th aria-label="Round number">#</th>
            <th aria-label="Trump suit"><i class="fa-solid fa-cards"></i></th>
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
    ${state?.whist?.result && state.round >= getTotalRoundsForCurrentGame()
      ? `<div style="display:flex; justify-content:flex-end; margin-top:12px;"><button onclick="window.endGameHandler()">End Game</button></div>`
      : ""}
  `;
  scoreboardEl.innerHTML = scoreboardHtml;
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

  if (me.assignments || me.swapSelection) {
    splitInstructionsEl.textContent = "You have already saved your hand split. Waiting for other players...";
    const swapMode = getRobotNoBotSwapModeClient();
    const savedLayoutClass = swapMode ? "swap-layout" : "normal-layout";
    const savedTargets = swapMode
      ? [
          { key: "left", label: "Left Pile", color: "#D1D5DB", cards: me.swapSelection?.left || [] },
          { key: "fixed", label: swapMode.fixedTarget === "brag" ? "Brag (Fixed)" : "Yaniv (Fixed)", color: swapMode.fixedTarget === "brag" ? "#FF8888" : "#6BA8D0", cards: me.swapSelection?.fixed || [] },
          { key: "right", label: "Right Pile", color: "#D1D5DB", cards: me.swapSelection?.right || [] }
        ]
      : getAssignmentTargets().map((target) => ({ ...target, cards: me.assignments?.[target.key] || [] }));

    const savedPilesHtml = savedTargets
      .map((target, idx) => {
        const pileColors = ["#FF8888", "#6BA8D0", "#C896E0"];
        const pileColor = target.color || pileColors[idx] || "#999";
        const cards = target.cards || [];
        const cardsHtml = cards
          .map((card, index) => `<button type="button" class="split-card-button" disabled style="opacity: 1; margin: 0; z-index: ${index + 1};">${cardToText(card)}</button>`)
          .join("");

        return `
          <div class="split-pile split-pile-clickable split-pile-${target.key}" style="background-color: rgba(${parseInt(pileColor.slice(1,3), 16)}, ${parseInt(pileColor.slice(3,5), 16)}, ${parseInt(pileColor.slice(5,7), 16)}, 0.85);">
            <div class="split-pile-header-clickable">
              <strong>${target.label}</strong>
            </div>
            <div class="split-stack">
              ${cardsHtml}
            </div>
          </div>
        `;
      })
      .join("");

    splitterEl.innerHTML = `
      <div class="split-player">
        <strong>Your split is saved.</strong>
        <div class="split-piles-area split-target-piles-area ${savedLayoutClass}" style="margin-top: 12px;">
          ${savedPilesHtml}
        </div>
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

  const swapMode = getRobotNoBotSwapModeClient();
  const pilesLayoutClass = swapMode ? "swap-layout" : "normal-layout";
  const targets = swapMode
    ? [
        { key: "left", label: "Left Pile", required: swapMode.equalCount, color: "#D1D5DB" },
        { key: "fixed", label: swapMode.fixedTarget === "brag" ? "Brag (Fixed)" : "Yaniv (Fixed)", required: swapMode.fixedCount, color: swapMode.fixedTarget === "brag" ? "#FF8888" : "#6BA8D0" },
        { key: "right", label: "Right Pile", required: swapMode.equalCount, color: "#D1D5DB" }
      ]
    : getAssignmentTargets();
  const counts = {};
  targets.forEach((target) => {
    counts[target.key] = me.hand.filter((card) => tempAssignments[card.id] === target.key).length;
  });
  const unassignedCards = getUnassignedCards();

  splitInstructionsEl.textContent = swapMode
    ? `Select cards into Left / Right and ${swapMode.fixedTarget === "brag" ? "Brag" : "Yaniv"} (fixed).`
    : "Select cards and move them into Brag, Yaniv, and Whist.";

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
    : ``;

  const pilesHtml = targets
    .map((target, idx) => {
      const pileColors = ["#FF8888", "#6BA8D0", "#C896E0"];
      const pileColor = target.color || pileColors[idx] || "#999";
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
        : ``;

      return `
        <div 
          class="split-pile split-pile-clickable split-pile-${target.key}" 
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
      ${renderSortToggle(false)}
      <h2 style="display:none;">Hand Splitter</h2>
      ${buildPanelHeaderMetaHtml("Split your hand into Brag, Yaniv, and Whist piles")}
    `;
  }

  splitterEl.innerHTML = `
    <div class="split-player">
      <div class="split-piles-area split-unassigned-area" style="display: grid; grid-template-columns: 1fr; margin-bottom: 20px;">
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

      <div class="split-piles-area split-target-piles-area ${pilesLayoutClass}">
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

  requestAnimationFrame(() => {
    autoFitAllCardStacks();
    requestAnimationFrame(() => {
      autoFitAllCardStacks();
    });
  });
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
      ${renderSortToggle(false)}
      <h2 style="display:none;">Brag</h2>
      ${buildPanelHeaderMetaHtml("Players compete to have the best 3-card hand")}
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
    : ``;

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
    : ``;
  const bragBoardLabel = activeBragKnockFlash ? "KNOCK" : "";
  const bragBoardLabelClass = activeBragKnockFlash ? "brag-knock-label" : "";
  const bragBoardHighlightClass = activeBragKnockFlash ? "brag-knock-highlight" : "";

  const knockGuruButtons = shouldShowKnockGuru()
    ? `
      <button type="button" onclick="window.chooseKnockOrGuruHandler('knock')">Knock</button>
      <button type="button" onclick="window.chooseKnockOrGuruHandler('guru')">Guru</button>
    `
    : "";

  bragControlsEl.innerHTML = `
    <div class="split-piles-area normal-layout" style="display: grid; grid-template-columns: 1fr; margin-top: 20px;">
      <div 
        class="split-pile split-pile-clickable ${bragBoardHighlightClass}" 
        style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px;"
      >
        <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
          <strong class="${bragBoardLabelClass}">${bragBoardLabel || "Table Cards"}</strong>
        </div>
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

  const panelHeaderEl = document.querySelector('.panel[data-tab="brag-results"] .panel-header-with-tooltip');
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      ${renderSortToggle(true)}
      <h2 style="display:none;">Brag Results</h2>
      ${buildPanelHeaderMetaHtml("Players compete to have the best 3-card hand")}
    `;
  }

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
            <strong>${player.name}${idx === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : ""}</strong>
          </div>
          <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
            ${cardsHtml || ``}
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
      ${renderSortToggle(isYanivResultsView)}
      <h2 style="display:none;">Yaniv</h2>
      ${buildPanelHeaderMetaHtml("Draw and discard cards to get your hand total to 5 or less")}
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
              <strong>${player.name}${idx === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : ""}</strong>
            </div>
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${cardsHtml || ``}
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
  const canCallYaniv = myYanivHand.reduce((sum, card) => sum + getYanivCardNumericValue(card), 0) <= 5;
  const isSlamOwner = state.yaniv.canSlam && state.yaniv.slamPlayerIndex === playerIndex;
  const canUseCallButton = canCallYaniv && !hasPendingDiscard && selectedCount === 0 && (isMyTurn || isSlamOwner);
  const canUseSlamButton = isSlamOwner;
  const yanivButtonsHtml = `
    <div style="display: flex; justify-content: center; gap: 10px; margin-top: 10px;">
      <button ${canUseCallButton ? "" : "disabled"} onclick="window.callYanivHandler()">Call Yaniv</button>
      <button ${canUseSlamButton ? "" : "disabled"} onclick="window.slamYanivCardHandler()">Slam Card</button>
    </div>
    <div style="text-align: center; margin-top: 8px;">
      ${isMyTurn ? "Select card(s), then click a pile to draw." : `Waiting for ${currentPlayerName} to play.`}
    </div>
  `;
  yanivControlsEl.innerHTML = "";

  // Render the table with hands and discard pile
  const discardTop = state.yaniv.discardPile.length > 0 ? state.yaniv.discardPile[state.yaniv.discardPile.length - 1] : null;
  const drawPileTop = Array.isArray(state.yaniv.drawPile) && state.yaniv.drawPile.length > 0 ? state.yaniv.drawPile[0] : null;
  const drawPileBackClass = drawPileTop ? getCardBackClass(drawPileTop.backColor) : "";
  const discardPileAction = canUsePileActions ? `onclick="window.discardAndDrawFromYanivDiscardHandler()"` : "";
  const drawPileAction = canUsePileActions ? `onclick="window.discardAndDrawFromYanivDeckHandler()"` : "";
  const pileActionStyle = canUsePileActions ? "cursor: pointer; opacity: 1;" : "cursor: not-allowed; opacity: 0.7;";
  const discardPileHighlightClass = [
    activeYanivDrawHighlightSource === "discard" ? "yaniv-pile-highlight" : "",
    activeYanivSlamFlash ? "yaniv-slam-highlight" : ""
  ].filter(Boolean).join(" ");
  const drawPileHighlightClass = activeYanivDrawHighlightSource === "deck" ? "yaniv-pile-highlight" : "";
  const discardPileLabel = activeYanivSlamFlash ? "SLAM!!" : "Discard";
  const discardPileLabelClass = activeYanivSlamFlash ? "yaniv-slam-label" : "";

  const myHandHtml = myYanivHand.length > 0
    ? myYanivHand
        .map((card) => {
          const isSelected = selectedYanivCardIds.includes(card.id);
          const selectionOrder = selectedYanivCardIds.indexOf(card.id);
          const selectionPriority = selectionOrder > -1 ? 100 + selectionOrder : 1;
          return `
            <button
              type="button"
              class="split-card-button ${isSelected ? "selected-card" : ""}"
              onclick="window.toggleYanivCardSelection('${card.id}')"
              style="margin: 0; z-index: ${selectionPriority}; ${state.yaniv.pendingDiscard.length > 0 ? "pointer-events: none; opacity: 0.5;" : ""}"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : "<div>No cards in hand.</div>";

  yanivTableEl.innerHTML = `
    <div class="yaniv-area">
      <div class="yaniv-info-box">
        <div class="split-piles-area normal-layout yaniv-top-piles" style="display: grid; grid-template-columns: 1fr 1fr; margin-top: 0;">
          <div
            class="split-pile split-pile-clickable ${discardPileHighlightClass}"
            style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px; ${pileActionStyle}"
            ${discardPileAction}
          >
            <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
              <strong class="${discardPileLabelClass}">${discardPileLabel}</strong>
            </div>
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${discardTop ? cardToText(discardTop) : `<div>Empty</div>`}
            </div>
          </div>
          <div
            class="split-pile split-pile-clickable ${drawPileHighlightClass}"
            style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px; ${pileActionStyle}"
            ${drawPileAction}
          >
            <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
              <strong>Draw</strong>
            </div>
            <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
              ${drawPileTop ? `<div class="card card-back-only ${drawPileBackClass}"><div class="card-back-pattern"></div></div>` : `<div>Empty</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="yaniv-info-box">
        ${yanivButtonsHtml}
      </div>

      <div class="yaniv-info-box">
        <div
          class="split-pile split-pile-clickable yaniv-hand-pile"
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
  `;

}

function renderWhist() {
  const whistTableEl = document.getElementById("whistTable");
  if (!whistTableEl) return;

  const isWhistResultsView = !!state?.whist?.result && !state?.whist?.started;
  const panelHeaderEl = document.querySelector('.panel[data-tab="whist"] .panel-header-with-tooltip');
  if (panelHeaderEl) {
    panelHeaderEl.innerHTML = `
      ${renderSortToggle(isWhistResultsView)}
      <h2 style="display:none;">Whist</h2>
      ${buildPanelHeaderMetaHtml("Nominate tricks and win exactly that many")}
    `;
  }

  const whistPanelH2 = document.querySelector('.panel[data-tab="whist"] h2');
  if (whistPanelH2) {
    whistPanelH2.textContent = !state || !state.whist.nominationsComplete ? "Nominations" : "Whist";
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
    const swapMode = getRobotNoBotSwapModeClient();
    const isBlindRound = isBlindRoundClient();

    const cardsHtml = mySavedWhist.length > 0
      ? mySavedWhist
          .map((card) => {
            if (!isBlindRound) {
              return `<button class="split-card-button" disabled style="opacity: 1; margin: 0;">${cardToText(card)}</button>`;
            }
            const backClass = getCardBackClass(card.backColor);
            return `<button class="split-card-button" disabled style="opacity: 1; margin: 0;"><div class="card card-back-only ${backClass}"><div class="card-back-pattern"></div></div></button>`;
          })
          .join("")
      : ``;

    const swapSelection = me?.swapSelection;
    const swapSelectionHtml = swapMode && swapSelection
      ? `
        <div class="split-piles-area normal-layout whist-top-piles" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
          <div class="split-pile split-pile-clickable" style="background-color: rgba(209, 213, 219, 0.9); justify-content: flex-start; padding: 10px;">
            <div class="split-pile-header-clickable"><strong>Left Pile</strong></div>
            <div class="split-stack">
              ${swapSelection.left.map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("")}
            </div>
          </div>
          <div class="split-pile split-pile-clickable" style="background-color: rgba(209, 213, 219, 0.9); justify-content: flex-start; padding: 10px;">
            <div class="split-pile-header-clickable"><strong>Right Pile</strong></div>
            <div class="split-stack">
              ${swapSelection.right.map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("")}
            </div>
          </div>
          <div class="split-pile split-pile-clickable" style="background-color: ${swapMode.fixedTarget === "brag" ? "rgba(255, 136, 136, 0.9)" : "rgba(107, 168, 208, 0.9)"}; grid-column: 1 / -1; justify-content: flex-start; padding: 10px;">
            <div class="split-pile-header-clickable"><strong>${swapMode.fixedTarget === "brag" ? "Brag (Fixed)" : "Yaniv (Fixed)"}</strong></div>
            <div class="split-stack">
              ${swapSelection.fixed.map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("")}
            </div>
          </div>
        </div>
      `
      : "";

    const nominationSection = isMyTurnToNominate
      ? `
        <div style="margin-top: 16px; padding: 16px; background: rgba(255, 255, 255, 0.5); border-radius: 8px;">
          <strong>Your Nomination</strong>
          <div class="action-row" style="margin-top: 8px;">
            <input id="nominationInput" type="number" min="0" max="${totalTricks}" style="width: 100px; padding: 8px; font-size: 14px;" />
            <button onclick="window.saveNomination()">Save Nomination</button>
          </div>
        </div>
      `
      : `<div style="margin-top: 16px; padding: 16px; background: rgba(255, 255, 255, 0.5); border-radius: 8px; text-align: center; font-style: italic;">Waiting for another player to nominate.</div>`;

    whistTableEl.innerHTML = `
      <div class="split-piles-area normal-layout whist-hand-area" style="display: grid; grid-template-columns: 1fr; margin-top: 20px;">
        <div class="split-pile split-pile-clickable whist-hand-pile" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
          <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
            <strong>${swapMode ? "Your Split For Robot / No-bot" : (isBlindRound ? "Your Blind Hand" : "Your Whist Hand")}</strong>
          </div>
          <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
            ${swapMode ? swapSelectionHtml : cardsHtml}
          </div>
        </div>
      </div>
      ${nominationSection}
    `;
    return;
  }

  if (state.whist.robotNoBotPending || state.whist.robotNoBotAwaitingContinue) {
    const swapMode = getRobotNoBotSwapModeClient();
    const resolvedFace = state.whist.robotNoBotCoinResult || state.whist.robotNoBotResults?.[0] || "nobot";
    const displayFace = robotFlipAnimating ? (robotFlipFaces[0] || "nobot") : resolvedFace;
    const coinIconHtml =
      displayFace === "robot"
        ? `<i class="fa-solid fa-robot"></i>`
        : `<i class="fa-regular fa-circle"></i>`;

    const flipPanelsHtml = state.players
      .map((player, idx) => {
        const face = state.whist.robotNoBotResults?.[idx] || displayFace;

        const split = player.swapSelection || { left: [], right: [], fixed: [] };
        const leftHtml = (split.left || []).map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("");
        const rightHtml = (split.right || []).map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("");
        const fixedHtml = (split.fixed || []).map((card) => `<button class="split-card-button" disabled style="opacity:1;margin:0;">${cardToText(card)}</button>`).join("");

        const isResolved = !!state.whist.robotNoBotAwaitingContinue;
        const leftTitle = !isResolved
          ? "Left"
          : (face === "nobot" ? "Whist" : (swapMode?.equalTarget === "brag" ? "Brag" : "Yaniv"));
        const rightTitle = !isResolved
          ? "Right"
          : (face === "robot" ? "Whist" : (swapMode?.equalTarget === "brag" ? "Brag" : "Yaniv"));
        const fixedTitle = swapMode?.fixedTarget === "brag" ? "Brag" : "Yaniv";

        const leftColor = !isResolved
          ? "rgba(209, 213, 219, 0.95)"
          : (face === "nobot" ? "rgba(200, 150, 224, 0.9)" : (swapMode?.equalTarget === "brag" ? "rgba(255, 136, 136, 0.9)" : "rgba(107, 168, 208, 0.9)"));
        const rightColor = !isResolved
          ? "rgba(209, 213, 219, 0.95)"
          : (face === "robot" ? "rgba(200, 150, 224, 0.9)" : (swapMode?.equalTarget === "brag" ? "rgba(255, 136, 136, 0.9)" : "rgba(107, 168, 208, 0.9)"));
        const fixedColor = swapMode?.fixedTarget === "brag" ? "rgba(255, 136, 136, 0.9)" : "rgba(107, 168, 208, 0.9)";

        return `
          <div class="split-pile split-pile-clickable" style="background-color: rgba(229, 231, 235, 0.95); justify-content: flex-start; padding: 12px;">
            <div style="font-weight: 700; margin-bottom: 8px;">${player.name}</div>
            <div style="width:100%; margin-top:8px; display:grid; gap:8px;">
              <div class="split-pile" style="background-color:${leftColor}; border:none; border-radius:10px; padding:8px;">
                <div class="split-pile-header-clickable" style="margin-bottom:6px;"><strong>${leftTitle}</strong></div>
                <div class="split-stack">${leftHtml}</div>
              </div>
              <div class="split-pile" style="background-color:${rightColor}; border:none; border-radius:10px; padding:8px;">
                <div class="split-pile-header-clickable" style="margin-bottom:6px;"><strong>${rightTitle}</strong></div>
                <div class="split-stack">${rightHtml}</div>
              </div>
              <div class="split-pile" style="background-color:${fixedColor}; border:none; border-radius:10px; padding:8px;">
                <div class="split-pile-header-clickable" style="margin-bottom:6px;"><strong>${fixedTitle}</strong></div>
                <div class="split-stack">${fixedHtml}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    whistTableEl.innerHTML = `
      <div style="width: 66px; height: 66px; border-radius: 999px; border: 2px solid #9ca3af; display:flex; align-items:center; justify-content:center; font-size: 26px; margin-bottom: 8px;">
        ${coinIconHtml}
      </div>
      <div class="phase-results">${flipPanelsHtml}</div>
      <div style="display:flex; justify-content:flex-end; margin-top: 12px;">
        ${state.whist.robotNoBotPending
          ? `<button ${robotFlipAnimating ? "disabled" : ""} onclick="window.resolveRobotNoBotHandler()">${robotFlipAnimating ? "Flipping..." : "Flip"}</button>`
          : `<button onclick="window.continueAfterRobotNoBotHandler()">Continue</button>`}
      </div>
    `;
    return;
  }

  const renderWonTrickPilesSection = () => {
    const wonTrickPiles = state.whist.wonTrickPiles || [];
    if (!wonTrickPiles.length) return "";

    const wonTrickPanelsHtml = wonTrickPiles
      .map((pile) => {
        const winnerName = state.players[pile.winnerIndex]?.name || "Unknown";
        const cards = Array.isArray(pile.cards) ? pile.cards : [];
        const wonCardsHtml = cards
          .map((card) => `<button class="split-card-button" disabled style="margin: 0; opacity: 1;">${cardToText(card)}</button>`)
          .join("");

        return `
          <div class="whist-won-player-panel">
            <div class="whist-won-player-label">
              ${winnerName}${pile.winnerIndex === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : ""}
            </div>
            <div class="split-stack whist-won-trick-stack">
              ${wonCardsHtml || ``}
            </div>
          </div>
        `;
      })
      .join("");

    return `<div class="whist-won-tricks-grid" style="margin-top: 12px;">${wonTrickPanelsHtml}</div>`;
  };

  if (!state.whist.started && state.whist.result) {
    const roundSummary = getRoundSummaryForCurrentWhistResults();
    const resultsHtml = state.whist.result.results
      .map((result) => {
        return `
          <div class="split-pile split-pile-clickable" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
            <div><strong>${result.playerName}${result.playerIndex === playerIndex ? ' <span class="you-icon" title="You" aria-label="You"><i class="fa-solid fa-user"></i></span>' : ""}</strong></div>
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
      ${renderWhistTrickHistory(roundSummary)}
      ${renderWonTrickPilesSection()}
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

  const isMyTurn = state.whist.currentPlayerIndex === playerIndex;
  const myWhistHand = me?.assignments?.whist || [];

  const myHandHtml = myWhistHand.length
    ? myWhistHand
        .map((card) => {
          const isPlayable = isMyTurn && canPlayWhistCardClient(card, myWhistHand, state.whist);
          const isDisabled = !isPlayable;
          return `
            <button
              type="button"
              class="split-card-button"
              onclick="window.playCard('${card.id}')"
              ${isDisabled ? "disabled" : ""}
              style="margin: 0; opacity: ${isDisabled ? "0.55" : "1"};"
            >
              ${cardToText(card)}
            </button>
          `;
        })
        .join("")
    : `<div>No Whist cards left</div>`;

  const revealTrickEntries = activeWhistTrickReveal
    ? (state.whist.lastCompletedTrick || [])
    : (state.whist.currentTrick || []);
  const whistRevealWinnerName = activeWhistTrickReveal && state.whist.lastCompletedTrickWinnerIndex !== null
    ? (state.players[state.whist.lastCompletedTrickWinnerIndex]?.name || "Unknown")
    : "";
  const currentTrickCardsHtml =
    revealTrickEntries.length > 0
      ? revealTrickEntries
          .map((entry) => {
            const trickPlayerName = state.players[entry.playerIndex]?.name || `Player ${entry.playerIndex + 1}`;
            return `
              <div class="whist-trick-entry" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
                <div>${trickPlayerName}</div>
                <button class="split-card-button" disabled style="margin: 0; opacity: 1;">${cardToText(entry.card)}</button>
              </div>
            `;
          })
          .join("")
      : `<div>No cards played yet.</div>`;

  whistTableEl.innerHTML = `
    <div class="whist-info-box">
      <div class="split-pile split-pile-clickable whist-trick-pile ${activeWhistTrickReveal ? "whist-trick-reveal" : ""}" style="background-color: rgba(118, 184, 118, 0.85); justify-content: flex-start; padding: 12px;">
        <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
          <strong class="${activeWhistTrickReveal ? "whist-trick-winner-label" : ""}">
            ${activeWhistTrickReveal ? `Won by ${whistRevealWinnerName}` : "Current Trick"}
          </strong>
        </div>
        <div class="split-stack whist-trick-stack" style="display: flex; flex-wrap: wrap; gap: 16px; justify-content: flex-start;">
          ${currentTrickCardsHtml}
        </div>
      </div>
    </div>

    <div class="whist-info-box" style="margin-top: 12px;">
      <div class="split-pile split-pile-clickable whist-hand-pile" style="background-color: rgba(200, 150, 224, 0.85); justify-content: flex-start; padding: 12px;">
        <div class="split-pile-header-clickable" style="width: 100%; margin-bottom: 12px;">
          <strong>Your Whist Hand</strong>
        </div>
        <div class="split-stack" style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;">
          ${myHandHtml}
        </div>
      </div>
    </div>

    ${renderWonTrickPilesSection()}

  `;

}

function cardToText(card) {
  if (!card) return "";

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
  const isJoker = card.rank === "Joker";
  const faceClass = isJoker ? "joker" : colorClass;
  const rankText = isJoker ? 'J<span class="joker-suffix">o</span>' : card.rank;
  const suitText = isJoker ? "" : suitSymbols[card.suit];

  return `
    <div class="card ${faceClass} ${backClass}">
      <div class="simple-card-face ${faceClass}">
        <span class="simple-card-rank">${rankText}</span>
        ${suitText ? `<span class="simple-card-suit">${suitText}</span>` : ""}
      </div>
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

function getWhistLeadSuitForClient(whistState) {
  if (!whistState) return null;
  if (whistState.leadSuit) return whistState.leadSuit;

  const trick = Array.isArray(whistState.currentTrick) ? whistState.currentTrick : [];
  const firstNonJoker = trick.find((entry) => entry?.card?.rank !== "Joker");
  return firstNonJoker?.card?.suit || null;
}

function canPlayWhistCardClient(card, myWhistHand, whistState) {
  if (!card) return false;
  if (card.rank === "Joker") return true; // Joker always allowed

  const leadSuit = getWhistLeadSuitForClient(whistState);
  if (!leadSuit) return true; // Suit open until first non-joker card is played

  const hasLeadSuit = (myWhistHand || []).some(
    (c) => c.rank !== "Joker" && c.suit === leadSuit
  );

  if (hasLeadSuit) {
    return card.suit === leadSuit;
  }

  return true; // no lead suit in hand, any card can be played
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
window.resolveRobotNoBotHandler = resolveRobotNoBotHandler;
window.continueAfterRobotNoBotHandler = continueAfterRobotNoBotHandler;
window.createRoomHandler = createRoomHandler;
window.joinRoomHandler = joinRoomHandler;
window.endGameHandler = endGameHandler;
window.leaveRoomHandler = leaveRoomHandler;
window.endRoomHandler = endRoomHandler;
window.startGameHandler = startGameHandler;




