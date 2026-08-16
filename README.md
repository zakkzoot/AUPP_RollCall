# NFC Tap-In Attendance

A self-hostable student attendance system. Each **teacher** gets one NFC tag. A student taps it on arrival; the system works out which lesson is running right now from the teacher's timetable, checks the student is physically there (geofence), and records attendance. First tap on a phone registers the student and binds them to that device — after that it's one tap, no typing.

Built to run entirely on **free tiers**: Supabase (database + auth + edge functions) and Vercel (hosting).

---

## Why NFC instead of a QR code

A QR code can be screenshotted and sent to an absent friend. NFC can't be shared as easily — but the real protection is server-side, not the tag itself. Three checks run in the `checkin` Edge Function and cannot be bypassed from the browser:

1. **Device binding** — a student ID is locked to the first phone it registers on. Entering someone else's ID on your own phone is rejected (`id_already_bound`).
2. **Geofence** — the tap is rejected unless the phone is within the lesson location's radius. Opening a saved link from home fails.
3. **Time window** — a tap only counts during a scheduled lesson (with a short grace period before it starts).

Even if a student shares the check-in URL, the recipient must be a registered device, at the location, during the lesson. For a classroom this is more than enough. (If you ever need cryptographic guarantees, NTAG 424 DNA tags issue a unique code per tap — not required here.)

---

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind, hosted on Vercel.
- **Backend:** Supabase Postgres with Row Level Security. All student check-in traffic goes through a Supabase **Edge Function** using the service role key — students never touch the database directly. Teachers use the Supabase client with their own login; RLS confines them to their own rows.
- **Maps:** Leaflet + OpenStreetMap (free, no API key).
- **One tag per teacher**, enforced by a unique index. Each teacher owns a timetable of weekly recurring lessons, each pointing at either a saved location or a one-off location.

```
Student phone ──tap──> /t/<tag_code>  ──POST──> checkin Edge Function ──> Postgres
Teacher browser ──login──> teacher UI ──(RLS)──> Postgres
                                     └──> export Edge Function (CSV)
```

---

## Setup

You need: a GitHub account, a [Supabase](https://supabase.com) account, a [Vercel](https://vercel.com) account, and the [Supabase CLI](https://supabase.com/docs/guides/cli) installed locally.

### 1. Get the code
```bash
git clone <your-fork-url> nfc-attend
cd nfc-attend
npm install
cp .env.example .env.local   # fill in once you have the values from steps 2 and 4
```

`npm run dev` serves it locally, `npm run build` produces the production bundle. All four variables in `.env.local` are required — if any is missing the app shows a "Setup needed" screen naming the ones it needs rather than failing silently.

### 2. Create the Supabase project
- Create a new project in the Supabase dashboard. Note the **Project URL** and the **anon** and **service_role** keys (Project Settings → API).
- Enable email auth: Authentication → Providers → Email → enabled. (For quick testing, turn off "Confirm email" so you can log in immediately.)

### 3. Apply the database schema
Either paste the files in `supabase/migrations/` into the Supabase SQL editor and run them in order (`0001_init.sql`, then `0002_teacher_profile_trigger.sql`), **or** use the CLI:
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 4. Deploy the Edge Functions
```bash
supabase functions deploy checkin
supabase functions deploy export
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions automatically — no secrets to set. (`GRACE_MIN`, the pre-lesson grace period, is a constant in `checkin/index.ts` if you want to change it.)

Your function URLs will be:
```
https://<project-ref>.supabase.co/functions/v1/checkin
https://<project-ref>.supabase.co/functions/v1/export
```

### 5. Deploy the frontend to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/zakkzoot/AUPP_RollCall&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY,VITE_CHECKIN_FN_URL,VITE_EXPORT_FN_URL&envDescription=Supabase%20URL%2C%20anon%20key%2C%20and%20the%20two%20Edge%20Function%20URLs)

> The button points at zakkzoot/AUPP_RollCall.

Or manually: import the repo in Vercel and set these environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | your Supabase **anon** key |
| `VITE_CHECKIN_FN_URL` | `https://<ref>.supabase.co/functions/v1/checkin` |
| `VITE_EXPORT_FN_URL` | `https://<ref>.supabase.co/functions/v1/export` |

Never set the service_role key here — it belongs only in Edge Functions.

### 6. First run as a teacher
1. Open your deployed site → **Create an account** → set your name and timezone (your timetable times are read in this zone).
2. **Locations** → add the rooms you teach in. Drop a pin (or paste `lat, lng` from Google Maps) and set each room's radius.
3. **Timetable** → add lessons one at a time, or **Import CSV** (download the template first).
4. **My tag** → create your tag and copy its URL.

### 7. Write the NFC tag

Each teacher writes their own tag from the **My tag** page. Two methods, and the page shows whichever fits the device:

- **Direct write (Chrome or Edge on Android):** tap **Write to NFC tag**, then hold a blank tag to the back of the phone. The URL is written straight from the browser — no separate app. This uses the Web NFC API, which is Android-Chrome/Edge only and needs HTTPS (Vercel provides it).
- **App method (iPhone, desktop, or any phone):** copy the tag URL from the page, install the free **NFC Tools** app, then Write → Add a record → URL → paste → hold phone to tag. Optionally lock the tag read-only.

The tag only ever stores the URL. There is no separate file to download — the payload *is* the link, written by one of the two methods above.

**Protect the tag from being overwritten.** Writing the URL doesn't stop a student holding their own phone to the tag and rewriting it — that protection lives on the tag hardware, not in this app, and is set once in NFC Tools (the **Other** tab):

- **Set a password (recommended):** "Set password" requires a password to *write* the tag. Reading (a check-in) stays free, so students can still tap in; only you can change the tag. Keep the password — you need it to rewrite the tag later.
- **Lock permanently:** "Lock tag" makes it read-only forever. Free and simplest, but irreversible — verify the URL first, because a locked tag can never be changed.

The browser's Web NFC write cannot set passwords or lock bits (that low-level tag config isn't exposed to web pages), so this protection step is always done in NFC Tools, once per tag.

