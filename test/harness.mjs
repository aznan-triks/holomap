let ok = 0, ko = 0;
export function check(name, condition) {
  if (condition) { ok++; console.log(`  ok    ${name}`); }
  else { ko++; console.log(`  FAIL  ${name}`); }
}
export function summary() {
  console.log(`\n${ok} ok, ${ko} failed`);
  if (ko > 0) process.exit(1);
}
