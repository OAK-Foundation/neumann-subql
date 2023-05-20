#!/bin/sh

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<EOF
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION generate_ulid() RETURNS uuid
    AS \$\$
        SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') || encode(gen_random_bytes(10), 'hex'))::uuid;
    \$\$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION generate_block_ulid(block_epoch integer) RETURNS uuid
    AS \$\$
        SELECT (lpad(to_hex(floor(block_epoch * 1000)::bigint), 12, '0') || encode(gen_random_bytes(10), 'hex'))::uuid;
    \$\$ LANGUAGE SQL;

EOF