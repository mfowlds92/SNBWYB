import express from "express";
import http from "http";
import { Server } from "socket.io";

import {
  createInitialState,
  startGame,
  nextRound,
  playWhistCard,
  saveNomination,
  saveWhistSelection,
  advanceBragTurn,
  swapBragOne,
  swapBragThree,
  chooseKnockOrGuru,
  startYaniv,
  startWhist,
  discardYanivCards,
  drawFromYanivDeck,
  drawFromYanivDiscard,
  slamYanivCard,
  continueWithoutSlam,
  callYaniv,
  resolveRobotNoBot,
  continueAfterRobotNoBot,
  jumpToRound
} from "./gameEngine.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("."));

let rooms = {};
const LOBBY_CHANNEL = "__lobby__";

function createRoom(roomId, roomName = roomId, ownerPlayerId = null) {
  rooms[roomId] = {
    roomId,
    roomName,
    ownerPlayerId,
    ownerName: null,
    players: [],
    playerIds: [],
    playerNames: [],
    playersList: [],
    chatMessages: [],
    state: null,
    gameStarted: false
  };
}

function buildLobbyState(room) {
  const playerNames = room.playerNames.map((name, index) => name || `Player ${index + 1}`);
  return createInitialState(playerNames);
}

function randomRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getRoomPlayerNames(room) {
  const names = room.playerNames.map((name, index) => name || `Player ${index + 1}`);
  if (!names.length && room.ownerName) return [room.ownerName];
  if (!names[0] && room.ownerName) names[0] = room.ownerName;
  return names.filter(Boolean);
}

function syncRoomPlayersList(room) {
  room.playersList = getRoomPlayerNames(room);
  return room.playersList;
}

function getRoomSummaries() {
  return Object.values(rooms).map((room) => ({
    playerNames: syncRoomPlayersList(room),
    playersList: room.playersList,
    playerCount: room.playersList.length,
    roomId: room.roomId,
    roomName: room.roomName,
    ownerPlayerId: room.ownerPlayerId,
    ownerName: room.ownerName || null,
    playersConnected: room.players.filter(Boolean).length,
    playersTotal: room.playerIds.length,
    gameStarted: room.gameStarted
  }));
}

function emitLobbyUpdate() {
  const lobbyRooms = getRoomSummaries();
  io.to(LOBBY_CHANNEL).emit("lobbyUpdate", { rooms: lobbyRooms });
  console.log(
    `[LOBBY][emitLobbyUpdate] rooms=${lobbyRooms.length}`,
    lobbyRooms.map((room) => ({
      roomId: room.roomId,
      roomName: room.roomName,
      playerCount: room.playerCount,
      playersList: room.playersList
    }))
  );
  logLobbyMembers("emitLobbyUpdate");
}

function isSocketInLobby(socket) {
  const currentRoomId = socket.data?.currentRoomId || null;
  if (!currentRoomId) return true;
  const room = rooms[currentRoomId];
  if (!room) return true;
  return !room.gameStarted;
}

function syncSocketLobbyMembership(socket) {
  if (!socket) return;
  if (isSocketInLobby(socket)) {
    socket.join(LOBBY_CHANNEL);
  } else {
    socket.leave(LOBBY_CHANNEL);
  }
}

function logLobbyMembers(context = "") {
  const lobbyRoom = io.sockets.adapter.rooms.get(LOBBY_CHANNEL);
  const socketIds = lobbyRoom ? Array.from(lobbyRoom) : [];
  const members = socketIds.map((socketId) => {
    const s = io.sockets.sockets.get(socketId);
    return {
      socketId,
      playerId: s?.data?.playerId || null,
      playerName: s?.data?.playerName || null,
      currentRoomId: s?.data?.currentRoomId || null
    };
  });
  console.log(`[LOBBY][${context}] members=${members.length}`, members);
}

function getPlayerIndexBySocket(room, socket) {
  const playerId = socket.data?.playerId;
  if (!playerId) return -1;
  return room.playerIds.findIndex((id) => id === playerId);
}

