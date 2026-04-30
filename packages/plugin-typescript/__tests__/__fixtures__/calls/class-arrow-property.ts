// Class field whose value is an arrow function. Expected attribution: Variable
// handler (the field) calls doWork (direct — no anonymous wrappers between
// the field's value and the call).
// Also a normal method for contrast — Function method calls otherWork (direct).

declare function doWork(): void;
declare function otherWork(): void;

export class Foo {
  handler = () => {
    doWork();
  };

  method() {
    otherWork();
  }
}
