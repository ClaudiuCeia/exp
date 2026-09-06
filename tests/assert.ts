import { expect } from "bun:test";

export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  expect(condition, message).toBeTruthy();
}

export const assertEquals = (actual: unknown, expected: unknown): void => {
  expect(actual).toEqual(expected);
};

export const assertMatch = (actual: string, expected: RegExp): void => {
  expect(actual).toMatch(expected);
};

export const assertStringIncludes = (
  actual: string,
  expected: string,
): void => {
  expect(actual).toContain(expected);
};

type ErrorConstructor = abstract new (...args: never[]) => Error;

export const assertThrows = (
  fn: () => unknown,
  ErrorClass?: ErrorConstructor,
  messageIncludes?: string,
): Error => {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeDefined();
  if (ErrorClass) expect(thrown).toBeInstanceOf(ErrorClass);
  if (messageIncludes) {
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(messageIncludes);
  }

  return thrown as Error;
};
