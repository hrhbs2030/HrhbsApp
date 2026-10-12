#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
# Retained legacy data is outside the active ORM models. A blanket push could
# propose dropping it. Verify the reviewed migration schema without mutating it.
pnpm --filter @workspace/db exec node scripts/verify-existing-schema.mjs
