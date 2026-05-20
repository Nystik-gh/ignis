function notAvailable(name) {
  return function () {
    throw new Error(`net.${name}() is not available in the web version.`);
  };
}

export const createServer = notAvailable("createServer");
export const createConnection = notAvailable("createConnection");
export const connect = notAvailable("connect");
export class Socket {
  constructor() {
    throw new Error("net.Socket is not available in the web version.");
  }
}
export class Server {
  constructor() {
    throw new Error("net.Server is not available in the web version.");
  }
}
