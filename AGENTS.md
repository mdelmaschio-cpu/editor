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

Always run `bun dev` from the **root directory** so package watchers for `core`, `viewer`, and `editor` are active — edits to those packages won't hot-reload in the editor app otherwise.

There is **no test suite**. Correctness is validated via `bun check-types` and `bun check`.

## Architecture Overview

This is a Turborepo monorepo (Bun 1.3.0) for a 3D building editor built with React Three Fiber and WebGPU. Four tiers with strict import discipline:

```
packages/core/     → packages/viewer/     → packages/editor/     → apps/editor/
(no UI, no Three)    (rendering only)       (full editor logic)     (Next.js shell)
```

**`@pascal-app/core`** — Node schemas (Zod), Zustand stores, geometry systems (no Three.js), spatial grid, typed event bus. Published to npm.

**`@pascal-app/viewer`** — React Three Fiber canvas, renderers for each node type, viewer-specific systems, post-processing. Published to npm. Must never import from `packages/editor` or `apps/editor`.

**`@pascal-app/editor`** — The full editor React component (`<Editor />`), all tools, the `useEditor` store, editor-specific systems and selection manager. Published to npm. Must never import from `apps/editor`.

**`apps/editor`** — Thin Next.js app that mounts `<Editor />` from `@pascal-app/editor`. Contains only routing, fonts, and minimal app-level config.

### Three Zustand Stores

| Store | Package | State |
|-------|---------|-------|
| `useScene` | `@pascal-app/core` | All nodes, dirty set, CRUD, collections. Persisted to IndexedDB. Undo/redo via Zundo. |
| `useViewer` | `@pascal-app/viewer` | Selection path, camera mode, level/wall display modes, theme, unit, display toggles. |
| `useEditor` | `@pascal-app/editor` | Active tool, phase (site/structure/furnish), mode, structure layer, view mode, UI state. |

Outside React (callbacks, systems), use `.getState()`: `useScene.getState().nodes[id]`.

### Node System

Every entity in the scene is a **node** — a Zod-validated object extending `BaseNode`:

```ts
{ id, type, parentId, visible, name?, metadata }
```

Node hierarchy:

```
Site
└── Building
    └── Level
        ├── Wall → Door, Window
        ├── Fence
        ├── Slab
        ├── Ceiling → Item (lights)
        ├── Roof → RoofSegment
        ├── Stair → StairSegment
        ├── Zone
        ├── Scan (3D reference)
        ├── Guide (2D reference)
        └── Item (furniture/fixtures)
```

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

Core systems (`packages/core/src/systems/`) contain pure geometry logic — no Three.js imports. Viewer systems (`packages/viewer/src/systems/`) can access `sceneRegistry` and Three.js objects but must not contain domain logic. Editor systems (`packages/editor/src/components/systems/`) handle editor-specific rendering logic (zone labels, edit handles, etc.).

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

**Viewer `SelectionManager`** (`packages/viewer/src/components/viewer/selection-manager.tsx`) — hierarchical: Building → Level → Zone → Elements. Stores selection path in `useViewer`.

**Editor `SelectionManager`** (`packages/editor/src/components/editor/selection-manager.tsx`) — phase- and tool-aware, replaces the viewer's default by being injected as a child of `<Viewer>`. Do not add phase/tool logic to the viewer's manager.

`useViewer` is the single source of truth for selection. The `selection` object has `{ buildingId, levelId, zoneId, selectedIds }`. Outliner arrays (`outliner.selectedObjects`) are mutated in-place for performance — do not assign new arrays.

### Viewer Isolation

The viewer must never import from `packages/editor` or `apps/editor`. Editor-specific behaviour is injected as children or props:

```tsx
<Viewer theme="light" onSelect={...}>
  <ToolManager />          {/* editor-only, injected as child */}
  <SelectionManager />
  <ZoneSystem />
</Viewer>
```

Before adding code to `packages/viewer`, ask: does this make sense in a read-only embed? If not, keep it in `packages/editor`.

### Tools

