import { currentContract } from './current.mjs';
import { targetFutureContract } from './target-future.mjs';

export { currentContract, targetFutureContract };

export const applicationContract = Object.freeze({
  contractVersion: 1,
  current: currentContract,
  targetFuture: targetFutureContract,
});
