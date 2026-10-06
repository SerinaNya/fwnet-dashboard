CREATE TABLE asns_epoch_ms (
  asn INTEGER PRIMARY KEY CHECK (typeof(asn) = 'integer' AND asn BETWEEN 1 AND 4294967295),
  country_code TEXT NOT NULL,
  subdivision_code TEXT NOT NULL,
  descr TEXT NOT NULL,
  remark TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer')
) STRICT;

CREATE TABLE roas_epoch_ms (
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
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
  FOREIGN KEY (asn) REFERENCES asns(asn) ON DELETE RESTRICT
) STRICT;
