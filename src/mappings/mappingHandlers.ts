import {
  SubstrateBlock,
  SubstrateEvent,
  SubstrateExtrinsic,
} from "@subql/types";
import { Block, Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";

import {
  composeEvent,
  composeExtrinsic,
  wrapExtrinsics,
	findOrCreateBlock,
	findOrCreateExtrinsic,
  findOrCreateEvent,

  handleEventDetail,

  takeAccountSnapshot,
} from "./common";

import {
  canonicalBlockID,
  canonicalEventID,
  canonicalExtrinsicID,
} from "./common/canonical_id";

const enableTakeAccountSnapshot: boolean = true;

/*
 * Index block and all events in this block.
 * Find relevant account that changed its state to take a snapshot of those account
 * at this block height
 *
 */
export async function handleBlock(block: SubstrateBlock): Promise<void> {
  // process individual events inside the block, find relevant changed account to take snapshot
  const accountToSnapshot = new Set<string>();
  const createBlock = findOrCreateBlock(block);

  const calls = wrapExtrinsics(block).map(ext => composeExtrinsic(ext));
  const createBulkExtrinsic = store.bulkCreate("Extrinsic", calls)

  let jobs = block.events.filter(event => {
    const {
      event: { section, method },
    } = event;

    // we only need to break down balances event if we implement such method
    return section === "balances" && handleEventDetail[method];
  }).map(async (event, index) => {
    const {
      event: { method, section },
    } = event;

    logger.info(`evt: ${method} ${section} ${index}`);
    let accounts: string[] = await handleEventDetail[method](block, event, index);
    accounts.forEach(a => accountToSnapshot.add(a));
  })

  await Promise.all([
    createBlock,
    createBulkExtrinsic,
    ...jobs,
  ]);

  if (enableTakeAccountSnapshot === true && accountToSnapshot.size > 0) {
    await takeAccountSnapshot(block.block.header.number.toBigInt(), Array.from(accountToSnapshot));
  }
}

export async function handleEvent(substrateEvent: SubstrateEvent): Promise<void> {
  // First we create main event to ensure it existed in the main table
  await findOrCreateEvent(substrateEvent);
}


export async function handleCall(extrinsic: SubstrateExtrinsic): Promise<void> {
  await findOrCreateExtrinsic(extrinsic);
}
