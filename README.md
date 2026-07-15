# HomeThread Mobile

HomeThread is a shared family command center for calendars, chores, messages, notes, daily recaps, and household integrations.

## Current native MVP

- Bright Bento home dashboard with saved dark mode
- Native bottom navigation and iPhone safe-area layout
- Shared calendar and upcoming events
- Assignable, completable chores
- Family chat with local message composition
- Shared notes, recap, integration, and settings screens
- Quick-add sheet for events, chores, notes, and messages
- Local iOS notification permission and test notification flow
- Integration state foundations for Apple Calendar, Google Calendar, Outlook, Skylight, email, and automations

The current repository is a functional front-end MVP. Authentication, cloud persistence, real-time family synchronization, provider OAuth, production email delivery, and backend automation processing are the next implementation layer.

## Run locally

```bash
npm install
npm run typecheck
npm start
```

Scan the Expo QR code with a compatible development client, or run `npm run ios` with Xcode and an iOS simulator available.

## App Store path

1. Replace the placeholder EAS project ID in `app.json` by running `eas init`.
2. Confirm ownership of the `com.homethread.family` bundle identifier or change it.
3. Add production backend and OAuth environment values through EAS secrets.
4. Create an Apple Developer app record and App Store Connect listing.
5. Run `eas build --platform ios --profile production`.
6. Test through TestFlight.
7. Run `eas submit --platform ios --profile production` after approval.

## Security baseline

- Do not store provider client secrets in the mobile app.
- Keep family data tenant-scoped and encrypted in transit and at rest.
- Use short-lived access tokens and platform keychain storage.
- Require explicit family-admin approval for invitations and integrations.
- Provide export, retention, account deletion, and child-data controls.
- Keep AI-generated recaps private to the household and exclude them from model training by default.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the production design.
