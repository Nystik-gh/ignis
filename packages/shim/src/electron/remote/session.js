export const sessionShim = {
  defaultSession: {
    clearCache() {
      return Promise.resolve();
    },

    clearStorageData() {
      return Promise.resolve();
    },

    setSpellCheckerLanguages(langs) {},
    getSpellCheckerLanguages() {
      return [];
    },

    on() {},
    once() {},
    removeListener() {},
  },
};
