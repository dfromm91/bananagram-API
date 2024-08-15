import express from "express";
const app = express();
import http from "http";
import fs from "node:fs";
import { Server } from "socket.io";
import cors from "cors";
app.use(cors());

import wordListPath from "word-list";

// Read the word list into an array
const wordArray = fs.readFileSync(wordListPath, "utf8").split("\n");

// Convert the array to a dictionary (object) for O(1) lookups
const wordDictionary = {};
wordArray.forEach((word) => {
  wordDictionary[word.toLowerCase()] = true;
});

// Function to check if a word is in the word dictionary

const rooms = {}; // This will store the state for each room, including the tile bag and individual grids

function initializeTileBag() {
  return {
    A: 13,
    B: 3,
    C: 3,
    D: 6,
    E: 18,
    F: 3,
    G: 4,
    H: 3,
    I: 12,
    J: 2,
    K: 2,
    L: 5,
    M: 3,
    N: 8,
    O: 11,
    P: 3,
    Q: 2,
    R: 9,
    S: 6,
    T: 9,
    U: 6,
    V: 3,
    W: 3,
    X: 2,
    Y: 3,
    Z: 2,
  };

  // return {
  //   A: 5,
  //   B: 2,
  //   C: 2,
  //   D: 3,
  //   E: 6,
  //   F: 2,
  //   G: 2,
  //   H: 1,
  //   I: 3,
  // };
}
setInterval(() => {
  Object.keys(rooms).forEach((room) => {
    const clients = io.sockets.adapter.rooms.get(room);

    if (!clients || clients.size === 0) {
      console.log(`Cleaning up empty room: ${room}`);
      delete rooms[room];
    }
  });
}, 60000);
function initializeGrid() {
  return Array.from({ length: 15 }, () => Array(15).fill(null)); // 10x10 grid initialized as a 2D array
}

function parseCrossword(grid) {
  const result = {};

  function addWord(word, locations) {
    if (word.length > 1) {
      // Ensure the word length is greater than 1
      result[word] = locations;
    }
  }

  function extractHorizontalWords() {
    for (let row = 0; row < grid.length; row++) {
      let word = "";
      let locations = [];
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col] !== null) {
          word += grid[row][col];
          locations.push([row, col]);
        } else {
          addWord(word, locations);
          word = "";
          locations = [];
        }
      }
      addWord(word, locations); // Add the last word in the row
    }
  }

  function extractVerticalWords() {
    for (let col = 0; col < grid[0].length; col++) {
      let word = "";
      let locations = [];
      for (let row = 0; row < grid.length; row++) {
        if (grid[row][col] !== null) {
          word += grid[row][col];
          locations.push([row, col]);
        } else {
          addWord(word, locations);
          word = "";
          locations = [];
        }
      }
      addWord(word, locations); // Add the last word in the column
    }
  }

  extractHorizontalWords();
  extractVerticalWords();

  return result;
}

