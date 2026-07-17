const fs = require("fs");

// Binds the app to config.socketPath (unix domain socket) or config.port (TCP).
function listen(app, config, onReady) {
  if (config.socketPath && fs.existsSync(config.socketPath)) {
    fs.unlinkSync(config.socketPath); // stale socket from an unclean shutdown blocks the bind
  }
  return app.listen(config.socketPath ?? config.port, () => {
    if (config.socketPath) {
      fs.chmodSync(config.socketPath, 0o666); // a reverse proxy runs as another user
    }
    if (onReady) onReady();
  });
}

// Removes the socket file after the server closes.
function cleanup(config) {
  if (config.socketPath && fs.existsSync(config.socketPath)) {
    fs.unlinkSync(config.socketPath);
  }
}

module.exports = { listen, cleanup };
