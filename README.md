# Cardinal Carpool 🌲🚗

Find a Stanford student to share a ride to or from **SFO, SJC, or OAK**.

**Live site:** https://cardinalcarpool.github.io · Admin: https://cardinalcarpool.github.io/admin.html

- Students post their trip. They can check **Leaving Stanford**, **Returning to Stanford**, or both, and each trip gets its own airport, date, time, and airline. They also give a pickup/drop-off dorm, first name, and email and/or phone.
- Everyone can filter rides by direction, airport, date (MM/DD/YYYY), dorm, and a time-of-day slider.
- **Your matches** at the top of the page lists, for each trip you posted, the riders and shuttles going the same direction to the same airport whose times **overlap** yours. Each trip has its own flexibility: how much earlier and later you could leave. It defaults to 1 hr earlier / 15 min later for departures and 15 min earlier / 1 hr later for returns, up to 4.5 hours each way. For example, 8:00 with up to 1 hr later and 9:30 with up to 1 hr earlier match, because 8:30–9:00 works for both. Each match shows the shared time. Shuttles leave at a fixed time, so they match if that time is inside your range.
- People can **edit or remove their own ride** from the same browser (an edit key is stored in `localStorage`).
- **Admin dashboard** (`/admin.html`): add **$5 shuttles** with an order-form link, delete rides, and export CSVs for a mail merge: all emails, or every trip with a match to the same airport and direction within ±30 minutes. That file includes the soonest match's offset, like "10 minutes after".
- "Share the website" by text, email, the phone's share sheet, or a copied link.
- Uses the Stanford identity palette (Cardinal Red, White, Process Black, plus accent colors) and Stanford's typefaces (Source Sans 3 and Source Serif 4).
- A few Easter eggs. 🌲

Made by Samuel for SSS · [sdesai05@stanford.edu](mailto:sdesai05@stanford.edu)

## How it works

| Part | Where it runs |
| --- | --- |
| Website (`index.html`, `admin.html`, `css/`, `js/`) | GitHub Pages (static) |
| Backend (`backend/Code.gs`) | Google Apps Script web app, bound to a Google Sheet |
| Data | The **Rides** tab of that Google Sheet |

While `js/config.js` has no `API_URL`, the site runs in **demo mode**: rides are saved only in your browser.

## Setup (about 10 minutes)

### 1. Backend: Google Sheet + Apps Script

1. Create a new Google Sheet (e.g. "Cardinal Carpool Data").
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with [`backend/Code.gs`](backend/Code.gs).
4. Open **Project Settings** (gear icon), check **Show "appsscript.json" manifest file in editor**, then replace that file's contents with [`backend/appsscript.json`](backend/appsscript.json).
5. Still in **Project Settings → Script properties**, add:
   - `ADMIN_PASSWORD`: your admin password. Keep it out of the repo; it lives only here.
6. Back in the editor, choose the `setup` function and click **Run**, then approve the permission prompt. This creates the **Rides** tab. The script only needs access to this one spreadsheet.
7. Click **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the **Web app URL** (it ends in `/exec`).

### 2. Frontend: connect and publish

1. Paste the URL into [`js/config.js`](js/config.js):
   ```js
   window.CC_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. Commit and push. GitHub Pages serves the site from the `main` branch at https://cardinalcarpool.github.io.

### Updating the backend later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. This keeps the same `/exec` URL.

## Notes and limits

- **Keep the Google Sheet private:** under Share, set General access to Restricted. The script runs as you, so the site works without anyone else having access.
- **Contact info is public:** names, emails, and phone numbers of posted rides are visible to anyone with the link. That's what lets people coordinate, and the form says so.
- **Times are Pacific time.** Rides disappear from the list an hour after their time.
- **Demo-mode admin password:** demo mode checks the password against a SHA-256 hash in `js/api.js`. With a real backend, the password is checked only by Apps Script.

## Local development

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.