function removePlayerFromRoom(roomId, playerId, socketId = null) {
  const room = rooms[roomId];
  if (!room) return false;

  let playerIndex = -1;
  if (playerId) {
    playerIndex = room.playerIds.findIndex((id) => id === playerId);
  }
  if (playerIndex === -1 && socketId) {
    playerIndex = room.players.findIndex((id) => id === socketId);
  }
  if (playerIndex === -1) return false;

  if (room.gameStarted) {
    room.players[playerIndex] = null;
    syncRoomPlayersList(room);
    return true;
  }

  room.players.splice(playerIndex, 1);
  room.playerIds.splice(playerIndex, 1);
  room.playerNames.splice(playerIndex, 1);
  syncRoomPlayersList(room);

  if (!room.playerIds.length) {
    delete rooms[roomId];
    return true;
  }

  if (!room.playerIds.includes(room.ownerPlayerId)) {
    room.ownerPlayerId = room.playerIds[0];
    room.ownerName = room.playerNames[0] || room.ownerName || `Player 1`;
  }

  room.state = buildLobbyState(room);
  return true;
}

function removePlayerFromOtherRooms(socket, playerId, targetRoomId = null) {
  let changed = false;
  for (const id of Object.keys(rooms)) {
    if (targetRoomId && id === targetRoomId) continue;
    const didRemove = removePlayerFromRoom(id, playerId, socket?.id || null);
    if (didRemove) {
      if (socket) {
        socket.leave(id);
      }
      changed = true;
      const room = rooms[id];
      if (room) {
        sendStateToRoom(id);
      }
    }
  }
  if (changed) {
    emitLobbyUpdate();
  }
}

function makeHiddenCards(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    rank: "Hidden",
    suit: "Hidden",
    backColor: "Red"
  }));
}

function makeHiddenCardsFromSource(cards, prefix) {
  if (!Array.isArray(cards)) return [];
  return cards.map((card, index) => ({
    id: `${prefix}-${index}`,
    rank: "Hidden",
    suit: "Hidden",
    backColor: card?.backColor || "Red"
  }));
}

function buildStateForPlayer(state, playerIndex) {
  const safeState = structuredClone(state);
  const revealBrag = state.brag.results && state.brag.results.length > 0 && !state.yaniv.started;
  const revealYaniv = state.yaniv.result && !state.whist.started;
  const revealWhist = state.whist.result && !state.whist.started;

  safeState.players = safeState.players.map((player, index) => {
    if (index === playerIndex) {
      return player;
    }

    return {
      ...player,
      hand: makeHiddenCardsFromSource(player.hand, `hidden-hand-${index}`),
      assignments: player.assignments
        ? {
            brag: revealBrag ? player.assignments.brag : makeHiddenCardsFromSource(player.assignments.brag, `hidden-brag-${index}`),
            yaniv: revealYaniv ? player.assignments.yaniv : makeHiddenCardsFromSource(player.assignments.yaniv, `hidden-yaniv-${index}`),
            whist: revealWhist ? player.assignments.whist : makeHiddenCardsFromSource(player.assignments.whist, `hidden-whist-${index}`)
          }
        : null,
      swapSelection: player.swapSelection
        ? {
            left: makeHiddenCardsFromSource(player.swapSelection.left, `hidden-left-${index}`),
            right: makeHiddenCardsFromSource(player.swapSelection.right, `hidden-right-${index}`),
            fixed: makeHiddenCardsFromSource(player.swapSelection.fixed, `hidden-fixed-${index}`)
          }
        : null
    };
  });

  if (Array.isArray(state.whist?.lastWonTrickByPlayer)) {
    safeState.whist.lastWonTrickByPlayer = state.whist.lastWonTrickByPlayer.map((cards, index) => {
      if (index === playerIndex) return cards;
      return makeHiddenCardsFromSource(cards, `hidden-wontrick-${index}`);
    });
  }

  if (Array.isArray(state.whist?.wonTricksByPlayer)) {
    safeState.whist.wonTricksByPlayer = state.whist.wonTricksByPlayer;
  }

  if (Array.isArray(state.whist?.wonTrickPiles)) {
    safeState.whist.wonTrickPiles = state.whist.wonTrickPiles;
  }

  return safeState;
}

