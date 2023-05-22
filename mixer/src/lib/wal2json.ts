const _getReadQuery = function(walOptions, slotName){
  let changesSql = '';
  Object.keys(walOptions).forEach(function(option){

    const value = walOptions[option];
    changesSql += `, '${option}', '${value}'`;
  });

  const sql = `SELECT * FROM pg_catalog.pg_logical_slot_get_changes('${slotName}', NULL, NULL${changesSql});`;

  return {
    text: sql,
    rowMode: 'array'
  };
};

interface WalOptions {
  addTables: string;
}

interface LogicalStreamOptions {
  slotname: string;
  timeout: number;

  // temporary slot is automatically drop when transaction close and the position won't be record
  temporary?: boolean;

  batchSize?: number;
}

class Wal2JSONListener {
  readonly slotname: string;
  readonly timeout: number;
  readonly temporary: boolean;

  readonly walOptions: WalOptions;

  readonly query: string;
  readonly peek: string;
  readonly queryParams: string[];

  batchSize: number;
  running: boolean;
  readonly client;

  constructor(client, {slotname, timeout, temporary, batchSize}: LogicalStreamOptions, walOptions: WalOptions) {
    this.client = client;

    this.slotname = slotname;
    this.temporary = temporary || false;

    this.walOptions = walOptions;
    this.batchSize = batchSize || 10;

    this.query = `SELECT xid, data FROM pg_logical_slot_get_changes($1, NULL, ${this.batchSize}, 'pretty-print', '1', 'format-version', '2', 'add-tables', $2, 'actions', $3)`;
    this.peek = `SELECT xid, data FROM pg_logical_slot_peek_changes($1, NULL, ${this.batchSize}, 'pretty-print', '1', 'format-version', '2', 'add-tables', $2, 'actions', $3)`;

    this.queryParams = [
      this.slotname,
      walOptions.addTables,
      "insert",
    ];

    this.running = false;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  async *next() {
    while (this.running) {
      // because we don't manage the client, we let the consumer deal with the connection error and retrying logic
      //
      // first, we peek into the change
      const results = await this.client.query(this.peek, this.queryParams);
      if (!this.running) {
        return
      }

      if (results.rows.length > 0) {
        for (const row of results.rows) {
          yield row
        }
      }

      // once we process all the changes, commit it
      await this.client.query(this.query, this.queryParams);
    }
  }

}

export default Wal2JSONListener;
