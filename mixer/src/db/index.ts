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

export const getConn = async () => {
  const conn = await db.connect();
  await conn.query("set search_path to turing");

  return conn;
}
