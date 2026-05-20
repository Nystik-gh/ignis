// Obsidian wraps this in try/catch: try{this.btime=window.require("btime")}catch(e){}
// Returning null causes graceful degradation. mtime is used instead.

export const btimeShim = null;
