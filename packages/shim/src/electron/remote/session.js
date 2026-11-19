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

  fromPartition() {
    return {
      clearStorageData() {
        return Promise.resolve();
      },

      clearData() {
        return Promise.resolve();
      },
    };
  },
};
