# Accessibility and keyboard interaction

[日本語版](../../docs_ja/editor/accessibility.md)

The canvas uses one keyboard tab stop and exposes the active Scene element through `aria-activedescendant`. It does not create a tab stop for every node, edge, handle, route point, or group.

## Scene navigation

- `N` / `Shift+N`: next / previous Scene object
- Arrow keys with no movable selection: pan or navigate according to the active canvas mode
- Arrow keys with selected geometry: move by 1 canvas unit
- Shift+Arrow: move by 10 units
- Ctrl/Cmd+A: select all
- Escape: cancel an active gesture/menu/dialog first, otherwise clear selection
- Context Menu key or Shift+F10: open the same menu as right click
- Home or package commands: reset the active label/route control where documented

Handled keys prevent page scrolling. Shortcuts are disabled while an input, textarea, select, contenteditable element, or IME composition owns input.

## Selection and gestures

Plain click replaces selection; Ctrl/Cmd-click toggles; Shift-click adds. Blank-canvas click clears selection. Marquee selection includes geometry within the dragged rectangle and is also available while a structured form requests resource selection.

One pointer or keyboard gesture creates one undo entry regardless of intermediate move events. Escape, pointer cancellation, abort, or invalid drop returns to the exact pre-gesture document.

Group drag, multi-selection drag, resize, endpoint drag, route editing, icon/label movement, align, and distribute all provide keyboard-accessible inspector equivalents.

## Context menus and dialogs

Context menus expose only actions valid for the focused object. Opening a menu does not mutate data. Focus returns to the invoking canvas object after close.

Deletion confirmation is a modal dialog with:

- a descriptive title;
- label-first affected-object list;
- clear destructive and cancel actions;
- trapped focus and Escape cancellation;
- focus return to the canvas after close.

Other validation errors are inline guidance or status/alert messages rather than confirmation dialogs.

## Status and visual targets

Asynchronous operations expose busy/status state. Validation failures use alerts without replacing stable machine diagnostics. Hover-only information such as comments is also keyboard-focus accessible.

Resize handles, waypoint controls, curve handles, endpoint halos, and hit paths preserve a usable screen-space size under zoom. Their transient visual elevation never changes persistent object layering.

Color is not the sole carrier of selection, warning, relation category, or membership. Templates and terminal markers have text or shape alternatives.

## Host responsibilities

The host provides an accessible label for the editor region, a finite block size, usable surrounding focus order, and accessible save/navigation controls. It must not intercept editor keyboard events that the package has handled or hide package status and dialogs from assistive technology.