function illegalWords(list) {
  let illegalwords = [];
  Object.keys(list).forEach((word) => {
    if (!wordDictionary[word.toLowerCase()]) {
      illegalwords.push(list[word]);
    }
  });
  return illegalwords;
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.on("resetRoom", (room) => {
    if (rooms[room]) {
      console.log(`Resetting room: ${room}`);
      delete rooms[room]; // Remove the room state
    }
  });

  socket.on("joinRoom", ({ room, pname, pnum }) => {
    // Check if the room already exists
    if (rooms[room]) {
      // Check if the room is full
      if (rooms[room].names.length >= rooms[room].pnum) {
        // Room is full, notify the player
        socket.emit("receiveMessage", { message: "Room full" });
        return; // Prevent further processing
      }

      if (pnum) {
        console.log("tried to reset pnum");
        socket.emit("receiveMessage", {
          message:
            "Number of players already set for this game. Leave field blank if you want to join this game",
        });
        return; // Prevent further processing
      }
    } else {
      // Initialize the room if it doesn't exist
      if (!rooms[room]) {
        if (pnum && parseInt(pnum) > 1 && parseInt(pnum) < 5) {
          rooms[room] = {
            tileBag: initializeTileBag(),
            players: {}, // Store each player's grid state
            names: [],
            pnum: parseInt(pnum),
            joined: 0,
          };
        } else {
          socket.emit("receiveMessage", {
            message: "Invalid # of players. 2-4 players allowed",
          });
          return; // Prevent further processing
        }
      }
    }

    // Add player to the room
    socket.join(room);
    rooms[room].names = [...rooms[room].names, pname];
    rooms[room].joined += 1;

    if (
      (rooms[room].names.length == 1 && pnum) ||
      (!pnum && rooms[room].names.length > 1)
    ) {
      console.log("updating rooms");
      socket.emit("updatepnum", rooms[room].pnum);
    }

    io.to(room).emit("updateOps", rooms[room].names);

    if (!rooms[room].players[socket.id]) {
      rooms[room] = {
        ...rooms[room],
        players: {
          ...rooms[room].players,
          [socket.id]: {
            grid: initializeGrid(),
          },
        },
      };
    }

    const names = rooms[room].names;
    io.to(room).emit("receiveMessage", {
      message: names,
      joined: rooms[room].joined,
      pnum: rooms[room].pnum,
    });

    socket.emit("initGame", {
      playerLetters: getRandomLetters(15, room),
      tiles: rooms[room].tileBag,
      grid: rooms[room].players[socket.id].grid,
    });

    io.to(room).emit("updateTileBag", rooms[room].tileBag);
  });

  socket.on("bunch", ({ room, bunchTileRef }) => {
    console.log("bunching...", bunchTileRef);

    rooms[room].tileBag[bunchTileRef.current] += 1;
    io.to(room).emit("updateTileBag", rooms[room].tileBag);
    const letter = getRandomLetters(3, room);
    const type = "b";
    socket.emit("peeldraw", { letter, type });
    io.to(room).emit("updateTileBag", rooms[room].tileBag);
  });

  socket.on("updateGrid", ({ newGridTiles, room, playerLetters }) => {
    if (room && rooms[room]) {
      // Update this player's grid state
      rooms[room].players[socket.id].grid = newGridTiles;
    }
    // console.log(illegalWords(parseCrossword(newGridTiles)));
    const illegal = illegalWords(parseCrossword(newGridTiles));

    socket.emit("wordLegality", { illegal });
  });

  socket.on("sendMessage", (data) => {
    console.log(data);
    socket.broadcast.emit("receiveMessage", data);
  });
  socket.on("peelclicked", ({ room, pname }) => {
    // Get all connected clients in the room
    const clients = io.sockets.adapter.rooms.get(room);
    console.log(
      Object.values(rooms[room].tileBag).reduce(
        (total, count) => total + count,
        0
      )
    );

    if (
      Object.values(rooms[room].tileBag).reduce(
        (total, count) => total + count,
        0
      ) < clients.size
    ) {
      io.to(room).emit("receiveMessage", { message: `${pname} won!!` });
      disconnectAllClientsInRoom(room);
      delete rooms[room];

      return;
    }

    if (clients) {
      clients.forEach((clientId) => {
        const letter = getRandomLetters(1, room); // Draw a unique letter for each player
        io.to(clientId).emit("peeldraw", { letter }); // Send the drawn letter to the specific player
      });
    }
    io.to(room).emit("updateTileBag", rooms[room].tileBag);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    // Optionally clean up the player's data from the room
  });
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Server is running");
});
function disconnectAllClientsInRoom(room) {
  const clients = io.sockets.adapter.rooms.get(room);

  if (clients) {
    clients.forEach((clientId) => {
      const clientSocket = io.sockets.sockets.get(clientId);
      if (clientSocket) {
        clientSocket.disconnect(true);
      }
    });
    console.log(`Disconnected all clients in room: ${room}`);
  } else {
    console.log(`No clients found in room: ${room}`);
  }
}

function getRandomLetters(num, room) {
  const letters = [];
  const tileBag = { ...rooms[room].tileBag }; // Shallow copy of the tile bag

  // Flatten the tile bag into an array
  const flatTiles = [];
  for (const [letter, count] of Object.entries(tileBag)) {
    for (let i = 0; i < count; i++) {
      flatTiles.push(letter);
    }
  }

  // Pick random letters
  for (let i = 0; i < num; i++) {
    if (flatTiles.length === 0) break; // Stop if no more letters are available

    const randomIndex = Math.floor(Math.random() * flatTiles.length);
    const randomLetter = flatTiles[randomIndex];

    letters.push(randomLetter);

    // Remove the selected letter from the flatTiles array
    flatTiles.splice(randomIndex, 1);

    // Update the tile bag immutably
    tileBag[randomLetter] = (tileBag[randomLetter] || 0) - 1;
  }

  // Update the room's tile bag immutably
  rooms[room] = {
    ...rooms[room],
    tileBag: { ...tileBag },
  };

  return letters;
}
