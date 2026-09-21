#!/usr/bin/env bash
#
# Fails if the production dependency tree contains anything that cannot be
# shipped from this machine to Linux/x64.
#
# The whole build-off-server strategy rests on this being true: the VPS has
# 791 MB available across six other applications, and `npm ci` there — never
# mind a native compile — is exactly the memory spike the strategy exists to
# avoid. If a future dependency introduces a native module, this stops the
# deploy here rather than producing a tarball that crashes on boot.
set -euo pipefail

TREE="${1:-node_modules}"
FAILED=0

if [ ! -d "$TREE/.prisma/client" ]; then
  echo "ERROR: $TREE/.prisma/client is missing — the generated Prisma client is"
  echo "       not in the tree and the service will fail on boot with"
  echo "       'Cannot find module .prisma/client/default'."
  exit 1
fi

# Compiled addons. `.node` files are ELF/Mach-O for one platform only.
NATIVE="$(find "$TREE" -name '*.node' -not -path '*/prebuilds/*' 2>/dev/null || true)"
if [ -n "$NATIVE" ]; then
  echo "ERROR: native addons in the production tree:"
  echo "$NATIVE"
  FAILED=1
fi

# Packages npm resolved for the build host rather than the target.
HOST_SPECIFIC="$(find "$TREE" -maxdepth 2 -type d \
  \( -name '*darwin*' -o -name '*-arm64*' -o -name '*win32*' \) 2>/dev/null || true)"
if [ -n "$HOST_SPECIFIC" ]; then
  echo "ERROR: build-host-specific packages in the production tree:"
  echo "$HOST_SPECIFIC"
  FAILED=1
fi

if [ "$FAILED" = 1 ]; then
  echo
  echo "Fix by installing production dependencies on a linux/x64 machine, or by"
  echo "removing the dependency. Do NOT work around this by building on the VPS."
  exit 1
fi

echo "Production tree is portable ($(du -sh "$TREE" | cut -f1))."
