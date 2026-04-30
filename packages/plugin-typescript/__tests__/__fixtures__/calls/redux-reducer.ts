// Models a redux toolkit slice. Expected attribution: Variable counterSlice
// calls bumpCounter (closure, via the reducers.increment arrow).

declare function createSlice<T>(opts: T): T;
declare function bumpCounter(state: { value: number }): void;
declare function decrementCounter(state: { value: number }, action: { payload: number }): void;

export const counterSlice = createSlice({
  name: 'counter',
  reducers: {
    increment: (state: { value: number }) => {
      bumpCounter(state);
    },
    decrement: (state: { value: number }, action: { payload: number }) => {
      decrementCounter(state, action);
    },
  },
});
