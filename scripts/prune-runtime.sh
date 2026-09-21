#!/usr/bin/env bash
#
# Removes packages that Prisma 7 drags into the production tree but that the
# *running service* never loads.
#
# `@prisma/client@7` declares a hard dependency on `prisma` — the CLI — so
# `npm ci --omit=dev` still installs Prisma Studio, the migration engines, a
# bundled Postgres (pglite), TypeScript and effect. That is ~165 MB of files
# that exist for `prisma migrate` and `prisma studio`. Migrations do run on the
# server — once, during the deploy, before this prune — but the running
# service never loads them, so the tree `current` points at is pruned.
#
# This is safe only because it is verified, not assumed: scripts/smoke-dist.sh
# boots the pruned tree and exercises a real database query before the tarball
# is built. If a future Prisma release moves something the runtime needs into
# this list, the build fails instead of production.
set -euo pipefail

TREE="${1:?usage: prune-runtime.sh <node_modules path>}"

PRUNE=(
  "@prisma/studio-core"      # Prisma Studio's web UI
  "@prisma/studio-core-licensed"
  "@prisma/dev"              # `prisma dev` local server
  "@prisma/engines"          # migration/format engines — CLI only
  "@prisma/engines-version"
  "@electric-sql/pglite"     # bundled Postgres for `prisma dev`
  "effect"                   # CLI internals
  "typescript"               # CLI reads prisma.config.ts
  "@effect"
)

BEFORE="$(du -sm "$TREE" | cut -f1)"
for pkg in "${PRUNE[@]}"; do
  rm -rf "${TREE:?}/${pkg}"
done
AFTER="$(du -sm "$TREE" | cut -f1)"

echo "Pruned runtime tree: ${BEFORE} MB → ${AFTER} MB"
