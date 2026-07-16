# bma — Bad Messaging App

> you cant say i didnt warn you

bma was born the way all great software is born: live, at an event, in
front of an audience, with zero minutes allocated to taste. It broadcast every
message to every human with a socket open, saved nothing, validated nothing,
and called it a day.

It then enjoyed a two-year retirement in a forgotten directory.

It has since been un-retired — this time with the intent of shipping something
real. The persistence is real, the protocol is typed, the migrations are
tracked, the moderation is audited. Nobody can point to the exact commit where
the name stopped being accurate. For the record, `package.json` has been
calling it `good-messaging-app` since the second commit. It knew.

It runs, for real, at [bma.tjreigh.mobi](https://bma.tjreigh.mobi).

## The product

**Disposable group chats.** Make a room, share the link, talk. The room cleans
up after itself so you don't have to.

- Anyone can create a room. No account, no email, no onboarding carousel.
- Each room lives at an unguessable URL (`/r/k7m4p2qx`). The link *is* the
  invite system.
- Rooms are unlisted, not private. Unguessable is not encrypted — it's a chat
  room, not a bunker.
- A room expires 24 hours after its last message. Then it's gone: messages
  deleted, link 404s, no archive, no "upgrade to keep your memories."
- The homepage is still the original global chat from the demo, preserved like
  a museum exhibit that visitors keep writing on.

No read receipts, no typing indicators, no reactions, no threads, no presence
dots. This is a feature. There are rate limits — five rooms per ten minutes,
ten messages per ten seconds. Calm down.

## The boring parts, done properly

Suspiciously well-behaved, for a bad messaging app:

- SQLite persistence with a tracked, transactional migration runner
- A typed, validated WebSocket protocol; rooms are bound at connection time
  and broadcasts never cross them
- An expiration sweep that deletes dead rooms and hangs up their sockets
- An admin dashboard with search, cursor pagination, room management, and an
  audit record for every moderation action
- Login throttling, CSRF and same-origin checks, strict CSP, versioned deploys

## There is, regrettably, a moderator

Even a disposable chat app needs a bouncer. There's an admin dashboard at
`/admin/`, and it stays entirely disabled unless all three `ADMIN_*`
environment variables are configured — by default the app remains gloriously
unsupervised.

`yarn admin:credentials` generates a password, its scrypt hash, and a session
secret. The hash and secret go in the server environment and nowhere else;
`.env.example` lists the names, never the values. Sessions last eight hours in
secure, HTTP-only, host-locked cookies, logins are throttled, and every
moderation action — deleting a message, closing a room — is written to an
audit log, because absolute power should at least leave a paper trail.

From the dashboard an admin can search and page through message history,
delete messages, browse rooms with expiry times and message counts, filter
messages to one room, and close a room — ejecting everyone in it on the spot,
which is exactly as satisfying as it sounds.

## Development

Requires Node.js 24 and Yarn.

```sh
yarn install
yarn start
```

The server listens on `http://127.0.0.1:3000` by default. Database migrations
run automatically when the application starts.

### Project layout

- `src/` — TypeScript application and CLI source
- `tests/` — unit and integration tests
- `web/` — browser assets copied into the build output
- `database/migrations/` — ordered SQLite migrations
- `deploy/` — production process and proxy configuration
- `scripts/` — build support scripts
- `dist/` and `data/` — ignored generated and runtime state

## Commands

```sh
yarn build
yarn test
yarn admin:credentials
```
