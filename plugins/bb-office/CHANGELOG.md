# Changelog

## Unreleased

## 1.0.0 — 2026-09-01

- Made expansion and collapse animate from one immutable worker anchor, fixing position drift across mode changes.
- Added aspect-locked corner resizing with persistent dimensions and replaced the toolbar with overlay-only move, collapse, and resize controls.
- Moved the office out of the sidebar into a viewport-fixed, draggable desktop panel with edge snapping and per-device position persistence.
- Added a route-aware collapsed state: the current worker on staffed threads, a floorplan icon on the new-thread route, and no control on threads without a present worker.
- Restored BB's native full-height thread list while retaining current-thread highlighting, worker hover/click behavior, and usage posters.
- Added theme-aware provider-usage posters outside the meeting rooms, with bounded hover details and click-through to BB Usage settings.
- Added host-aware usage reads, privacy normalization, request coalescing, and a two-minute refresh without changing worker hover or office behavior.
- Added the live BB thread office visualization with stable worker placement and navigation.
- Added stable workstations, related-thread meeting rooms, lounges, overflow behavior, entrance and exit movement, hover identity, click-through navigation, current-thread highlighting, quiet motion, responsive sizing, and BB-aware light/dark appearance.
- Added global, revisioned office configuration through RPC, realtime updates, `bb office`, and the native `configure_bb_office` agent tool.
- Added the bundled `bb-office-customization` skill with a safe inspect → preview → approve → apply workflow.
- Added exact Hugeicons `FloorPlanIcon` branding and the collapsed-office control.
- Added pinned Pixel Agents engine/art attribution, managed-install asset resolution, and production packaging checks.
