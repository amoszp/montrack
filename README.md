# 🏔️ Montrack

**Montrack** is a Progressive Web App (PWA) designed to quickly and efficiently manage work schedules by tracking **who worked, when, and for how many hours**.

It has been designed with a **mobile-first** approach, prioritizing speed, simplicity, and an intuitive user experience. All data is stored locally on the device, allowing the application to work completely offline.

---

# ✨ Features

- 📅 Monthly and weekly calendar views
- 👥 Unlimited worker management
- ⏱️ Assign worked hours to one or multiple days at once
- 🔄 Individual default hours for each worker
- ✏️ Edit any assignment at any time
- 📊 Worker statistics and work history
- 📄 Export reports (PDF, Excel)
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
- Default working hours
- Automatically assigned color

---

## 2. Assign work

The Calendar is the main screen of the application.

Simply:

1. Tap a worker.
2. Enter the worked hours.
3. Optionally save those hours as the new default.
4. Select one or multiple dates.
5. Confirm.

The worker is assigned to every selected day.

---

## 3. Edit assignments

Tap any calendar day.

A modal window opens showing:

- Assigned workers
- Worked hours
- Edit options
- Delete options
- Add worker button

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

### JSON

Creates a complete backup of the application.

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
- Tailwind CSS
- React Router
- React Hook Form
- Zod
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

# 📜 License

This project has been developed exclusively for the Montrack application.

---

**Montrack**

*Simple work tracking. Fast enough for every day.*
