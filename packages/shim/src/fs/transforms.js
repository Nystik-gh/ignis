// FS shim translation registry.
// Path resolvers map logical paths to physical paths; read transforms post-process bytes after a read; write transforms pre-process bytes before a write.
// All hooks run at the shim's public surface, so caches and transport see only physical paths and as-stored bytes.

import { normalize } from "../util/path.js";

// --- Path resolvers ---

const pathResolvers = [];

export function registerPathResolver(matcher, resolver) {
  pathResolvers.push({ matcher, resolver });
}

// resolved is the physical path.
// redirected is true when a path resolver sent the request to a different path.
export function resolvePathInfo(path) {
  const norm = normalize(path);

  for (const { matcher, resolver } of pathResolvers) {
    try {
      if (matcher(norm)) {
        const resolved = resolver(norm);

        if (typeof resolved === "string" && normalize(resolved).length > 0) {
          return { resolved: normalize(resolved), redirected: true };
        }
      }
    } catch {}
  }

  return { resolved: norm, redirected: false };
}

export function resolvePath(path) {
  return resolvePathInfo(path).resolved;
}

function addTransform(list, target, fn) {
  const path = typeof target === "function" ? undefined : normalize(target);
  const matches = path === undefined ? target : (p) => p === path;

  list.push({ path, matches, fn });
}

function removeTransform(list, path) {
  const norm = normalize(path);

  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].path === norm) {
      list.splice(i, 1);
    }
  }
}

function transformMatches(entry, norm) {
  try {
    return !!entry.matches(norm);
  } catch {
    return false;
  }
}

function applyTransforms(list, path, data) {
  const norm = normalize(path);
  let result = data;

  for (const entry of list) {
    if (!transformMatches(entry, norm)) {
      continue;
    }

    try {
      result = entry.fn(result, norm);
    } catch {}
  }

  return result;
}

// --- Read transforms ---

const readTransforms = [];

export function registerReadTransform(target, fn) {
  addTransform(readTransforms, target, fn);
}

export function removeReadTransform(path) {
  removeTransform(readTransforms, path);
}

export function applyReadTransform(path, data) {
  return applyTransforms(readTransforms, path, data);
}

// --- Write transforms ---

const writeTransforms = [];

export function registerWriteTransform(target, fn) {
  addTransform(writeTransforms, target, fn);
}

export function removeWriteTransform(path) {
  removeTransform(writeTransforms, path);
}

export function applyWriteTransform(path, data) {
  return applyTransforms(writeTransforms, path, data);
}

// Test-only: clear all registered hooks.
export function _reset() {
  pathResolvers.length = 0;
  readTransforms.length = 0;
  writeTransforms.length = 0;
}
