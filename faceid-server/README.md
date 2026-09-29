# FaceID proxy (Megvii)

Implements Megvii FaceID **`get_biz_token`** (with your uploaded ID as `image_ref1`) and **`verify`** (MegLive SDK output → Megvii). Your mobile app must never contain `FACEID_API_SECRET`.

## Setup

1. Copy `.env.example` to `.env` and set **`FACEID_API_KEY`** and **`FACEID_API_SECRET`** from the **FaceID** console (they may differ from Face++ Open Platform keys).
2. `npm install` then `npm start` (default port **4001**).
3. Merge these routes into **batasmo-web** (same paths: `/faceid/biz-token`, `/faceid/verify`, **`/faceplus/detect`**, **`/faceplus/compare`**) or put this service behind your gateway.

## Didit (notarial — replaces Face++)

Set in `.env`:

- `DIDIT_API_KEY` — from Didit console → Developers → API Keys
- `DIDIT_WORKFLOW_ID` — from Workflows (KYC: ID + liveness + face match)
- `DIDIT_CALLBACK_URL` — default `batasmoapp://didit-callback`

| Route | Purpose |
|-------|---------|
| `GET /didit/health` | `{ configured: true }` when key + workflow are set |
| `POST /didit/session` | Body: `{ vendor_data? }` → `{ session_id, url }` |
| `GET /didit/session/:id` | Poll approval status |

Mobile: `EXPO_PUBLIC_DIDIT_PROXY_URL=https://batasmo-web.onrender.com` (routes merged in `Web/backend` — see `Web/backend/DIDIT_RENDER_DEPLOY.md`). Local dev: `http://YOUR_LAN_IP:4001` or run this folder standalone.

## Face++ proxy (legacy)

Set **`FACEPLUS_API_KEY`** and **`FACEPLUS_API_SECRET`** in this service `.env` (server only — do not ship in the APK).

| Route | Purpose |
|-------|---------|
| `GET /faceplus/health` | `{ configured: true }` when keys are set |
| `POST /faceplus/detect` | Body: `{ imageBase64, returnAttributes? }` |
| `POST /faceplus/compare` | Body: `{ imageBase64_1, imageBase64_2 }` |

All Face++ calls are **queued** on the server so multiple testers (panel APKs) do not hit `CONCURRENCY_LIMIT_EXCEEDED`.

Mobile: set **`EXPO_PUBLIC_FACEPLUS_PROXY_URL`** to this API base (or use **`EXPO_PUBLIC_BATASMO_WEB_API_URL`** if routes are merged there). Keep **`EXPO_PUBLIC_FACEPLUS_USE_PROXY=1`** (default).

## Mobile

- Point **`EXPO_PUBLIC_BATASMO_WEB_API_URL`** at the host that serves the FaceID routes (same base as `/verify-identity`).
- Implement **`NativeModules.BatasMoMegLive.startLiveness(bizToken)`** using Megvii’s MegLive SDK; return `{ megliveFileUri }` for `POST /faceid/verify`.
- Enable **`EXPO_PUBLIC_FACEID_LIVENESS_ENABLED=true`** after the native module exists.

## References

- [get_biz_token](https://faceid.com/faceid-open-doc/docs/idverify-api-getbiztoken.html)
- [verify](https://faceid.com/faceid-open-doc/docs/idverify-api-verify.html)
