// File names come from the change, so its author picks them. Printed raw, a
// name holding a line break could forge a line of a report the agent trusts,
// such as a proof that a file it should read needs no reading.

/** Control characters, line separators, or a leading quote that would make a raw name read as a quoted one. */
const unsafe = /^"|[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

/** `file` as is when it prints on one line unambiguously, else quoted with every control character escaped. */
export function printablePath(file: string): string {
  if (!unsafe.test(file)) return file;
  return JSON.stringify(file).replace(/[\x7f-\x9f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