Tools live in `packages/editor/src/components/tools/`. Each is a React component activated by `ToolManager` based on `useEditor` state. Tools mutate `useScene` directly — no Three.js API calls. Preview/ghost geometry lives in the tool component, not the scene store. Clean up transient nodes on unmount.

The full tool map (phase → tool → component):

| Phase | Tools |
|-------|-------|
| `site` | `property-line` → SiteBoundaryEditor |
| `structure` | `wall`, `fence`, `slab`, `ceiling`, `roof`, `stair`, `door`, `item`, `zone`, `window` |
| `furnish` | `item` → ItemTool |

### useEditor State

Key state in `packages/editor/src/store/use-editor.tsx`:

- `phase`: `'site' | 'structure' | 'furnish'`
- `mode`: `'select' | 'edit' | 'delete' | 'build'`
- `tool`: active tool name (or `null`)
- `structureLayer`: `'zones' | 'elements'`
- `viewMode`: `'3d' | '2d' | 'split'`
- `splitOrientation`: `'horizontal' | 'vertical'`
- `isFloorplanOpen`: boolean
- `isFirstPersonMode`: boolean
- `isPreviewMode`: boolean
- `movingNode`: node currently being moved (items, doors, windows, etc.)

### useViewer State

Key state in `packages/viewer/src/store/use-viewer.ts`:

- `selection`: `{ buildingId, levelId, zoneId, selectedIds }`
- `cameraMode`: `'perspective' | 'orthographic'`
- `levelMode`: `'stacked' | 'exploded' | 'solo' | 'manual'`
- `wallMode`: `'up' | 'cutaway' | 'down'`
- `theme`: `'light' | 'dark'`
- `unit`: `'metric' | 'imperial'`
- `showScans`, `showGuides`, `showGrid`: display toggles
- `walkthroughMode`: boolean
- `readOnly` (on `useScene`): when `true`, all create/update/delete operations are no-ops

### Three.js Layers

| Constant | Value | Usage |
|----------|-------|-------|
| `SCENE_LAYER` | 0 | All regular scene geometry (default) |
| `EDITOR_LAYER` | 1 | Grid, tool previews, cursor meshes — hidden from thumbnail camera |
| `ZONE_LAYER` | 2 | Zone fills — rendered in a separate post-processing pass |

Never hardcode layer numbers. `SCENE_LAYER`/`ZONE_LAYER` are exported from `@pascal-app/viewer`; `EDITOR_LAYER` is in `packages/editor/src/lib/constants.ts`.

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
| `packages/core/src/schema/types.ts` | `AnyNode` union type |
| `packages/core/src/store/use-scene.ts` | Main scene store |
| `packages/core/src/events/bus.ts` | Global event emitter |
| `packages/core/src/hooks/scene-registry/` | Registry hook + global map |
| `packages/core/src/systems/` | Geometry/logic systems (no Three.js) |
| `packages/viewer/src/components/renderers/` | One renderer per node type |
| `packages/viewer/src/components/viewer/index.tsx` | Viewer mount order (systems after renderers) |
| `packages/viewer/src/components/viewer/selection-manager.tsx` | Viewer-level selection |
| `packages/viewer/src/store/use-viewer.ts` | Viewer state |
| `packages/editor/src/index.tsx` | Editor package public exports |
| `packages/editor/src/components/editor/index.tsx` | Main `<Editor />` component |
| `packages/editor/src/components/editor/selection-manager.tsx` | Editor-aware selection |
| `packages/editor/src/components/tools/` | All editor tools |
| `packages/editor/src/components/tools/tool-manager.tsx` | Tool activation by phase+mode |
| `packages/editor/src/components/systems/` | Editor-specific systems (zone labels, roof/stair edit) |
| `packages/editor/src/store/use-editor.tsx` | Editor state |
| `packages/editor/src/lib/constants.ts` | `EDITOR_LAYER` and other editor constants |
| `apps/editor/app/page.tsx` | Thin Next.js shell — mounts `<Editor />` |
