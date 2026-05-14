# Mobile login debug — support & escalation

**Goals:** Same Supabase project and predictable login behavior as web; **separate real auth errors** from **post-login gates** (phone verification, VerifyAccount, etc.).

*Fingerprints only in tickets/chat; full keys in private or 1Password.*

---

## Confirm before debugging (fingerprints only)

| Check | Action |
|-------|--------|
| **Project alignment** | Running app must use **`https://sjmmyqeqiigmclcgcadr.supabase.co`** and the **same** anon/publishable key as web (`batasmo_web` → `src/lib/supabaseClient.js`). Compare **first 8 + last 8** characters of the key with web and with **Supabase → Project Settings → API**. |
| **Build channel** | Document which **EAS profile** / which **`.env`** applies to the build under test (**Expo Go** vs **dev client** vs **TestFlight / Play**). Secrets can differ from local `.env`; confirm which config is **live**. |
| **Failure type** | For a failing login (e.g. Attorney who works on web), capture **Metro/console**: `error.message` (and `status` / `code` if present) from **`signInWithPassword`** inside **`authService.signInWithEmail`** — not only the Alert text. |
| **Post-login vs password** | If Supabase **succeeds** but the user still sees “Login failed” or is sent to **VerifyAccount** / phone — document that path; it is **not** a bad password. **Attorneys** are **not** subject to client-only phone verification (`needsPhoneVerification` is false when `role` is Attorney in `authService.js`). If something still blocks attorneys, capture it as a separate bug. |

---

## Ask back (minimum for escalation)

One line if they’re busy:

> Please send **Supabase URL hostname** + **key fingerprint** (first 8 / last 8) for **this build**, the exact **`signInWithPassword` `error.message`** from **Metro** (not only the Alert), and confirm whether **Attorney** users hit **client-only** phone verification **after** a successful sign-in.

That is usually enough to decide: **wrong env**, **bad credentials on device**, **lockout**, or **post-login logic**.

Optional: one **screenshot** or **log line** with the raw Supabase error after a failed attempt.

---

## Filled template (typical dev — update when keys/hostname change)

| Field | This repo (dev) |
|-------|-----------------|
| **Hostname** | `sjmmyqeqiigmclcgcadr.supabase.co` |
| **Key fingerprint** | Publishable: first 8 ≈ `sb_publi…`, last 8 ≈ `…fPgC1UuZ` |
| **Where set** | `BatasMoApp/.env` → `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`; optional workspace `.env`; fallbacks in `services/supabaseClient.js` |

---

## Exact failure (fill per incident)

- **User-visible:** Alert title + body (`Login failed`, `Phone verification`, `Account Locked`, `Confirm your email`, …).
- **Raw error:** from `signInWithPassword` in `authService.signInWithEmail` → `error.message`, `error.status`, `error.code` if present.

---

## Code path (quick reference)

| Item | Location |
|------|----------|
| **Login** | `services/authService.js` → **`signInWithEmail`** |
| **UI** | `screens/LoginAndSignup.js`, `screens/Login.js` |
| **Email** | `trim()` + **`toLowerCase()`** before `signInWithPassword` |
| **Lockout** | `check_login_lockout` → `LOCKOUT:{seconds}` |
| **Post-login** | `needsPhoneVerification` only if **not** Attorney and no phone confirm and no email confirm — see `authService.js` |

**`createClient`:** `services/supabaseClient.js` (AsyncStorage, refresh token).

---

## Build / runtime (fill when reporting)

- **Channel:** Expo Go / dev client / TestFlight / Play — _______________
- **Version / commit:** _______________

---

## Server side (optional)

Supabase → **Authentication → Logs**: failed attempt vs successful **web** login for same user.

---

## Documentation map

| Doc | Purpose |
|-----|---------|
| **`batasmo_web/docs/WEB_AUTH_FLOW_FOR_MOBILE.md`** §§1–6 | Web auth **contract** |
| Same file **§7** | Mobile vs web **snapshot** (drift) |
| **`docs/DEBUG_LOGIN_SUPPORT.md`** (this file) | Tickets, fingerprints, escalation **ask-backs** |
| **`docs/README.md`** | Link to web doc; do not duplicate §7 |

**Maintenance:** Update **this file** when `authService`, `LoginAndSignup`, `index.js` bootstrap, or **env** behavior changes. Update **§7** in the web doc when mobile drift changes.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-17 | Initial template from codebase snapshot. |
| 2026-04-17 | Added escalation checklist, ask-back one-liner, Attorney vs post-login, doc map. |
