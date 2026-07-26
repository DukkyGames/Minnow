# Menubar app switcher

## Goal

Replace the labeled **Desktop** menubar button with an icon-only control that opens a small app grid for quick switching while inside an app.

## Decisions (confirmed)

- [x] Layout: small icon grid (not a list)
- [x] Visibility: hide on Desktop view (dock covers that case)
- [x] App set: same as dock (`listDockApps`), plus a Desktop tile
- [x] Fidelity: production-ready shell chrome
- [x] Pattern: match notifications / update popovers (fixed panel, Escape, outside click)

## Todos

- [x] Shape brief locked from user answers
- [x] Add `src/os/app-switcher-menu.ts`
- [x] Wire icon-only trigger in `src/os/menubar.ts`
- [x] Styles in `src/styles/minnowos-shell.css`
- [x] Unit test for switcher item ordering / Desktop action
- [x] Update `documentation/context.md`

## Interaction

1. In-app menubar shows grid icon (aria-label: Apps).
2. Click opens popover under the button: Desktop first, then dock apps.
3. Current foreground app marked active; Desktop launches via `navigateToDesktop`.
4. Selecting an item closes the popover and launches.
5. Escape / outside click dismisses; opens close other chrome popovers.
