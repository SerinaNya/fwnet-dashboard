CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE maintainers (
  uuid TEXT PRIMARY KEY CHECK (length(uuid) > 0),
  name TEXT NOT NULL,
  remark TEXT NOT NULL,
  source TEXT NOT NULL
) STRICT;

CREATE TABLE asns (
  asn INTEGER PRIMARY KEY CHECK (typeof(asn) = 'integer' AND asn BETWEEN 1 AND 4294967295),
  country_code TEXT NOT NULL,
  subdivision_code TEXT NOT NULL,
  descr TEXT NOT NULL,
  remark TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE asn_maintainers (
  asn INTEGER NOT NULL,
  maintainer_uuid TEXT NOT NULL,
  PRIMARY KEY (asn, maintainer_uuid),
  FOREIGN KEY (asn) REFERENCES asns(asn) ON DELETE CASCADE,
  FOREIGN KEY (maintainer_uuid) REFERENCES maintainers(uuid) ON DELETE RESTRICT
) STRICT;

CREATE TABLE roas (
  uuid TEXT PRIMARY KEY CHECK (length(uuid) > 0),
  route TEXT NOT NULL,
  prefix_length INTEGER NOT NULL CHECK (prefix_length BETWEEN 0 AND 128),
  address_bits INTEGER NOT NULL CHECK (address_bits IN (32, 128)),
  max_length INTEGER NOT NULL CHECK (max_length BETWEEN prefix_length AND address_bits),
  asn INTEGER CHECK (asn IS NULL OR (typeof(asn) = 'integer' AND asn BETWEEN 1 AND 4294967295)),
  descr TEXT NOT NULL,
  remark TEXT NOT NULL,
  country_code TEXT NOT NULL,
  subdivision_code TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asn) REFERENCES asns(asn) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX roas_tuple_unique
  ON roas(route, max_length, COALESCE(asn, -1));

CREATE TABLE import_provenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  source_path TEXT NOT NULL,
  provenance_json TEXT NOT NULL
) STRICT;
