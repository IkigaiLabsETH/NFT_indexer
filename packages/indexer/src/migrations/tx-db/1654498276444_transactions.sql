-- Up Migration

CREATE TABLE "transactions" (
  "hash" BYTEA NOT NULL,
  "from" BYTEA NOT NULL,
  "to" BYTEA NOT NULL,
  "value" NUMERIC NOT NULL,
  "data" BYTEA,
  "block_number" INT,
  "block_timestamp" INT,
  "gas_used" NUMERIC,
  "gas_price" NUMERIC,
  "gas_fee" NUMERIC
);


ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_pk"
  PRIMARY KEY ("hash");

CREATE INDEX "transactions_to_index"
  ON "transactions" ("to");

CREATE INDEX "transactions_data_4bytes_index"
  ON "transactions" (substring("data" FROM length("data") - 3));

-- Down Migration

DROP TABLE "transactions";