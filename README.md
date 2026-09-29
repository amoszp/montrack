# 🏔️ Montrack

**Montrack** is a Progressive Web App (PWA) designed to quickly and efficiently manage work schedules by tracking **who worked, when, and for how many hours**.

It has been designed with a **mobile-first** approach, prioritizing speed, simplicity, and an intuitive user experience. All data is stored locally on the device, allowing the application to work completely offline.

---

# ✨ Features

- 📅 Monthly and weekly calendar views
- 👥 Unlimited worker management
- 🌗 Configurable shifts (Mañana, Tarde, Noche… or your own) with fixed payment per shift
- ⏱️ Assign one or several shifts to a worker on one or multiple days at once
- 🔄 Default hours per shift
- ✏️ Edit any assignment at any time
- 📊 Worker statistics and work history
- 📄 Export reports (PDF, Excel, TXT), with preview and sharing
- 💾 Backup and restore data (JSON)
- 📱 Installable as a PWA on Android, iPhone and Desktop
- 🌐 Fully offline
- ⚡ Fast, lightweight and optimized for daily use

---

# 📱 Installation

Montrack is a **Progressive Web App**, meaning it can be installed like a native application without using the Play Store or App Store.

### Android

1. Open Montrack in Google Chrome.
2. Tap the **Install App** prompt or open the browser menu.
3. Select **Install** or **Add to Home Screen**.
4. Montrack will appear in your app drawer like any other app.

### iPhone

1. Open Montrack in Safari.
2. Tap the **Share** button.
3. Select **Add to Home Screen**.
4. Launch it directly from your home screen.

---

# 🚀 Getting Started

## 1. Add your workers

Open the **Trabajadores** section and create all the workers you want to manage.

Each worker stores:

- Name
- Automatically assigned color

A worker has no fixed shift: the shift is chosen every time they are assigned to a day.

---

## 2. Assign work

The Calendar is the main screen of the application.

Simply:

1. Tap a day (or tap a worker to pick several days).
2. Select the worker.
3. Tick one or more shifts (for example Mañana + Noche).
4. Adjust the hours if needed (optionally save them as the shift default).
5. Press **Guardar turnos**.

The selected shifts are assigned on every selected day. The same shift cannot be added twice to the same worker on the same day.

## Shifts and payments

Shifts are configured in **Ajustes → Configuración de turnos** (name, usual hours, payment). Payment is fixed per shift and does not depend on the hours worked. Every assignment stores a snapshot of the shift name and payment, so changing a shift later never changes past records.

---

## 3. Edit assignments

Tap any calendar day.

A modal window opens showing:

- Assigned workers and each of their shifts
- Hours and payment of every shift
- Edit options
- Delete a single shift (with confirmation)
- Add worker button

When a worker's last shift of the day is deleted, they disappear from that day.

Everything in the application is editable.

Nothing is permanent.

---

# 📊 History

The History section provides statistics for every worker.

Available information includes:

- Total worked hours
- Total worked days
- Average daily hours
- Hours worked this week
- Hours worked this month
- Hours worked this year
- First recorded day
- Last recorded day

You can also browse the complete chronological history.

Filters are available by:

- Week
- Month
- Year
- Custom date range

---

# 📄 Exporting

Montrack supports several export formats.

### PDF

Professional report designed for printing and sharing.

Includes:

- Worker information
- Selected period
- Total days worked
- Total hours
- Average hours
- Detailed work table

### Excel (.xlsx)

Perfect for calculations and external reporting.

Includes:

- Dates
- Workers
- Hours
- Totals
- Filters

### TXT

A simple, human-readable report per worker.

### JSON

Creates a complete backup of the application (workers, shifts, assignments and their payment snapshots).

This file can later be imported to restore every worker and assignment exactly as they were.

---

# 🔔 Monthly Reminder

At the beginning of every new month, Montrack reminds you to export the previous month's records.

Available actions:

- Export PDF
- Export Excel
- Export JSON
- Remind me later
- Already exported

This helps prevent accidental data loss.

---

# 💾 Storage

All information is stored locally on your device using LocalStorage.

No accounts.

No servers.

No internet connection required.

If storage usage approaches the browser limit, Montrack will notify you before any issue occurs and will recommend exporting and removing older months if necessary.

No data is ever deleted automatically.

---

# 🎨 Design Principles

Montrack has been built around a few simple principles:

- Minimal interface
- Fast interaction
- Consistent typography
- Clean spacing
- Mobile-first experience
- No unnecessary complexity

The application intentionally avoids excessive colors and visual clutter, allowing users to focus entirely on recording work quickly.

---

# 🛠️ Technology Stack

- React
- TypeScript
- Vite
- jsPDF
- date-fns
- LocalStorage
- Progressive Web App (PWA)

---

# 🔮 Future Improvements

The architecture has been designed to allow future features such as:

- Dark Mode
- Cloud synchronization
- Notifications
- Advanced reports
- Search
- Additional worker information

without requiring a major refactor.

---

# 🧪 Development

```bash
npm install
npm run dev      # development server
npm test         # business-logic tests (migration, payments, exports)
npm run build    # production build with PWA service worker
```

Data saved by older versions (workers with a fixed day/night type) is migrated automatically on first launch; an untouched copy of the old data is kept in LocalStorage under `montrack-data-v1-backup`.

---

# 📜 License

This project has been developed exclusively for the Montrack application.

---

**Montrack**

*Simple work tracking. Fast enough for every day.*
