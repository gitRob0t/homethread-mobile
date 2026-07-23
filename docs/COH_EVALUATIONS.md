# Coh reliability evaluations

Coh has two automated test layers:

1. Offline contracts verify that the deployed function still contains the non-negotiable interaction, confirmation, retry, validation, and telemetry safeguards.
2. Live scenarios exercise the real authenticated Edge Function across multiple turns without approving a write. Each test conversation is canceled afterward.

Run the offline suite on every change:

```bash
npm run eval:coh
```

Run the live suite with a dedicated test household and short-lived test-user access token:

```bash
COHO_EVAL_ACCESS_TOKEN="SHORT_LIVED_USER_JWT" \
COHO_EVAL_HOUSEHOLD_ID="TEST_HOUSEHOLD_UUID" \
COHO_EVAL_TIMEZONE="America/New_York" \
npm run eval:coh
```

Use a dedicated test account and household. Never commit the access token. CI should inject it as an encrypted secret and rotate it regularly.

The current scenarios protect the highest-value behaviors:

- “I have a haircut” starts an event workflow and asks for the date/time instead of listing capabilities.
- Short follow-up answers preserve the working draft.
- Place and reminder corrections merge into the same proposal.
- Chore due time and game-time reward extraction remain structured.
- The assistant does not execute any proposal until explicit confirmation.
- Every conversation is traceable by prompt version, model, status, missing fields, action status, attachment count, and latency without storing message content in telemetry.
