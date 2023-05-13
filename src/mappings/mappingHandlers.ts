import {
  SubstrateBlock,
  SubstrateEvent,
  SubstrateExtrinsic,
} from "@subql/types";
import { Block, Transfer } from "../types";
import { Balance } from "@polkadot/types/interfaces";

import {
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

console.log("foo", handleEventDetail);

/*
 * Index block and all events in this block.
 * Find relevant account that changed its state to take a snapshot of those account
 * at this block height
 *
 */
export async function handleBlock(block: SubstrateBlock): Promise<void> {
	await findOrCreateBlock(block);

  // process individual events inside the block, find relevant changed account to take snapshot
  const accountToSnapshot = new Set<string>();

  const blockNumber = block.block.header.number.toBigInt();
  await Promise.all(block.events.map(async (event) => {
    const {
      event: { method, section, index },
    } = event;

    if (section === "balances") {
      logger.debug(
        `

        Block: ${blockNumber}, Event ${section}/${method};
        -------------
          ${JSON.stringify(event, null, 1)}

        =============
        `
      );

      if (handleEventDetail[method]) {
        let accounts: string[] = await handleEventDetail[method].call(handleEventDetail[method], block, event);
        accounts.forEach(a => accountToSnapshot.add(a));
      }
    }
  }));

  if (enableTakeAccountSnapshot === true && accountToSnapshot.size > 0) {
    await takeAccountSnapshot(blockNumber, Array.from(accountToSnapshot));
  }
}

export async function handleEvent(substrateEvent: SubstrateEvent): Promise<void> {
  // First we create main event to ensure it existed in the main table
  await findOrCreateEvent(substrateEvent);
}


export async function handleCall(extrinsic: SubstrateExtrinsic): Promise<void> {
  const callId = await findOrCreateExtrinsic(extrinsic);
}
