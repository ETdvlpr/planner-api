# planner-api

The backend for [Planner](../planner-mobile): accounts, domain CRUD for the web
client, and push/pull sync for the local-first mobile app.

NestJS 11 · Prisma 7 · PostgreSQL 16 · Firebase Auth · Cloudflare R2.

For *why* it is shaped this way, read [BACKEND-PLAN.md](BACKEND-PLAN.md). This
file is how to run it.

## Running it

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and FIREBASE_PROJECT_ID
createdb planner_dev
npx prisma migrate deploy
npm run start:dev
```

Swagger is at `http://localhost:3100/api/v1/docs`, health at
`http://localhost:3100/health` (unprefixed, unauthenticated, not rate-limited).

R2 credentials are optional in development: leave `STORAGE_*` blank and the
media endpoints return 503 while everything else works.

## Tests

```bash
npm test          # 64 unit tests, no database
npm run test:int  # 37 integration tests, needs Postgres
npm run typecheck
npm run lint
```

Integration tests skip themselves without `TEST_DATABASE_URL`:

```bash
createdb planner_test
DATABASE_URL=postgresql://localhost:5432/planner_test npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://localhost:5432/planner_test npm run test:int
```

## Deploying

```bash
./deploy.sh      # builds locally, ships a tarball, migrates, restarts
```

The build happens on your machine, never on the server — the VPS has 993 MB
available across six other applications and a TypeScript build peaks at 1–2 GB.
The deploy unpacks into `releases/<timestamp>/`, applies migrations, checks for
schema drift, swaps a symlink, and rolls back if `/health` does not answer
within 20 seconds.

## Layout

```
src/
  common/guards/          FirebaseAuthGuard — the only place identity enters
  common/crud/            ownership scoping, soft deletes, sequence stamping
  modules/<domain>/       dto · service · controller, one per resource
  modules/sync/           the push/pull engine and its registry
  modules/recurrence/     the Dart recurrence maths, ported and pinned by tests
  jobs/                   one-shot entry points for systemd timers
prisma/schema.prisma      the schema, and the sync wire contract
deploy/                   nginx vhost, systemd units, backup script
```

## Things to know before changing anything

**Ownership is never a parameter.** Handlers take `@UserId()`, derived from the
verified token. `ScopedCrudService` merges it into every `where` clause, and the
sync layer strips it from inbound rows. If you find yourself passing a user id
in from a request body, something has gone wrong.

**Every write needs a sequence number.** `SeqService` allocates it, and
`ScopedCrudService` stamps it automatically. A row written without one is
invisible to `GET /sync/pull` forever — the easiest way to lose data here.

**Nothing is hard-deleted.** `deletedAt` is set instead, because a hard delete
cannot replicate: a peer that never saw the row has no way to learn it is gone.

**The schema is a wire contract.** `prisma/schema.prisma` mirrors the Drift
tables in the mobile app, and the enum *values* are the Dart `Enum.name` strings
that Drift persists. Renaming one is a data migration, not a refactor.
`schema-parity.spec.ts` will tell you when the two drift apart.

**The mobile client is a test here.** `test/fixtures/client-push.json` is a
push recorded from the Flutter sync engine; `client-contract.int-spec.ts`
replays it. After changing the Drift schema, regenerate it from
`planner-mobile` with `WIRE_FIXTURE_OUT=../planner-api/test/fixtures/client-push.json
flutter test test/unit/wire_fixture_test.dart`.

**Recurrence exists twice.** The maths is implemented in Dart and again in
`recurrence.spec-model.ts`. They must agree; `recurrence.spec.ts` pins the
cases. If you change one, change both.
