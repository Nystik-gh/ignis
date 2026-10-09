const fs = require("fs");

const GIT_DEPENDENCY = { name: "isomorphic-git", version: "1.42.2" };

class GitRepository {
  constructor(implementation) {
    this.git = implementation;
  }

  async initialize(vaultPath, repositoryPath) {
    await this.git.init({
      fs,
      dir: vaultPath,
      gitdir: repositoryPath,
      bare: true,
      defaultBranch: "main",
    });
  }

  async snapshot(vaultPath, repositoryPath, beforeCommit) {
    const options = { fs, dir: vaultPath, gitdir: repositoryPath };
    const files = await this.git.statusMatrix(options);

    for (const [filepath, head, workdir, stage] of files) {
      if (workdir === stage) {
        continue;
      }

      if (workdir === 0) {
        await this.git.remove({ ...options, filepath });
      } else {
        await this.git.add({
          ...options,
          filepath,
          // Git keeps tracking files that are subsequently ignored.
          force: head !== 0 || stage !== 0,
        });
      }
    }

    const staged = await this.git.statusMatrix(options);
    const committed = staged.some(([, head, , stage]) => head !== stage);
    await beforeCommit();

    if (committed) {
      await this.git.commit({
        ...options,
        message: `Vault backup: ${new Date().toISOString()}`,
        author: { name: "Ignis", email: "ignis@localhost" },
      });
    }

    let oid;

    try {
      oid = await this.git.resolveRef({ ...options, ref: "HEAD" });
    } catch (e) {
      if (e.code !== "NotFoundError") {
        throw e;
      }

      return { committed, lastCommit: null, lastCommitAt: null };
    }

    const { commit } = await this.git.readCommit({ ...options, oid });
    return {
      committed,
      lastCommit: oid,
      lastCommitAt: new Date(commit.committer.timestamp * 1000).toISOString(),
    };
  }
}

module.exports = { GIT_DEPENDENCY, GitRepository };
