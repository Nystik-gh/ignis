const { WebSocketServer } = require("ws");

//currently unused
function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    console.log("[ws] Client connected");

    ws.on("message", (data) => {
      // TODO: handle watch/unwatch subscriptions from client
      const msg = JSON.parse(data);
      console.log("[ws] Received:", msg);
    });

    ws.on("close", () => {
      console.log("[ws] Client disconnected");
    });
  });

  // TODO: maybe integrate chokidar file watching and broadcast changes

  return wss;
}

module.exports = { setupWebSocket };
