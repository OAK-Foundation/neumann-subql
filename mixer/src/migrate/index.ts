import client from "../db";

// Currently we only have a few migration so I don't bring in extra dependencies to manage it
// when we add a dozen more, switch to db-mate
export const migrate = async () => {
  // these 3 queries can run independently
  await Promise.all([
    client.query('alter table turing.blocks add column if not exists collator_id varchar(255)'),
    client.query('alter table turing.blocks add column if not exists state_root varchar(255)'),
    client.query('alter table turing.blocks add column if not exists extrinsics_root varchar(255)'),])

  // column need to be create before commit
  await Promise.all([
    client.query('create index concurrently if not exists blocks_collator on turing.blocks (collator_id);')
  ]);
}
