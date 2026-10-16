# Cardinal Carpool 🌲🚗

Find a Stanford student to share a ride to or from **SFO, SJC, or OAK**.

- Students post their trip. They can check **Leaving Stanford**, **Returning to Stanford**, or both, and each trip gets its own airport, date, time, and airline. They also give a pickup/drop-off dorm, first name, and email and/or phone.
- Everyone can filter rides by direction, airport, date (MM/DD/YYYY), dorm, and a time-of-day slider. **Show matches** jumps to rides within ±1 hour of your trip.
- People can **edit or remove their own ride** from the same browser (an edit key is stored in `localStorage`).
- **Notify me** (opt-in, needs an email): riders pick how far **before** and **after** their time they care about. They're only alerted about rides posted *after* they signed up.
- **Hourly emails**: at the top of every hour, one "you have a new match, check it out" email is BCC'd to every opted-in rider with a new match. Each match triggers at most one alert.
- **Admin dashboard** (`/admin.html`): add **$5 shuttles** with an order-form link, delete rides, pause or resume hourly emails, and send them on demand.
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
| Email | Apps Script `MailApp`, sent from the Google account that deploys the script |

While `js/config.js` has no `API_URL`, the site runs in **demo mode**: rides are saved only in your browser, and emails are logged to the console instead of sent.

## Setup (about 10 minutes)

### 1. Backend: Google Sheet + Apps Script

1. Create a new Google Sheet (e.g. "Cardinal Carpool Data").
2. In the Sheet, open **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with [`backend/Code.gs`](backend/Code.gs).
4. Open **Project Settings** (gear icon), check **Show "appsscript.json" manifest file in editor**, then replace that file's contents with [`backend/appsscript.json`](backend/appsscript.json).
5. Still in **Project Settings → Script properties**, add:
   - `ADMIN_PASSWORD`: your admin password. Keep it out of the repo; it lives only here.
   - `SITE_URL` (optional): your GitHub Pages URL, used for the link in emails. You can also set it from the admin dashboard.
6. Back in the editor, choose the `setup` function and click **Run**. Approve the permissions. This creates the **Rides** tab, authorizes email, and starts the on-the-hour email schedule. A 6-hourly safety check restarts the schedule if it ever stops.
7. Click **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Copy the **Web app URL** (it ends in `/exec`).

### 2. Frontend: connect and publish

1. Paste the URL into [`js/config.js`](js/config.js):
   ```js
   window.CC_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. Commit and push. GitHub Pages serves the site from the `main` branch.

### Updating the backend later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. This keeps the same `/exec` URL.

## Notes and limits

- **Email quota:** Apps Script on a free Gmail account can email about 100 recipients a day, and every BCC address counts. Google Workspace accounts get more. The dashboard shows how many are left. If the limit is hit, waiting alerts go out in the next hour once quota is available.
- **Sender:** emails come from the Google account that runs the script. Use a dedicated Gmail account; an Outlook account can't run Apps Script. Replies go to sdesai05@stanford.edu.
- **Contact info is public:** names, emails, and phone numbers of posted rides are visible to anyone with the link. That's what lets people coordinate, and the form says so.
- **Times are Pacific time.** Rides disappear from the list an hour after their time.
- **Demo-mode admin password:** demo mode checks the password against a SHA-256 hash in `js/api.js`. With a real backend, the password is checked only by Apps Script.

## Local development

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.
