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
}

class Wal2JSONListener {
  readonly slotname: string;
  readonly timeout: number;
  readonly temporary: boolean;

  readonly walOptions: WalOptions;

  readonly query: string;
  readonly queryParams: string[];

  running: boolean;
  readonly client;

  constructor(client, {slotname, timeout, temporary}: LogicalStreamOptions, walOptions: WalOptions) {
    this.client = client;

    this.slotname = slotname;
    this.temporary = temporary || false;

    this.walOptions = walOptions;

    this.query = "SELECT data FROM pg_logical_slot_get_changes($1, NULL, NULL, 'pretty-print', '1', 'format-version', '2', 'add-tables', $2, 'actions', $3)";
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
      const results = await this.client.query(this.query, this.queryParams);
      if (!this.running) {
        return
      }

      if (results.rows.length > 0) {
        yield results.rows
      }
    }
  }

}

export default Wal2JSONListener;
