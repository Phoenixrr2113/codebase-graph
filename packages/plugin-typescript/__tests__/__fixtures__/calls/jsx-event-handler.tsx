// JSX onClick prop with arrow handler. Expected attribution: Function
// MyButton calls track (closure).

declare function track(eventName: string): void;

export function MyButton() {
  return <button onClick={() => track('click')}>Click</button>;
}
