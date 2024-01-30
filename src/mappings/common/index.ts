import {
  SubstrateBlock,
  SubstrateExtrinsic,
  SubstrateEvent,
} from "@subql/types";

import type { DispatchInfo } from "@polkadot/types/interfaces";
import { BN } from "@polkadot/util";
import { convertWeight } from "@polkadot/api-contract/base/util";

import { AccountInfo, EventRecord } from "@polkadot/types/interfaces/system";

import {
  Args,
  Block,
  Transfer,
  Endowed,
  Event,
  Extrinsic,
  Account,
  AccountSnapshot,
  TaskEvent,
  Collator,
} from "../../types";

import { BalanceSet } from "../../types/models/BalanceSet";
import { Deposit } from "../../types/models/Deposit";
import { Reserved } from "../../types/models/Reserved";
import { Unreserved } from "../../types/models/Unreserved";
import { Withdraw } from "../../types/models/Withdraw";
import { Slash } from "../../types/models/Slash";
import { ReservRepatriated } from "../../types/models/ReservRepatriated";

import {
  canonicalBlockID,
  canonicalEventID,
  canonicalExtrinsicID,
} from "./canonical_id";

class AccountInfoAtBlock {
  accountId: string;
  freeBalance: bigint;
  reserveBalance: bigint;
  totalBalance: bigint;
  snapshotAtBlock: bigint;
}


export async function findOrCreateBlock(substrateBlock: SubstrateBlock): Promise<String> {
  const { specVersion, timestamp, block, events } = substrateBlock;
  const blockHeight = block.header.number;
  const blockHash = block.hash

  const id = canonicalBlockID(substrateBlock);

  // Calculate weight
  // Ref: https://github.com/polkadot-js/api/blob/30a5d4ecaae64fdcc255d6036a294a692f27cb07/packages/api-contract/src/base/util.ts#L43-L52
  // on weightv1 weightv2 conversion
  let blockWeight = events.reduce((totalWeight: BN, event) => {
    const { event: { method, section, data } } = event;
    let weight = new BN(0);
    if (section === "system" && ["ExtrinsicFailed", "ExtrinsicSuccess"].includes(method)) {
      let w = ((method === "ExtrinsicSuccess" ? data[0] : data[1]) as DispatchInfo).weight;
      // TODO: Index weight v2 with both of refTime and proofSize
      return totalWeight.iadd(convertWeight(w).v1Weight);
    }

    return totalWeight.iadd(weight)
  }, new BN(0));

  const record = {
    id,
    specVersion,
    timestamp,
    hash: blockHash.toString(),
    height: blockHeight.toBigInt(),
    weight: BigInt(blockWeight.toNumber()),
  }

  await store.set(`Block`, id, record);

  return record.id;
}


export function composeEvent(substrateEvent: SubstrateEvent): Event {
  const { idx, block, event, extrinsic } = substrateEvent;
  const blockHeight = block.block.header.number;

  let callId = null;
  if (typeof extrinsic !== 'undefined') {
    callId = canonicalExtrinsicID(extrinsic);
  }

  const blockId = canonicalBlockID(block);
  const eventId = canonicalEventID(substrateEvent);

  const record = new Event(
      eventId,
      blockHeight.toBigInt(),
      idx,
      event.section,
      event.method,
      event.data.meta.docs.join(" "),
      block.timestamp
  )
  record.data = event.data.toHuman() as Args
  record.extrinsicId = callId
  record.blockId = blockId

  return record;
}

