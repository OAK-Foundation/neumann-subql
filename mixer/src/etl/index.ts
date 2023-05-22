import client from "../db";

const MAYBE_NEW_TASK = "new_task";

export interface ChangeColumn {
  name: string;
  type: string;
  value: any;
}

export interface ChangeRow {
  action: string;
  schema: string;
  table: string;
  columns: ChangeColumn[];
}

export const processChange = async (doc: ChangeRow): Promise<void|string[]> => {
  if (doc.action != "I") {
    // these are begin/commit
    return;
  }

  if (doc.columns?.length <= 0) {
    return;
  }

  const changes = new Set<string>();
  if (doc.table == "events") {
    if (doc.columns.some(a => a.name == "module" && a.value == "automationTime")) {
      const rawData = doc.columns.find(a => a.name == "data");
      const data = JSON.parse(rawData?.value || '{}');
      console.log("change doc: ", doc, data);
      if (data?.taskId) {
        await populateTask();
      }
    }
  }

  return Array.from(changes);
}

export const populateTask = async() => {
  const taskHeight = await client.query(`
    with data as (
    select
        events.id as event_id,
        events.block_height as block_height,
        events.idx as idx,
        events.module as module,
        events.method as method,
        events.extrinsic_id as extrinsic_id,
        events.timestamp as timestamp,

        events.data->>'taskId' as task_id,

        COALESCE(extrinsics.from_account_id, events.data->>'who') as task_creator_id,
        extrinsics.timestamp as task_created_at,
        extrinsics.id as task_created_extrinsic_id
    from extrinsics
    inner join events on extrinsics.id = events.extrinsic_id
    where events.data->>'taskId' is not null
            and events.method = 'TaskScheduled'
            and extrinsics.module = 'automationTime'
            and extrinsics.method  like 'schedule%'
    order by events.block_height asc, idx asc
    )

    insert into tasks (
        id, block_height, event_id, extrinsic_id, timestamp,
        creator_id,
        _id, _block_range)
    select
        d.task_id, d.block_height, d.event_id, d.extrinsic_id, d.timestamp,
        d.task_creator_id,
        to_uuid(d.task_id), int8range(d.block_height::int8, null)
    from data as d
    on conflict do nothing;
  `);

}
