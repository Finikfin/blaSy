CREATE TABLE IF NOT EXISTS model_cache(input_hash TEXT PRIMARY KEY,prompt_version TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,output_json TEXT NOT NULL,status TEXT NOT NULL);
