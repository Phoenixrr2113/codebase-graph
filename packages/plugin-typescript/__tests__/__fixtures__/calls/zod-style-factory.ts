// Models zod's $ZodCheckMultipleOf — the case that motivated this whole fix.
// Expected attribution: Variable $ZodCheckMultipleOf calls floatSafeRemainder (closure).

declare function $constructor<T>(name: string, init: (inst: T, def: unknown) => void): T;
declare const util: { floatSafeRemainder: (a: number, b: number) => number };

interface ZodCheck {
  _zod: { check: (payload: { value: number }) => void };
}

export const $ZodCheckMultipleOf = $constructor<ZodCheck>(
  '$ZodCheckMultipleOf',
  (inst, _def) => {
    inst._zod.check = (payload) => {
      util.floatSafeRemainder(payload.value, 0.1);
    };
  },
);