export async function findOrCreateEvent(substrateEvent: SubstrateEvent): Promise<String> {
  const { idx, block, event, extrinsic } = substrateEvent;
  const blockHeight = block.block.header.number;

  let callId = null;

  if (typeof extrinsic !== 'undefined') {
    const { section: extrinsicModule, method: extrinsicMethod } = extrinsic.extrinsic.method;

    // Skip indexing events for mandatory system extrinsics
    if (extrinsicModule === 'timestamp' && extrinsicMethod === 'set') {
      return;
    }

    if (extrinsicModule === 'parachainSystem' && extrinsicMethod === 'setValidationData') {
        if ((event.section !== 'automationTime') && (event.section !== 'xcmpQueue')) {
            // we want to track anything related to our time/price automation,
            // adn xcmp so we can cross check the schedule from other chain
            return;
        }
    }

    callId = canonicalExtrinsicID(extrinsic);
  }

  const record = composeEvent(substrateEvent);
  const promises = [
    store.set(`Event`, record.id, record),
  ];


  // collator join event
  if (record.module == "parachainStaking" && record.method == "JoinedCollatorCandidates") {
    const address = extrinsic.extrinsic.signer.toString();
    const collator = Collator.create({
      id: address,
      joinedDate: block.timestamp
    });

    promises.push(collator.save());
  }

  if (record.module == "automationTime") {
    const data = event.data.toHuman() as { taskId?: string };

    if (data.taskId) {
      // break down the task 
      const ta = new TaskEvent(
        record.id,
        blockHeight.toBigInt(),
        idx,
        event.section,
        event.method,
        record.id,
        data["taskId"],
        block.timestamp
      );
      ta.extrinsicId = callId;
      promises.push(store.set(`TaskEvent`, ta.id, ta));
    }
  }

  await Promise.all(promises);
}

export function composeExtrinsic(substrateExtrinsic: SubstrateExtrinsic): Extrinsic {
  const { idx, block, extrinsic } = substrateExtrinsic;

  const blockHeight = block.block.header.number;
  const id = canonicalExtrinsicID(substrateExtrinsic);

  const args = extrinsic.method.toHuman()['args'];
  logger.debug(`
  Block: ${block.block.header.number}, Signer: ${extrinsic.signer}
  -------------
    ${JSON.stringify(substrateExtrinsic, null, 1)}

  =============
  `);

  const record = new Extrinsic(
    id,
    blockHeight.toBigInt(),
    idx,
    extrinsic.method.section,
    extrinsic.method.method,
    substrateExtrinsic.success,
    block.timestamp,
    extrinsic.hash.toString()
  );

  record.args = args
  record.fromAccountId = extrinsic.signer.toString()

  return record;
}

export function wrapExtrinsics(wrappedBlock: SubstrateBlock): SubstrateExtrinsic[] {
  return wrappedBlock.block.extrinsics.map((extrinsic, idx) => {
    const events = wrappedBlock.events.filter(
      ({ phase }) => phase.isApplyExtrinsic && phase.asApplyExtrinsic.eqn(idx)
    );
    return {
      idx,
      extrinsic,
      block: wrappedBlock,
      events,
      success:
        events.findIndex((evt) => evt.event.method === "ExtrinsicSuccess") > -1,
    };
  });
}

export async function findOrCreateExtrinsic(substrateExtrinsic: SubstrateExtrinsic): Promise<String> {
  const record = composeExtrinsic(substrateExtrinsic);
  await store.set(`Extrinsic`, record.id, record);

  return record.id;
}


