const { Client } = require("pg");

import Wal2JSONListener from "./lib/wal2json";

const client = new Client();
const mixerSlot = "turing_mixer";

const initDb = async () => {
  await client.connect();
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
  await client.close();
}

const listen = async() => {
  // Now listen to the change
  const changeFeed = new Wal2JSONListener(
    client,
    {slotname: mixerSlot, temporary: false, timeout: 500},
    {addTables: "turing.extrinsics,turing.events"}
  )
  changeFeed.start();

  try {
    for await (const rows of changeFeed.next()) {
      for (const row of rows) {
        const data = JSON.parse(row.data);
        if (data.action == "I") {
          console.log("got change", data);
        }
      }
    }
  } catch (e) {
    console.log("error when fetching changeset.", e);
    shutdown()
  }
}

const setupSignal = async () => {
  process.on("SIGINT", async function () {
    console.log("receive sigint, start shutting down process")
    await client.end()
  })
}

Promise.all([
  initDb(),
  setupSignal(),
]).then(() => {
  listen();
  console.log("mixer booted succesfully, start running");
})
