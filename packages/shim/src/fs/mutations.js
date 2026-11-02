import { markSentOp } from "./echo-guard.js";
import { enqueueMutation } from "./write-coalescer.js";
import { dropRetries, retryNow, trackWrite } from "./write-durability.js";
import { isPathInSubtree } from "../util/path.js";
import { utf8ByteLength } from "../util/utf8.js";

export function createMutations(metadataCache, contentCache, transport) {
  function entriesUnder(path) {
    return metadataCache
      .keys()
      .filter((key) => isPathInSubtree(key, path))
      .map((key) => ({
        key,
        meta: metadataCache.get(key),
        content: contentCache.get(key),
      }));
  }

  function stampUpdates(entries) {
    for (const entry of entries) {
      entry.updates = contentCache.pathUpdates(entry.key);
    }
  }

  function restore(removed, added) {
    const untouched = removed.filter(
      ({ key, updates }) => contentCache.pathUpdates(key) === updates,
    );

    for (const { key, meta, content } of added) {
      if (metadataCache.get(key) === meta) {
        metadataCache.delete(key);
      }

      if (content !== null && contentCache.get(key) === content) {
        contentCache.delete(key);
      }
    }

    for (const { key, meta, content } of untouched) {
      const setAgain = metadataCache.has(key);

      if (setAgain) {
        continue;
      }

      metadataCache.set(key, meta);

      if (content !== null) {
        contentCache.set(key, content);
      }
    }
  }

  function cacheStamp(path) {
    return {
      meta: metadataCache.get(path),
      contentUpdates: contentCache.pathUpdates(path),
    };
  }

  function refreshUnlessChanged(path, stamp) {
    return transport.stat(path).then((meta) => {
      if (contentCache.pathUpdates(path) === stamp.contentUpdates) {
        contentCache.invalidate(path);
      }

      if (metadataCache.get(path) === stamp.meta) {
        metadataCache.set(path, meta);
      }
    });
  }

  function existsOnServer(path) {
    return transport.stat(path).then(
      () => true,
      (e) => e.code !== "ENOENT",
    );
  }

  function send(paths, request, order) {
    return enqueueMutation(
      paths,
      () => {
        for (const path of paths) {
          markSentOp(path);
        }

        return request();
      },
      order,
    );
  }

  function commitRemove(path, request) {
    const removed = entriesUnder(path);

    markSentOp(path);

    for (const key of metadataCache.deleteSubtree(path)) {
      contentCache.delete(key);
    }

    stampUpdates(removed);

    return send([path], request, { supersededPaths: [path] }).catch((e) => {
      const goneOnServer = e.code === "ENOENT";

      if (goneOnServer) {
        dropRetries(path);
      } else {
        restore(removed, []);
      }

      throw e;
    });
  }

  function commitRename(from, to, request) {
    markSentOp(from);
    markSentOp(to);

    if (from === to) {
      return send([from], request, {});
    }

    const moved = entriesUnder(from);
    const replaced = entriesUnder(to);
    const added = moved.map(({ key, meta, content }) => ({
      key: to + key.slice(from.length),
      meta,
      content,
    }));

    for (const key of metadataCache.rename(from, to)) {
      contentCache.delete(key);
    }

    for (const { key } of moved) {
      contentCache.delete(key);
    }

    for (const { key, content } of added) {
      if (content !== null) {
        contentCache.set(key, content);
      }
    }

    stampUpdates([...moved, ...replaced]);

    return send([from, to], request, {
      supersededPaths: [to],
      dependentPaths: [from],
    }).catch(async (e) => {
      // Verify the file being renamed actually exists.
      const sourceExists = e.code !== "ENOENT" || (await existsOnServer(from));

      restore(sourceExists ? [...moved, ...replaced] : replaced, added);
      throw e;
    });
  }

  function appendToCaches(path, data) {
    const meta = metadataCache.get(path);
    const content = contentCache.get(path);
    const contentUnknown = meta && content === null;

    if (
      typeof data !== "string" ||
      meta?.type === "directory" ||
      contentUnknown
    ) {
      contentCache.invalidate(path);
      return null;
    }

    const appended = meta ? joinContent(content, data) : data;
    const size =
      typeof appended === "string"
        ? utf8ByteLength(appended)
        : appended.byteLength;

    metadataCache.set(path, {
      type: "file",
      size,
      mtime: Date.now(),
      ctime: meta?.ctime || Date.now(),
    });
    contentCache.set(path, appended);

    return appended;
  }

  function retryAsWrite(path, content, meta, opts, error) {
    trackWrite(path, opts).failure(
      content,
      undefined,
      (result) => {
        if (metadataCache.get(path) !== meta) {
          return;
        }

        metadataCache.set(path, {
          ...meta,
          size: result.size || meta.size,
          mtime: result.mtime,
        });
      },
      error,
    );
  }

  function commitAppend(path, data, request, opts) {
    markSentOp(path);

    const appended = appendToCaches(path, data);
    const stamp = cacheStamp(path);

    return enqueueMutation([path], () =>
      retryNow(path)
        .then(() => {
          markSentOp(path);

          return request();
        })
        .then(
          () => refreshUnlessChanged(path, stamp),
          (e) => {
            if (appended === null) {
              throw e;
            }

            retryAsWrite(path, appended, stamp.meta, opts, e);
          },
        ),
    );
  }

  function copyToCaches(src, dest) {
    const content = contentCache.get(src);
    const srcMeta = metadataCache.get(src);
    const meta = srcMeta ? { ...srcMeta } : null;

    if (content !== null) {
      contentCache.set(dest, content);
    } else {
      contentCache.delete(dest);
    }

    if (meta) {
      metadataCache.set(dest, meta);
    }

    return { key: dest, meta, content };
  }

  function commitCopy(src, dest, request) {
    const replaced = entriesUnder(dest).filter(({ key }) => key === dest);

    markSentOp(dest);

    const copied = copyToCaches(src, dest);
    const stamp = cacheStamp(dest);

    stampUpdates(replaced);
    let copiedOnServer = false;

    return enqueueMutation(
      [src, dest],
      () => {
        markSentOp(dest);

        return request().then(() => {
          copiedOnServer = true;

          return refreshUnlessChanged(dest, stamp);
        });
      },
      { supersededPaths: [dest], dependentPaths: [src] },
    ).catch((e) => {
      if (!copiedOnServer) {
        restore(replaced, [copied]);
      }

      throw e;
    });
  }

  return { commitAppend, commitCopy, commitRemove, commitRename };
}

function joinContent(content, data) {
  if (typeof content === "string") {
    return content + data;
  }

  const added = new TextEncoder().encode(data);
  const joined = new Uint8Array(content.byteLength + added.byteLength);

  joined.set(content);
  joined.set(added, content.byteLength);

  return joined;
}