### 8. Test
Tap during a scheduled lesson at the right location → register once → tap again → instant check-in against the correct subject. Then try from home to confirm the geofence blocks you, and outside lesson hours to confirm the time window blocks you.

---

## CSV import format

Header row plus one example of each location style:

```csv
subject,day_of_week,start_time,end_time,location_name,override_lat,override_lng,override_radius_m
GCSE Biology,Mon,09:00,10:00,Science Block Room 4,,,
Field Trip Prep,Wed,11:00,12:00,,11.5564,104.9282,80
```

- Use a **saved location** by naming it in `location_name`, leaving the three `override_*` columns blank. The name must already exist under Locations (import never creates locations — they need a real pin and radius).
- Use a **one-off location** by leaving `location_name` blank and filling all three `override_*` columns.
- `day_of_week` accepts `Mon`/`Monday`/`0–6` (0 = Sunday). Times accept `09:00`, `9:00`, or `9am`.
- Import validates every row and shows a preview; only valid rows are written. Exact duplicates are skipped.

---

## Multiple teachers

Every teacher who signs up gets their own tag, timetable, locations, and attendance, isolated by Row Level Security. One deployment serves a whole school. Students are shared across teachers (one device = one student identity), which is what you want — a student registers once and taps any teacher's tag.

---

## Notes & limits

- **Free tier:** comfortably handles a school's check-in volume. The `checkins` table is the one that grows; export and clear old terms if it ever gets large.
- **Location accuracy:** phone GPS is usually good to 5–20 m outdoors, worse indoors. Set radii with a little slack (30–50 m is sensible for a single building).
- **Timezone:** set per teacher at signup. If a teacher moves regions, update it in the database (`teachers.timezone`).
- **Overlapping lessons:** if two lessons overlap in time, the tap is assigned to the one starting nearest to now. Keep slots clean.
- **iPhones:** iPhone XS and newer read NFC tags natively from the lock screen. Very old models need to open NFC Tools first.

---

## Project layout

```
supabase/
  migrations/0001_init.sql        schema + RLS
  migrations/0002_*.sql           auto-create the teacher profile on sign-up
  functions/checkin/index.ts      student check-in (geofence, time, device binding)
  functions/export/index.ts       teacher CSV export (JWT-scoped)
  functions/_shared/utils.ts      haversine, timezone, helpers
src/
  pages/CheckIn.tsx               the student-facing page
  pages/teacher/                  login, dashboard, timetable, locations, tag
  components/MapPicker.tsx        Leaflet pin + radius
  components/TimetableImport.tsx  CSV parse/validate/preview/commit
```

---

## License

MIT — do what you like. No warranty.