export async function takeAccountSnapshot(
  blockNumber: bigint,
  accounts4snapshot: string[]
) {
  let data = await api.query.system.account.multi(accounts4snapshot);

  Promise.all(accounts4snapshot.map(async (accountId, index) => {
    logger.info(`getAccountInfo at ${blockNumber} for address:${accountId}`);
    const raw: AccountInfo = data[index] as unknown as AccountInfo;
    let accountInfo: AccountInfoAtBlock;
    accountInfo = {
      accountId: accountId,
      freeBalance: raw ? raw.data.free.toBigInt() : BigInt(0),
      reserveBalance: raw ? raw.data.reserved.toBigInt() : BigInt(0),
      totalBalance: raw ? (raw.data.free.toBigInt() + raw.data.reserved.toBigInt()) : BigInt(0),
      snapshotAtBlock: blockNumber,
    };
    logger.info(
      `getAccountInfo at ${blockNumber} : ${accountInfo.accountId}--${accountInfo.freeBalance}--${accountInfo.reserveBalance}--${accountInfo.totalBalance}`
    );
    let id = `${blockNumber.toString()}-${accountId}`;
    let snapshotRecords = await AccountSnapshot.get(id);

    if (!snapshotRecords) {
      let newSnapshot: AccountSnapshot = AccountSnapshot.create({
        id: id,
        accountId: accountId,
        snapshotAtBlock: accountInfo.snapshotAtBlock,
        freeBalance: accountInfo.freeBalance,
        reserveBalance: accountInfo.reserveBalance,
        totalBalance: accountInfo.totalBalance,
      });
      await newSnapshot.save();
    }

    let accountRecord = await Account.get(accountId);
    if (!accountRecord) {
      accountRecord = Account.create({
        id: accountId,
        atBlock: blockNumber,
        freeBalance: accountInfo.freeBalance,
        reserveBalance: accountInfo.reserveBalance,
        totalBalance: accountInfo.totalBalance,
      });
      await accountRecord.save();
    } else {
      accountRecord.atBlock = blockNumber;
      accountRecord.freeBalance = accountInfo.freeBalance;
      accountRecord.reserveBalance = accountInfo.reserveBalance;
      accountRecord.totalBalance = accountInfo.totalBalance;
      await accountRecord.save();
    }
  }))
}
async function getAccountInfoAtBlockNumber(
  accountId: string,
  blockNumber: bigint
): Promise<AccountInfoAtBlock> {
  logger.info(`getAccountInfo at ${blockNumber} by addres:${accountId}`);
  const raw: AccountInfo = (await api.query.system.account(
    accountId
  )) as unknown as AccountInfo;

  let accountInfo: AccountInfoAtBlock;
  if (raw) {
    accountInfo = {
      accountId: accountId,
      freeBalance: raw.data.free.toBigInt(),
      reserveBalance: raw.data.reserved.toBigInt(),
      totalBalance: raw.data.free.toBigInt() + raw.data.reserved.toBigInt(),
      snapshotAtBlock: blockNumber,
    };
  } else {
    accountInfo = {
      accountId: accountId,
      freeBalance: BigInt(0),
      reserveBalance: BigInt(0),
      totalBalance: BigInt(0),
      snapshotAtBlock: blockNumber,
    };
  }
  logger.info(
    `getAccountInfo at ${blockNumber} : ${accountInfo.accountId}--${accountInfo.freeBalance}--${accountInfo.reserveBalance}--${accountInfo.totalBalance}`
  );
  return accountInfo;
}

async function handleEndowed(
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountId, balanceChange] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`New Endowed happened!: ${JSON.stringify(event)}`);

  let newEndowed = await Endowed.create({
    id: accountId,
    accountId: accountId,
    freeBalance: BigInt(balanceChange),
    reserveBalance: BigInt(0),
    totalBalance: BigInt(balanceChange),
    blockNumber: blockNum,
    timestamp: block.timestamp,
  });
  await newEndowed.save();

  return [accountId];
}

export const handleTransfer = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [from, to, balanceChange] = event.data.toJSON() as [
    string,
    string,
    bigint
  ];
  let blockNum = bn.toBigInt();

  logger.info(`New Transfer happened!: ${JSON.stringify(event)}`);

  // Create the new transfer entity
  const transfer = new Transfer(
    `${blockNum}-${index}`,
    to,
    from
  );

  transfer.blockNumber = blockNum;
  transfer.balanceChange = BigInt(balanceChange);
  transfer.timestamp = block.timestamp;

  await transfer.save();

  return [from, to];
};

//“AccountId” ‘s free balance =”Balance1”, reserve balance = “Balance2”
export const handleBalanceSet = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance1, balance2] = event.data.toJSON() as [
    string,
    bigint,
    bigint
  ];
  let blockNum = bn.toBigInt();

  logger.info(`BalanceSet happened!: ${JSON.stringify(event)}`);

  // Create the new BalanceSet entity
  const balanceSet = new BalanceSet(
    `${blockNum}-${index}`,
    accountToSet
  );
  balanceSet.blockNumber = blockNum;
  balanceSet.balanceChange = BigInt(balance1) + BigInt(balance2);
  balanceSet.timestamp = block.timestamp;

  await balanceSet.save();
  return [accountToSet];
};