function sendStateToRoom(roomId) {
  const room = rooms[roomId];
  if (!room || !room.state) return;
  syncRoomPlayersList(room);

  room.players.forEach((socketId, playerIndex) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const safeState = buildStateForPlayer(room.state, playerIndex);
    socket.emit("playerIndex", playerIndex);
    socket.emit("stateUpdate", safeState);
    socket.emit("roomMeta", {
      roomId: room.roomId,
      roomName: room.roomName,
      ownerPlayerId: room.ownerPlayerId,
      ownerName: room.ownerName || null,
      playerNames: room.playersList,
      playersList: room.playersList,
      playerCount: room.playersList.length,
      gameStarted: room.gameStarted,
      playersConnected: room.players.filter(Boolean).length,
      playersTotal: room.playerIds.length
    });
  });
}

function drawNonJokerBragCommunityCard(state) {
  const attemptedCardIds = new Set();

  while (state.deck.length > 0) {
    const card = state.deck.shift();
    if (!card) return null;

    if (card.rank !== "Joker") {
      return card;
    }

    // Jokers cannot start face-up on the Brag table, so cycle them behind the deck.
    state.deck.push(card);

    if (attemptedCardIds.has(card.id)) {
      return null;
    }

    attemptedCardIds.add(card.id);
  }

  return null;
}

