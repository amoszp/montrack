# Montrack

Montrack is a local-first PWA for fast attendance logging. The React/TypeScript UI is divided into calendar, history, workers and settings views. A small storage layer persists workers and assignments in LocalStorage; data is normalized around `Worker` and `Assignment` records, so future sync or reporting can be added without reshaping UI state.

The mobile-first design uses a restrained blue palette, spacious cards, and an always-present bottom navigation. Calendar actions open a focused day sheet; worker entries can be added, edited, or removed in place. History derives totals from assignments, while Settings provides JSON backup and clear export affordances.

The PWA includes a manifest and a cache-first service worker for core offline launch. Exports are represented by user-visible controls in this prototype; JSON backup/import is fully wired. Worker colors come from a fixed set of blue shades for consistent identity. LocalStorage usage is measured from serialized records and the architecture keeps all persistence behind the storage module.