//“AccountId” ’s free balance + “Balance”
export const handleDeposit = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Deposit happened!: ${JSON.stringify(event)}`);

  // Create the new Deposit entity
  const deposit = new Deposit(
    `${blockNum}-${index}`,
    accountToSet
  );

  deposit.blockNumber = blockNum;
  deposit.balanceChange = BigInt(balance);
  deposit.timestamp = block.timestamp;

  await deposit.save();
  return [accountToSet];
};

//“AccountId” ‘s free balance - “Balance”,“AccountId” ‘s reserve balance + “Balance”
export const handleReserved = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Reserved happened!: ${JSON.stringify(event)}`);

  // Create the new Reserved entity
  const reserved = new Reserved(
    `${blockNum}-${index}`,
    accountToSet
  );

  reserved.blockNumber = blockNum;
  reserved.balanceChange = BigInt(balance);
  reserved.timestamp = block.timestamp;

  await reserved.save();

  return [accountToSet];
};

//“AccountId” ‘s free balance + “Balance”, “AccountId” ‘s reserve balance - “Balance”
export const handleUnreserved = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Unreserved happened!: ${JSON.stringify(event)}`);

  // Create the new Reserved entity
  const unreserved = new Unreserved(
    `${blockNum}-${index}`,
    accountToSet
  );

  unreserved.blockNumber = blockNum;
  unreserved.balanceChange = BigInt(balance);
  unreserved.timestamp = block.timestamp;

  await unreserved.save();

  return [accountToSet];
};

//“AccountId” ‘s free balance - “Balance”
export const handleWithdraw = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Withdraw happened!: ${JSON.stringify(event)}`);

  // Create the new Withdraw entity
  const withdraw = new Withdraw(
    `${blockNum}-${index}`,
    accountToSet
  );

  withdraw.blockNumber = blockNum;
  withdraw.balanceChange = BigInt(balance);
  withdraw.timestamp = block.timestamp;

  await withdraw.save();

  return [accountToSet];
};

//“AccountId” ‘s total balance - “Balance”
//(hard to determine if the slash happens on free/reserve)
//If it is called through internal method “slash”, then it will prefer free balance first but potential slash reserve if free is not sufficient.
//If it is called through internal method “slash_reserved”, then it will slash reserve only.
export const handleSlash = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [accountToSet, balance] = event.data.toJSON() as [string, bigint];
  let blockNum = bn.toBigInt();

  logger.info(`Slash happened!: ${JSON.stringify(event)}`);

  // Create the new Withdraw entity
  const slash = new Slash(
    `${blockNum}-${index}`,
    accountToSet,
  );
  slash.blockNumber = blockNum;
  slash.balanceChange = BigInt(balance);
  slash.timestamp = block.timestamp;

  await slash.save();

  return [accountToSet];
};

/* -ReserveRepatriated(AccountId, AccountId, Balance, Status) 
    AccountId: sender  
    AccountId: receiver
    Balance: amount of sender's reserve being transfered
    Status: Indicating the amount is added to receiver's reserve part or free part of balance.
    “AccountId1” ‘s reserve balance - “Balance”
    “AccountId2” ‘s “Status” balance + “Balance” (”Status” indicator of free/reserve part) */

export const handleReservRepatriated = async (
  block: SubstrateBlock,
  substrateEvent: EventRecord,
  index: number
): Promise<string[]> => {
  const { event } = substrateEvent;
  const { timestamp: createdAt, block: rawBlock } = block;
  const { number: bn } = rawBlock.header;
  const [sender, receiver, balance, status] = event.data.toJSON() as [
    string,
    string,
    bigint,
    string
  ];
  let blockNum = bn.toBigInt();

  logger.info(`Repatraiated happened!: ${JSON.stringify(event)}`);

  //ensure that our account entities exist

  // Create the new Reserved entity
  const reservRepatriated = new ReservRepatriated(
    `${blockNum}-${index}`,
    receiver,
    sender
  );

  reservRepatriated.blockNumber = blockNum;
  reservRepatriated.balanceChange = BigInt(balance);
  reservRepatriated.timestamp = block.timestamp;

  await reservRepatriated.save();

  return [sender, receiver];
};

const handleEventDetail = {
  Endowed: handleEndowed,
  Transfer: handleTransfer,
  BalanceSet: handleBalanceSet,
  Deposit: handleDeposit,
  Reserved: handleReserved,
  Withdraw: handleWithdraw,
  Unreserved: handleUnreserved,
  Slash: handleSlash,
  ReservRepatriated: handleReservRepatriated,
};

export {
  handleEventDetail,
};