function startBragRoundIfReady(state) {
  if (!state.whist.nominationsComplete) return;
  if (state.whist.robotNoBotPending) return;
  if (state.whist.robotNoBotAwaitingContinue) return;
  if (state.brag.started) return;

  state.brag.started = true;
  state.brag.communityCards = [];
  state.brag.currentPlayerIndex =
    (state.dealerIndex + 1) % state.players.length;
  state.brag.turnCount = 0;
  state.brag.turnsTakenByPlayer = state.players.map(() => 0);
  state.brag.firstCycleComplete = false;
  state.brag.guruActive = false;
  state.brag.knockAvailable = false;
  state.brag.knock = null;
  state.brag.finalTurnsRemaining = 0;

  for (let i = 0; i < 3; i++) {
    const card = drawNonJokerBragCommunityCard(state);
    if (card) {
      state.brag.communityCards.push(card);
    }
  }

  state.brag.currentPlayerIndex =
    (state.dealerIndex + 1) % state.players.length;
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("initSession", ({ playerId, playerName, currentRoomId }) => {
    const resolvedPlayerId = playerId || `p_${Math.random().toString(36).slice(2, 10)}`;
    socket.data.playerId = resolvedPlayerId;
    socket.data.playerName = (playerName || "").trim();

    let restoredRoomId = null;
    let restoredPlayerIndex = null;

    if (currentRoomId && rooms[currentRoomId]) {
      const room = rooms[currentRoomId];
      const playerIndex = room.playerIds.findIndex((id) => id === resolvedPlayerId);
      if (playerIndex !== -1) {
        room.players[playerIndex] = socket.id;
        if (socket.data.playerName) {
          room.playerNames[playerIndex] = socket.data.playerName;
          if (room.state?.players?.[playerIndex]) {
            room.state.players[playerIndex].name = socket.data.playerName;
          }
        }
        socket.join(currentRoomId);
        socket.data.currentRoomId = currentRoomId;
        restoredRoomId = currentRoomId;
        restoredPlayerIndex = playerIndex;
      }
    }

    if (!restoredRoomId) {
      socket.data.currentRoomId = null;
    }
    syncSocketLobbyMembership(socket);

    socket.emit("sessionReady", {
      playerId: resolvedPlayerId,
      playerName: socket.data.playerName || "",
      currentRoomId: restoredRoomId,
      playerIndex: restoredPlayerIndex,
      rooms: getRoomSummaries()
    });

    if (restoredRoomId) {
      sendStateToRoom(restoredRoomId);
      const restoredRoom = rooms[restoredRoomId];
      if (restoredRoom) {
        socket.emit("chatHistory", { roomId: restoredRoomId, messages: restoredRoom.chatMessages || [] });
      }
    }
  });

  socket.on("createRoom", ({ roomName, playerName }) => {
    const playerId = socket.data?.playerId;
    if (!playerId) {
      socket.emit("errorMessage", "Session not initialized");
      return;
    }

    removePlayerFromOtherRooms(socket, playerId, null);

    const incomingName = (playerName || "").trim();
    if (incomingName) {
      socket.data.playerName = incomingName;
    }

    const safeRoomName = (roomName || "Game Room").trim() || "Game Room";
    let roomId = randomRoomId();
    while (rooms[roomId]) {
      roomId = randomRoomId();
    }

    createRoom(roomId, safeRoomName, playerId);
    const room = rooms[roomId];

    room.players.push(socket.id);
    room.playerIds.push(playerId);
    const creatorName = socket.data.playerName || `Player 1`;
    room.playerNames.push(creatorName);
    room.ownerName = creatorName;
    syncRoomPlayersList(room);
    room.state = buildLobbyState(room);

    socket.join(roomId);
    socket.data.currentRoomId = roomId;
    syncSocketLobbyMembership(socket);
    socket.emit("roomJoined", {
      roomId,
      roomName: room.roomName,
      ownerPlayerId: room.ownerPlayerId,
      ownerName: room.ownerName || null,
      playerNames: room.playersList,
      playersList: room.playersList,
      playerCount: room.playersList.length,
      playerIndex: 0,
      gameStarted: room.gameStarted
    });
    socket.emit("chatHistory", { roomId, messages: room.chatMessages || [] });
    sendStateToRoom(roomId);
    emitLobbyUpdate();
  });

  socket.on("joinRoom", (roomIdOrPayload) => {
    const roomId = typeof roomIdOrPayload === "string" ? roomIdOrPayload : roomIdOrPayload?.roomId;
    const incomingName = typeof roomIdOrPayload === "object" ? roomIdOrPayload?.playerName : null;
    const room = rooms[roomId];
    const playerId = socket.data?.playerId;

    const cleanIncomingName = (incomingName || "").trim();
    if (cleanIncomingName) {
      socket.data.playerName = cleanIncomingName;
    }

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    if (!playerId) {
      socket.emit("errorMessage", "Session not initialized");
      return;
    }

    removePlayerFromOtherRooms(socket, playerId, roomId);

    let playerIndex = room.playerIds.findIndex((id) => id === playerId);

    if (room.gameStarted && playerIndex === -1) {
      socket.emit("errorMessage", "Game already started. You can only rejoin if you were already in this room.");
      return;
    }

    if (playerIndex === -1) {
      if (room.playerIds.length >= 10) {
        socket.emit("errorMessage", "Room is full.");
        return;
      }
      room.playerIds.push(playerId);
      room.playerNames.push(socket.data.playerName || `Player ${room.playerIds.length}`);
      room.players.push(socket.id);
      playerIndex = room.playerIds.length - 1;
    } else {
      room.players[playerIndex] = socket.id;
      if (socket.data.playerName) {
        room.playerNames[playerIndex] = socket.data.playerName;
      }
    }
    syncRoomPlayersList(room);

    if (!room.gameStarted) {
      room.state = buildLobbyState(room);
    } else if (room.state?.players?.[playerIndex] && socket.data.playerName) {
      room.state.players[playerIndex].name = socket.data.playerName;
    }

    socket.join(roomId);
    socket.data.currentRoomId = roomId;
    syncSocketLobbyMembership(socket);
    socket.emit("roomJoined", {
      roomId,
      roomName: room.roomName,
      ownerPlayerId: room.ownerPlayerId,
      ownerName: room.ownerName || null,
      playerNames: room.playersList,
      playersList: room.playersList,
      playerCount: room.playersList.length,
      playerIndex,
      gameStarted: room.gameStarted
    });
    socket.emit("chatHistory", { roomId, messages: room.chatMessages || [] });
    sendStateToRoom(roomId);
    emitLobbyUpdate();
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerId = socket.data?.playerId;
    if (!playerId || room.ownerPlayerId !== playerId) {
      socket.emit("errorMessage", "Only the room owner can start the game.");
      return;
    }

    if (room.playerIds.length < 2) {
      socket.emit("errorMessage", "Need at least 2 players to start.");
      return;
    }

    room.state = buildLobbyState(room);

    const result = startGame(room.state);

    if (!result.error) {
      room.state = result.state;
      room.gameStarted = true;
      room.players.forEach((memberSocketId) => {
        const memberSocket = io.sockets.sockets.get(memberSocketId);
        if (memberSocket) {
          memberSocket.data.currentRoomId = roomId;
          syncSocketLobbyMembership(memberSocket);
        }
      });
      sendStateToRoom(roomId);
      emitLobbyUpdate();
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("resetGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerId = socket.data?.playerId;
    if (!playerId || room.ownerPlayerId !== playerId) {
      socket.emit("errorMessage", "Only the room owner can reset the game.");
      return;
    }

    room.state = buildLobbyState(room);
    room.gameStarted = false;
    room.players.forEach((memberSocketId) => {
      const memberSocket = io.sockets.sockets.get(memberSocketId);
      if (memberSocket) {
        memberSocket.data.currentRoomId = roomId;
        syncSocketLobbyMembership(memberSocket);
      }
    });
    sendStateToRoom(roomId);
    emitLobbyUpdate();
  });

  socket.on("leaveRoom", (roomId) => {
    const playerId = socket.data?.playerId;
    let resolvedRoomId = roomId;

    if (!resolvedRoomId || !rooms[resolvedRoomId]) {
      resolvedRoomId = Object.keys(rooms).find((id) => {
        const room = rooms[id];
        if (!room) return false;
        if (playerId && room.playerIds.includes(playerId)) return true;
        return room.players.includes(socket.id);
      });
    }

    const room = rooms[resolvedRoomId];
    if (!room) {
      socket.emit("roomLeft");
      return;
    }

    if (!playerId) {
      socket.emit("roomLeft");
      return;
    }

    const playerIndex = room.playerIds.findIndex((id) => id === playerId);
    if (playerIndex === -1) {
      socket.emit("roomLeft");
      return;
    }

    socket.leave(resolvedRoomId);
    socket.data.currentRoomId = null;
    syncSocketLobbyMembership(socket);
    removePlayerFromRoom(resolvedRoomId, playerId, socket.id);
    if (rooms[resolvedRoomId]) {
      sendStateToRoom(resolvedRoomId);
    }
    emitLobbyUpdate();
    socket.emit("roomLeft");
  });

  socket.on("saveWhistSelection", ({ roomId, playerIndex, selectedAssignments }) => {
  const room = rooms[roomId];
  if (!room || !room.state) return;

  const result = saveWhistSelection(room.state, playerIndex, selectedAssignments);

  if (!result.error) {
    room.state = result.state;
    sendStateToRoom(roomId);
  } else {
    socket.emit("errorMessage", result.error);
  }
});

  socket.on("saveNomination", ({ roomId, playerIndex, nomination }) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = saveNomination(room.state, playerIndex, nomination);

    if (!result.error) {
      room.state = result.state;

      startBragRoundIfReady(room.state);

      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("resolveRobotNoBot", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = resolveRobotNoBot(room.state);
    if (result.error) {
      socket.emit("errorMessage", result.error);
      return;
    }

    room.state = result.state;
    sendStateToRoom(roomId);
  });

  socket.on("continueAfterRobotNoBot", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = continueAfterRobotNoBot(room.state);
    if (result.error) {
      socket.emit("errorMessage", result.error);
      return;
    }

    room.state = result.state;
    startBragRoundIfReady(room.state);
    sendStateToRoom(roomId);
  });

  socket.on("nextRound", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;


    if (room.state.whist.started) {
      socket.emit("errorMessage", "Cannot advance while Whist is still in progress");
      return;
    }

    if (!room.state.whist.result) {
      socket.emit("errorMessage", "Finish the current round first");
      return;
    }

    const result = nextRound(room.state);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("jumpToRound", ({ roomId, round }) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = jumpToRound(room.state, round);
    if (result.error) {
      socket.emit("errorMessage", result.error);
      return;
    }

    room.state = result.state;
    sendStateToRoom(roomId);
  });

  socket.on("swapBragOne", ({ roomId, playerIndex, handCardId, communityCardId }) => {
  const room = rooms[roomId];
  if (!room || !room.state) return;

  const result = swapBragOne(room.state, playerIndex, handCardId, communityCardId);

  if (!result.error) {
    room.state = result.state;
    sendStateToRoom(roomId);
  } else {
    socket.emit("errorMessage", result.error);
  }
});

socket.on("swapBragThree", ({ roomId, playerIndex }) => {
  const room = rooms[roomId];
  if (!room || !room.state) return;

  const result = swapBragThree(room.state, playerIndex);

  if (!result.error) {
    room.state = result.state;
    sendStateToRoom(roomId);
  } else {
    socket.emit("errorMessage", result.error);
  }
});



  socket.on("playCard", ({ roomId, playerIndex, cardId }) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = playWhistCard(room.state, playerIndex, cardId);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

socket.on("chooseKnockOrGuru", ({ roomId, choice }) => {
  const room = rooms[roomId];
  if (!room || !room.state) return;

  const playerIndex = getPlayerIndexBySocket(room, socket);
  if (playerIndex === -1) {
    socket.emit("errorMessage", "Player not found in room");
    return;
  }

  const result = chooseKnockOrGuru(room.state, playerIndex, choice);

  if (!result.error) {
    room.state = result.state;
    sendStateToRoom(roomId);
  } else {
    socket.emit("errorMessage", result.error);
  }
});

  socket.on("startYaniv", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = startYaniv(room.state);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("startWhist", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const result = startWhist(room.state);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("discardYanivCards", ({ roomId, cardIds }) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = discardYanivCards(room.state, playerIndex, cardIds);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("drawFromYanivDeck", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = drawFromYanivDeck(room.state, playerIndex);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("drawFromYanivDiscard", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = drawFromYanivDiscard(room.state, playerIndex);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("slamYanivCard", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = slamYanivCard(room.state, playerIndex);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("continueWithoutSlam", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = continueWithoutSlam(room.state, playerIndex);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("updatePlayerName", ({ roomId, playerIndex, newName }) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const myPlayerIndex = getPlayerIndexBySocket(room, socket);
    if (myPlayerIndex !== playerIndex) {
      socket.emit("errorMessage", "You can only update your own name");
      return;
    }

    if (!newName || newName.trim() === "") {
      socket.emit("errorMessage", "Player name cannot be empty");
      return;
    }

    const cleanName = newName.trim();
    room.state.players[playerIndex].name = cleanName;
    room.playerNames[playerIndex] = cleanName;
    if (room.playerIds[playerIndex] === room.ownerPlayerId) {
      room.ownerName = cleanName;
    }
    syncRoomPlayersList(room);
    socket.data.playerName = cleanName;
    sendStateToRoom(roomId);
    emitLobbyUpdate();
  });

  socket.on("callYaniv", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = getPlayerIndexBySocket(room, socket);
    if (playerIndex === -1) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    const result = callYaniv(room.state, playerIndex);

    if (!result.error) {
      room.state = result.state;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
  });

  socket.on("endGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerId = socket.data?.playerId;
    if (!playerId || room.ownerPlayerId !== playerId) {
      socket.emit("errorMessage", "Only the room owner can end the game.");
      return;
    }

    room.players.forEach((socketId) => {
      const memberSocket = io.sockets.sockets.get(socketId);
      if (memberSocket) {
        memberSocket.emit("gameEnded");
        memberSocket.emit("roomLeft");
        memberSocket.leave(roomId);
        memberSocket.data.currentRoomId = null;
        syncSocketLobbyMembership(memberSocket);
      }
    });
    delete rooms[roomId];
    emitLobbyUpdate();
  });

  socket.on("requestLobbyRooms", () => {
    socket.emit("lobbyUpdate", { rooms: getRoomSummaries() });
  });

  socket.on("sendChatMessage", ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;
    const playerId = socket.data?.playerId;
    if (!playerId) return;
    const playerIndex = room.playerIds.findIndex((id) => id === playerId);
    if (playerIndex === -1) return;

    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    const message = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      playerId,
      playerName: room.playerNames[playerIndex] || socket.data.playerName || `Player ${playerIndex + 1}`,
      text: trimmed.slice(0, 500),
      timestamp: Date.now()
    };

    room.chatMessages.push(message);
    if (room.chatMessages.length > 300) {
      room.chatMessages = room.chatMessages.slice(-300);
    }

    io.to(roomId).emit("chatMessage", { roomId, message });
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      const index = room.players.findIndex((id) => id === socket.id);

      if (index !== -1) {
        const disconnectedPlayerId = room.playerIds[index] || null;
        removePlayerFromRoom(roomId, disconnectedPlayerId, socket.id);
        if (rooms[roomId]) {
          sendStateToRoom(roomId);
        }
        emitLobbyUpdate();
        break;
      }
    }
  });
});



server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
