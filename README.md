# FWNET Network Dashboard

FWNET network registry dashboard built with Next.js and Node.js built-in SQLite.

## Requirements

- Node.js 24.18 or later
- pnpm

## Local development

Install dependencies and apply the schema:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
```

Existing local databases are preserved. To initialize an empty database from a converted JSON dataset, import it explicitly using its path:

```sh
pnpm db:import -- /path/to/network.json
```

Import only succeeds when the database is empty; it does not replace an existing dataset. Start the development server with:

```sh
pnpm dev
```

Run the database checks with `pnpm db:verify`.

The dashboard currently uses the fixed demo identity `SerinaNya`; it does not provide OIDC or other user authentication.

## Docker deployment

The production image uses Node.js 24.18 on Debian slim. Docker Compose stores SQLite and its WAL files in the persistent `fwnet-data` named volume. The container runs schema migrations at startup but never imports or resets the dataset automatically.

The image does not include a dataset. Existing databases in the persistent volume are retained. To import an external converted JSON dataset into an empty database, mount it for the one-time import:

```sh
docker compose run --rm -v /path/to/network.json:/import/network.json:ro app node scripts/database.mjs import /import/network.json
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to change the host port. The container runs schema migrations at startup but never imports or resets the dataset automatically.

For HTTPS access through a reverse proxy, set `PUBLIC_ORIGIN` to the exact externally accessed origin, with no trailing slash, for example `https://dashboard.example.com`. Plain host access can leave `PUBLIC_ORIGIN` blank; the backend will fall back to the request host.

The `fwnet-data` volume survives container recreation and image updates. Back up the volume before upgrades or other maintenance. For a consistent file-level backup, stop the app before copying the SQLite database and its related WAL files. Do not remove the volume to troubleshoot startup unless you intend to delete the database.
