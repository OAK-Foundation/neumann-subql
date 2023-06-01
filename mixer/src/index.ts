import { ApiPromise, WsProvider } from "@polkadot/api";

import client, {
  init as initDb,
  shutdown as shutdownDb,
} from "./db";

import {
  migrate
} from "./migrate";

import Wal2JSONListener from "./lib/wal2json";
import {
  ChangeRow,
  processChange,
  populateBlockMetadata,
} from "./etl";

const mixerSlot = "turing_mixer";


const init = async () => {
  await initDb();
  console.log("initialized db");

  await migrate();
  console.log("migrated db");

  await initRPC();
  console.log("initialize rpc client");

  // setup replica slot
  const checkQuery = "SELECT * FROM pg_replication_slots WHERE slot_name = $1;";
  const results = await client.query(checkQuery, [mixerSlot]);
  if(!results.rows.length){
    const startQuery = "SELECT pg_catalog.pg_create_logical_replication_slot($1, 'wal2json', $2);";
    await client.query(startQuery, [mixerSlot, false]);
  }
}

let api = null;
const initRPC = async () => {
  const wsProvider = new WsProvider(process.env["RPC_ADDRESS"] || 'wss://rpc.turing-staging.oak.tech');
  api = await ApiPromise.create({ provider: wsProvider });
}

const shutdown = async () => {
  listener.stop();
  shutdownDb();
  process.exit(1);
}

const listener = new Wal2JSONListener(
  client,
  {slotname: mixerSlot, temporary: false, timeout: 500, batchSize: 5,},
  {addTables: "*.extrinsics,*.events,*.blocks"}
);

const listen = async() => {
  // Now listen to the change
  listener.start();

  try {
    for await (const change of listener.next()) {
      if (!change.data) {
        continue;
      }

      const row = JSON.parse(change.data);
      await processChange(row, api);
    }
  } catch (e) {
    // TODO: add sentry
    console.log("error when fetching changeset: ", e);
    shutdown();
  }
}

const backfill = async() => {
  while (true) {
    const result = await client.query('select id, hash from turing.blocks where collator_id is null limit 30');
    if (result && result.rows) {
      await Promise.all(result.rows.map(async (row) => {
        console.log("row", row);
        await populateBlockMetadata(row["hash"], row.id, api);
      }));
    }
  }
}

const setupSignal = async () => {
  process.on("SIGINT", async function () {
    console.log("receive sigint, start shutting down process")
    await shutdown();
  })
}

Promise.all([
  init(),
  setupSignal(),
]).then(() => {
  // backfill can be remove when we're catching up
  backfill();
  listen();
  console.log("mixer booted succesfully, start running");
})
