import client from "../db";
import * as Sentry from '@sentry/node';

const MAYBE_NEW_TASK = "new_task";
const DEBUG = process.env["DEBUG"] == "1";

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

enum TaskStatus {
  Active    = 'active',
  Completed = 'completed',
  Canceled  = 'cancelled',
}

const TaskScheduledEvent = 'TaskScheduled', 
      TaskCanceledEvent  = 'TaskCancelled',
      TaskCompletedEvent = 'TaskCompleted';

export const processChange = async (doc: ChangeRow, api): Promise<void|string[]> => {
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
      console.log("automationTime event", data);
      if (data?.taskId) {
        if (doc.columns.some(a => a.name == "method" && a.value == TaskScheduledEvent)) {
          // TODO: This query isn't efficent enough, it doesn't track last populate. 
          await populateTask();
        }
        if (doc.columns.some(a => a.name == "method" && a.value == TaskCompletedEvent)) {
          await updateTaskStatus(TaskStatus.Completed);
        }
        if (doc.columns.some(a => a.name == "method" && a.value == TaskCanceledEvent)) {
          await updateTaskStatus(TaskStatus.Canceled);
        }

        if (doc.columns.some(a => a.name == "method" && ["TaskExecuted", "TaskExecutionFailed"].includes(a.value))) {
          await updateTaskMetric(data.taskId);
        }
      }
    }
  }

  if (doc.table == "blocks") {
    const blockHash = doc.columns.find(c => c.name == "hash")?.value;
    const blockId = doc.columns.find(c => c.name == "id")?.value
    await populateBlockMetadata(blockHash, blockId, api)

    // task need to be populated first
    await populateTask();
    // Now we can update the status and metrics
    await Promise.all([
        updateTaskStatus(TaskStatus.Completed),
        updateTaskStatus(TaskStatus.Canceled),
    ]);
  }

  return Array.from(changes);
}

export const populateBlockMetadata = async(blockHash, blockId, api) => {
  try {
    const header = await api.derive.chain.getHeader(blockHash);
    const v = header.toHuman();
    await client.query(`update turing.blocks
    set collator_id = $1, state_root=$2, extrinsics_root=$3
    where id = $4`, [header.author.toString(), v.stateRoot, v.extrinsicsRoot, blockId]);
  } catch (e) {
    console.log(`error when populate block metadata`, e);
  }
  return;
}

export const populateTask = async() => {
  const query = `
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
        creator_id, status,
        _id, _block_range)
    select
        d.task_id, d.block_height, d.event_id, d.extrinsic_id, d.timestamp,
        -- when task first scheduled, it's in actived status
        d.task_creator_id, 'active' as status,
        to_uuid(d.task_id), int8range(d.block_height::int8, null)
    from data as d
    on conflict do nothing;
  `;

  try {
    await client.query(query);
  } catch (e) {
    console.log("error when populating task", e, query)
    Sentry.captureException(e);
  }
}

export const updateTaskStatus = async(status: TaskStatus) => {
  let method: string = TaskCompletedEvent;

  let flagColumn = 'completed_at';
  if (status == TaskStatus.Canceled) {
    method = TaskCanceledEvent;
    flagColumn = 'canceled_at';
  };

  
  const query = `
    with filter_tasks as (
        select 
          event_id, task_id, method, timestamp as event_at
        from task_events
        inner join tasks on tasks.id=task_events.task_id and (tasks.status is null or task.status != $2)
        where module = 'automationTime' and method = $1
    )
    update tasks 
        set status = $2,
            ${flagColumn} = c.event_at
    from filter_tasks as c
    where c.task_id = tasks.id and (status is null or status != $2)
  `;

  try {
    await client.query(query, [method, status]);
  } catch (e) {
    console.log("error when updating task status", e, query)
    Sentry.captureException(e);
  }
}

export const updateTaskMetric = async(taskId: String) => {
  const query = `
    with task_run as (
      select 
       count(*) as occurence,
       task_id 
      from task_events 
      
      where method in(
        -- old native transfer event when run, 
        'SuccessfullyTransferredFunds', 'TransferFailed', 
        -- old xcmp 
        'XcmpTaskSucceeded', 'XcmpTaskFailed',

        -- auto compounted task
        'SuccesfullyAutoCompoundedDelegatorStake',
        'AutoCompoundDelegatorStakeFailed',

        -- old dynamic dispatch
        'DynamicDispatchResult',
        'CallCannotBeDecoded',

        'TaskExecuted',
        'TaskExecutionFailed'
      ) -- and task_id = $1

      -- not necesarily but prepare to batch update mult task later. for now, we do one by one udpate.
      group by task_id 
    )

    update tasks
    set executed_count=r.occurence
    from task_run as r
    where tasks.id = r.task_id
  `;

  try {
    await client.query(query, [taskId]);
  } catch (e) {
    console.log("error when updating task metric", e, query)
    Sentry.captureException(e);
  }
}
