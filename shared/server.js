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
  callYaniv
} from "./gameEngine.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("."));

let rooms = {};

function createRoom(roomId) {
  rooms[roomId] = {
    roomId,
    players: [],
    state: null,
    gameStarted: false
  };
}

function buildLobbyState(room) {
  const playerNames = room.players.map((_, index) => {
    // Preserve existing player names if the state already exists
    if (room.state && room.state.players[index]) {
      return room.state.players[index].name;
    }
    return `Player ${index + 1}`;
  });
  return createInitialState(playerNames);
}

function makeHiddenCards(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    rank: "Hidden",
    suit: "Hidden",
    backColor: "Red"
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

    const hiddenHandCount = Array.isArray(player.hand) ? player.hand.length : 0;
    const hiddenWhistCount = Array.isArray(player.assignments?.whist)
      ? player.assignments.whist.length
      : 0;
    const hiddenBragCount = Array.isArray(player.assignments?.brag)
      ? player.assignments.brag.length
      : 0;
    const hiddenYanivCount = Array.isArray(player.assignments?.yaniv)
      ? player.assignments.yaniv.length
      : 0;

    return {
      ...player,
      hand: makeHiddenCards(hiddenHandCount, `hidden-hand-${index}`),
      assignments: player.assignments
        ? {
            brag: revealBrag ? player.assignments.brag : makeHiddenCards(hiddenBragCount, `hidden-brag-${index}`),
            yaniv: revealYaniv ? player.assignments.yaniv : makeHiddenCards(hiddenYanivCount, `hidden-yaniv-${index}`),
            whist: revealWhist ? player.assignments.whist : makeHiddenCards(hiddenWhistCount, `hidden-whist-${index}`)
          }
        : null
    };
  });

  return safeState;
}

function sendStateToRoom(roomId) {
  const room = rooms[roomId];
  if (!room || !room.state) return;

  room.players.forEach((socketId, playerIndex) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const safeState = buildStateForPlayer(room.state, playerIndex);
    socket.emit("stateUpdate", safeState);
  });
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("joinRoom", (roomId) => {
    if (!rooms[roomId]) {
      createRoom(roomId);
    }

    const room = rooms[roomId];

    if (room.gameStarted) {
      socket.emit("errorMessage", "This room has already started.");
      return;
    }

    if (room.players.length >= 10) {
      socket.emit("errorMessage", "Room is full.");
      return;
    }

    room.players.push(socket.id);
    const playerIndex = room.players.length - 1;

    room.state = buildLobbyState(room);

    socket.join(roomId);

    socket.emit("playerIndex", playerIndex);
    sendStateToRoom(roomId);
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.players.length < 2) {
      socket.emit("errorMessage", "Need at least 2 players to start.");
      return;
    }

    room.state = buildLobbyState(room);

    const result = startGame(room.state);

    if (!result.error) {
      room.state = result.state;
      room.gameStarted = true;
      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
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

if (room.state.whist.nominationsComplete) {
  room.state.brag.started = true;
  room.state.brag.communityCards = [];
  room.state.brag.currentPlayerIndex =
    (room.state.dealerIndex + 1) % room.state.players.length;
  room.state.brag.turnCount = 0;
  room.state.brag.turnsTakenByPlayer = room.state.players.map(() => 0);
  room.state.brag.firstCycleComplete = false;
  room.state.brag.guruActive = false;
  room.state.brag.knockAvailable = false;
  room.state.brag.knock = null;
  room.state.brag.finalTurnsRemaining = 0;

  for (let i = 0; i < 3; i++) {
    const card = room.state.deck.shift();
    if (card) {
      room.state.brag.communityCards.push(card);
    }
  }
}

  room.state.brag.currentPlayerIndex =
    (room.state.dealerIndex + 1) % room.state.players.length;

      sendStateToRoom(roomId);
    } else {
      socket.emit("errorMessage", result.error);
    }
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

  const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

    if (room.players[playerIndex] !== socket.id) {
      socket.emit("errorMessage", "You can only update your own name");
      return;
    }

    if (!newName || newName.trim() === "") {
      socket.emit("errorMessage", "Player name cannot be empty");
      return;
    }

    room.state.players[playerIndex].name = newName.trim();
    sendStateToRoom(roomId);
  });

  socket.on("callYaniv", (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.state) return;

    const playerIndex = room.players.findIndex((id) => id === socket.id);
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

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);

      if (index !== -1) {
        room.players.splice(index, 1);

        if (!room.gameStarted) {
          if (room.players.length === 0) {
            delete rooms[roomId];
          } else {
            room.state = buildLobbyState(room);
            sendStateToRoom(roomId);
          }
        }

        break;
      }
    }
  });
});



server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);