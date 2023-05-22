import client, {
  init as initDb,
  shutdown as shutdownDb,
} from './db';

import Wal2JSONListener from "./lib/wal2json";
import {
  ChangeRow,
  processChange,
} from "./etl";

const mixerSlot = "turing_mixer";

const init = async () => {
  await initDb();
  console.log("initialized db");

  // setup replica slot
  const checkQuery = 'SELECT * FROM pg_replication_slots WHERE slot_name = $1;';
  const results = await client.query(checkQuery, [mixerSlot]);
  if(!results.rows.length){
    const startQuery = "SELECT pg_catalog.pg_create_logical_replication_slot($1, 'wal2json', $2);";
    await client.query(startQuery, [mixerSlot, false]);
  }
}

const shutdown = async () => {
  listener.stop();
  shutdownDb();
  process.exit(1);
}

const listener = new Wal2JSONListener(
  client,
  {slotname: mixerSlot, temporary: false, timeout: 500, batchSize: 5,},
  {addTables: "*.extrinsics,*.events"}
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
      await processChange(row);
    }
  } catch (e) {
    // TODO: add sentry
    console.log("error when fetching changeset: ", e);
    shutdown();
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
  listen();
  console.log("mixer booted succesfully, start running");
})
