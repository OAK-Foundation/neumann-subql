const { Pool } = require("pg");

const db = new Pool();

export const init = async () => {
  await db.connect();
  await db.query("set search_path to turing");
}

export const shutdown = async () => {
  await db.end();
}

const executor = {
  query: (sql: string, args?: any[]) => db.query(sql, args),
};

export default executor

const connMaps = new Map<string, object>(); 

// this is need when we run query that have to be pin to the same conneciton such as a  transaction
export const getConn = async (name: string) => {
  if (connMaps.get(name)) {
    return Promise.resolve(connMaps[name]);
  }

  connMaps[name] = await db.connect();
  return connMaps[name];
}
