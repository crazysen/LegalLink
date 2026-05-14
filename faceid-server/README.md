# FaceID proxy (Megvii)

Implements Megvii FaceID **`get_biz_token`** (with your uploaded ID as `image_ref1`) and **`verify`** (MegLive SDK output → Megvii). Your mobile app must never contain `FACEID_API_SECRET`.

## Setup

1. Copy `.env.example` to `.env` and set **`FACEID_API_KEY`** and **`FACEID_API_SECRET`** from the **FaceID** console (they may differ from Face++ Open Platform keys).
2. `npm install` then `npm start` (default port **4001**).
3. Merge these routes into **batasmo-web** (same paths: `/faceid/biz-token`, `/faceid/verify`) or put this service behind your gateway.

## Mobile

- Point **`EXPO_PUBLIC_BATASMO_WEB_API_URL`** at the host that serves the FaceID routes (same base as `/verify-identity`).
- Implement **`NativeModules.BatasMoMegLive.startLiveness(bizToken)`** using Megvii’s MegLive SDK; return `{ megliveFileUri }` for `POST /faceid/verify`.
- Enable **`EXPO_PUBLIC_FACEID_LIVENESS_ENABLED=true`** after the native module exists.

## References

- [get_biz_token](https://faceid.com/faceid-open-doc/docs/idverify-api-getbiztoken.html)
- [verify](https://faceid.com/faceid-open-doc/docs/idverify-api-verify.html)
