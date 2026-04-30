// Deeply nested anonymous arrows inside a Variable. Expected attribution:
// Variable runner calls innermost (closure).

declare function makeRunner<T>(fn: () => () => () => T): T;
declare function innermost(): number;

export const runner = makeRunner(() => () => () => innermost());
