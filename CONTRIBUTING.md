# Contributing to Ignis

Thanks for your interest in contributing. Here are some ways you can help.

## Reporting Plugin Compatibility Issues

Testing plugins and reporting what works (or doesn't) is one of the most valuable contributions right now. When a plugin doesn't work, the browser console usually contains the information needed to diagnose the problem.

### How to file a useful compatibility report

1. Open the browser dev tools (F12 or Ctrl+Shift+I)
2. Go to the **Console** tab
3. Enable the plugin or trigger the failing action
4. Look for errors, especially lines starting with:
   - `[ignis] Unshimmed require: <module>` - a Node.js module the plugin needs that Ignis doesn't provide yet
   - `[shim:MISS] <module>.<property>` - a property or method on a shimmed module that isn't implemented
   - `Plugin failure: <plugin-id>` - Obsidian caught a crash from the plugin
5. Copy the full error including the stack trace

### What to include in the issue

- Plugin name and version
- What you tried to do
- What happened (error, crash, nothing, partial functionality)
- The console output (errors and shim warnings)
- Whether the plugin loads at all or fails immediately

### Example of a useful report

> **Plugin:** Templater v1.18.4
> **Status:** Broken on load
>
> Console shows:
> ```
> [ignis] Unshimmed require: util
> [shim:MISS] UNKNOWN(util).promisify - property not found on shim
> Plugin failure: templater-obsidian TypeError: t is not a function
> ```
>
> The plugin needs `util.promisify` which isn't shimmed yet.

This kind of report makes it straightforward to add the missing shim.

## Code Contributions

In order to avoid wasted work and time for both Maintainer and Contributors, any pull request that is more than a small, self-contained fix (e.g. a missing shim property, a typo, a broken link) must be preceded by a discussion with the Maintainer, in an issue or discussion thread, and have the Maintainer's go-ahead before the work starts. This covers new features, changes to anything documented as a design decision (see [ARCHITECTURE.md](docs/ARCHITECTURE.md)), or changes to the pinned Obsidian version. A pull request that was not agreed in a prior discussion is closed without review.

One fix or feature per pull request. CI configuration, build tooling, and unrelated cleanups are separate pull requests, each requiring its own prior discussion. This includes documentation, unless it is explicitly about the changes in that pull request and written in line with existing documentation formats. Files for the Contributor's own tooling (editor or AI assistant configuration, handoff notes, ignore entries specific to the Contributor's environment) do not belong in a pull request.

Once the approach is agreed:

1. Fork the repo and create a branch for your change
2. Run `npm install` once at the repo root (npm workspaces)
3. Run `npm run dev` to build and start the server
4. Test your change in the browser with at least one vault open
5. Run `npm test` and make sure the whole suite passes
6. Run `npm run lint` and make sure it passes

### Project structure

- `packages/shim/` - Browser shims for Node.js and Electron APIs
- `packages/ui/` - Svelte UI components (vault manager, dialogs)
- `packages/bridge/` - The ignis-bridge Obsidian plugin (settings, file actions)
- `packages/server-core/` - Shared server helpers (path guards, watcher, WebSocket)
- `apps/ignis-server/` - Express server, Docker image
- `apps/ignis-server/server/plugins/` - Server plugin packages (e.g., headless-sync)

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

### Adding a new shim

If a plugin needs a Node.js module that isn't shimmed:

1. Create the shim in `packages/shim/src/node/<module>.js`
2. Export the functions the plugin needs (stub what you can't implement)
3. Register it in `packages/shim/src/require.js` (import + add to `rawRegistry`)
4. Build and test with the plugin that needed it
