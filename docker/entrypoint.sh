#!/bin/sh
set -eu

node scripts/database.mjs migrate
exec "$@"
