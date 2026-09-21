#!/usr/bin/env bash
#
# Builds a deployable tarball **locally**.
#
# This exists because the server cannot build. TypeScript compilation peaks at
# 1–2 GB; the box has 993 MB available with 740 MB already swapped, running six
# other applications. `npm ci && npm run build` there would thrash swap hard
# enough to degrade every one of them. So the artefact is produced here and
# shipped whole.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="${OUT_DIR:-release}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARBALL="$OUT_DIR/planner-api-${STAMP}.tar.gz"

echo "Cleaning…"
rm -rf dist node_modules_prod
mkdir -p "$OUT_DIR"

echo "Installing build dependencies…"
npm ci

echo "Generating the Prisma client…"
npx prisma generate

echo "Type-checking…"
npm run typecheck

echo "Testing…"
npm test -- --ci

echo "Building…"
npm run build

# Production dependencies only, installed into a staging tree so the tarball
# carries no devDependencies.
#
# `--os=linux --cpu=x64` matters: this builds on macOS/arm64 and runs on
# Linux/x64, and npm otherwise resolves optional platform-specific packages for
# the build host. It is safe here only because nothing in the production tree is
# native — Prisma 7 with the `PrismaPg` driver adapter ships no query-engine
# binary, which is what makes shipping node_modules across platforms viable at
# all. `verify-portable.sh` fails the build if that ever stops being true.
echo "Installing production dependencies (linux/x64)…"
mkdir -p node_modules_prod
cp package.json package-lock.json node_modules_prod/
(cd node_modules_prod && npm ci --omit=dev --no-audit --no-fund --os=linux --cpu=x64)

# The generated client lives in node_modules/.prisma/client, which `npm ci`
# does not create — `@prisma/client/default.js` requires it and the service
# cannot boot without it. It is pure JavaScript (Prisma 7 with a driver adapter
# ships no engine binary), so copying it across platforms is sound.
echo "Copying the generated Prisma client…"
rm -rf node_modules_prod/node_modules/.prisma
cp -R node_modules/.prisma node_modules_prod/node_modules/.prisma

echo "Verifying the tree is portable…"
./scripts/verify-portable.sh node_modules_prod/node_modules

# Prisma 7's client depends on the Prisma CLI, so `--omit=dev` still drags in
# Studio, the engines and a bundled Postgres. None of it runs on the server.
./scripts/prune-runtime.sh node_modules_prod/node_modules

# …and prove the pruned tree actually works before shipping it.
./scripts/smoke-dist.sh node_modules_prod/node_modules

echo "Packing…"
# COPYFILE_DISABLE / --no-xattrs: macOS tar otherwise embeds per-file extended
# attributes that GNU tar on the server cannot read, producing one warning line
# per file — megabytes of noise that buries any real error in the deploy log.
export COPYFILE_DISABLE=1
tar --no-xattrs --no-mac-metadata -czf "$TARBALL" \
  dist \
  prisma \
  prisma.config.ts \
  package.json \
  package-lock.json \
  deploy \
  -C node_modules_prod node_modules

rm -rf node_modules_prod
echo "Built $TARBALL ($(du -h "$TARBALL" | cut -f1))"
