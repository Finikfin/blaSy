CREATE TABLE IF NOT EXISTS import_profiles(
    name TEXT PRIMARY KEY,
    mapping_json TEXT NOT NULL,
    delimiter TEXT,
    encoding TEXT,
    type_mapping_json TEXT NOT NULL,
    default_account_id TEXT,
    default_currency TEXT
);
