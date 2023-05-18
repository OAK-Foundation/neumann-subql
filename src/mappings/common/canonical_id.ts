import {
  SubstrateBlock,
  SubstrateExtrinsic,
  SubstrateEvent,
} from "@subql/types";

export function canonicalBlockID(substrateBlock: SubstrateBlock): string {
  const { block } = substrateBlock;
  return `${block.header.number}`;
}

export function canonicalEventID(substrateEvent: SubstrateEvent): string {
  const { idx, block } = substrateEvent;
  const blockHeight = block.block.header.number;
  return `${blockHeight}-${idx}`;
}

export function canonicalExtrinsicID(substrateExtrinsic: SubstrateExtrinsic): string {
  const { idx, block } = substrateExtrinsic;
  const blockHeight = block.block.header.number;
  return `${blockHeight}-${idx}`;
}
