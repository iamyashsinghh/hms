# HMS mobile (Expo)

One codebase, four apps. `APP_VARIANT` picks the app at build time (`eas build --profile <variant>-preview`).

| Variant | Opens on | Screens | API modules |
| --- | --- | --- | --- |
| `doctor` | Queue | Today's queue (30 s refresh), patient chart with allergies and EMR timeline, call/start/complete token, e-prescription (edits the open consultation, allergy override, favourites, save or save and sign) | emr, frontoffice, core |
| `staff` | OPD | Token queue per doctor, patient chart, queue actions | frontoffice, setup, core |
| `owner` | Summary | Daily summary: collections vs yesterday, OPD visits, new patients, pending bills, payment modes, top doctors and services | reports |
| `patient` | My visits | OTP sign-in (own session), appointments, prescriptions, lab/scan reports, bills, family on the account | portal |

```bash
APP_VARIANT=doctor pnpm start                      # EXPO_PUBLIC_API_URL=http://<your-ip>:4000/api/v1 on a phone
pnpm typecheck && pnpm test                        # unit tests (no server needed)
MOBILE_LIVE_API=http://localhost:4000/api/v1 pnpm test   # + end-to-end OPD flow against a running API and worker
APP_VARIANT=owner npx expo export --platform android     # JS bundle check
```

How it is put together:

- `src/data/` has no React Native imports: `endpoints.ts` (every module path), `client.ts` (calls over
  `@hms/api-client`'s `Http`), `normalize.ts` (API JSON → view models), `rx.ts` (dosing, quantity, allergy rules
  mirrored from the EMR server). Unit tested in `test/`.
- When a module's route is not on the server (`404 Cannot GET …`), development builds show demo data with a
  yellow "Demo data" banner. Release builds show "not available on this server yet" instead and never fake data.
  Prescription writes never fall back.
- The doctor queue reads `GET /emr/queue`; until EMR is deployed it uses the front-office queue filtered to the doctor.
- Screens a module adds appear on Home through `src/modules/<key>/index.ts` (permission, or role while a
  module's permission keys are not seeded).
