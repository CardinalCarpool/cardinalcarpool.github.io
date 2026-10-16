# Cardinal Carpool 🌲🚗

Find a Stanford student to share a ride to or from **SFO, SJC, or OAK**.

- Students post their trip: direction, date, time, airport, airline, pickup/drop-off dorm, first name, and email and/or phone.
- Everyone can filter rides by direction, airport, date (MM/DD/YYYY), dorm, and a time-of-day slider.
- People can **edit or remove their own ride** from the same browser (an edit key is stored in `localStorage`).
- **Admin dashboard** (`/admin.html`): add **$5 shuttles** with an order-form link, delete rides, turn automatic emails on or off, and send match emails on demand.
- **Automatic emails**: when someone posts or edits a ride, or a shuttle is added, every rider with the same airport and direction within **30 minutes** gets one email listing their new matches. Each match is emailed once.
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
6. Back in the editor, choose the `setup` function and click **Run**. Approve the permissions; this creates the **Rides** tab and authorizes email sending.
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

- **Email quota:** consumer Gmail accounts can send about 100 emails a day from Apps Script; Google Workspace accounts get more. The dashboard shows how many are left today.
- **Contact info is public:** names, emails, and phone numbers of posted rides are visible to anyone with the link. That's what lets people coordinate, and the form says so.
- **Times are Pacific time.** Rides disappear from the list an hour after their time.
- **Demo-mode admin password:** demo mode checks the password against a SHA-256 hash in `js/api.js`. With a real backend, the password is checked only by Apps Script.

## Local development

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.
