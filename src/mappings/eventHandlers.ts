import { SubstrateBlock, SubstrateEvent, SubstrateExtrinsic } from "@subql/types";
import { Block, Event, Extrinsic } from "../types";

export async function handleEvent(substrateEvent: SubstrateEvent): Promise<void> {
  const { idx, block, event, extrinsic } = substrateEvent;
  const blockHeight = block.block.header.number;

  let callId = null;
  if (typeof extrinsic !== 'undefined') {
    const { section: extrinsicModule, method: extrinsicMethod } = extrinsic.extrinsic.method;
    // Skip indexing events for mandatory system extrinsics
    if ((extrinsicModule === 'parachainSystem' && extrinsicMethod === 'setValidationData') ||
      (extrinsicModule === 'timestamp' && extrinsicMethod === 'set')) {
      return;
    }

    callId = await findOrCreateExtrinsic(extrinsic);
  }

  const blockId = await findOrCreateBlock(block);

  const eventAttributes = {
    id: `event-${blockHeight}-${idx}`,
    blockHeight: blockHeight.toBigInt(),
    idx: idx,
    module: event.section,
    method: event.method,
    data: event.data.toHuman(),
    docs: event.meta.docs.join(" "),
    extrinsicId: callId,
    timestamp: block.timestamp,
    blockId: blockId.toString(),
  }

  await Event.create(eventAttributes).save();
}

async function findOrCreateExtrinsic(substrateExtrinsic: SubstrateExtrinsic): Promise<String> {
  const { idx, block, extrinsic } = substrateExtrinsic;
  const blockHeight = block.block.header.number;
  const id = `extrinsic-${blockHeight}-${idx}`;

  const existingBaseExtrinsic = await Extrinsic.get(id)
  if (typeof existingBaseExtrinsic !== 'undefined') {
    return existingBaseExtrinsic.id;
  }

  const args = extrinsic.method.toHuman()['args'];

  const callAttributes = {
    id: id,
    blockHeight: blockHeight.toBigInt(),
    idx: idx,
    module: extrinsic.method.section,
    method: extrinsic.method.method,
    success: substrateExtrinsic.success,
    args: args,
    timestamp: block.timestamp
  }

  const record = Extrinsic.create(callAttributes);
  await record.save();
  return record.id;
}

async function findOrCreateBlock(substrateBlock: SubstrateBlock): Promise<String> {
  const { specVersion, timestamp, block } = substrateBlock;
  const blockHeight = block.header.number;
  const blockHash = block.hash
  const id = `block-${blockHeight}`;

  const existingBaseBlock = await Block.get(id)
  if (typeof existingBaseBlock !== 'undefined') {
    return existingBaseBlock.id;
  }

  const blockAttributes = {
    id: id,
    hash: blockHash.toString(),
    height: blockHeight.toBigInt(),
    specVersion: specVersion,
    timestamp: timestamp,
  }

  const record = Block.create(blockAttributes);
  await record.save();
  return record.id;
}