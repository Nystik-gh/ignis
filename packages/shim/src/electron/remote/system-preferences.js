export const systemPreferencesShim = {
  getAccentColor() {
    return "0078d4"; // Default Windows accent blue
  },

  isAeroGlassEnabled() {
    return false;
  },

  getMediaAccessStatus(mediaType) {
    return "granted";
  },

  askForMediaAccess(mediaType) {
    return Promise.resolve(true);
  },

  on() {},
  once() {},
  removeListener() {},
};
