# BatasMo — Identity verification HTTP API (for web backend)

**Base URL:** Same host the mobile app uses as `EXPO_PUBLIC_BATASMO_WEB_API_URL` (e.g. `https://batasmo-web.onrender.com`). All paths below are **relative to that origin** (no `/api` prefix unless your deployment adds one — align with existing `/verify-identity` routing).

**Reference implementation:** `faceid-server/index.js` in this repo (merge these routes into your main Node service or run this package).

---

## 1. Legacy — Photo vs government ID

### `POST /verify-identity`

Compares a **selfie** (base64) to the **uploaded ID image** (base64). Used when MegLive is not enabled or as fallback.

| Item | Value |
|------|--------|
| **Content-Type** | `application/json` |

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selfieBase64` | string | Yes | Selfie image as **raw base64** (no `data:image/...;base64,` prefix). |
| `idBase64` | string | Yes | Government ID image as **raw base64** (same rule). |

**Success response** (`200`, JSON)

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | Whether the backend considers the faces a match. |
| `confidence` | number | Match score (app treats **≥ 75** as pass together with `verified`). |
| `isIdentical` | boolean | Optional; same idea as `verified` depending on Face++/Azure. |

**Error response:** JSON with `error` string; non-2xx status.

**Backend notes:** Server typically uses **Face++** if `FACEPLUS_API_KEY` / `FACEPLUS_API_SECRET` are set, else **Azure Face** (existing BatasMo-web behavior).

---

## 2. FaceID + MegLive — Liveness + match to ID (upgrade path)

Megvii **FaceID** credentials (`FACEID_API_KEY`, `FACEID_API_SECRET`) are **server-only**. Upstream docs: [get_biz_token](https://faceid.com/faceid-open-doc/docs/idverify-api-getbiztoken.html), [verify](https://faceid.com/faceid-open-doc/docs/idverify-api-verify.html).

### Optional auth (both FaceID routes)

If the server sets `FACEID_MOBILE_SHARED_SECRET`, require:

```http
Authorization: Bearer <FACEID_MOBILE_SHARED_SECRET>
```

Mobile sets **`EXPO_PUBLIC_FACEID_SHARED_SECRET`** to the same value. If unset on server, no `Authorization` header is required.

---

### `POST /faceid/biz-token`

Creates a Megvii session token. Server calls Megvii **`POST {FACEID_API_BASE}/faceid/v3/sdk/get_biz_token`** with **`comparison_type=0`**, **`image_ref1`** = ID image, **`liveness_type=meglive`** (action liveness). The **`biz_token`** is passed into the **MegLive native SDK** on the device.

| Item | Value |
|------|--------|
| **Content-Type** | `application/json` |

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `idBase64` | string | Yes | Government ID image, **raw base64** (no data-URI prefix). |
| `uuid` | string | Yes | Per-session id for this user flow, **max 128 characters**. |

**Success response** (`200`, JSON)

| Field | Type | Description |
|-------|------|-------------|
| `biz_token` | string | Pass to MegLive SDK; short-lived; **one-time use** with verify. |
| `request_id` | string | Optional; Megvii request id. |
| `time_used` | number | Optional; ms. |

**Error response:** JSON with `error` or Megvii `error` field; `503` if FaceID keys not configured on server.

---

### `POST /faceid/verify`

Uploads the **binary package** produced by the MegLive SDK after the user completes liveness. Server calls Megvii **`POST {FACEID_API_BASE}/faceid/v3/sdk/verify`**.

| Item | Value |
|------|--------|
| **Content-Type** | `multipart/form-data` |

**Parts**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `biz_token` | text field | Yes | Same `biz_token` from `/faceid/biz-token`. |
| `meglive_data` | file | Yes | Opaque binary from MegLive — **do not modify** the SDK output. |

**Success response** (`200`, JSON)

Megvii’s JSON plus these **normalized** fields from our proxy:

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | `true` when `result_code === 1000` and attack check passes (`attack_result.result` is not treated as attack). |
| `confidence` | number | From **`verification.ref1.confidence`** (live face vs `image_ref1` / ID). |
| `faceMatchConfidence` | number | Same as `confidence` in reference server. |

Also includes Megvii fields such as `result_code`, `result_message`, `verification`, `attack_result`, `images`, `request_id`, etc.

**Error response:** JSON with `error` / `result_message`; `400` if `biz_token` or file missing.

---

## 3. Health (FaceID service sample)

### `GET /health`

**Response** (`200`)

```json
{ "ok": true, "faceidConfigured": true }
```

`faceidConfigured` is `true` when `FACEID_API_KEY` and `FACEID_API_SECRET` are set.

---

## 4. Server environment variables (FaceID proxy)

| Variable | Required | Description |
|----------|----------|-------------|
| `FACEID_API_KEY` | Yes (for FaceID routes) | FaceID console API key. |
| `FACEID_API_SECRET` | Yes | FaceID API secret. |
| `FACEID_API_BASE` | No | Default `https://api.megvii.com` — change if Megvii assigned another region/base URL. |
| `FACEID_MOBILE_SHARED_SECRET` | No | If set, mobile must send matching `Authorization: Bearer`. |
| `FACEID_LIVENESS_TYPE` | No | Default `meglive`. Alternatives per Megvii: `still`, `flash`, etc. |
| `FACEID_VERBOSE` | No | `0` or `1` — forwarded to get_biz_token if set. |
| `FACEID_SECURITY_LEVEL` | No | `1` \| `2` \| `3` — forwarded if set. |
| `PORT` | No | Default `4001` for standalone `faceid-server`. |

---

## 5. Mobile app behavior (summary)

| Env flag | Effect |
|----------|--------|
| `EXPO_PUBLIC_FACEID_LIVENESS_ENABLED=true` | Use `/faceid/biz-token` → MegLive → `/faceid/verify` when native module exists. |
| `EXPO_PUBLIC_FACEID_ALLOW_LEGACY_FALLBACK` | If not `false`, allows falling back to **`POST /verify-identity`** when MegLive is missing. |
| `EXPO_PUBLIC_FACEID_SHARED_SECRET` | Optional Bearer token for FaceID routes (must match server). |

---

*Last updated to match `faceid-server/index.js` and `BatasMoApp/services/faceVerificationService.js`.*
