# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install          # Install all dependencies
bun dev              # Build packages + start all watchers + Next.js at http://localhost:3000
bun build            # Production build of all packages via Turbo
bun check            # Biome lint + format check (run before committing)
bun check:fix        # Auto-fix lint and format issues
bun check-types      # TypeScript type checking across all packages
bun kill             # Kill any process on port 3002
```

Always run `bun dev` from the **root directory** so package watchers for `core` and `viewer` are active — edits to those packages won't hot-reload in the editor app otherwise.

There is **no test suite**. Correctness is validated via `bun check-types` and `bun check`.

## Architecture Overview

This is a Turborepo monorepo (Bun 1.3.0) for a 3D building editor built with React Three Fiber and WebGPU. Three tiers with strict import discipline:

```
packages/core/     → packages/viewer/     → apps/editor/
(no UI, no Three)    (rendering only)       (full app)
```

**`@pascal-app/core`** — Node schemas (Zod), three Zustand stores, geometry systems (no Three.js), spatial grid, typed event bus. Published to npm.

**`@pascal-app/viewer`** — React Three Fiber canvas, renderers for each node type, viewer-specific systems, post-processing. Published to npm. Must never import from `apps/editor`.

**`apps/editor`** — Next.js app. All editor tools, the editor `useEditor` store, editor-specific systems and selection manager. Injected into the viewer via `<Viewer>` children.

### Three Zustand Stores

| Store | Package | State |
|-------|---------|-------|
| `useScene` | `@pascal-app/core` | All nodes, dirty set, CRUD. Persisted to IndexedDB. Undo/redo via Zundo. |
| `useViewer` | `@pascal-app/viewer` | Selection path, camera mode, level display mode, theme, display toggles. |
| `useEditor` | `apps/editor` | Active tool, phase (site/structure/furnish), structure layer, UI state. |

Outside React (callbacks, systems), use `.getState()`: `useScene.getState().nodes[id]`.

### Node System

Every entity in the scene is a **node** — a Zod-validated object extending `BaseNode`:

```ts
{ id, type, parentId, visible, name?, metadata }
```

Node hierarchy: `Site → Building → Level → (Wall, Slab, Ceiling, Roof, Zone, Scan, Guide, Item, Door, Window, ...)`

Nodes live in a **flat dictionary** (`Record<id, AnyNode>`), not a nested tree. Always create nodes with `.parse()` — never construct plain objects manually:

```ts
const wall = WallNode.parse({ start: [0, 0], end: [5, 0] })
useScene.getState().createNode(wall, levelId)
```

Adding a new node type: define schema in `packages/core/src/schema/nodes/`, add to the `AnyNode` union in `types.ts`, then add a renderer in `packages/viewer/src/components/renderers/`.

### Renderer → System Data Flow

1. **Renderer** (in `packages/viewer`) creates a placeholder mesh, calls `useRegistry(node.id, type, ref)` to register in the scene registry, and spreads `useNodeEvents(node, type)` onto the mesh for pointer events.
2. **`createNode`/`updateNode`** marks the node dirty in `useScene.dirtyNodes`.
3. **System** (a `return null` React component using `useFrame`) detects dirty nodes, looks up the mesh via `sceneRegistry.nodes.get(id)`, updates geometry, clears the dirty flag.

Core systems (`packages/core/src/systems/`) contain pure geometry logic — no Three.js imports. Viewer systems (`packages/viewer/src/systems/`) can access `sceneRegistry` and Three.js objects but must not contain domain logic.

### Event Bus

Global typed `mitt` instance. Renderers **only emit** (via `useNodeEvents`); tools and selection managers **only listen**.

Event format: `<nodeType>:<suffix>` — e.g. `wall:click`, `item:enter`, `grid:pointerdown`.

```ts
useEffect(() => {
  const handler = (e: WallEvent) => { ... }
  emitter.on('wall:click', handler)
  return () => emitter.off('wall:click', handler)  // always clean up with same ref
}, [])
```

### Scene Registry

Global mutable map: node ID → `THREE.Object3D`. Registered synchronously (`useLayoutEffect`) by renderers. Used for O(1) lookups by systems and selection managers — never traverse the scene graph.

```ts
const obj = sceneRegistry.nodes.get(nodeId)
for (const id of sceneRegistry.byType.wall) { ... }
```

Core systems must not use the registry — they work with plain node data only.

### Selection System (Two Layers)

**Viewer `SelectionManager`** (`packages/viewer`) — hierarchical: Building → Level → Zone → Elements. Stores path in `useViewer`.

**Editor `SelectionManager`** (`apps/editor`) — phase-aware, replaces the viewer's default by being injected as a child of `<Viewer>`. Do not add phase/tool logic to the viewer's manager.

`useViewer` is the single source of truth for selection. Outliner arrays (`outliner.selectedObjects`) are mutated in-place for performance — do not assign new arrays.

### Viewer Isolation

The viewer must never import from `apps/editor`. Editor-specific behaviour is injected as children or props:

```tsx
<Viewer theme="light" onSelect={...}>
  <ToolManager />          {/* editor-only, injected as child */}
  <MyEditorSystem />
</Viewer>
```

Before adding code to `packages/viewer`, ask: does this make sense in a read-only embed? If not, keep it in `apps/editor`.

### Tools

Tools live in `apps/editor/components/tools/`. Each is a React component activated by `ToolManager` based on `useEditor` state. Tools mutate `useScene` directly — no Three.js API calls. Preview/ghost geometry lives in the tool component, not the scene store. Clean up transient nodes on unmount.

### Three.js Layers

| Constant | Value | Usage |
|----------|-------|-------|
| `SCENE_LAYER` | 0 | All regular scene geometry (default) |
| `EDITOR_LAYER` | 1 | Grid, tool previews, cursor meshes — hidden from thumbnail camera |
| `ZONE_LAYER` | 2 | Zone fills — rendered in a separate post-processing pass |

Never hardcode layer numbers. `SCENE_LAYER`/`ZONE_LAYER` are exported from `@pascal-app/viewer`; `EDITOR_LAYER` is in `apps/editor/lib/constants`.

### Spatial Queries

Before committing a placed item, validate with `useSpatialQuery()`:

```ts
const { canPlaceOnFloor, canPlaceOnWall, canPlaceOnCeiling } = useSpatialQuery()
const { valid, adjustedY } = canPlaceOnWall(levelId, wallId, x, y, dims, 'wall', undefined, [item.id])
```

Always pass `[item.id]` in `ignoreIds` for draft items already in the scene. Use `adjustedY` from `canPlaceOnWall` — not the raw cursor Y.

## Key Files

| Path | Purpose |
|------|---------|
| `packages/core/src/schema/nodes/` | Zod node type definitions |
| `packages/core/src/store/use-scene.ts` | Main scene store |
| `packages/core/src/events/bus.ts` | Global event emitter |
| `packages/core/src/hooks/scene-registry/` | Registry hook + global map |
| `packages/core/src/systems/` | Geometry/logic systems (no Three.js) |
| `packages/viewer/src/components/renderers/` | One renderer per node type |
| `packages/viewer/src/components/viewer/index.tsx` | Viewer mount order (systems after renderers) |
| `packages/viewer/src/store/use-viewer.ts` | Viewer state |
| `apps/editor/components/tools/` | All editor tools |
| `apps/editor/components/tools/tool-manager.tsx` | Tool activation by phase+mode |
| `apps/editor/components/editor/selection-manager.tsx` | Editor-aware selection |
| `apps/editor/store/use-editor.ts` | Editor state |
